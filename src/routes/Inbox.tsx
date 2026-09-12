import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SequelLogo from '../components/SequelLogo'
import { fileKey, filesFromDrop, isMediaFile } from '../lib/dropFiles'
import {
  isComplete,
  loadPartner,
  savePartner,
  type Partner,
} from '../lib/partner'
import { loadSent, markSent } from '../lib/sentFiles'
import { readTagsAll, type FileTags } from '../lib/tags'
import { tokenClient } from '../lib/tokenClient'
import { contentTypeFor, putToS3, signUpload } from '../lib/upload'
import { runQueue } from '../lib/uploadQueue'

type RowState =
  'reading' | 'ready' | 'uploading' | 'done' | 'failed' | 'duplicate'

type Row = {
  id: string
  file: File
  dedupe: string
  state: RowState
  progress: number
  error: string | null
  tags: FileTags | null
}

const PARALLEL_UPLOADS = 4

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Keyed on the token so that moving between two inbox links rebuilds the page.
 * Everything here — the queue, the already-sent keys, the batch note — belongs
 * to one inbox, and useRef's initial value would otherwise survive the change
 * and mis-flag files against the previous inbox.
 */
export default function InboxRoute() {
  const { token = '' } = useParams()
  return <Inbox key={token} token={token} />
}

