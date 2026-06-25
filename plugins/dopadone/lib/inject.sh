#!/usr/bin/env bash
# Shared helpers for health-rhythm plugin hooks.
#
# Sourced (not invoked) by scripts/user-prompt.sh, session-start.sh, notification.sh.
# Reads configuration from CLAUDE_PLUGIN_OPTION_* environment variables that
# Claude Code injects based on the userConfig schema in .claude-plugin/plugin.json.
# Falls back to sensible defaults so the scripts also work outside a plugin context
# (useful during development and direct invocation).

set -u

# --- Config (env-var driven, defaults match plugin.json userConfig defaults) ---
# Boundaries are "HH:MM" local-clock strings (minute granularity — 23:30 is valid).
# Four phases, half-open windows: work [work_start, wrapup_start) →
# wrapup [wrapup_start, evening_start) → evening [evening_start, sleep_start) →
# sleep [sleep_start, work_start) wrapping midnight.
HR_DOPADONE_PATH="${CLAUDE_PLUGIN_OPTION_DOPADONE_PATH:-dopadone}"
HR_WORK_START="${CLAUDE_PLUGIN_OPTION_WORK_START:-07:00}"
HR_WRAPUP_START="${CLAUDE_PLUGIN_OPTION_WRAPUP_START:-22:00}"
HR_EVENING_START="${CLAUDE_PLUGIN_OPTION_EVENING_START:-23:00}"
HR_SLEEP_START="${CLAUDE_PLUGIN_OPTION_SLEEP_START:-23:30}"
HR_WRAPUP_INTENSITY="${CLAUDE_PLUGIN_OPTION_WRAPUP_INTENSITY:-35}"
HR_EVENING_INTENSITY="${CLAUDE_PLUGIN_OPTION_EVENING_INTENSITY:-70}"
HR_WRAPUP_INTERVAL="${CLAUDE_PLUGIN_OPTION_WRAPUP_REMINDER_INTERVAL_MINUTES:-15}"
HR_OVERRIDE_PHRASE="${CLAUDE_PLUGIN_OPTION_OVERRIDE_PHRASE:-wiem, override}"
HR_TIME_MARKER_INTERVAL="${CLAUDE_PLUGIN_OPTION_TIME_MARKER_INTERVAL_MINUTES:-20}"
HR_INTERRUPT_COOLDOWN_MINUTES="${CLAUDE_PLUGIN_OPTION_INTERRUPT_COOLDOWN_MINUTES:-5}"

# State + log live under CLAUDE_PLUGIN_DATA when running as a plugin, else
# fall back to a per-user dir under ~/.claude/state/.
HR_DATA_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/state}"
HR_RETRY_FILE="${HR_RETRY_FILE:-$HR_DATA_DIR/health-rhythm-retries.txt}"
HR_LOG_FILE="${HR_LOG_FILE:-$HR_DATA_DIR/health-rhythm-hook.log}"
HR_RETRY_WINDOW_SEC=300

# Absolute path to the bundled interrupt-protocol doc. The per-turn interrupt block
# stays compact (dynamic facts only) and points Claude here for the full how/why,
# read once per conversation. Resolved from THIS file's own location so it's correct
# for any install path (cache/<version>/, dev repo, etc.).
HR_PROTOCOL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)/references/interrupt-protocol.md"

# --- Agenda fetch ---
# Calls `<dopadone-path> habits agenda --json` with a 4s timeout. Returns "" on
# failure — caller exits silently (better silent than crash mid-prompt).
hr_get_agenda() {
  if ! command -v "$HR_DOPADONE_PATH" >/dev/null 2>&1; then
    return 0
  fi
  # macOS doesn't ship `timeout`; perl alarm is portable.
  perl -e 'alarm shift; exec @ARGV' 4 "$HR_DOPADONE_PATH" habits agenda --json 2>/dev/null || true
}

