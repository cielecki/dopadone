/**
 * Override phrase — TS parity port of `hr_prompt_overrides` (lib/inject.sh).
 *
 * Case-insensitive match against the configured phrase OR a fixed set of PL/EN
 * synonyms. The configured phrase has its regex metacharacters escaped first.
 */

/** Escape the chars the bash `sed 's/[][\.|$(){}?+*^]/\\&/g'` escapes, for safe regex embedding. */
function escapePhrase(phrase: string): string {
  return phrase.replace(/[[\]\\.|$(){}?+*^]/g, '\\$&')
}

/** True if the prompt contains the override phrase (or a known synonym). */
export function promptOverrides(promptText: string, overridePhrase: string): boolean {
  const escaped = escapePhrase(overridePhrase)
  const re = new RegExp(
    `(${escaped}|^override\\b|robi[eę]\\s+i\\s+tak|yes\\s+anyway|i\\s+know,?\\s+override)`,
    'i'
  )
  return re.test(promptText)
}
