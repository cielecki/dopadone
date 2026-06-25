import { describe, expect, it } from 'vitest'
import { promptOverrides } from './override'

const PHRASE = 'wiem, override'

describe('promptOverrides', () => {
  it('matches the configured phrase, case-insensitive', () => {
    expect(promptOverrides('wiem, override teraz', PHRASE)).toBe(true)
    expect(promptOverrides('WIEM, OVERRIDE', PHRASE)).toBe(true)
    expect(promptOverrides('... wiem, override ...', PHRASE)).toBe(true)
  })
  it('matches the built-in PL/EN synonyms', () => {
    expect(promptOverrides('override this please', PHRASE)).toBe(true)
    expect(promptOverrides('robię i tak', PHRASE)).toBe(true)
    expect(promptOverrides('robie i tak', PHRASE)).toBe(true)
    expect(promptOverrides('yes anyway', PHRASE)).toBe(true)
    expect(promptOverrides('i know, override', PHRASE)).toBe(true)
    expect(promptOverrides('i know override', PHRASE)).toBe(true)
  })
  it('does not match a normal prompt', () => {
    expect(promptOverrides('please refactor this function', PHRASE)).toBe(false)
    expect(promptOverrides('', PHRASE)).toBe(false)
  })
  it('escapes regex metacharacters in a custom phrase', () => {
    expect(promptOverrides('just go! now', 'go!')).toBe(true)
    expect(promptOverrides('a+b', 'a+b')).toBe(true)
    expect(promptOverrides('axb', 'a+b')).toBe(false)
  })
})
