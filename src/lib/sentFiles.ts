/**
 * Files this browser has already sent to a given inbox.
 *
 * The in-memory queue de-duplicates within a session, but that is gone on
 * reload — which is exactly when a partner re-drags the same folder "to be
 * sure". Keeping the keys in localStorage makes a second drop recognisable
 * instead of silently creating a second track and a second S3 object.
 *
 * Scoped per inbox token: the same file legitimately belongs to two projects.
 */
const PREFIX = 'sequel.sent.v1.'

// Enough to stay useful across a long campaign without growing forever.
const MAX_KEYS = 2000

export function loadSent(token: string): Set<string> {
  try {
    const raw = localStorage.getItem(PREFIX + token)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set()
  } catch {
    return new Set()
  }
}

export function markSent(token: string, key: string): void {
  try {
    const keys = [...loadSent(token), key]
    localStorage.setItem(
      PREFIX + token,
      JSON.stringify(keys.slice(-MAX_KEYS)),
    )
  } catch {
    // Storage unavailable — duplicates become possible again, which is the
    // behaviour we already had, so it is not worth failing an upload over.
  }
}
