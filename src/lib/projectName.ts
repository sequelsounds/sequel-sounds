/**
 * Track names projects like "256-OLD-26-II Nachips": a job number, then the
 * name. The header shows the name large and the number small beside it, so
 * the two are split here. A name with no recognisable number is shown whole.
 */
const NUMBERED = /^(\d{2,4}(?:-[A-Za-z0-9]+)+)\s+(.+)$/

export function splitProjectName(name: string): {
  number: string | null
  title: string
} {
  const m = name.trim().match(NUMBERED)
  return m ? { number: m[1], title: m[2] } : { number: null, title: name.trim() }
}
