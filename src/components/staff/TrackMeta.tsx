import { useEffect, useRef, useState } from 'react'
import { useCornerIsDark } from '../../lib/luminance'
import { useMediaUrl } from '../../lib/media'
import { useTrackActions, useTrackDetail, type Track, type TrackDetail } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { putToS3, signArtworkUpload } from '../../lib/upload'
import { ChevronIcon } from './icons'

type Props = {
  track: Track
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}

/**
 * Staff corrections to what the Lambda read off the file.
 *
 * The Lambda is the authority on what a file *contains*; this is the authority
 * on what the library *says*, which stops being the same thing the moment a
 * production library writes "TITLE --- sales copy" into the title frame. The
 * full ffprobe dump stays in `embedded_tags` regardless — it is what the
 * Custom tab reads — so nothing typed here destroys the original.
 *
 * Laid out to match DISCO's editor, which staff already use daily: same tabs,
 * same field order, same artwork column, same footer. Lyrics and Tags are
 * deliberately empty — the spec puts both out of scope — but the tabs are
 * present rather than missing, so the two editors read the same way.
 */

type Tab = 'metadata' | 'lyrics' | 'writers' | 'tags' | 'custom' | 'notes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'writers', label: 'Writers' },
  { id: 'tags', label: 'Tags' },
  { id: 'custom', label: 'Custom' },
  { id: 'notes', label: 'Notes' },
]

type FieldKey = keyof TrackDetail

/** DISCO's Metadata tab, in DISCO's order. */
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
]

const SHORT: { key: FieldKey; label: string; type?: string }[] = [
  { key: 'year', label: 'Year' },
  { key: 'release_date', label: 'Release date', type: 'date' },
  { key: 'bpm', label: 'BPM' },
  { key: 'isrc', label: 'ISRC' },
]

const NUMERIC = new Set<string>(['year', 'bpm', 'track_no', 'disc_no'])
const SKIP = new Set<string>(['id', 'artwork_s3_key', 'writers', 'embedded_tags'])

/** Every key the form holds, so the shape never changes once mounted. */
const FORM_KEYS = [
  'title', 'artist', 'album', 'composer', 'publisher', 'label', 'grouping',
  'genre', 'year', 'release_date', 'bpm', 'musical_key', 'isrc', 'track_no',
  'disc_no', 'comments', 'staff_notes', 'lyrics',
] as const

/**
 * The list row already carries most of these, so the dialog opens filled
 * rather than on a spinner. Without this it rendered a one-line "Loading…"
 * body and then jumped from roughly 250px to 660px when the query landed —
 * centred, so it grew from the middle and read as the dialog changing shape.
 */
function seedFrom(track: Track): Record<string, string> {
  const known = track as unknown as Record<string, unknown>
  const seed: Record<string, string> = {}
  for (const k of FORM_KEYS) {
    const v = known[k]
    seed[k] = v == null ? '' : String(v)
  }
  return seed
}

type Writer = { name?: string; publisher?: string; pro?: string; split?: number | string }

