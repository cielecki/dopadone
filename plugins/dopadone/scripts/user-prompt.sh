#!/usr/bin/env bash
# UserPromptSubmit hook — 4-phase sleep schedule + habit anchoring (v2.0).
#
# Time-of-day is classified into a phase (work | wrapup | evening | sleep) from
# configurable HH:MM boundaries. The sleep schedule is ORTHOGONAL to habits:
# habit-urgency interrupts fire all day exactly as before; the phase only adds
# an evening/sleep baseline on top. Three injection channels, all wrapped in
# <dopadone> XML tags so Claude can tell plugin output from conversation:
#
#   1. Blocking interrupt (probability-gated): rolls a die against P. If hit,
#      injects a directive telling Claude to DROP the request and respond with a
#      health reminder. Shape depends on phase:
#        work/wrapup → habit-driven single imperative (P = habit urgency)
#        evening     → refuse work + discover wind-down routine + persuade
#                      (P = max(evening_intensity, habit urgency), cap 99)
#        sleep       → near-total refusal (P forced to 100; override only)
#
#   2. Non-blocking wrap-up reminder (wrapup phase only): answer the request
#      NORMALLY and append one soft "wind the day down" sentence. Own cadence
#      (wrapup_reminder_interval_minutes) + intensity (wrapup_intensity).
#
#   3. Time-marker (when interval elapsed): a tiny
#      `<dopadone event="time-marker" date=".." time=".."/>` so Claude
#      doesn't lose wall-clock time in long conversations.
#
# All paths update a per-session "last injection" timestamp so the time-marker
# doesn't fire too often. Override phrase bypasses everything (the only escape
# from the sleep phase).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/inject.sh
source "$SCRIPT_DIR/../lib/inject.sh"

input_json="$(cat)"
prompt_text="$(echo "$input_json" | jq -r '.prompt // empty' 2>/dev/null || true)"
session_id="$(echo "$input_json" | jq -r '.session_id // "default"' 2>/dev/null || echo "default")"
transcript_path="$(echo "$input_json" | jq -r '.transcript_path // empty' 2>/dev/null || true)"

# --- Routine gate (interactive-only) -------------------------------------
# health-rhythm nudges + time-markers are for a HUMAN watching an interactive
# chat. Scheduled-task / autonomous runs (/dream, daily-inbox-triage, …) have no
# human present — the scheduler wraps the first turn with `<scheduled-task name=…
# file=…>This is an automated run of a scheduled task. The user is not present…`.
# Detect it and stay silent for the WHOLE session (later autonomous turns drop the
# wrapper, so we remember the session with a marker file).
#
# IMPORTANT (verified 2026-06-05 — the bug this rev fixes): that wrapper does NOT
# reliably land in the hook's `.prompt` field. A scheduled /dream run injected an
# interrupt at 07:52 and left routine-gate.log empty across every data dir —
# proving the `.prompt`-only match has never fired since the v2.3.0 gate shipped.
# The earlier "verified from routine transcripts" check looked at the TRANSCRIPT
# (which carries the wrapper), not the hook INPUT (which doesn't). The wrapper DOES
# sit in the transcript's opening user turn, so we also scan `transcript_path` for
# it. Entrypoint stays unusable — every session reports `claude-desktop`.
hr_routine_marker="$HR_DATA_DIR/routine-session-$(hr_sanitize_key "$session_id").txt"
hr_is_routine=0
case "$prompt_text" in
  *"<scheduled-task"*|*"automated run of a scheduled task"*) hr_is_routine=1 ;;
