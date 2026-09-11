// process-track — the authoritative pass over an uploaded file.
//
// S3 fires this when a partner's original lands. It has the bytes, so it is the
// only place that can say what the file actually is: duration, tags, a hash of
// the content. Whatever the browser guessed on the way in is overwritten here.
//
// Nothing is rewritten or tidied. A title is the embedded title verbatim, or
// the filename minus its extension. Tags are stored as ffprobe reports them.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const run = promisify(execFile)
const s3 = new S3Client({})

// Provided by the layer.
const FFMPEG = '/opt/bin/ffmpeg'
const FFPROBE = '/opt/bin/ffprobe'

const PEAK_COUNT = 2000
const PREVIEW_BITRATE = '128k'

const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v'])

/** ffmpeg writes progress to stderr and is loud; only the failure matters. */
async function ffmpeg(args) {
  try {
    await run(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    throw new Error(`ffmpeg ${args[args.length - 1]}: ${String(err.stderr || err).slice(-500)}`)
  }
}

async function ffprobe(file) {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
    { maxBuffer: 32 * 1024 * 1024 },
  )
  return JSON.parse(stdout)
}

/**
 * Download and hash in one pass. The file can be 2 GB, so it is never held in
 * memory — the hash is computed off the same stream that writes it to disk.
 */
async function downloadAndHash(bucket, key, dest) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const hash = createHash('sha256')
  res.Body.on('data', (chunk) => hash.update(chunk))
  await pipeline(res.Body, createWriteStream(dest))
  return hash.digest('hex')
}

async function put(bucket, key, body, contentType) {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  )
}

/**
 * Peaks for the waveform. Decoded to raw mono 16-bit at a low rate — the shape
 * is all that is drawn, so decoding at full rate would be a lot of work thrown
 * away. Each bucket keeps its min and max so the drawn envelope is symmetric
 * and transients survive.
 */
