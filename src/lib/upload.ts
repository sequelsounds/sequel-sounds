const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export type SignedUpload = {
  track_id: string
  key: string
  upload_url: string
  expires_in: number
  project_id: string
  inbox_id: string
}

/** Ask the Edge Function for a presigned PUT. The token authorises the call. */
export async function signUpload(token: string, file: File): Promise<SignedUpload> {
  const res = await fetch(`${FUNCTIONS_URL}/sign-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-share-token': token,
      // The publishable key is public by design; it only gets the request past
      // the platform's JWT gate. The share token is the real authorisation.
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    }),
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `could not start upload (${res.status})`)
  }
  return res.json()
}

/**
 * PUT straight to S3. Uses XMLHttpRequest rather than fetch because fetch gives
 * no upload progress, and these are large files on partner connections.
 */
export function putToS3(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error('upload failed — check your connection'))
    xhr.onabort = () => reject(new Error('upload cancelled'))

    xhr.send(file)
  })
}
