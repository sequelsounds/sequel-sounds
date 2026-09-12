import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Signed read URLs for objects in the media bucket.
 *
 * The bucket is private, so every artwork and preview is fetched through a
 * presigned URL from `sign-media`. A page of forty tracks asks for forty
 * URLs at once, so requests made within the same tick are folded into one
 * call rather than forty. URLs last an hour; the cache expires them a little
 * early so nothing is handed out on the edge of expiry.
 */
const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const BATCH_WINDOW_MS = 20
const SAFETY_MARGIN_MS = 5 * 60 * 1000

type Cached = { url: string; expiresAt: number }
const cache = new Map<string, Cached>()

type Waiter = { keys: string[]; resolve: (r: Record<string, string>) => void; reject: (e: Error) => void }
let pending: Waiter[] = []
let timer: ReturnType<typeof setTimeout> | null = null

async function flush() {
  const waiters = pending
  pending = []
  timer = null

  const keys = [...new Set(waiters.flatMap((w) => w.keys))].filter((k) => {
    const hit = cache.get(k)
    return !hit || hit.expiresAt <= Date.now()
  })

  try {
    if (keys.length > 0) {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      const res = await fetch(`${FUNCTIONS_URL}/sign-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ keys }),
      })
      if (!res.ok) throw new Error(`could not sign media (${res.status})`)
      const body = (await res.json()) as { urls: Record<string, string>; expires_in: number }
      const expiresAt = Date.now() + body.expires_in * 1000 - SAFETY_MARGIN_MS
      for (const [key, url] of Object.entries(body.urls)) cache.set(key, { url, expiresAt })
    }
    for (const w of waiters) {
      const out: Record<string, string> = {}
      for (const k of w.keys) {
        const hit = cache.get(k)
        if (hit) out[k] = hit.url
      }
      w.resolve(out)
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error('could not sign media')
    for (const w of waiters) w.reject(e)
  }
}

export function mediaUrls(keys: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    pending.push({ keys, resolve, reject })
    if (!timer) timer = setTimeout(flush, BATCH_WINDOW_MS)
  })
}

/** One key's URL, or null while unsigned / when the key is null. */
export function useMediaUrl(key: string | null | undefined) {
  return useQuery({
    queryKey: ['media', key],
    enabled: !!key,
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => (key ? ((await mediaUrls([key]))[key] ?? null) : null),
  })
}
