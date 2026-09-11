import { parseBlob } from 'music-metadata'
import { titleFromFilename } from './filename'

export type FileTags = {
  title: string
  artist: string | null
  album: string | null
  bpm: number | null
  musical_key: string | null
  duration_seconds: number | null
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function numeric(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Best-effort tag read in the browser. This is a convenience pass so the
 * partner can see what they dropped — the ffmpeg Lambda re-reads the file
 * server-side and is the authoritative source. Anything unreadable here just
 * falls back to the filename; it is never an upload error.
 */
export async function readTags(file: File): Promise<FileTags> {
  const fallback: FileTags = {
    title: titleFromFilename(file.name),
    artist: null,
    album: null,
    bpm: null,
    musical_key: null,
    duration_seconds: null,
  }

  try {
    const { common, format } = await parseBlob(file, { duration: true })
    return {
      // Filename wins when the tag is absent or blank, as specified.
      title: clean(common.title) ?? fallback.title,
      artist: clean(common.artist) ?? clean(common.albumartist),
      album: clean(common.album),
      bpm: numeric(common.bpm),
      musical_key: clean(common.key),
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