function Inbox({ token }: { token: string }) {
  const supabase = useMemo(() => tokenClient(token), [token])

  // The token grants read on its own inbox row only; we need the ids that the
  // RLS insert policy checks.
  const inbox = useQuery({
    queryKey: ['inbox', token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inboxes')
        .select('id, project_id, projects_mirror(name)')
        .single()
      if (error) throw error
      return data
    },
  })

  // Read once at mount rather than in an effect: there is no SSR here, so the
  // stored partner is available on the very first render and the form never
  // flashes empty for someone who has dropped files before.
  const stored = useMemo(() => loadPartner(), [])
  const [partner, setPartner] = useState<Partner>(stored)
  const [editingPartner, setEditingPartner] = useState(!isComplete(stored))
  const [rows, setRows] = useState<Row[]>([])
  const sentKeys = useRef<Set<string>>(loadSent(token))
  const [note, setNote] = useState('')
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)

  // Workers run concurrently and outlive any single render, so they read the
  // live rows and batch note through refs rather than a captured closure. The
  // refs are synced after commit; every worker is started from an event handler,
  // which runs after effects have flushed.
  const rowsRef = useRef<Row[]>([])
  const noteRef = useRef('')
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    noteRef.current = note
  }, [note])

  useEffect(() => {
    savePartner(partner)
  }, [partner])

  const patch = useCallback((id: string, next: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...next } : row)),
    )
  }, [])

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const media = incoming.filter(isMediaFile)
      if (media.length === 0) return

      const seen = new Set(rowsRef.current.map((row) => row.dedupe))
      const fresh: Row[] = []
      for (const file of media) {
        const dedupe = fileKey(file)
        if (seen.has(dedupe)) continue // dropped the same folder twice
        seen.add(dedupe)
        fresh.push({
          id: crypto.randomUUID(),
          file,
          dedupe,
          // Sent from this browser before — flagged, not dropped, so the
          // partner can see why it is being skipped.
          state: sentKeys.current.has(dedupe) ? 'duplicate' : 'reading',
          progress: 0,
          error: null,
          tags: null,
        })
      }
      if (fresh.length === 0) return

      setRows((current) => [...current, ...fresh])

      // Tags are a fast first pass for the partner's benefit; the row is uploadable
      // either way, so this never gates the queue.
      await readTagsAll(
        fresh.map((row) => row.file),
        (index, tags) =>
          patch(fresh[index].id, {
            tags,
            ...(fresh[index].state === 'duplicate' ? {} : { state: 'ready' }),
          }),
      )
    },
    [patch],
  )

  async function uploadOne(id: string) {
    const row = rowsRef.current.find((r) => r.id === id)
    if (!row || !inbox.data) return

    patch(id, { state: 'uploading', progress: 0, error: null })
    try {
      // 1. The Edge Function validates the token and mints the track id + key.
      const signed = await signUpload(token, row.file)

      // 2. Straight to S3 — the file never passes through Supabase.
      await putToS3(signed.upload_url, row.file, (progress) =>
        patch(id, { progress }),
      )

      // 3. Only now record the row, so a failed upload leaves no track behind.
      const tags = row.tags
      const contentType = contentTypeFor(row.file)
      const trimmedNote = noteRef.current.trim()
      const { error } = await supabase.from('tracks').insert({
        id: signed.track_id,
        inbox_id: signed.inbox_id,
        project_id: signed.project_id,
        s3_key: signed.key,
        original_filename: row.file.name,
        mime_type: contentType,
        size_bytes: row.file.size,
        kind: contentType.startsWith('video/') ? 'video' : 'audio',

        // Browser-side tags, filename as the fallback for title. The Lambda
        // re-reads the file server-side and overwrites these.
        title: tags?.title ?? row.file.name,
        artist: tags?.artist ?? null,
        album: tags?.album ?? null,
        bpm: tags?.bpm ?? null,
        musical_key: tags?.musical_key ?? null,
        duration_seconds: tags?.duration_seconds ?? null,

        submitter_name: partner.name.trim(),
        submitter_email: partner.email.trim(),
        submitter_company: partner.company.trim(),
        // Keep the pre-existing column populated so staff views that read it
        // still show a way to reply.
        contact_email: partner.email.trim(),
        notes: trimmedNote === '' ? null : trimmedNote,
        submission_id: submissionRef.current,
      })
      if (error) throw error

      sentKeys.current.add(row.dedupe)
      markSent(token, row.dedupe)
      patch(id, { state: 'done', progress: 100 })
    } catch (err) {
      patch(id, {
        state: 'failed',
        error: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  // One drop = one submission. The id is minted per send, so the staff inbox
  // can stack the whole drop as a single group without inferring it from
  // timestamps. A retry keeps the id it was first sent under.
  const submissionRef = useRef<string | null>(null)

  async function send(ids: string[]) {
    if (ids.length === 0 || running) return
    if (!submissionRef.current) submissionRef.current = crypto.randomUUID()
    setRunning(true)
    try {
      await runQueue(ids, uploadOne, PARALLEL_UPLOADS)
    } finally {
      setRunning(false)
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    await addFiles(await filesFromDrop(e.dataTransfer))
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    void addFiles(Array.from(e.target.files ?? []))
    e.target.value = '' // let the same folder be picked again
  }

  const counts = useMemo(() => {
    const done = rows.filter((r) => r.state === 'done').length
    const failed = rows.filter((r) => r.state === 'failed').length
    const pending = rows.filter(
      (r) => r.state === 'ready' || r.state === 'reading',
    ).length
    return { done, failed, pending, total: rows.length }
  }, [rows])

  const projectName = inbox.data?.projects_mirror?.name ?? ''
  useEffect(() => {
    document.title = 'Sequel | Upload'
  }, [])

  const partnerReady = isComplete(partner)
  const pendingIds = rows.filter((r) => r.state === 'ready').map((r) => r.id)
  const duplicateCount = rows.filter((r) => r.state === 'duplicate').length
  // What this drop will actually send. A row already sent is not outstanding
  // work, so counting it as one made "0 of 1 done" describe a job that could
  // never finish.
  const sendableTotal = rows.length - duplicateCount
  const failedIds = rows.filter((r) => r.state === 'failed').map((r) => r.id)
  const field = 'field-boxed'

  return (
    <div className="surface-light min-h-screen">
      <div className="mx-auto max-w-4xl space-y-6 px-6 pb-28 pt-10">
        {/* items-start rather than a shared baseline: "Upload" sits beside the
            mark, not the title below, so their top edges are what has to line
            up. */}
        <div className="mb-8 flex items-start justify-between gap-6">
          <SequelLogo />
          <span className="font-title shrink-0 text-[2rem] uppercase leading-none">
            Upload
          </span>
        </div>

        {/* Height is reserved so the page does not jump when the name lands,
            but nothing is drawn in the gap — a placeholder is more noticeable
            than the empty space it is meant to cover. */}
        <header className="min-h-10">
          <h1 className="sentence-case font-sans text-[2rem] font-normal leading-tight">
            {projectName}
          </h1>
        </header>

        {/* ---- who is sending, asked once per browser ---- */}
        <section>
          {partnerReady && !editingPartner ? (
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm">
                <span className="font-medium">{partner.name}</span>
                <span className="text-sequel-brown/70">
                  {' '}
                  · {partner.company}
                </span>
                <div className="text-xs text-sequel-brown/60">
                  {partner.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPartner(true)}
                className="shrink-0 text-xs text-sequel-brown/70 underline"
              >
                Not you?
              </button>
            </div>
          ) : (
            <div
              className="space-y-3"
              onBlur={(e) => {
                // relatedTarget is where focus went; if it is still inside this
                // group the partner is just moving between the three fields.
                if (
                  !e.currentTarget.contains(e.relatedTarget as Node | null) &&
                  isComplete(partner)
                ) {
                  setEditingPartner(false)
                }
              }}
            >
              <div>
                <h2 className="text-sm font-semibold">Who is sending these?</h2>
                <p className="text-xs text-sequel-brown/70">
                  Asked once and remembered on this browser.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  value={partner.name}
                  onChange={(e) =>
                    setPartner({ ...partner, name: e.target.value })
                  }
                  placeholder="Your name"
                  className={field}
                />
                <input
                  type="email"
                  value={partner.email}
                  onChange={(e) =>
                    setPartner({ ...partner, email: e.target.value })
                  }
                  placeholder="Your email"
                  className={field}
                />
                <input
                  value={partner.company}
                  onChange={(e) =>
                    setPartner({ ...partner, company: e.target.value })
                  }
                  placeholder="Company / label"
                  className={field}
                />
              </div>
            </div>
          )}
        </section>

        {/* ---- the dropzone ---- */}
        <section
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`border border-dashed p-10 text-center transition-colors ${
            dragging
              ? 'border-sequel-brown bg-sequel-brown/5'
              : 'border-sequel-brown bg-transparent'
          }`}
        >
          <p className="text-sm font-medium">Drop files or folders here</p>
          <p className="mt-1 text-xs text-sequel-brown/70">
            WAV, AIFF, FLAC, MP3, M4A, MOV, MP4 — up to 2 GB each
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <label className="btn btn-mono btn-outline cursor-pointer">
              Browse
              <input
                type="file"
                multiple
                accept="audio/*,video/*"
                onChange={onPick}
                className="hidden"
              />
            </label>
          </div>
        </section>

        {/* ---- one note for the whole batch ---- */}
        {rows.length > 0 && (
          <section>
            <label className="text-sm font-medium" htmlFor="batch-note">
              Anything we should know?{' '}
              <span className="text-sequel-brown/60">(optional)</span>
            </label>
            <textarea
              id="batch-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Applies to everything in this drop."
              className={`${field} mt-1`}
            />
          </section>
        )}

        {/* ---- the rows ---- */}
        {rows.length > 0 && (
          <section className="overflow-hidden border border-sequel-brown">
            <ul className="divide-y divide-sequel-brown/30">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {row.tags?.title ?? row.file.name}
                    </div>
                    <div className="truncate text-xs text-sequel-brown/70">
                      {[
                        row.tags?.artist,
                        row.tags?.album,
                        formatDuration(row.tags?.duration_seconds ?? null),
                        row.tags?.bpm ? `${row.tags.bpm} BPM` : null,
                        row.tags?.musical_key,
                        formatSize(row.file.size),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {row.state === 'uploading' && (
                      <div className="mt-1.5 h-1 overflow-hidden bg-sequel-brown/15">
                        <div
                          className="h-full bg-sequel-brown transition-[width]"
                          style={{ width: `${row.progress}%` }}
                        />
                      </div>
                    )}
                    {row.state === 'failed' && (
                      <p className="form-error mt-1">{row.error}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-xs">
                    {row.state === 'reading' && (
                      <span className="text-sequel-brown/60">Reading…</span>
                    )}
                    {row.state === 'ready' && (
                      <button
                        type="button"
                        onClick={() =>
                          setRows((c) => c.filter((r) => r.id !== row.id))
                        }
                        className="text-sequel-brown/60 underline hover:text-sequel-brown"
                      >
                        Remove
                      </button>
                    )}
                    {row.state === 'uploading' && (
                      <span className="tabular-nums text-sequel-brown/70">
                        {row.progress}%
                      </span>
                    )}
                    {row.state === 'done' && (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-4 w-4"
                        role="img"
                        aria-label="Sent"
                      >
                        <path
                          d="M3 8.5l3.5 3.5L13 5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                      </svg>
                    )}
                    {row.state === 'duplicate' && (
                      <span className="font-mono text-[0.7rem] uppercase text-sequel-brown/60">
                        Already sent
                      </span>
                    )}
                    {row.state === 'failed' && (
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => void send([row.id])}
                        className="text-sequel-brown underline disabled:opacity-40"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {counts.done > 0 && (
              <p className="border-t border-sequel-brown/30 px-3 py-2 text-xs text-sequel-brown/60">
                Ticked tracks are with us. This list clears when you close the
                page — you do not need to keep it.
              </p>
            )}
          </section>
        )}

        {/* ---- sticky action bar ---- */}
        {rows.length > 0 && (
          <div className="fixed inset-x-0 bottom-0 border-t border-sequel-brown bg-sequel-silver/95 backdrop-blur">
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 p-4">
              <div className="text-sm">
                {sendableTotal > 0 && (
                  <span className="font-medium tabular-nums">
                    {counts.done} of {sendableTotal} done
                  </span>
                )}
                {duplicateCount > 0 && (
                  <span className="text-sequel-brown/70">
                    {sendableTotal > 0 ? ' · ' : ''}
                    {duplicateCount} already sent
                  </span>
                )}
                {counts.failed > 0 && (
                  <span className="text-sequel-error">
                    {' '}
                    · {counts.failed} failed
                  </span>
                )}
                {!partnerReady && (
                  <span className="text-sequel-brown/70">
                    {' '}
                    · add your details first
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {counts.failed > 0 && !running && (
                  <button
                    type="button"
                    onClick={() => void send(failedIds)}
                    className="btn btn-mono btn-outline"
                  >
                    Retry {counts.failed} failed
                  </button>
                )}
                {(pendingIds.length > 0 || running) && (
                  <button
                    type="button"
                    disabled={running || !partnerReady || !inbox.data}
                    onClick={() => void send(pendingIds)}
                    className="btn btn-mono btn-dark"
                  >
                    {running
                      ? `Uploading… ${counts.done}/${sendableTotal}`
                      : `Send ${pendingIds.length} track${pendingIds.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
