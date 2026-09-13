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

type Waiter = {
  keys: string[]
  token: string | null
  resolve: (r: Record<string, string>) => void
  reject: (e: Error) => void
}
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
      // Share pages have a token and no session; staff have the reverse.
      const shareToken = waiters.find((w) => w.token)?.token ?? null
      const res = await fetch(`${FUNCTIONS_URL}/sign-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          ...(shareToken ? { 'x-share-token': shareToken } : {}),
        },
        body: JSON.stringify({ keys }),
      })
      if (!res.ok) throw new Error(`could not sign media (${res.status})`)
      const body = (await res.json()) as {
        urls: Record<string, string>
        expires_in: number
      }
      const expiresAt = Date.now() + body.expires_in * 1000 - SAFETY_MARGIN_MS
      for (const [key, url] of Object.entries(body.urls))
        cache.set(key, { url, expiresAt })
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

export function mediaUrls(
  keys: string[],
  token: string | null = null,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    pending.push({ keys, token, resolve, reject })
    if (!timer) timer = setTimeout(flush, BATCH_WINDOW_MS)
  })
}

/**
 * A URL that saves the object under `filename` rather than playing it.
 *
 * One request, uncached, on purpose: a download is one click on one row,
 * and the disposition is signed into the URL, so the same key with two
 * names is two different URLs and would only pollute the cache above.
 * Whether the caller may have it at all — downloads on, originals on — is
 * the function's decision, which is why an empty answer is an error here
 * rather than a null: the row offered a button the switches do not back.
 */
export async function downloadUrl(
  key: string,
  filename: string,
  token: string | null = null,
): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  const res = await fetch(`${FUNCTIONS_URL}/sign-media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      ...(token ? { 'x-share-token': token } : {}),
    },
    body: JSON.stringify({ keys: [], download: { [key]: filename } }),
  })
  if (!res.ok) throw new Error(`could not sign the download (${res.status})`)
  const body = (await res.json()) as { urls: Record<string, string> }
  const url = body.urls[key]
  if (!url) throw new Error('This file is not available to download.')
  return url
}

/** One key's URL, or null while unsigned / when the key is null. */
export function useMediaUrl(
  key: string | null | undefined,
  token: string | null = null,
) {
  return useQuery({
    queryKey: ['media', key, token],
    enabled: !!key,
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () =>
      key ? ((await mediaUrls([key], token))[key] ?? null) : null,
  })
}
