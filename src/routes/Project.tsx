import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronIcon } from '../components/staff/icons'
import Search from '../components/staff/Search'
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
    const key =
      t.submission_id ??
      `${t.submitter_email ?? ''}|${t.created_at.slice(0, 13)}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        company:
          t.submitter_company ||
          t.submitter_name ||
          t.submitter_email ||
          'Unknown partner',
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

  const submissions = useMemo(
    () => groupSubmissions(tracks.data ?? []),
    [tracks.data],
  )
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

  if (project.error)
    return <p className="form-error px-7 py-4">{project.error.message}</p>

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">{project.data?.client_name ?? ' '}</div>
        <div className="title-row gap-4">
          <h1 className="page-title min-w-0 flex-1 truncate">
            <span className="sentence-case font-sans">{title}</span>
          </h1>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn btn-tool btn-outline"
              disabled={!project.data?.inboxes?.token}
              onClick={() => void copyInbox()}
            >
              {copied ? 'Copied' : 'Copy inbox link'}
            </button>
            {trackUrl && (
              <a
                className="btn btn-tool btn-quiet"
                href={trackUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in Track
              </a>
            )}
          </div>
        </div>
        <div className="page-subtitle">{number || ' '}</div>
      </div>

      {/* tab_bar_app: the search first at 40%, then the divider, then what
          the band is for on this page — as the Projects page puts its stats
          after the same two. */}
      <div className="tab-band">
        <div className="tab-band-search">
          <Search />
        </div>
        <div className="tab-band-divider mx-6" />
        <div
          role="tablist"
          className="flex items-end gap-[26px] self-stretch"
        >
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'inbox'}
            onClick={() => setTab('inbox')}
          >
            Inbox
            {tracks.data && (
              <span className="count">
                {plural(submissions.length, 'submission')} ·{' '}
                {plural(tracks.data.length, 'track')}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'playlists'}
            onClick={() => setTab('playlists')}
          >
            Playlists
            {playlists.data && (
              <span className="count">{playlists.data.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'activity'}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'inbox' && (
          <>
            {tracks.isPending && (
              <p className="px-7 py-4 text-sequel-mid">Loading…</p>
            )}
            {tracks.error && (
              <p className="form-error px-7 py-4">{tracks.error.message}</p>
            )}
            {tracks.data && submissions.length === 0 && (
              <p className="px-7 py-6 text-sequel-mid">
                Nothing has been sent to this inbox yet. Copy the link above and
                pass it to partners.
              </p>
            )}
            {submissions.map((s, i) => {
              const open = toggled[s.key] ?? i === 0
              const meta = [
                s.email,
                formatDate(s.latest),
                plural(s.tracks.length, 'track'),
              ]
                .filter(Boolean)
                .join(' · ')
              return open ? (
                <section key={s.key}>
                  <div
                    className="submission-open"
                    onClick={() =>
                      setToggled((t) => ({ ...t, [s.key]: false }))
                    }
                  >
                    <h2 className="submission-title">{s.company}</h2>
                    <span className="min-w-0 truncate text-[13px] text-sequel-mid">
                      {meta}
                      {s.note && <> · “{s.note}”</>}
                    </span>
                    <ChevronIcon className="ml-auto shrink-0" />
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
                  <span className="min-w-0 truncate text-[13px] text-sequel-mid">
                    {meta}
                  </span>
                  <ChevronIcon className="ml-auto shrink-0 -rotate-90" />
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
                  const newId = await actions.createPlaylist.mutateAsync({
                    projectId: id ?? null,
                  })
                  creator.open(newId)
                }}
              >
                New playlist
              </button>
            </div>
            {playlists.data && playlists.data.length === 0 && (
              <p className="px-7 py-6 text-sequel-mid">
                No playlists for this project yet.
              </p>
            )}
            {playlists.data && playlists.data.length > 0 && (
              <PlaylistRows
                rows={playlists.data}
                onOpen={(p) => creator.open(p.id)}
                current={creator.playlistId}
              />
            )}
          </>
        )}

        {tab === 'activity' && (
          <div className="px-7 py-6 text-sequel-mid">
            <p>
              Activity is recorded from the viewer page — who opened each
              playlist, what they played and for how long.
            </p>
            <p className="mt-2">
              Nothing to show until the first playlist is shared.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
