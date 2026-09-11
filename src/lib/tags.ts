import { parseBlob } from 'music-metadata'

const EXTENSION = /\.[^.]+$/

export type FileTags = {
  title: string
  artist: string | null
  album: string | null
  bpm: number | null
  musical_key: string | null
  duration_seconds: number | null
}

/**
 * The title rule, and the whole of it: the embedded title exactly as the file
 * carries it, or the filename with its extension removed. Nothing is tidied,
 * expanded or second-guessed — a track called `03_-_Master_v2` is called that,
 * and staff rename it in the library if they want it different.
 */
export function titleFor(filename: string, embedded: unknown): string {
  if (typeof embedded === 'string' && embedded.trim() !== '') return embedded
  return filename.replace(EXTENSION, '')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function numeric(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Best-effort tag read in the browser, so the partner can see what they
 * dropped. The Lambda re-reads the file server-side and overwrites all of it,
 * so nothing here needs to be complete or even correct — it must only never
 * throw, because an unreadable tag is not a reason to refuse an upload.
 */
export async function readTags(file: File): Promise<FileTags> {
  const fallback: FileTags = {
    title: titleFor(file.name, null),
    artist: null,
    album: null,
    bpm: null,
    musical_key: null,
    duration_seconds: null,
  }

  try {
    const { common, format } = await parseBlob(file, { duration: true })
    return {
      title: titleFor(file.name, common.title),
      artist: text(common.artist) ?? text(common.albumartist),
      album: text(common.album),
      bpm: numeric(common.bpm),
      musical_key: text(common.key),
      duration_seconds: numeric(format.duration),
    }
  } catch {
    return fallback
  }
}

/**
 * Parse with a cap on concurrency. `parseBlob` pulls chunks into memory, and a
 * 50-file drop of 100 MB WAVs parsed at once is a tab crash.
 */
export async function readTagsAll(
  files: File[],
  onOne: (index: number, tags: FileTags) => void,
  concurrency = 4,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const i = next++
      onOne(i, await readTags(files[i]))
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  )
}