async function peaksFrom(file, tmp) {
  const raw = `${tmp}/audio.pcm`
  await ffmpeg(['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-y', raw])

  const buf = await readFile(raw)
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
  if (samples.length === 0) return []

  const per = Math.max(1, Math.floor(samples.length / PEAK_COUNT))
  const peaks = []
  for (let i = 0; i < samples.length; i += per) {
    let min = 0
    let max = 0
    for (let j = i; j < i + per && j < samples.length; j++) {
      const v = samples[j] / 32768
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks.push(Number(min.toFixed(4)), Number(max.toFixed(4)))
  }
  await rm(raw, { force: true })
  return peaks
}

/** Tags as ffprobe reports them, format-level merged with the first stream's. */
function tagsFrom(probe) {
  const streamTags = (probe.streams ?? []).reduce(
    (acc, s) => ({ ...(s.tags ?? {}), ...acc }),
    {},
  )
  return { ...streamTags, ...(probe.format?.tags ?? {}) }
}

/** Case-insensitive lookup — tag casing varies by format and by writer. */
function tag(tags, ...names) {
  const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]))
  for (const n of names) {
    const v = lower[n.toLowerCase()]
    if (typeof v === 'string' && v.trim() !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

const int = (v) => {
  if (v === null) return null
  // "3/12" is a track number out of a total; the total is not the number.
  const n = Number.parseInt(String(v).split('/')[0], 10)
  return Number.isFinite(n) ? n : null
}

const num = (v) => {
  if (v === null) return null
  const n = Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** A full ISO date if the tag carries one, else null — `year` holds the rest. */
function dateFrom(value) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[0] : null
}

function yearFrom(value) {
  if (!value) return null
  const m = String(value).match(/(\d{4})/)
  return m ? Number.parseInt(m[1], 10) : null
}

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const bucket = record.s3.bucket.name
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))

    // tracks/{uuid}/original.{ext} — anything else is one of our own outputs.
    const match = key.match(/^tracks\/([0-9a-f-]{36})\/original\.([a-z0-9]+)$/i)
    if (!match) {
      console.log(`skipping ${key}`)
      continue
    }
    const [, trackId, ext] = match
    const isVideo = VIDEO_EXT.has(ext.toLowerCase())
    const prefix = `tracks/${trackId}`
    const tmp = `/tmp/${trackId}`

    try {
      await mkdir(tmp, { recursive: true })
      const source = `${tmp}/original.${ext}`
      const contentHash = await downloadAndHash(bucket, key, source)

      const probe = await ffprobe(source)
      const tags = tagsFrom(probe)
      const duration = num(probe.format?.duration)

      // --- preview -------------------------------------------------------
      let previewKey
      if (isVideo) {
        previewKey = `${prefix}/preview.mp4`
        const out = `${tmp}/preview.mp4`
        await ffmpeg([
          '-v', 'error', '-i', source,
          '-vf', 'scale=-2:720',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-c:a', 'aac', '-b:a', PREVIEW_BITRATE,
          '-movflags', '+faststart', '-y', out,
        ])
        await put(bucket, previewKey, createReadStream(out), 'video/mp4')
      } else {
        previewKey = `${prefix}/preview.mp3`
        const out = `${tmp}/preview.mp3`
        await ffmpeg([
          '-v', 'error', '-i', source,
          '-vn', '-c:a', 'libmp3lame', '-b:a', PREVIEW_BITRATE, '-y', out,
        ])
        await put(bucket, previewKey, createReadStream(out), 'audio/mpeg')
      }

      // --- peaks ---------------------------------------------------------
      const peaks = await peaksFrom(source, tmp)
      await put(bucket, `${prefix}/peaks.json`, JSON.stringify(peaks), 'application/json')

      // --- artwork -------------------------------------------------------
      // Audio: the embedded cover, which ffmpeg exposes as a video stream.
      // Video: there is no cover, so a frame at one second stands in.
      let artworkKey = null
      const art = `${tmp}/artwork.jpg`
      try {
        await ffmpeg(
          isVideo
            ? ['-v', 'error', '-ss', '1', '-i', source, '-frames:v', '1', '-vf', 'scale=-2:600', '-y', art]
            : ['-v', 'error', '-i', source, '-an', '-frames:v', '1', '-y', art],
        )
        if ((await stat(art)).size > 0) {
          artworkKey = `${prefix}/artwork.jpg`
          await put(bucket, artworkKey, createReadStream(art), 'image/jpeg')
        }
      } catch {
        // No cover art is normal, not a failure.
      }

      const size = (await stat(source)).size

      await report({
        track_id: trackId,
        status: 'done',
        fields: {
          title_from_tag: tag(tags, 'title', 'TITLE', 'INAM'),
          artist: tag(tags, 'artist', 'ARTIST', 'album_artist', 'IART'),
          album: tag(tags, 'album', 'ALBUM', 'IPRD'),
          composer: tag(tags, 'composer', 'COMPOSER'),
          grouping: tag(tags, 'grouping', 'TIT1', 'content_group'),
          genre: tag(tags, 'genre', 'GENRE', 'IGNR'),
          year: yearFrom(tag(tags, 'date', 'year', 'TYER', 'ICRD', 'originalyear')),
          release_date: dateFrom(tag(tags, 'date', 'release_date', 'ICRD')),
          bpm: num(tag(tags, 'bpm', 'TBPM', 'tempo')),
          musical_key: tag(tags, 'key', 'initial_key', 'TKEY'),
          isrc: tag(tags, 'isrc', 'TSRC'),
          iswc: tag(tags, 'iswc'),
          pro_number: tag(tags, 'pro_number', 'pro'),
          track_no: int(tag(tags, 'track', 'tracknumber', 'TRCK')),
          disc_no: int(tag(tags, 'disc', 'discnumber', 'TPOS')),
          comments: tag(tags, 'comment', 'comments', 'ICMT', 'description'),
          duration_seconds: duration,
          size_bytes: size,
          content_hash: contentHash,
          preview_key: previewKey,
          artwork_s3_key: artworkKey,
          waveform_peaks: peaks,
          embedded_tags: tags,
        },
      })
    } catch (err) {
      console.error(`${key} failed`, err)
      await report({
        track_id: trackId,
        status: 'failed',
        error: String(err?.message ?? err).slice(0, 500),
      }).catch((e) => console.error('could not report failure', e))
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
  return { ok: true }
}

/** Hand the result to Supabase. This function never touches the database. */
async function report(body) {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/track-processed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-processing-secret': process.env.TRACK_PROCESSED_SECRET,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`track-processed ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}