# --- Phase classification ---
# "HH:MM" → minutes since midnight (0..1439). 10# forces base-10 so "08"/"09"
# don't trip bash's octal parser.
hr_hm_to_min() {
  local hm="${1:-00:00}"; hm="${hm// /}"
  local h="${hm%%:*}" m="${hm##*:}"
  [ "$h" = "$hm" ] && m=0
  echo $(( 10#${h:-0} * 60 + 10#${m:-0} ))
}

# Returns one of: work | wrapup | evening | sleep
# Half-open windows from the configurable HH:MM boundaries:
#   work    [work_start,    wrapup_start)   → silent (sleep channel adds nothing)
#   wrapup  [wrapup_start,  evening_start)  → non-blocking wrap-up nudges
#   evening [evening_start, sleep_start)    → blocking refusal + persuasion
#   sleep   [sleep_start,   work_start)     → ~100% refusal (wraps midnight)
hr_phase() {
  local now_min="${1:-$(hr_hm_to_min "$(date +%H:%M)")}"
  local w u e s
  w=$(hr_hm_to_min "$HR_WORK_START")
  u=$(hr_hm_to_min "$HR_WRAPUP_START")
  e=$(hr_hm_to_min "$HR_EVENING_START")
  s=$(hr_hm_to_min "$HR_SLEEP_START")

  # Sleep wraps midnight: [s, 1440) ∪ [0, w). Test it first as the catch-all.
  if [ "$now_min" -ge "$s" ] || [ "$now_min" -lt "$w" ]; then echo "sleep"; return; fi
  # w <= now < s: latest-opened window wins.
  if [ "$now_min" -ge "$e" ]; then echo "evening"; return; fi
  if [ "$now_min" -ge "$u" ]; then echo "wrapup"; return; fi
  echo "work"
}

# --- Probability model ---
#
# The sleep-schedule channel and the habit channel are ORTHOGONAL. Habit urgency
# drives blocking interrupts all day exactly as before; the sleep schedule only
# adds a per-phase BASELINE that the blocking probability is max()'d against.
#
#   work     → baseline 0   (habit urgency dominates; no sleep pressure)
#   wrapup   → baseline 0   (handled by a SEPARATE non-blocking channel; habits
#                            still block on their own track)
#   evening  → baseline = $HR_EVENING_INTENSITY (blocking refusal + persuasion)
#   sleep    → forced 100   (every prompt blocked; retry can't win, override only)
#
# Final P (blocking) = min(99, max(phase_baseline, habit_urgency)), EXCEPT sleep
# where P is forced to 100 so retrying never breaks through — the override phrase
# (checked before the roll) is the only escape.

hr_phase_baseline_pct() {
  case "${1:-work}" in
    sleep) echo 100 ;;
    evening) echo "$HR_EVENING_INTENSITY" ;;
    *) echo 0 ;;
  esac
}

