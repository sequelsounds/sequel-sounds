const AUDIO_VIDEO_EXT =
  /\.(wav|aif|aiff|flac|mp3|m4a|ogg|opus|mov|mp4|m4v)$/i

/**
 * A readable title from a filename. Partners drop files named
 * `03_-_Night_Drive_(Master_v2).wav`, and typing a title for each of 47 of
 * those is exactly what they will not do.
 *
 * Deliberately conservative: a leading number is only dropped when a separator
 * follows it, so a track genuinely called "1979" survives.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(AUDIO_VIDEO_EXT, '')

  const tidied = base
    .replace(/^\d{1,3}[\s._-]+/, '') // "03 - " / "03_" track numbers
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ') // keep real hyphens, normalise the spacing
    .replace(/\s+/g, ' ')
    .trim()

  // Never return empty — the title column is NOT NULL, and a file named "01.wav"
  // would otherwise tidy itself down to nothing.
  return tidied || base.trim() || filename
}
