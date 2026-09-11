const AUDIO_VIDEO_EXT =
  /\.(wav|aif|aiff|flac|mp3|m4a|ogg|opus|mov|mp4|m4v)$/i

/** Skip Finder/Explorer noise and resource forks that ride along in folders. */
function isJunk(name: string): boolean {
  return name.startsWith('.') || name === 'Thumbs.db'
}

export function isMediaFile(file: File): boolean {
  return !isJunk(file.name) && AUDIO_VIDEO_EXT.test(file.name)
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => reader.readEntries(resolve, () => resolve([])))
}

function fileOf(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => entry.file(resolve, () => resolve(null)))
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry)
    if (file && isMediaFile(file)) out.push(file)
    return
  }
  if (!entry.isDirectory) return

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries returns at most 100 per call; keep going until it returns none.
  for (;;) {
    const batch = await readEntries(reader)
    if (batch.length === 0) return
    for (const child of batch) {
      if (!isJunk(child.name)) await walk(child, out)
    }
  }
}

/**
 * Every media file in a drop, walking into dropped folders. Partners routinely
 * drag a whole album folder rather than selecting files, so a dropzone that
 * only reads `dataTransfer.files` would silently take nothing.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((e): e is FileSystemEntry => e !== null)

  if (entries.length === 0) {
    return Array.from(dataTransfer.files).filter(isMediaFile)
  }

  const out: File[] = []
  await Promise.all(entries.map((entry) => walk(entry, out)))
  return out
}

/** De-duplicate against what is already queued: same name, size and mtime. */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}
