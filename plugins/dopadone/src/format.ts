/**
 * Formatters — TS parity port of `hr_fmt_dur` (lib/inject.sh).
 */

/** minutes → "<1m" / "Nm" / "Nh" / "Nh Nm". */
export function fmtDur(m: number): string {
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}