esac
if [ "$hr_is_routine" -eq 0 ] && [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  # Best-effort fallback: the scheduler wrapper sits in the transcript's opening
  # turn. head-bounded so a long interactive chat is never scanned in full.
  if head -c 131072 "$transcript_path" 2>/dev/null | grep -qF '<scheduled-task name='; then
    hr_is_routine=1
  fi
fi
# Diagnostic (off by default): export HR_DEBUG_ROUTINE=1 to log every call's
# detection inputs — lets a scheduled run leave evidence of the real `.prompt`
# shape + whether the transcript fallback matched, so the fix can be confirmed live.
if [ -n "${HR_DEBUG_ROUTINE:-}" ]; then
  mkdir -p "$HR_DATA_DIR" 2>/dev/null || true
  printf '%s\tcall\tsid=%s\troutine=%s\tplen=%s\ttp=%s\n' \
    "$(date -u +%FT%TZ)" "$session_id" "$hr_is_routine" "${#prompt_text}" "${transcript_path:+yes}" \
    >> "$HR_DATA_DIR/routine-gate.log" 2>/dev/null || true
fi
if [ "$hr_is_routine" -eq 1 ]; then
  mkdir -p "$HR_DATA_DIR" 2>/dev/null || true
  : > "$hr_routine_marker"
  printf '%s\troutine-detected\t%s\n' "$(date -u +%FT%TZ)" "$session_id" \
    >> "$HR_DATA_DIR/routine-gate.log" 2>/dev/null || true
  exit 0
fi
[ -f "$hr_routine_marker" ] && exit 0

# Override phrase — let through silently and clear retry state.
if [ -n "$prompt_text" ] && hr_prompt_overrides "$prompt_text"; then
  hr_retry_clear
  exit 0
fi

agenda="$(hr_get_agenda)"
if [ -z "$agenda" ]; then
  # No agenda (dopadone unavailable / misconfigured) → never interrupt.
  exit 0
fi

# Globally muted via `dopadone habits mute` → always silent.
muted="$(echo "$agenda" | jq -r '.muted')"
if [ "$muted" != "null" ]; then
  hr_retry_clear
  exit 0
fi

phase="$(hr_phase)"

# --- Wrap-up phase: non-blocking reminder channel (own cadence + intensity) ---
# Independent of the blocking channel below. Habits can STILL block during
# wrap-up (orthogonal); this just maybe adds a soft "wind the day down" nudge.
if [ "$phase" = "wrapup" ] && [ "$HR_WRAPUP_INTENSITY" -gt 0 ] && [ "$HR_WRAPUP_INTERVAL" -ge 0 ]; then
  mins_since_wrap="$(hr_minutes_since_wrapup "$session_id")"
  if [ "$mins_since_wrap" -ge "$HR_WRAPUP_INTERVAL" ]; then
    roll=$((RANDOM % 100))
    if [ "$roll" -lt "$HR_WRAPUP_INTENSITY" ]; then
      directive="$(hr_build_wrapup_directive)"
      hr_emit_wrapup "$directive"
      hr_record_wrapup "$session_id"
      hr_record_inject "$session_id"
      exit 0
    fi
  fi
  # fall through to the blocking (habit) channel — baseline is 0 in wrapup
fi

# --- Blocking interrupt channel (habit urgency + evening/sleep baseline) ---
p="$(hr_final_pct "$agenda" "$phase")"

should_interrupt=0
if [ "$p" -gt 0 ]; then
  roll=$((RANDOM % 100))
  if [ "$roll" -lt "$p" ]; then
    should_interrupt=1
  fi
fi

# Cross-session cooldown gate: even if dice hit, suppress this interrupt if the
# same habit fired one within HR_INTERRUPT_COOLDOWN_MINUTES. Prevents the same
# habit reminder cascading across N parallel Claude chats (and the resulting
# triple "mark done" state mutation).
#
# ONLY applies in the habit-driven phases (work / wrapup). The evening + sleep
# REFUSALS are deliberately exempt: they mutate no state, so fanning the same
# refusal across chats is harmless AND correct (you shouldn't work in ANY chat
# at night). A cooldown there would open 5-min silent windows where night work
# slips through un-refused — exactly what we're preventing.
cooldown_key=""
if [ "$should_interrupt" -eq 1 ] && [ "$HR_INTERRUPT_COOLDOWN_MINUTES" -gt 0 ] \
   && { [ "$phase" = "work" ] || [ "$phase" = "wrapup" ]; }; then
  focus="$(hr_pick_focus_habit "$agenda")"
  cooldown_key="$(hr_cooldown_key "$focus" "$phase")"
  mins_since_int="$(hr_minutes_since_interrupt "$cooldown_key")"
  if [ "$mins_since_int" -lt "$HR_INTERRUPT_COOLDOWN_MINUTES" ]; then
    should_interrupt=0
  fi
fi

if [ "$should_interrupt" -eq 1 ]; then
  # Interrupt path: record cooldown, bump retry, build directive, emit, record timestamp.
  [ -n "$cooldown_key" ] && hr_record_interrupt "$cooldown_key"
  retry="$(hr_retry_bump)"
  directive="$(hr_build_interrupt_directive "$agenda" "$phase" "$retry")"
  hr_emit_interrupt "$directive" "$phase" "$retry"
  hr_record_inject "$session_id"
  exit 0
fi

# No interrupt this turn (dice missed OR suppressed by cooldown) — clear retry
# counter, then maybe emit a time-marker.
hr_retry_clear

mins_since="$(hr_minutes_since_inject "$session_id")"
if [ "$mins_since" -ge "$HR_TIME_MARKER_INTERVAL" ]; then
  hr_emit_time_marker
  hr_record_inject "$session_id"
fi

exit 0
