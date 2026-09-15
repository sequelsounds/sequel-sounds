import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIsFinance } from '../../lib/xanoMirror'
import { Modal } from './RowActions'
import {
  addressLines,
  connectQuickBooks,
  useDisconnectQuickBooks,
  useLinkQboVendor,
  useQboVendors,
  vendorLabel,
  type QboVendor,
} from '../../lib/quickbooks'

/**
 * The QuickBooks vendor picker and the billing address, as the old app's
 * `/roster-edit` and `/partner-edit` Finance tabs have them.
 *
 * Old-app rules kept:
 *  - the picker is finance only, and hidden from everyone else;
 *  - focus shows every vendor, typing filters on the name, each row reads
 *    "Name — CURRENCY";
 *  - choosing a row saves at once, the vendor id and its currency together;
 *  - never auto-matched, and no "not required" row — unlinked is unlinked;
 *  - the address is read from QuickBooks, never stored, with a distinct
 *    message for every way it can be blank.
 *
 * Added because this app holds its own QuickBooks connection: a Connect link
 * when there is no connection, a Disconnect link (with a confirm) when there
 * is, and the reason when a save or a call fails.
 *
 * ⚠️ Old-app defect NOT copied: its address asks QuickBooks through a
 * finance-only endpoint for everyone, so a non-finance user sees "Loading..."
 * forever. Here they are told it is finance only.
 */
