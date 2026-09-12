import { useEffect, useRef, useState } from 'react'
import { useMediaUrl } from '../../lib/media'
import { useTrackActions, useTrackDetail, type Track, type TrackDetail } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { putToS3, signArtworkUpload } from '../../lib/upload'
import Artwork from './Artwork'

type Props = {
  track: Track
  onClose: () => void
}

/**
 * Staff corrections to what the Lambda read off the file.
 *
 * The Lambda is the authority on what a file *contains*; this is the authority
 * on what the library *says*, which stops being the same thing the moment a
 * production library writes "TITLE --- sales copy" into the title frame. The
 * full ffprobe dump stays in `embedded_tags` regardless, so nothing typed here
 * destroys the original.
 *
 * Laid out like DISCO's editor: identity strip across the top, artwork in its
 * own column, the fields in pairs beside it. The row of short fields and the
 * comments box follow DISCO's order too, which is why `grouping`, `year`,
 * `release_date` and the disc/track numbers are editable at all — the columns
 * existed and nothing had ever surfaced them.
 */

type FieldKey = keyof Omit<TrackDetail, 'id' | 'artwork_s3_key'>

const PAIRS: { key: FieldKey; label: string }[][] = [
  [
    { key: 'title', label: 'Title' },
    { key: 'artist', label: 'Artist' },
  ],
  [
    { key: 'album', label: 'Album' },
    { key: 'composer', label: 'Composer' },
  ],
  [
    { key: 'grouping', label: 'Grouping' },
    { key: 'genre', label: 'Genre' },
  ],
  [
    { key: 'publisher', label: 'Publisher' },
    { key: 'label', label: 'Label' },
  ],
]

const SHORT: { key: FieldKey; label: string; type?: string; numeric?: boolean }[] = [
  { key: 'year', label: 'Year', numeric: true },
  { key: 'release_date', label: 'Release date', type: 'date' },
  { key: 'bpm', label: 'BPM', numeric: true },
  { key: 'musical_key', label: 'Key' },
  { key: 'isrc', label: 'ISRC' },
]

const NUMERIC = new Set<FieldKey>(['year', 'bpm', 'track_no', 'disc_no'])

