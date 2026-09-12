import { useEffect, useRef, useState } from 'react'
import { useMediaUrl } from '../../lib/media'
import { useTrackActions, type Track } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { putToS3, signArtworkUpload } from '../../lib/upload'

type Props = {
  track: Track
  onClose: () => void
}

type Field = {
  key: keyof Track
  label: string
  wide?: boolean
  numeric?: boolean
}

/**
 * Staff corrections to what the Lambda read off the file. The Lambda is the
 * authority on what a file *contains*; this is the authority on what the
 * library *says*, which is not the same thing once a production library has
 * stuffed a paragraph of sales copy into the title tag.
 *
 * Only the fields staff actually retype are here. The full ffprobe dump stays
 * in `embedded_tags` either way, so nothing typed here loses the original.
 */
const FIELDS: Field[] = [
  { key: 'title', label: 'Title', wide: true },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'composer', label: 'Composer' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'label', label: 'Label' },
  { key: 'genre', label: 'Genre' },
  { key: 'bpm', label: 'BPM', numeric: true },
  { key: 'musical_key', label: 'Key' },
  { key: 'isrc', label: 'ISRC' },
]

export default function TrackMeta({ track, onClose }: Props) {
  const save = useTrackActions()
  const [artKey, setArtKey] = useState<string | null>(track.artwork_s3_key)
  const [artPreview, setArtPreview] = useState<string | null>(null)
  const [artBusy, setArtBusy] = useState(false)
  const [artError, setArtError] = useState<string | null>(null)
  const [artOver, setArtOver] = useState(false)
  const artInput = useRef<HTMLInputElement>(null)

  // The stored cover, signed. A just-picked file is previewed from the blob
  // instead, so the picture changes the moment it is chosen rather than after
  // a round trip.
  const { data: storedArtUrl } = useMediaUrl(artPreview ? null : artKey)
  const shownArt = artPreview ?? storedArtUrl ?? null

  // Revoking on unmount rather than on every change: the object URL has to
  // outlive the render that painted it.
  useEffect(() => {
    return () => {
      if (artPreview) URL.revokeObjectURL(artPreview)
    }
  }, [artPreview])

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
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const f of FIELDS) initial[f.key] = String(track[f.key] ?? '')
    initial.staff_notes = track.staff_notes ?? ''
    return initial
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const patch: Record<string, string | number | null> = {}
    for (const f of FIELDS) {
      const raw = form[f.key].trim()
      if (f.numeric) patch[f.key] = raw === '' ? null : Number(raw)
      // Title is not null in the schema, so an emptied one keeps what it had.
      else if (f.key === 'title') patch.title = raw === '' ? track.title : raw
      else patch[f.key] = raw === '' ? null : raw
    }
    patch.staff_notes = form.staff_notes.trim() === '' ? null : form.staff_notes.trim()
    patch.artwork_s3_key = artKey
    await save.mutateAsync({ id: track.id, ...patch })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sequel-brown/40 p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="surface-light max-h-full w-full max-w-2xl overflow-auto border border-sequel-line p-6 shadow-[0_10px_40px_rgba(55,43,41,0.25)]"
      >
        <div className="mb-4 flex items-baseline justify-between gap-4">
          {/* .display-heading is already Creato at 2rem/300 — the login page's
              treatment, reused rather than restated. */}
          <h2 className="display-heading uppercase">Track details</h2>
          <button type="button" onClick={onClose} className="text-sequel-mid hover:text-sequel-ink">
            ×
          </button>
        </div>

        {/* ---- artwork ---- */}
        <div className="mb-4">
          <span className="field-label block text-sequel-mid">Artwork</span>
          <div className="mt-1 flex items-start gap-3">
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
              className={`relative h-32 w-32 shrink-0 border border-dashed ${
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
                  className="h-full w-full px-2 text-[11px] text-sequel-ink"
                >
                  {artBusy ? 'Uploading…' : 'Drop an image, or click to choose'}
                </button>
              )}
            </div>
            <div className="text-[11px] text-sequel-ink">
              <button
                type="button"
                className="underline"
                disabled={artBusy}
                onClick={() => artInput.current?.click()}
              >
                {shownArt ? 'Replace image' : 'Choose an image'}
              </button>
              <p className="mt-1 font-light">JPG, PNG or WebP, up to 10 MB.</p>
              {artError && <p className="form-error mt-1">{artError}</p>}
            </div>
          </div>
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

        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className={f.wide ? 'col-span-2' : ''}>
              <span className="field-label block text-sequel-mid">{f.label}</span>
              <input
                className="field-boxed mt-1"
                value={form[f.key]}
                inputMode={f.numeric ? 'decimal' : undefined}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="col-span-2">
            <span className="field-label block text-sequel-mid">
              Staff notes — never shown to partners or clients
            </span>
            <textarea
              rows={2}
              className="field-boxed mt-1"
              value={form.staff_notes}
              onChange={(e) => setForm((s) => ({ ...s, staff_notes: e.target.value }))}
            />
          </label>
        </div>

        {save.error && <p className="form-error mt-3">{save.error.message}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-tool btn-quiet">
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className="btn btn-tool btn-dark">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