export function QboVendorField({
  supplierId,
  uuid,
  vendorId,
}: {
  supplierId: number
  uuid: string | undefined
  vendorId: string | null | undefined
}) {
  const finance = useIsFinance()
  const isFinance = finance.data === true
  const vendors = useQboVendors(isFinance)
  const link = useLinkQboVendor(uuid)
  const disconnect = useDisconnectQuickBooks()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  // null until the person types: the box keeps showing the linked vendor, and
  // the list is unfiltered, exactly as focusing the old field does.
  const [typed, setTyped] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const busy = useRef(false)

  // Coming back from Intuit: say what happened once, then take it off the URL
  // so a reload does not say it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('qbo_error')
    const connected = params.get('qbo') === 'connected'
    if (!error && !connected) return
    if (error) {
      setStatus('error')
      setMessage(error)
    }
    if (connected) void qc.invalidateQueries({ queryKey: ['qbo', 'vendors'] })
    params.delete('qbo_error')
    params.delete('qbo')
    const qs = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  }, [qc])

  const all = useMemo<QboVendor[]>(() => vendors.data?.vendors ?? [], [vendors.data])
  const connected = vendors.data?.connected === true
  const linked = vendorId ? all.find((v) => String(v.id) === String(vendorId)) : undefined

  const linkedLabel = !vendorId
    ? ''
    : !connected
      ? ''
      : linked
        ? vendorLabel(linked)
        : 'Linked to a vendor no longer in QuickBooks'

  const query = (typed ?? '').toLowerCase().trim()
  const list = query ? all.filter((v) => v.name.toLowerCase().includes(query)) : all

  async function choose(v: QboVendor) {
    if (busy.current) return
    busy.current = true
    setStatus('saving')
    setMessage(null)
    try {
      await link.mutateAsync({ supplierId, vendor: v })
      setStatus('saved')
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1800)
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      busy.current = false
      setOpen(false)
      setTyped(null)
    }
  }

  async function connect() {
    try {
      await connectQuickBooks()
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'QuickBooks could not be connected.')
    }
  }

  const needsConnect = isFinance && vendors.isSuccess && !connected

  let head: React.ReactNode = null
  if (status === 'error' && message) {
    head = (
      <span className="edit-field-status is-error" role="alert">
        {message}
      </span>
    )
  } else if (status === 'saving') {
    head = <span className="edit-field-status">Saving…</span>
  } else if (status === 'saved') {
    head = <span className="edit-field-status is-saved">Saved</span>
  } else if (vendors.isError) {
    head = (
      <span className="edit-field-status is-error" role="alert">
        {vendors.error.message}
      </span>
    )
  }

  if (!isFinance) return null

  return (
        <div className="edit-field">
          <div className="edit-field-head">
            <label className="edit-field-label" htmlFor={`qbo-vendor-${supplierId}`}>
              QuickBooks Vendor
            </label>
            {head ??
              (needsConnect ? (
                <button type="button" className="link-button qbo-connect" onClick={() => void connect()}>
                  Connect QuickBooks
                </button>
              ) : connected ? (
                <button type="button" className="link-button qbo-connect" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </button>
              ) : null)}
          </div>
          <div className="qbo-combo">
            <input
              id={`qbo-vendor-${supplierId}`}
              className="edit-field-input"
              autoComplete="off"
              placeholder={
                needsConnect ? 'QuickBooks is not connected' : vendors.isPending ? 'Loading...' : 'Not yet linked'
              }
              disabled={!connected || status === 'saving'}
              value={typed ?? linkedLabel}
              onFocus={(e) => {
                setOpen(true)
                setTyped(null)
                e.currentTarget.select()
              }}
              onChange={(e) => {
                setTyped(e.target.value)
                setOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false)
                  setTyped(null)
                  e.currentTarget.blur()
                }
              }}
              // Blur lands before the row's click, so closing at once would
              // remove the row and the click would never arrive.
              onBlur={() =>
                setTimeout(() => {
                  if (!busy.current) {
                    setOpen(false)
                    setTyped(null)
                  }
                }, 250)
              }
            />
            {open && connected && (
              <div className="qbo-combo-panel" role="listbox">
                {list.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={String(v.id) === String(vendorId)}
                    className="qbo-combo-option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void choose(v)}
                  >
                    {vendorLabel(v)}
                  </button>
                ))}
                {query && list.length === 0 && (
                  <div className="qbo-combo-empty">No vendors match that search.</div>
                )}
              </div>
            )}
          </div>
          {confirmDisconnect && (
            <Modal onClose={() => setConfirmDisconnect(false)}>
              <div className="rm-header">Disconnect QuickBooks?</div>
              <div className="rm-subheader">
                The new app will stop reading vendors until finance connects it again. The old app&rsquo;s
                QuickBooks connection is not affected.
              </div>
              {disconnect.error && <p className="form-error">{disconnect.error.message}</p>}
              <div className="rm-buttons">
                {/* Closes only once it has worked, like the archive modal. */}
                <button
                  type="button"
                  className="wizard-btn rm-button"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(undefined, { onSuccess: () => setConfirmDisconnect(false) })
                  }
                >
                  {disconnect.isPending ? 'DISCONNECTING…' : 'CONFIRM'}
                </button>
                <button type="button" className="wizard-btn rm-button" onClick={() => setConfirmDisconnect(false)}>
                  CANCEL
                </button>
              </div>
            </Modal>
          )}
        </div>
  )
}

/**
 * Read only, for everyone. QuickBooks is where the address lives; nothing is
 * stored here, so an unlinked supplier has no address anywhere.
 */
export function QboBillingAddress({ vendorId }: { vendorId: string | null | undefined }) {
  const finance = useIsFinance()
  const isFinance = finance.data === true
  const vendors = useQboVendors(isFinance)
  const all = vendors.data?.vendors ?? []
  const connected = vendors.data?.connected === true
  const linked = vendorId ? all.find((v) => String(v.id) === String(vendorId)) : undefined

  let address: string
  if (!vendorId) address = 'Not yet linked to a QuickBooks vendor'
  else if (finance.isPending) address = 'Loading...'
  else if (!isFinance) address = 'Visible to finance only'
  else if (vendors.isPending) address = 'Loading...'
  else if (vendors.isError) address = 'QuickBooks could not be reached'
  else if (!connected) address = 'QuickBooks is not connected'
  else if (!linked) address = 'Linked vendor not found in QuickBooks'
  else {
    const lines = addressLines(linked.address)
    address = lines.length ? lines.join('\n') : 'No billing address set in QuickBooks'
  }

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <span className="edit-field-label">Billing Address (from QuickBooks)</span>
      </div>
      <div className="qbo-address">{address}</div>
    </div>
  )
}
