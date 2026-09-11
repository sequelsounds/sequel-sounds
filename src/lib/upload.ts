const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

const EXT_CONTENT_TYPE: Record<string, string> = {
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
}

/**
 * A content type the Edge Function will accept. Browsers hand back an empty
 * `file.type` for plenty of real AIFF and FLAC files, and sign-upload rejects
 * anything that is not audio/* or video/*, so falling back to the extension is
 * what keeps a 50-file drop from losing files to a quirk of the OS type table.
 */
export function contentTypeFor(file: File): string {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
    return file.type
  }
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  return EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream'
}

export type SignedUpload = {
  track_id: string
  key: string
  upload_url: string
  expires_in: number
  project_id: string
  inbox_id: string
  /** Set when the project already holds a file with this name and byte length. */
  already_uploaded: { track_id: string; created_at: string } | null
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
      content_type: contentTypeFor(file),
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
    xhr.setRequestHeader('Content-Type', contentTypeFor(file))

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
