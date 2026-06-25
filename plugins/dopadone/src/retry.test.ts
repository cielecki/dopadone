import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bumpRetry, clearRetry, parseRetry, readRetry } from './retry'

describe('parseRetry', () => {
  it('parses <ts>|<count> within the window', () => {
    expect(parseRetry('1000|3', 1100, 300)).toEqual({ ts: 1000, count: 3 })
  })
  it('resets when older than the window', () => {
    expect(parseRetry('1000|3', 1500, 300)).toEqual({ ts: 0, count: 0 })
  })
  it('resets on malformed/empty content', () => {
    expect(parseRetry('abc', 1100, 300)).toEqual({ ts: 0, count: 0 })
    expect(parseRetry('', 1100, 300)).toEqual({ ts: 0, count: 0 })
    expect(parseRetry('1000|', 1100, 300)).toEqual({ ts: 0, count: 0 })
  })
})

describe('retry file I/O', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hr-retry-'))
    file = join(dir, 'retries.txt')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('missing file reads as count 0', () => {
    expect(readRetry(file, 1000).count).toBe(0)
  })
  it('bump increments and persists', () => {
    expect(bumpRetry(file, 1000)).toBe(1)
    expect(bumpRetry(file, 1010)).toBe(2)
    expect(readFileSync(file, 'utf8')).toBe('1010|2')
  })
  it('bump resets after the window elapses', () => {
    bumpRetry(file, 1000)
    bumpRetry(file, 1010)
    expect(bumpRetry(file, 2000)).toBe(1) // >300s gap → window reset, back to 1
  })
  it('clear removes the file', () => {
    bumpRetry(file, 1000)
    clearRetry(file)
    expect(readRetry(file, 1000).count).toBe(0)
  })
})
