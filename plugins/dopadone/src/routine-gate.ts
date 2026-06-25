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
