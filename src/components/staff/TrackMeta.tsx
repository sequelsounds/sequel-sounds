import { useState } from 'react'
import { useTrackActions, type Track } from '../../lib/queries'

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
          <h2 className="font-title text-[17px] font-normal uppercase">Track details</h2>
          <button type="button" onClick={onClose} className="text-sequel-mid hover:text-sequel-ink">
            ×
          </button>
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
