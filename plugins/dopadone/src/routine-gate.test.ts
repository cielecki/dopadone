import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectRoutine, readTranscriptHead, TRANSCRIPT_HEAD_BYTES } from './routine-gate'

describe('detectRoutine', () => {
  it('matches the scheduler markers in the prompt', () => {
    expect(detectRoutine('<scheduled-task name="dream">…', null)).toBe(true)
    expect(detectRoutine('This is an automated run of a scheduled task.', null)).toBe(true)
  })
  it('matches the transcript-head fallback', () => {
    expect(detectRoutine('normal prompt', 'blah <scheduled-task name="x"> blah')).toBe(true)
  })
  it('is false for an ordinary interactive prompt', () => {
    expect(detectRoutine('please fix the bug', null)).toBe(false)
    expect(detectRoutine('please fix the bug', 'a normal transcript')).toBe(false)
  })
})

describe('readTranscriptHead', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hr-tp-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null for a missing/empty path', () => {
    expect(readTranscriptHead('')).toBeNull()
    expect(readTranscriptHead(join(dir, 'nope.jsonl'))).toBeNull()
  })
  it('reads only the bounded head and finds an early marker in a huge file', () => {
    const f = join(dir, 't.jsonl')
    const marker = '<scheduled-task name="dream">'
    // Marker near the top, then a body far larger than the head bound.
    writeFileSync(f, `${marker}\n${'x'.repeat(TRANSCRIPT_HEAD_BYTES * 2)}`)
    const head = readTranscriptHead(f)
    expect(head).not.toBeNull()
    expect((head as string).length).toBeLessThanOrEqual(TRANSCRIPT_HEAD_BYTES)
    expect(detectRoutine('normal', head)).toBe(true)
  })
})