export default function TrackMeta({ track, onClose, onPrev, onNext }: Props) {
  const detail = useTrackDetail(track.id)
  const save = useTrackActions()

  const [tab, setTab] = useState<Tab>('metadata')
  const [form, setForm] = useState<Record<string, string>>(() => seedFrom(track))
  // Keys the person has typed into. The server's copy must not overwrite an
  // edit made while it was still in flight.
  const touched = useRef<Set<string>>(new Set())
  const [writers, setWriters] = useState<Writer[]>([])
  const [artKey, setArtKey] = useState<string | null>(track.artwork_s3_key)
  const [artPreview, setArtPreview] = useState<string | null>(null)
  const [artBusy, setArtBusy] = useState(false)
  const [artError, setArtError] = useState<string | null>(null)
  const [artOver, setArtOver] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const artInput = useRef<HTMLInputElement>(null)

  // The full row fills in the handful the list does not carry — grouping,
  // year, release date, the disc numbers, comments. None of them change the
  // dialog's height, so nothing moves when it arrives.
  useEffect(() => {
    if (!detail.data) return
    setForm((current) => {
      const next = { ...current }
      for (const [k, v] of Object.entries(detail.data)) {
        if (SKIP.has(k) || touched.current.has(k)) continue
        next[k] = v == null ? '' : String(v)
      }
      return next
    })
    setArtKey(detail.data.artwork_s3_key)
    setWriters(Array.isArray(detail.data.writers) ? (detail.data.writers as Writer[]) : [])
  }, [detail.data])

  const { data: storedArtUrl } = useMediaUrl(artPreview ? null : artKey)
  const shownArt = artPreview ?? storedArtUrl ?? null

  // The mark sits on the picture with nothing behind it, so it takes its
  // colour from what it is standing on. Unknown keeps silver rather than
  // guessing: a wrong guess on a light sleeve makes it invisible.
  const cornerIsDark = useCornerIsDark(shownArt)

  useEffect(() => {
    return () => {
      if (artPreview) URL.revokeObjectURL(artPreview)
    }
  }, [artPreview])

  const set = (k: string, v: string) => {
    touched.current.add(k)
    setForm((f) => ({ ...f, [k]: v }))
  }

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
    const patch: Record<string, unknown> = {}
    for (const key of Object.keys(form)) {
      const raw = form[key].trim()
      if (raw === '') {
        // title is not null in the schema, so an emptied one keeps what it had.
        patch[key] = key === 'title' ? track.title : null
      } else if (NUMERIC.has(key)) {
        const n = Number(raw)
        patch[key] = Number.isFinite(n) ? n : null
      } else {
        patch[key] = raw
      }
    }
    patch.artwork_s3_key = artKey
    const cleanWriters = writers.filter((w) => (w.name ?? '').trim() !== '')
    patch.writers = cleanWriters.length ? cleanWriters : null
    await save.mutateAsync({ id: track.id, ...patch })
    onClose()
  }

  const field = 'field-boxed py-2.5!'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sequel-brown/40 p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="surface-light flex max-h-full w-full max-w-[64rem] flex-col overflow-hidden border border-sequel-line shadow-[0_10px_40px_rgba(55,43,41,0.25)]"
      >
        {/* ---- header: the track, and a way through the list ---- */}
        <div className="flex items-center gap-4 px-7 pt-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center bg-sequel-well">
            {shownArt ? (
              <img src={shownArt} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-mono text-xs">♪</span>
            )}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-[1.35rem] font-normal">
            {detail.data?.title ?? track.title}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!onPrev}
              aria-label="Previous track"
              className="grid h-9 w-9 place-items-center disabled:opacity-30"
            >
              <ChevronIcon size="1.25rem" className="rotate-90" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              aria-label="Next track"
              className="grid h-9 w-9 place-items-center disabled:opacity-30"
            >
              <ChevronIcon size="1.25rem" className="-rotate-90" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              // Same weight as the one on the artwork. Ink rather than silver:
              // this one sits on the light surface, where silver is invisible.
              className="grid h-9 w-9 place-items-center text-[1.6rem] leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* ---- tabs ---- */}
        <div role="tablist" className="mt-5 flex gap-7 border-b border-sequel-line px-7">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="tab"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Metadata is the tallest tab, so it sets the height and the rest
            fill it. Without this the dialog resized on every tab change —
            660px on Metadata, 318px on Notes, 268px on Tags — which read as
            the dialog jumping about rather than the content changing. */}
        <div className="flex min-h-[27rem] flex-1 overflow-auto px-7 py-6">
          {tab === 'metadata' ? (
            <div className="flex w-full gap-7">
              {/* ---- artwork ---- */}
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
                  className={`relative mt-2 aspect-square w-full border border-dashed ${
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
                        className={`absolute right-0 top-0 grid h-9 w-9 place-items-center text-[1.6rem] leading-none ${
                          cornerIsDark === false ? 'text-sequel-brown' : 'text-sequel-silver'
                        }`}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => artInput.current?.click()}
                      className="h-full w-full px-4 text-[13px] font-light"
                    >
                      {artBusy ? 'Uploading…' : 'Drag and drop image here, or click to browse'}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] font-light">JPG, PNG or WebP, up to 10 MB.</p>
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
              <div className="min-w-0 flex-1 space-y-4">
                {PAIRS.map((pair) => (
                  <div key={pair[0].key} className="grid grid-cols-2 gap-5">
                    {pair.map((f) => (
                      <label key={f.key}>
                        <span className="field-label block">{f.label}</span>
                        <input
                          className={`${field} mt-2`}
                          value={form[f.key] ?? ''}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                ))}

                <div className="grid grid-cols-5 gap-5">
                  {SHORT.map((f) => (
                    <label key={f.key}>
                      <span className="field-label block">{f.label}</span>
                      <input
                        type={f.type ?? 'text'}
                        inputMode={NUMERIC.has(f.key) ? 'numeric' : undefined}
                        className={`${field} mt-2`}
                        value={form[f.key] ?? ''}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    </label>
                  ))}
                  <div>
                    <span className="field-label block">Order</span>
                    <div className="mt-2 flex items-center gap-1">
                      <input
                        aria-label="Track number"
                        inputMode="numeric"
                        className={field}
                        value={form.track_no ?? ''}
                        onChange={(e) => set('track_no', e.target.value)}
                      />
                      <span className="font-light">/</span>
                      <input
                        aria-label="Disc number"
                        inputMode="numeric"
                        className={field}
                        value={form.disc_no ?? ''}
                        onChange={(e) => set('disc_no', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <label className="block">
                  <span className="field-label block">Comments</span>
                  <input
                    className={`${field} mt-2`}
                    value={form.comments ?? ''}
                    onChange={(e) => set('comments', e.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : tab === 'lyrics' ? (
            <label className="block w-full">
              <span className="field-label block">Lyrics</span>
              {/* The one place a single line will not do. Resize is off, so
                  it is a plain box like every other field rather than one
                  with a grabber in the corner. */}
              <textarea
                rows={14}
                className={`${field} mt-2`}
                placeholder="Type or paste the lyrics."
                value={form.lyrics ?? ''}
                onChange={(e) => set('lyrics', e.target.value)}
              />
            </label>
          ) : tab === 'writers' ? (
            <div className="w-full space-y-3">
              {writers.length === 0 && (
                <p className="font-light">No writers recorded. Add the first one below.</p>
              )}
              {writers.map((w, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_6rem_5rem_2rem] items-end gap-3">
                  {(['name', 'publisher', 'pro'] as const).map((k) => (
                    <label key={k}>
                      {i === 0 && <span className="field-label block capitalize">{k}</span>}
                      <input
                        className={`${field} mt-2`}
                        value={String(w[k] ?? '')}
                        onChange={(e) =>
                          setWriters((ws) =>
                            ws.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label>
                    {i === 0 && <span className="field-label block">Split %</span>}
                    <input
                      inputMode="numeric"
                      className={`${field} mt-2`}
                      value={String(w.split ?? '')}
                      onChange={(e) =>
                        setWriters((ws) =>
                          ws.map((x, j) => (j === i ? { ...x, split: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Remove writer"
                    className="mb-2"
                    onClick={() => setWriters((ws) => ws.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-tool btn-outline"
                onClick={() => setWriters((ws) => [...ws, { name: '' }])}
              >
                Add writer
              </button>
              <p className="text-[11px] font-light">
                Nothing here checks that the splits total 100.
              </p>
            </div>
          ) : tab === 'notes' ? (
            <label className="block w-full">
              <span className="field-label block">
                Staff notes — never shown to partners or clients
              </span>
              <textarea
                rows={14}
                className={`${field} mt-2`}
                placeholder="Anything the team should know about this track."
                value={form.staff_notes ?? ''}
                onChange={(e) => set('staff_notes', e.target.value)}
              />
            </label>
          ) : tab === 'custom' ? (
            <div className="w-full">
              <p className="field-label mb-2">
                Every tag as the file carried it, exactly as ffprobe read it. Read-only — this is
                the original the fields above were taken from.
              </p>
              <pre className="field-boxed max-h-[22rem] overflow-auto font-mono! text-[11px]! [white-space:pre-wrap]">
                {detail.data?.embedded_tags
                  ? JSON.stringify(detail.data.embedded_tags, null, 2)
                  : 'Nothing embedded — this track has not been processed yet.'}
              </pre>
            </div>
          ) : (
            <p className="font-light">
              Tags are not kept in Sequel Studio — the spec leaves the taxonomy until later.
            </p>
          )}
        </div>

        {/* ---- footer ---- */}
        <div className="flex items-center justify-between gap-4 border-t border-sequel-line px-7 py-5">
          {/* A uuid is not something anyone retypes, so it copies. */}
          <button
            type="button"
            title="Copy track ID"
            onClick={async () => {
              await navigator.clipboard.writeText(track.id)
              setIdCopied(true)
              setTimeout(() => setIdCopied(false), 1500)
            }}
            // Not underlined: it is an identifier, not a link. The underline
            // on hover is enough to say it does something.
            className="min-w-0 truncate text-[11px] font-light hover:underline"
          >
            {idCopied ? 'ID copied' : `ID: ${track.id}`}
          </button>
          <div className="flex shrink-0 items-center gap-3">
            {save.error && <span className="form-error">{save.error.message}</span>}
            <button type="button" onClick={onClose} className="btn btn-tool btn-quiet">
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
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
