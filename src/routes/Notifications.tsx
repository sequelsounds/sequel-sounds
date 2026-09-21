import { Link } from 'react-router-dom'
import { Loader } from '../components/Loader'
import {
  notificationHref,
  useMarkNotificationsRead,
  useNotifications,
  type Notification,
} from '../lib/notifications'

/**
 * The Notifications page — the Rail's last dead link, made real.
 *
 * ⚠️ IT IS NOT A LOG. Only things somebody should act on or would want to know
 * land here; counts and history stay where they belong (a release form's opens
 * are in its share menu). The first kinds are a sent release form being opened
 * and being downloaded, once each.
 *
 * ⚠️ NOTHING IS MARKED READ BY LOOKING AT IT. Opening the page does not clear
 * the badge, because arriving and reading are different things and a badge that
 * empties on arrival is a badge that hides what it was for. A row clears when
 * it is clicked, or all of them from the button.
 */

/** "2 hours ago" / "Yesterday" / "3 Sep" — close things read as elapsed time,
 *  distant ones as a date, which is how people actually read a feed. */
function when(iso: string) {
  const then = new Date(iso)
  const mins = Math.round((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (hours < 48) return 'Yesterday'
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Row({ n, onRead }: { n: Notification; onRead: () => void }) {
  const href = notificationHref(n)
  const body = (
    <>
      {/* The dot is the whole unread affordance: no bold text, no tinted row.
          A feed where unread items shout is one people clear to make it stop
          rather than because they read it. */}
      <span className={`nt-dot${n.read_at ? ' is-read' : ''}`} aria-hidden="true" />
      <span className="nt-message">{n.message}</span>
      <span className="nt-when">{when(n.created_at)}</span>
    </>
  )

  if (!href) return <div className="nt-row">{body}</div>
  return (
    <Link to={href} className="nt-row is-openable" onClick={onRead}>
      {body}
    </Link>
  )
}

export default function Notifications() {
  const notifications = useNotifications()
  const read = useMarkNotificationsRead()

  const items = notifications.data?.items ?? []
  const unread = notifications.data?.unread ?? 0

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Notifications</div>
        <div className="title-row">
          <h1 className="page-title">{unread ? `${unread} unread` : 'Nothing new'}</h1>
          {unread > 0 && (
            <button
              type="button"
              className="am-submit"
              disabled={read.isPending}
              onClick={() => read.mutate(undefined)}
            >
              {read.isPending ? 'MARKING…' : 'MARK ALL READ'}
            </button>
          )}
        </div>
        <div className="page-subtitle">
          {/* Said here rather than discovered later: this knows the link was
              opened, not who opened it. */}
          When a release form you sent is opened or downloaded.
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-8">
        {notifications.isPending ? (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        ) : notifications.error ? (
          <p className="form-error px-8">{notifications.error.message}</p>
        ) : items.length === 0 ? (
          <p className="empty-note py-8">
            Nothing here yet. Send a release form and this fills up when it is opened.
          </p>
        ) : (
          items.map((n) => (
            <Row key={n.id} n={n} onRead={() => !n.read_at && read.mutate([n.id])} />
          ))
        )}
      </div>
    </>
  )
}