export default function TrackMeta({ track, onClose }: Props) {
  const detail = useTrackDetail(track.id)
  const save = useTrackActions()

  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [artKey, setArtKey] = useState<string | null>(track.artwork_s3_key)
  const [artPreview, setArtPreview] = useState<string | null>(null)
  const [artBusy, setArtBusy] = useState(false)
  const [artError, setArtError] = useState<string | null>(null)
  const [artOver, setArtOver] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const artInput = useRef<HTMLInputElement>(null)

  // Server truth fills the form once it lands. The dialog opens immediately on
  // what the list already knows, so it never blocks on this.
  useEffect(() => {
    if (!detail.data) return
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(detail.data)) {
      if (k === 'id' || k === 'artwork_s3_key') continue
      next[k] = v == null ? '' : String(v)
    }
    setForm(next)
    setArtKey(detail.data.artwork_s3_key)
  }, [detail.data])

  const { data: storedArtUrl } = useMediaUrl(artPreview ? null : artKey)
  const shownArt = artPreview ?? storedArtUrl ?? null

  useEffect(() => {
    return () => {
      if (artPreview) URL.revokeObjectURL(artPreview)
    }
  }, [artPreview])

  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const uploadArtwork = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setArtError('That is not an image.')
      return
    }
    setArtBusy(true)
    setArtError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      if (!accessToken) throw new Error('Your session has expired. Sign in again.')
      const signed = await signArtworkUpload(file, track.id, accessToken)
      await putToS3(signed.upload_url, file, () => {})
      setArtKey(signed.key)
      setArtPreview(URL.createObjectURL(file))
    } catch (err) {
      setArtError(err instanceof Error ? err.message : 'Could not upload that image.')
    } finally {
      setArtBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    const patch: Record<string, string | number | null> = {}
    for (const key of Object.keys(form)) {
      const raw = form[key].trim()
      if (raw === '') {
        // title is not null in the schema, so an emptied one keeps what it had.
        patch[key] = key === 'title' ? track.title : null
      } else if (NUMERIC.has(key as FieldKey)) {
        const n = Number(raw)
        patch[key] = Number.isFinite(n) ? n : null
      } else {
        patch[key] = raw
      }
    }
    patch.artwork_s3_key = artKey
    await save.mutateAsync({ id: track.id, ...patch })
    onClose()
  }

  const subtitle = [detail.data?.artist ?? track.artist, detail.data?.album ?? track.album]
    .filter(Boolean)
    .join(': ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sequel-brown/40 p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="surface-light flex max-h-full w-full max-w-[68rem] flex-col overflow-hidden border border-sequel-line shadow-[0_10px_40px_rgba(55,43,41,0.25)]"
      >
        {/* Identity strip, as DISCO has it: the track says what it is, rather
            than the dialog saying what kind of dialog it is. */}
        <div className="flex items-center gap-3 border-b border-sequel-line px-6 py-4">
          <Artwork artworkKey={artKey} kind={track.kind} className="h-11! w-11! shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate">{detail.data?.title ?? track.title}</div>
            <div className="truncate text-xs font-light">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 px-2 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-6 overflow-auto p-6">
          {/* ---- artwork column ---- */}
          <div className="w-48 shrink-0">
            <span className="field-label block">Track artwork</span>
            <div
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setArtOver(true)
              }}
              onDragLeave={() => setArtOver(false)}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setArtOver(false)
                void uploadArtwork(e.dataTransfer.files[0])
              }}
              className={`relative mt-1 aspect-square w-full border border-dashed ${
                artOver ? 'border-sequel-brown bg-sequel-well' : 'border-sequel-line'
              }`}
            >
              {shownArt ? (
                <>
                  <img src={shownArt} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="Remove artwork"
                    title="Remove artwork"
                    onClick={() => {
                      setArtKey(null)
                      setArtPreview(null)
                    }}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center bg-sequel-brown text-sequel-silver"
                  >
                    ×
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => artInput.current?.click()}
                  className="h-full w-full px-3 text-[11px]"
                >
                  {artBusy ? 'Uploading…' : 'Drop an image, or click to choose'}
                </button>
              )}
            </div>
            <button
              type="button"
              className="mt-2 text-[11px] underline"
              disabled={artBusy}
              onClick={() => artInput.current?.click()}
            >
              {shownArt ? 'Replace image' : 'Choose an image'}
            </button>
            <p className="mt-1 text-[11px] font-light">JPG, PNG or WebP, up to 10 MB.</p>
            {artError && <p className="form-error mt-1">{artError}</p>}
            <input
              ref={artInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void uploadArtwork(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          {/* ---- fields ---- */}
          <div className="min-w-0 flex-1">
            {!form ? (
              <p className="font-light">Loading…</p>
            ) : (
              <div className="space-y-3">
                {PAIRS.map((pair) => (
                  <div key={pair[0].key} className="grid grid-cols-2 gap-3">
                    {pair.map((f) => (
                      <label key={f.key}>
                        <span className="field-label block">{f.label}</span>
                        <input
                          className="field-boxed mt-1"
                          value={form[f.key] ?? ''}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                ))}

                <div className="grid grid-cols-6 gap-3">
                  {SHORT.map((f) => (
                    <label key={f.key}>
                      <span className="field-label block">{f.label}</span>
                      <input
                        type={f.type ?? 'text'}
                        inputMode={f.numeric ? 'numeric' : undefined}
                        className="field-boxed mt-1"
                        value={form[f.key] ?? ''}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    </label>
                  ))}
                  <div>
                    <span className="field-label block">Order</span>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        aria-label="Track number"
                        inputMode="numeric"
                        className="field-boxed"
                        value={form.track_no ?? ''}
                        onChange={(e) => set('track_no', e.target.value)}
                      />
                      <span className="font-light">/</span>
                      <input
                        aria-label="Disc number"
                        inputMode="numeric"
                        className="field-boxed"
                        value={form.disc_no ?? ''}
                        onChange={(e) => set('disc_no', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <label className="block">
                  <span className="field-label block">Comments</span>
                  <textarea
                    rows={4}
                    className="field-boxed mt-1"
                    value={form.comments ?? ''}
                    onChange={(e) => set('comments', e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="field-label block">
                    Staff notes — never shown to partners or clients
                  </span>
                  <textarea
                    rows={2}
                    className="field-boxed mt-1"
                    value={form.staff_notes ?? ''}
                    onChange={(e) => set('staff_notes', e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-sequel-line px-6 py-4">
          {/* A uuid is not something anyone retypes, so it copies. */}
          <button
            type="button"
            title="Copy track ID"
            onClick={async () => {
              await navigator.clipboard.writeText(track.id)
              setIdCopied(true)
              setTimeout(() => setIdCopied(false), 1500)
            }}
            className="text-[11px] font-light underline"
          >
            {idCopied ? 'ID copied' : `ID: ${track.id}`}
          </button>
          <div className="flex items-center gap-2">
            {save.error && <span className="form-error">{save.error.message}</span>}
            <button type="button" onClick={onClose} className="btn btn-tool btn-quiet">
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending || !form}
              className="btn btn-tool btn-dark"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
