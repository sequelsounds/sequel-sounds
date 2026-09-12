import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import TrackTable from '../components/staff/TrackTable'
import { useCreator } from '../lib/creator'
import { formatDate, plural } from '../lib/format'
import { splitProjectName } from '../lib/projectName'
import {
  usePlaylistActions,
  usePlaylists,
  useProject,
  useProjectTracks,
  useRecordVisit,
  type TrackWithUse,
} from '../lib/queries'
import { trackProjectUrl } from '../lib/track'
import { PlaylistRows } from './Playlists'

type Tab = 'inbox' | 'playlists' | 'activity'

/**
 * One partner drop. Grouped on the id the inbox page mints per send; rows
 * from before that column existed fall back to sender-and-hour.
 */
type Submission = {
  key: string
  company: string
  email: string
  note: string | null
  latest: string
  tracks: TrackWithUse[]
}

function groupSubmissions(tracks: TrackWithUse[]): Submission[] {
  const groups = new Map<string, Submission>()
  for (const t of tracks) {
    const key = t.submission_id ?? `${t.submitter_email ?? ''}|${t.created_at.slice(0, 13)}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        company: t.submitter_company || t.submitter_name || t.submitter_email || 'Unknown partner',
        email: t.submitter_email ?? '',
        note: t.notes,
        latest: t.created_at,
        tracks: [],
      }
      groups.set(key, g)
    }
    g.tracks.push(t)
    if (t.created_at > g.latest) g.latest = t.created_at
    if (!g.note && t.notes) g.note = t.notes
  }
  return [...groups.values()].sort((a, b) => (a.latest < b.latest ? 1 : -1))
}

export default function Project() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'inbox'
  const project = useProject(id)
  const tracks = useProjectTracks(id)
  const playlists = usePlaylists(id)
  const creator = useCreator()
  const actions = usePlaylistActions()
  useRecordVisit(id)

  const [copied, setCopied] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const submissions = useMemo(() => groupSubmissions(tracks.data ?? []), [tracks.data])
  const { number, title } = splitProjectName(project.data?.name ?? '')
  const trackUrl = trackProjectUrl(project.data?.xano_uuid ?? null)

  const copyInbox = async () => {
    const token = project.data?.inboxes?.token
    if (!token) return
    await navigator.clipboard.writeText(`${location.origin}/inbox/${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'inbox') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }

  if (project.error) return <p className="form-error px-7 py-4">{project.error.message}</p>

  return (
    <>
      <div className="border-b border-sequel-line px-7 pt-[22px]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-title text-[clamp(18px,2.4vw,28px)] font-normal leading-[1.1] [overflow-wrap:anywhere]">
              <span className="sentence-case font-sans">{title}</span>
              {number && (
                <span className="ml-3 align-middle font-sans text-xs normal-case tracking-[.04em] text-sequel-mid">
                  {number}
                </span>
              )}
            </h1>
            <div className="mt-1 text-sequel-mid">{project.data?.client_name ?? ' '}</div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn btn-tool btn-outline"
              disabled={!project.data?.inboxes?.token}
              onClick={() => void copyInbox()}
            >
              {copied ? 'Copied' : 'Copy inbox link'}
            </button>
            {trackUrl && (
              <a className="btn btn-tool btn-quiet" href={trackUrl} target="_blank" rel="noreferrer">
                Open in Track
              </a>
            )}
          </div>
        </div>
        <div role="tablist" className="mt-[22px] flex gap-[26px]">
          <button type="button" role="tab" className="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>
            Inbox
            {tracks.data && (
              <span className="count">
                {plural(submissions.length, 'submission')} · {plural(tracks.data.length, 'track')}
              </span>
            )}
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'playlists'} onClick={() => setTab('playlists')}>
            Playlists
            {playlists.data && <span className="count">{playlists.data.length}</span>}
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>
            Activity
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'inbox' && (
          <>
            {tracks.isPending && <p className="px-7 py-4 text-sequel-mid">Loading…</p>}
            {tracks.error && <p className="form-error px-7 py-4">{tracks.error.message}</p>}
            {tracks.data && submissions.length === 0 && (
              <p className="px-7 py-6 text-sequel-mid">
                Nothing has been sent to this inbox yet. Copy the link above and pass it to partners.
              </p>
            )}
            {submissions.map((s, i) => {
              const open = toggled[s.key] ?? i === 0
              const meta = [s.email, formatDate(s.latest), plural(s.tracks.length, 'track')]
                .filter(Boolean)
                .join(' · ')
              return open ? (
                <section key={s.key}>
                  <div
                    className="submission-open"
                    onClick={() => setToggled((t) => ({ ...t, [s.key]: false }))}
                  >
                    <h2 className="submission-title">{s.company}</h2>
                    <span className="min-w-0 truncate text-[13px] text-sequel-mid">
                      {meta}
                      {s.note && <> · “{s.note}”</>}
                    </span>
                    <span className="ml-auto text-sequel-mid">▾</span>
                  </div>
                  <TrackTable tracks={s.tracks} />
                </section>
              ) : (
                <div
                  key={s.key}
                  className={`submission-closed ${i > 0 && !(toggled[submissions[i - 1].key] ?? i - 1 === 0) ? '' : 'border-t'}`}
                  onClick={() => setToggled((t) => ({ ...t, [s.key]: true }))}
                >
                  <h2 className="submission-title">{s.company}</h2>
                  <span className="min-w-0 truncate text-[13px] text-sequel-mid">{meta}</span>
                  <span className="ml-auto text-sequel-mid">▸</span>
                </div>
              )
            })}
          </>
        )}

        {tab === 'playlists' && (
          <>
            <div className="flex justify-end px-7 pt-4">
              <button
                type="button"
                className="btn btn-tool btn-outline"
                onClick={async () => {
                  const newId = await actions.createPlaylist.mutateAsync({ projectId: id ?? null })
                  creator.open(newId)
                }}
              >
                New playlist
              </button>
            </div>
            {playlists.data && playlists.data.length === 0 && (
              <p className="px-7 py-6 text-sequel-mid">No playlists for this project yet.</p>
            )}
            {playlists.data && playlists.data.length > 0 && (
              <PlaylistRows rows={playlists.data} onOpen={(p) => creator.open(p.id)} current={creator.playlistId} />
            )}
          </>
        )}

        {tab === 'activity' && (
          <div className="px-7 py-6 text-sequel-mid">
            <p>Activity is recorded from the viewer page — who opened each playlist, what they played and for how long.</p>
            <p className="mt-2">Nothing to show until the first playlist is shared.</p>
          </div>
        )}
      </div>
    </>
  )
}
