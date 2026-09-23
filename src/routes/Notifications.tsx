import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useMe } from '../lib/xanoMirror'
import {
  notificationHref,
  useMarkNotificationsRead,
  useNotifications,
  type Notification,
} from '../lib/notifications'

/**
 * The Notifications page, laid out like /projects: the same header, the same
 * search-and-counters band, the same column head and 4rem rows that invert on
 * hover. It had been a one-off layout and looked like it.
 *
 * ⚠️ NOTHING IS MARKED READ BY LOOKING AT IT. Opening the page does not clear
 * the badge — arriving and reading are different things. A row clears when it
 * is clicked, or all of them from MARK ALL READ.
 *
 * ⚠️ THE DOT IS THE ONLY UNREAD MARK — no bold, no tinted row. A feed where
 * unread items shout gets cleared to make it stop rather than read.
 */

/** What each kind is called in the Type column. Unknown kinds fall back to the
 *  raw kind with underscores as spaces, so a new one never renders blank. */
const KIND_LABEL: Record<string, string> = {
  release_form_viewed: 'Release form opened',
  release_form_downloaded: 'Release form downloaded',
  invoice_submitted: 'Invoice to raise',
  invoice_raised: 'Invoice raised',
  invoice_paid: 'Invoice paid',
  invoice_overdue: 'Invoice overdue',
  brief_submitted: 'Brief submitted',
  studio_upload: 'Music received',
  song_confirmed: 'Song confirmed',
  schedule_a_signed: 'Schedule A signed',
  access_requested: 'Access request',
}

const kindLabel = (kind: string) => {
  const label = KIND_LABEL[kind] ?? kind.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** "2 hours ago" / "Yesterday" / "14 Sep 2026" — close things as elapsed time,
 *  distant ones as the app's date format. */
function when(iso: string) {
  const then = new Date(iso)
  const mins = Math.round((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (hours < 48) return 'Yesterday'
  const day = then.getDate()
  const month = then.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)
  return `${day} ${month} ${then.getFullYear()}`
}

const project = (n: Notification) =>
  [n.project_sequel_no, n.project_title].filter(Boolean).join(' ') || '—'

function Counter({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Notifications() {
  const me = useMe()
  const notifications = useNotifications()
  const read = useMarkNotificationsRead()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const unread = notifications.data?.unread ?? 0

  const rows = useMemo(() => {
    const all = notifications.data?.items ?? []
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((n) =>
      [n.message, project(n), kindLabel(n.kind)].join(' ').toLowerCase().includes(term),
    )
  }, [notifications.data, q])

  const open = (n: Notification) => {
    if (!n.read_at) read.mutate([n.id])
    const href = notificationHref(n)
    if (href) navigate(href)
  }

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Let&rsquo;s check in on&hellip;</div>
        <div className="title-row">
          <h1 className="page-title">Your notifications</h1>
          {unread > 0 && (
            <button
              type="button"
              className="btn btn-mono btn-outline"
              disabled={read.isPending}
              onClick={() => read.mutate(undefined)}
            >
              {read.isPending ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>
        <div className="page-subtitle">{me.data?.name ?? ' '}</div>
      </div>

      <div className="tab-band">
        <div className="tab-band-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search notifications"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="Unread" value={unread} />
        <div className="tab-band-divider" />
        <Counter label="Total" value={notifications.data?.items.length ?? 0} />
      </div>

      <div className="nt-grid project-list-head">
        <span className="project-list-head-cell">Notification</span>
        <span className="project-list-head-cell">Project</span>
        <span className="project-list-head-cell">Type</span>
        <span className="project-list-head-cell">When</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {notifications.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {notifications.error && (
          <p className="form-error px-8 py-4">{notifications.error.message}</p>
        )}
        {notifications.data &&
          rows.map((n) => (
            <div
              key={n.id}
              className="nt-grid project-list-row"
              onClick={() => open(n)}
              title={n.read_at ? undefined : 'Unread'}
            >
              <span className={`nt-dot${n.read_at ? ' is-read' : ''}`} aria-hidden="true" />
              <span className="project-list-cell" title={n.message}>
                {n.message}
              </span>
              <span className="project-list-cell" title={project(n)}>
                {project(n)}
              </span>
              <span className="project-list-cell">{kindLabel(n.kind)}</span>
              <span className="project-list-cell">{when(n.created_at)}</span>
            </div>
          ))}
        {notifications.data && rows.length === 0 && (
          <div className="no-result-row">
            {q ? 'Nothing matches that search.' : 'No notifications yet.'}
          </div>
        )}
      </div>
    </>
  )
}
