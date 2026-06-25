#!/usr/bin/env bash
# Notification hook — OS desktop notification at meal-window openings and
# sleep boundaries. Fires whenever Claude is idle / awaiting input. Hourly
# dedup so we don't spam if Claude sits idle for a long time.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/inject.sh
source "$SCRIPT_DIR/../lib/inject.sh"

cat >/dev/null 2>&1 || true

STATE_FILE="$HR_DATA_DIR/health-rhythm-notif.txt"
mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true

hour="$(date +%H)"
hour=$((10#$hour))
min="$(date +%M)"
min=$((10#$min))
now_min=$(( hour * 60 + min ))

# Bail silently if globally muted.
agenda="$(hr_get_agenda)"
if [ -n "$agenda" ]; then
  muted="$(echo "$agenda" | jq -r '.muted')"
  if [ "$muted" != "null" ]; then
    exit 0
  fi
fi

title=""
body=""

# Meal-window openings — fire near the top of the hour only (habit-adjacent).
if [ "$min" -lt 15 ]; then
  case "$hour" in
    8)  title="Śniadanie"; body="Okno 08:00-10:00. Czas zjeść." ;;
    13) title="Obiad"; body="Okno 13:00-15:00. Czas zamówić / zjeść." ;;
    18) title="Kolacja"; body="Okno 18:00-20:00. Czas zjeść." ;;
  esac
fi

# Phase-boundary notifications. fire_near sets title/body if now is within 15
# min AFTER the given HH:MM boundary (circular distance handles midnight wrap).
fire_near() {
  local b; b="$(hr_hm_to_min "$1")"
  if [ $(( (now_min - b + 1440) % 1440 )) -lt 15 ]; then
    title="$2"; body="$3"
  fi
}
fire_near "$HR_WRAPUP_START"  "Zwijanie dnia"    "Pora kończyć — zacznij domykać pętle."
fire_near "$HR_EVENING_START" "Wieczorna rutyna" "Koniec pracy. Czas się wyciszać."

# Sleep wall — fire in the 15 min leading up to sleep_start.
warn_min=$(( ( $(hr_hm_to_min "$HR_SLEEP_START") - 10 + 1440 ) % 1440 ))
if [ $(( (now_min - warn_min + 1440) % 1440 )) -lt 15 ]; then
  title="Sen za 10 min"; body="${HR_SLEEP_START} lights-out. Domykaj dzień, do łóżka."
fi

if [ -z "$title" ]; then
  exit 0
fi

# Per-boundary hourly dedup: key includes the title so two boundaries in the
# same hour (e.g. evening 23:00 + sleep-wall 23:20) each fire once.
now_key="$(date +%Y-%m-%d-%H)-$title"
last_key=""
if [ -f "$STATE_FILE" ]; then
  last_key="$(cat "$STATE_FILE")"
fi
if [ "$now_key" = "$last_key" ]; then
  exit 0
fi

osascript -e "display notification \"$body\" with title \"🥗 $title\" sound name \"Glass\"" 2>/dev/null || true

echo "$now_key" > "$STATE_FILE"
exit 0
