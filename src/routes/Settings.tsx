import { Loader } from '../components/Loader'
import { SignaturePad } from '../components/staff/SignaturePad'
import { useMe } from '../lib/xanoMirror'

/**
 * Your own settings — the things that are yours rather than the business's.
 *
 * ⚠️ IT HOLDS ONE THING SO FAR. The signature lived on the user's own record
 * while this page did not exist, which worked but put a personal control in the
 * middle of an admin screen where every other field is one staff member editing
 * another. Anything else that belongs to the person rather than the company
 * goes here — notification preferences when those are built, and whatever else
 * Track's own Settings turns out to carry.
 *
 * ⚠️ NOTHING HERE IS ABOUT SOMEBODY ELSE. Every control on this page writes to
 * the row matching auth.uid(); none of them takes a user argument. That is what
 * makes a page like this safe to leave open.
 */
export default function Settings() {
  const me = useMe()

  if (me.isPending) {
    return (
      <div className="flex flex-1 justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (me.error) return <p className="form-error px-8 py-8">{me.error.message}</p>
  if (!me.data) return <p className="empty-note py-8">No account.</p>

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Your settings</div>
        <div className="title-row">
          <h1 className="page-title">{me.data.name ?? 'You'}</h1>
        </div>
        <div className="page-subtitle">{me.data.email ?? ' '}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-8">
        <div className="edit-form">
          <SignaturePad />
        </div>
      </div>
    </>
  )
}
