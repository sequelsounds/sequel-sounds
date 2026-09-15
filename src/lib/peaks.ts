/**
 * Waveform peaks worked out in the browser, in the same shape the Lambda
 * writes for tracks: a flat [min, max, …] array of about 2000 pairs between
 * -1 and 1, four decimals. Mono (the channels averaged), as the Lambda's
 * `-ac 1` is.
 *
 * Used for project files, which never go through the Lambda. Decoding a whole
 * file is real work — a 40 MB WAV decodes to about as much memory — so callers
 * cap the size and never block anything on it.
 */

const PEAK_COUNT = 2000
/** Past this a file is not decoded here; the bar stays flat. */
export const MAX_PEAK_BYTES = 200 * 1024 * 1024

export async function peaksFromBuffer(buffer: ArrayBuffer): Promise<number[] | null> {
  const Ctx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Ctx) return null
  const ctx = new Ctx(1, 1, 44100)
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(buffer)
  } catch {
    return null
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  const length = audio.length
  if (length === 0) return null
  const per = Math.max(1, Math.floor(length / PEAK_COUNT))
  const peaks: number[] = []
  for (let i = 0; i < length; i += per) {
    let min = 0
    let max = 0
    const end = Math.min(length, i + per)
    for (let j = i; j < end; j++) {
      let v = 0
      for (const ch of channels) v += ch[j]
      v /= channels.length
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks.push(Number(Math.max(-1, min).toFixed(4)), Number(Math.min(1, max).toFixed(4)))
  }
  return peaks
}

export async function peaksFromFile(file: File): Promise<number[] | null> {
  if (file.size > MAX_PEAK_BYTES) return null
  return peaksFromBuffer(await file.arrayBuffer())
}

export async function peaksFromUrl(url: string, size: number): Promise<number[] | null> {
  if (!size || size > MAX_PEAK_BYTES) return null
  const res = await fetch(url)
  if (!res.ok) return null
  return peaksFromBuffer(await res.arrayBuffer())
}
