/**
 * Routine gate — TS parity port of the interactive-only detection in user-prompt.sh.
 *
 * health-rhythm nudges are for a HUMAN watching an interactive chat. Scheduled /
 * autonomous runs (/dream, daily-inbox-triage, …) must stay silent. Dual detection
 * (verified 2026-06-05): the scheduler wrapper does NOT reliably land in the hook's
 * `.prompt`, so we ALSO scan the transcript head for `<scheduled-task name=`.
 */
import { closeSync, existsSync, openSync, readSync } from 'node:fs'

/** Bytes of the transcript head to scan — bounded so a long chat is never read in full. */
export const TRANSCRIPT_HEAD_BYTES = 131072

/**
 * Pure detection: routine if the prompt carries the scheduler markers, OR the
 * transcript head contains `<scheduled-task name=`. `transcriptHead` is the
 * already-read head slice (null if no transcript).
 */
export function detectRoutine(promptText: string, transcriptHead: string | null): boolean {
  if (
    promptText.includes('<scheduled-task') ||
    promptText.includes('automated run of a scheduled task')
  ) {
    return true
  }
  if (transcriptHead?.includes('<scheduled-task name=')) {
    return true
  }
  return false
}

/**
 * Is this turn a harness-injected background event rather than something the human typed?
 *
 * A completed background task (Bash `run_in_background`, a Monitor event, a finished Agent)
 * re-invokes the session with a synthetic user turn, and that turn goes through
 * UserPromptSubmit exactly like a real prompt. Nobody is at the keyboard for it.
 *
 * Verified 2026-07-29 (session 4546e77f, a 2h14m transcription wait): interrupts fired with
 * `retry="1"` at 22:30:48 and `retry="2"` at 22:31:04, each on a turn whose user message was a
 * `<task-notification>`. The escalation tiers then read that as the human pushing back — the
 * directive reached retry ≥ 3 and started offering the override phrase before he had seen a
 * single prompt. Both halves are wrong: the nudge is delivered to an empty room, and the
 * counter that exists to measure human insistence is advanced by machine events.
 */
export function isBackgroundEventTurn(promptText: string): boolean {
  return (
    promptText.includes('<task-notification') ||
    promptText.includes('[SYSTEM NOTIFICATION - NOT USER INPUT]')
  )
}

/** Read up to TRANSCRIPT_HEAD_BYTES from a transcript file; "" on any failure. */
export function readTranscriptHead(transcriptPath: string): string | null {
  if (!transcriptPath || !existsSync(transcriptPath)) return null
  try {
    const fd = openSync(transcriptPath, 'r')
    try {
      const buf = Buffer.alloc(TRANSCRIPT_HEAD_BYTES)
      const n = readSync(fd, buf, 0, TRANSCRIPT_HEAD_BYTES, 0)
      return buf.toString('utf8', 0, n)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}