hr_habit_urgency_pct() {
  local agenda="$1"
  echo "$agenda" | jq '
    def open_pct(h):
      if (h.timeWindow.linger_minutes // 0) <= 0 then
        (h.priority * 3)
      else
        (
          ([(h.lingerElapsedMinutes // 0) / h.timeWindow.linger_minutes, 1.0] | min)
          * (h.priority / 4) * 50
          | floor
        )
      end;

    # Only OPEN habits drive urgency — missed-today is "let it go, tomorrow
    # better" per dopadone philosophy. Plugin should not nag about a habit
    # that dopadone itself no longer shows or allows actions on.
    [
      (.summary.openNow[] as $id | .habits[] | select(.id == $id and .snoozed == null) | open_pct(.))
    ] | (max // 0)
  '
}

hr_final_pct() {
  local agenda="$1"
  local phase="$2"
  local baseline
  baseline="$(hr_phase_baseline_pct "$phase")"
  local urgency
  urgency="$(hr_habit_urgency_pct "$agenda")"
  urgency="${urgency:-0}"
  local p=$baseline
  if [ "$urgency" -gt "$p" ]; then p=$urgency; fi
  if [ "$phase" = "sleep" ]; then
    p=100             # forced — habits can't lower it, retry can't beat it
  elif [ "$p" -gt 99 ]; then
    p=99              # work/wrapup/evening: keep a ~1% gap so retry stays an escape valve
  fi
  echo "$p"
}

# --- Override password ---
# If user's prompt contains the configured override phrase (case-insensitive),
# bypass the block. Polish/English variants also recognised as common synonyms.
hr_prompt_overrides() {
  local prompt_text="$1"
  # Escape regex metacharacters in the user-configured phrase.
  local phrase_escaped
  phrase_escaped="$(printf '%s' "$HR_OVERRIDE_PHRASE" | sed 's/[][\.|$(){}?+*^]/\\&/g')"
  echo "$prompt_text" | grep -qiE "(${phrase_escaped}|^override\b|robi[eę]\s+i\s+tak|yes\s+anyway|i\s+know,?\s+override)"
}

# --- Retry counter ---
# Format: `<unix-ts>|<count>`. Bumped on each block; reset if file is older
# than the retry-window or on a pass-through.
hr_retry_read() {
  if [ ! -f "$HR_RETRY_FILE" ]; then echo "0|0"; return; fi
  local raw
  raw="$(cat "$HR_RETRY_FILE")"
  local ts="${raw%%|*}"
  local cnt="${raw##*|}"
  local now
  now="$(date +%s)"
  if [ -z "$ts" ] || [ -z "$cnt" ] || [ $((now - ts)) -gt "$HR_RETRY_WINDOW_SEC" ]; then
    echo "0|0"
  else
    echo "$raw"
  fi
}

hr_retry_bump() {
  mkdir -p "$(dirname "$HR_RETRY_FILE")" 2>/dev/null || true
  local prev
  prev="$(hr_retry_read)"
  local cnt="${prev##*|}"
  cnt=$((cnt + 1))
  echo "$(date +%s)|$cnt" > "$HR_RETRY_FILE"
  echo "$cnt"
}

hr_retry_clear() {
  rm -f "$HR_RETRY_FILE" 2>/dev/null || true
}

# --- Per-session inject timestamp ---
# Tracks when this plugin last injected ANYTHING (interrupt or time-marker) into
# the conversation with the given session_id. Used to gate the standalone
# time-marker (don't spam Claude with time-only injections every turn).
hr_session_state_path() {
  local sid="${1:-default}"
  printf '%s/last-inject-%s.txt' "$HR_DATA_DIR" "$sid"
}

hr_minutes_since_inject() {
  local sid="$1"
  local f
  f="$(hr_session_state_path "$sid")"
  if [ ! -f "$f" ]; then
    echo 999999
    return
  fi
  local last
  last="$(cat "$f" 2>/dev/null || echo 0)"
  local now
  now="$(date +%s)"
  echo $(( (now - last) / 60 ))
}

hr_record_inject() {
  local sid="$1"
  local f
  f="$(hr_session_state_path "$sid")"
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  date +%s > "$f"
}

# --- Wrap-up cadence (per-session) ---
# Gates the non-blocking wrap-up reminder so it fires at most once per
# HR_WRAPUP_INTERVAL minutes per session — independent of the time-marker and
# interrupt-cooldown clocks.
hr_wrapup_state_path() {
  local sid="${1:-default}"
  printf '%s/last-wrapup-%s.txt' "$HR_DATA_DIR" "$(hr_sanitize_key "$sid")"
}

hr_minutes_since_wrapup() {
  local f
  f="$(hr_wrapup_state_path "$1")"
  if [ ! -f "$f" ]; then echo 999999; return; fi
  local last now
  last="$(cat "$f" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  echo $(( (now - last) / 60 ))
}

hr_record_wrapup() {
  local f
  f="$(hr_wrapup_state_path "$1")"
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  date +%s > "$f"
}

# --- Per-interrupt-key cooldown (cross-session) ---
# When an interrupt fires for a given habit (or mode sentinel), record the
# timestamp in a GLOBAL file (NOT keyed by session_id). Subsequent dice-roll
# hits for the same key within HR_INTERRUPT_COOLDOWN_MINUTES are suppressed.
#
# Motivation: user often runs multiple Claude Code chats in parallel. Without
# a cooldown, the SAME habit (e.g. "obiad") fires an interrupt on chat A AND
# chat B AND chat C within seconds — user has to dismiss the same reminder
# N times and each chat marks the habit done. With the cooldown, the first
# interrupt wins; the others silently fall through to time-marker logic until
# the cooldown elapses OR the user marks the habit done in any one chat (at
# which point dopadone's agenda no longer surfaces it as open → no urgency
# → no interrupt anyway).
#
# This is deliberately NOT a `dopadone habits snooze` — that would affect
# other dopadone consumers (Looper, /do, future apps). Cooldown is local to
# THIS plugin only.

# Sanitize a key for use as a filename component (UUIDs, habit ids, "mode:sleep"
# all go through here — replace any char outside [A-Za-z0-9._-] with '_').
hr_sanitize_key() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

hr_cooldown_path() {
  local key
  key="$(hr_sanitize_key "${1:-default}")"
  printf '%s/interrupt-cooldown-%s.txt' "$HR_DATA_DIR" "$key"
}

# Returns minutes since the last interrupt for this key (999999 if never).
hr_minutes_since_interrupt() {
  local f
  f="$(hr_cooldown_path "$1")"
  if [ ! -f "$f" ]; then echo 999999; return; fi
  local last
  last="$(cat "$f" 2>/dev/null || echo 0)"
  local now
  now="$(date +%s)"
  echo $(( (now - last) / 60 ))
}

hr_record_interrupt() {
  local f
  f="$(hr_cooldown_path "$1")"
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  date +%s > "$f"
}

# Compute the cooldown key for the current turn. If a focus habit was picked,
# its id is the key. Otherwise (sleep/hard/wind-down/pre-wake with no open
# habits, or normal-mode random interrupt), fall back to a mode sentinel.
hr_cooldown_key() {
  local focus="$1"
  local mode="$2"
  if [ -n "$focus" ]; then
    echo "$focus" | jq -r '.id'
  else
    printf 'mode:%s' "$mode"
  fi
}

# --- Formatters ---
hr_fmt_dur() {
  local m=$1
  if [ "$m" -lt 1 ]; then echo "<1m"; return; fi
  if [ "$m" -lt 60 ]; then echo "${m}m"; return; fi
  local h=$((m / 60))
  local rem=$((m % 60))
  if [ "$rem" -eq 0 ]; then echo "${h}h"; else echo "${h}h ${rem}m"; fi
}

# --- Focus habit picker ---
# Returns JSON for the highest-urgency OPEN habit, or empty string. Missed-today
# habits are deliberately excluded — dopadone's own UX hides/locks them once
# the window closes ("let it go, tomorrow better"). Plugin matches that.
hr_pick_focus_habit() {
  local agenda="$1"
  echo "$agenda" | jq -c '
    def urgency(h):
      if (h.timeWindow.linger_minutes // 0) > 0 then
        ([(h.lingerElapsedMinutes // 0) / h.timeWindow.linger_minutes, 1.0] | min)
          * (h.priority / 4)
      else
        h.priority / 8
      end;
    [.habits[] | select(.kind == "open-todo" and .snoozed == null) |
      . + {_u: urgency(.)}]
    | sort_by(-._u)
    | (first // empty)
    | if . then {
        id, content, kind, priority,
        description: (.description // ""),
        lingerElapsed: (.lingerElapsedMinutes // 0),
        lingerLeft: (
          if (.timeWindow.linger_minutes // 0) > 0 then
            (.timeWindow.linger_minutes - (.lingerElapsedMinutes // 0))
          else null end
        )
      } else empty end
  '
}

# --- Blocking interrupt directive builder ---
#
# Emits a COMPACT directive (dynamic facts only) that tells Claude to DROP the
# user's request this turn and respond with a health reminder. The full how/why
# (style, escalation, the evening/sleep persuasion scripts) lives in
# $HR_PROTOCOL_FILE, which Claude
# reads ONCE per conversation — keeps the per-turn token cost ~150 instead of ~800.
# Shape depends on the phase: evening (refuse + wind-down + persuade) / sleep
# (near-total refusal) / work+wrapup (habit anchor). Claude composes the wording.
#
# Args: $1 agenda JSON, $2 phase, $3 retry_count
hr_build_interrupt_directive() {
  local agenda="$1"
  local phase="$2"
  local retry="${3:-1}"

  # Protocol pointer — only for the high-frequency work/wrapup habit anchoring,
  # whose style guide + grammar are long and repeat many times a day (worth a file).
  # Evening/sleep are rare + phase-specific, so their directive is fully inline below.
  local protocol="Pełny protokół reakcji (styl odpowiedzi, eskalacja): ${HR_PROTOCOL_FILE}
— przeczytaj RAZ na rozmowę, jeśli jeszcze go nie znasz; potem działaj z pamięci, nie czytaj ponownie."

  # --- Evening-routine: refuse + runtime wind-down discovery + persuasion (fully inline) ---
  if [ "$phase" = "evening" ]; then
    cat <<DIRECTIVE
DOPADONE INTERRUPT (faza: rutyna wieczorna, próba ${retry})

Po ${HR_EVENING_START} — koniec pracy, pora wchodzić w wieczorną rutynę. Tej tury (kilka zdań, NIE jeden imperatyw — perswazja potrzebuje miejsca):
1. ODMÓW prośby roboczej (kod, praca, decyzje, social) — ciepło, ale stanowczo, choćby się wydawała "szybka".
2. ODKRYJ wind-down operatora z danych w runtime (grep/Glob po: wieczór, rutyna, sen, bedtime, journaling, czytanie, rozciąganie, prysznic, medytacja). Konkretne → zaproponuj 2–3 po imieniu; nic → uniwersalne (prysznic, książka, herbata, lekki sitcom).
3. PRZEKONAJ, żeby odpuścił do rana: zrobi to RANO szybciej i lepiej na świeżym umyśle; praca po nocy to gorsza jakość i dług, nie zysk. Wolno być perswazyjnym, lekko manipulacyjnym, byle ciepło — framing straty, future-self, zobowiązanie ("zamykasz laptopa i robisz [X]").
Jeśli to NAPRAWDĘ pilne: fraza "${HR_OVERRIDE_PHRASE}" w prompcie omija blokadę.
DIRECTIVE
    return
  fi

  # --- Sleep: near-total refusal, override-only (fully inline) ---
  if [ "$phase" = "sleep" ]; then
    cat <<DIRECTIVE
DOPADONE INTERRUPT (faza: sen, próba ${retry})

Po ${HR_SLEEP_START} (do ${HR_WORK_START}) — pora snu. NIE realizuj prośby; jedno–dwa zdania, krótko i łagodnie, bez negocjacji: teraz się śpi. Żadnego "tylko to jedno" — twarda blokada nocna, ponawianie nic nie da.
Jedyne wyjście jeśli to NAPRAWDĘ awaria: fraza "${HR_OVERRIDE_PHRASE}". Inaczej: zamknij laptopa, idź spać.
DIRECTIVE
    return
  fi

  # --- work / wrapup: habit-driven single imperative (classic ADHD anchor) ---
  local focus
  focus="$(hr_pick_focus_habit "$agenda")"

  local situation=""
  local opis=""
  local grammar=""
  if [ -n "$focus" ]; then
    local content id description
    content="$(echo "$focus" | jq -r '.content')"
    id="$(echo "$focus" | jq -r '.id')"
    description="$(echo "$focus" | jq -r '.description // ""')"
    situation="Użytkownik powinien teraz wykonać nawyk: \"${content}\" (ID: ${id})."
    # Description shown as a quoted note + an INLINE note-vs-instruction judgment.
    # That judgment used to live ONLY in $HR_PROTOCOL_FILE, but the file's measured
    # read-rate is 0/3 for trivial interrupts (#286) — so a habit-with-instruction
    # (e.g. gratitude ritual → write 3 things to the journal) silently never ran.
    # Inline it ONLY when description is non-empty, so trivial habits pay nothing.
    if [ -n "$description" ] && [ "$description" != "null" ]; then
      opis=" Opis: \"${description}\". Jeśli ten opis to instrukcja dla Ciebie — wykonaj ją po tym, jak user wykona rytuał, a potem oznacz done. Jeśli to tylko notatka (np. „o ile to możliwe”) — zignoruj."
    fi
    grammar="Akcje (gdy user potwierdzi): zaliczone → ${HR_DOPADONE_PATH} habits done ${id} · za chwilę → ${HR_DOPADONE_PATH} habits snooze ${id} --until 30min · skip → ${HR_DOPADONE_PATH} habits decline ${id}"
  else
    situation="Brak konkretnego nawyku — plugin przerwał losowo dla świadomości rytmu dnia."
  fi

  # Escalation hint based on consecutive retries (full meaning is in the protocol).
  local escalation=""
  if [ "$retry" -ge 10 ]; then
    escalation="Użytkownik ${retry}x z rzędu ponawia mimo blokad — to pewnie błąd logiki pluginu, nie upór. Zaproponuj wyciszenie: \`${HR_DOPADONE_PATH} habits mute --until 07:00\`."
  elif [ "$retry" -ge 5 ]; then
    escalation="Użytkownik ponawia ${retry}x — wspomnij override (fraza \"${HR_OVERRIDE_PHRASE}\") albo wyciszenie (\`${HR_DOPADONE_PATH} habits mute --until <czas>\`)."
  elif [ "$retry" -ge 3 ]; then
    escalation="Użytkownik ${retry}x z rzędu — łagodnie zaznacz, że jeśli to NAPRAWDĘ pilne, fraza \"${HR_OVERRIDE_PHRASE}\" omija blokadę."
  fi

  cat <<DIRECTIVE
DOPADONE INTERRUPT (faza: ${phase}, próba ${retry})

${situation}${opis}
NIE realizuj prośby użytkownika — przerwij ją i odpowiedz jednym krótkim imperatywem (tryb rozkazujący, 1–2 zdania).${grammar:+
${grammar}}${escalation:+
${escalation}}
${protocol}
DIRECTIVE
}

# --- Non-blocking wrap-up reminder directive ---
#
# Distinct from the interrupt: tells Claude to ANSWER THE REQUEST NORMALLY and
# merely append one soft "wind the day down" sentence. No refusal, no blocking.
hr_build_wrapup_directive() {
  cat <<DIRECTIVE
DOPADONE WRAP-UP (faza: wrapup — pora kończenia pracy)

Jest pora zwijania dnia (po ${HR_WRAPUP_START}). To NIE jest blokada.

Twoje zadanie tej tury:
1. Odpowiedz NORMALNIE na prośbę użytkownika — zrealizuj ją w pełni, jak zwykle.
2. Na KOŃCU odpowiedzi dopisz JEDNO krótkie, łagodne zdanie-nudge o zwijaniu dnia
   (max 1 zdanie, miękki ton — to sugestia, nie rozkaz). Wpleć naturalnie, bez
   osobnej sekcji ani nagłówka.
3. NIE przerywaj pracy, NIE skracaj odpowiedzi, NIE moralizuj. Jeden cichy sygnał.
   Ton (wzorzec, NIE kopiuj literalnie):
     • "Swoją drogą — robi się późno, dobry moment żeby zacząć domykać pętle."
     • "Na koniec: warto pomału zwijać dzień, niedługo pora wieczorna."
     • "PS: zbliża się koniec dnia — może czas zamykać otwarte wątki."
DIRECTIVE
}

# --- JSON emitters ---
#
# All injections are wrapped in a `<dopadone>` XML tag so Claude can
# unambiguously distinguish plugin output from regular conversation content.
# Attributes carry meta (time, mode, retry); content (if any) is the directive.

# Wrap directive in <dopadone event="interrupt" .../> tag and emit
# additionalContext injection. Replaces v1.0's `decision: block` (which
# silently dropped prompts in some Claude Code versions).
hr_emit_interrupt() {
  local directive="$1"
  local mode="$2"
  local retry="$3"
  local date_ymd time_hm
  date_ymd="$(date +%Y-%m-%d)"
  time_hm="$(date +%H:%M)"

  local wrapped
  wrapped="$(printf '<dopadone event="interrupt" date="%s" time="%s" mode="%s" retry="%s">\n%s\n</dopadone>' \
    "$date_ymd" "$time_hm" "$mode" "$retry" "$directive")"

  local json
  json="$(jq -nc --arg c "$wrapped" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: $c
    }
  }')"
  mkdir -p "$(dirname "$HR_LOG_FILE")" 2>/dev/null || true
  printf '%s %s\n' "$(date +%s)" "$json" >> "$HR_LOG_FILE" 2>/dev/null || true
  printf '%s' "$json"
}

# Emit a standalone <dopadone event="time-marker"/> tag. No directive —
# just tells Claude the current wall-clock time. Used between interrupts so
# Claude doesn't lose track of time in long conversations.
hr_emit_time_marker() {
  local date_ymd time_hm
  date_ymd="$(date +%Y-%m-%d)"
  time_hm="$(date +%H:%M)"
  local content
  content="$(printf '<dopadone event="time-marker" date="%s" time="%s"/>' "$date_ymd" "$time_hm")"

  local json
  json="$(jq -nc --arg c "$content" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: $c
    }
  }')"
  mkdir -p "$(dirname "$HR_LOG_FILE")" 2>/dev/null || true
  printf '%s %s\n' "$(date +%s)" "$json" >> "$HR_LOG_FILE" 2>/dev/null || true
  printf '%s' "$json"
}

# Emit a <dopadone event="wrapup" .../> tag carrying the non-blocking
# wrap-up directive. Same transport as the interrupt — "non-blocking" is purely
# a property of the directive text (answer normally + append nudge).
hr_emit_wrapup() {
  local directive="$1"
  local date_ymd time_hm
  date_ymd="$(date +%Y-%m-%d)"
  time_hm="$(date +%H:%M)"

  local wrapped
  wrapped="$(printf '<dopadone event="wrapup" date="%s" time="%s">\n%s\n</dopadone>' \
    "$date_ymd" "$time_hm" "$directive")"

  local json
  json="$(jq -nc --arg c "$wrapped" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: $c
    }
  }')"
  mkdir -p "$(dirname "$HR_LOG_FILE")" 2>/dev/null || true
  printf '%s %s\n' "$(date +%s)" "$json" >> "$HR_LOG_FILE" 2>/dev/null || true
  printf '%s' "$json"
}

hr_emit_silent() {
  exit 0
}
