import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { tokenClient } from '../lib/tokenClient'
import { putToS3, signUpload } from '../lib/upload'

type Submission = {
  id: string
  title: string
  artist: string
  filename: string
  sentAt: Date
}

const EMPTY = {
  title: '',
  artist: '',
  contact_email: '',
  publisher: '',
  writers: '',
  label: '',
  notes: '',
}

export default function Inbox() {
  const { token = '' } = useParams()
  const supabase = useMemo(() => tokenClient(token), [token])

  // The token grants read on its own inbox row only; we need the ids that the
  // RLS insert policy checks.
  const inbox = useQuery({
    queryKey: ['inbox', token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inboxes')
        .select('id, project_id, label')
        .single()
      if (error) throw error
      return data
    },
  })

  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Partners cannot read the inbox back (RLS blocks it, so one partner can't
  // enumerate another's submissions). This session-only list is their receipt.
  const [sent, setSent] = useState<Submission[]>([])

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !inbox.data) return
    setBusy(true)
    setProgress(0)
    setError(null)
    try {
      // 1. The Edge Function validates the token and mints the track id + key.
      const signed = await signUpload(token, file)

      // 2. Straight to S3 — the file never passes through Supabase.
      await putToS3(signed.upload_url, file, setProgress)

      // 3. Only now record the row, so a failed upload leaves no track behind.
      const { error } = await supabase
        .from('tracks')
        .insert({
          ...form,
          id: signed.track_id,
          inbox_id: signed.inbox_id,
          project_id: signed.project_id,
          s3_key: signed.key,
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          kind: file.type.startsWith('video/') ? 'video' : 'audio',
        })
      if (error) throw error

      setSent((s) => [
        {
          id: signed.track_id,
          title: form.title,
          artist: form.artist,
          filename: file.name,
          sentAt: new Date(),
        },
        ...s,
      ])
      setForm(EMPTY)
      setFile(null)
      setFileKey((k) => k + 1)
      setProgress(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded border border-neutral-300 px-3 py-2 text-sm'

  return (
    <div className="mx-auto max-w-xl space-y-8 p-8">
      <div>
        <h1 className="text-xl font-semibold">Submit tracks</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Title, artist and your email are required. Everything else helps but is optional.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Title *" className={field} />
        <input required value={form.artist} onChange={(e) => set('artist', e.target.value)} placeholder="Artist / composer *" className={field} />
        <input required type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="Your email *" className={field} />
        <input value={form.publisher} onChange={(e) => set('publisher', e.target.value)} placeholder="Publisher" className={field} />
        <input value={form.writers} onChange={(e) => set('writers', e.target.value)} placeholder="Writers" className={field} />
        <input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Label" className={field} />
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Notes" rows={3} className={field} />
        <input key={fileKey} required type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />

        {busy && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded bg-neutral-200">
              <div
                className="h-full bg-neutral-900 transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-neutral-500">Uploading… {progress}%</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy || !inbox.data} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? 'Sending…' : 'Send track'}
        </button>
      </form>

      {sent.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Sent in this session</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {sent.map((s) => (
              <li key={s.id} className="py-2">
                <span className="font-medium">{s.title}</span>
                <span className="text-neutral-500"> — {s.artist}</span>
                <div className="text-xs text-neutral-400">
                  {s.filename} · {s.sentAt.toLocaleTimeString()}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-400">
            This list is only kept while the page is open. We have your submissions.
          </p>
        </section>
      )}
    </div>
  )
}
