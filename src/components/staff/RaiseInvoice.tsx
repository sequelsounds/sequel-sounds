import { useState } from 'react'
import { Modal } from './RowActions'
import { formatMoney } from '../../lib/format'
import {
  connectQuickBooks,
  raiseCheck,
  useRaiseInvoice,
  useRetryBills,
  type BillResult,
  type RaiseCheck,
  type RaiseResult,
} from '../../lib/quickbooks'

/**
 * RAISE INVOICE and its modal — the old app's `raise_invoice_button` and
 * `raise_invoice_modal`, rebuilt. Every sentence is the old app's (Wized
 * elements raise_modal_*, read 17 Sep 2026) unless marked otherwise.
 *
 * The flow is the old one: the pre-flight runs BEFORE the modal opens, so it
 * opens showing either the summary and a confirm, or the reasons it cannot be
 * raised and only a Close. After an attempt the modal shows what happened, and
 * a failed supplier bill is never reported as a clean success — invoice 1163
 * was, on 9 Sep, and a real cost never reached QuickBooks.
 *
 * Added here, not in the old app:
 *  - a line saying when the raise goes to Intuit's TEST company (Andy, 17 Sep:
 *    sandbox until the switch-over), and a button to connect it;
 *  - CREATE MISSING BILLS after a bill fails — the old app had the endpoint
 *    (retry_invoice_bills) but no button for it;
 *  - the "created but not recorded" state, from the new raise's safety rules.
 *
 * The old modal fades its eyebrow, intro and warning. Here the text is solid
 * (CLAUDE.md: never fade text).
 */

type Outcome = {
  ok: boolean
  warn: boolean
  message: string
  qboId: string
  appUrl: string
  bills: BillResult[]
  failed: number
}

function outcomeOf(res: RaiseResult): Outcome {
  const appUrl = res.app_url ?? 'https://app.qbo.intuit.com'
  if (res.created_not_recorded) {
    return { ok: true, warn: true, message: res.message ?? '', qboId: res.qbo_invoice_id ?? '', appUrl, bills: [], failed: 0 }
  }
  if (!res.raised) {
    const msg = res.message || res.error || 'QuickBooks would not accept the invoice.'
    const list = res.problems?.length ? ` ${res.problems.join(' ')}` : ''
    return {
      ok: false,
      warn: false,
      message: `${msg}${list}${/Nothing has been changed/.test(msg) ? '' : ' Nothing has been changed - you can try again.'}`,
      qboId: '',
      appUrl,
      bills: [],
      failed: 0,
    }
  }

  let msg = `Raised as invoice ${res.invoice_number ?? ''}.`
  if (res.recovered) msg += ' It had already been created by an earlier attempt, and is now recorded here.'
  if (res.po_attached) msg += ' The PO is attached and will go out with it.'
  else if (res.attach_detail && !res.attach_detail.startsWith('No PO')) msg += ` ${res.attach_detail}`
  msg += ' It has NOT been sent - open it in QuickBooks, check it, and send it from there.'
  msg += billSentence(res.bills_created ?? 0, res.bills_failed ?? 0, res.bills_skipped?.length ?? 0)

  const failed = res.bills_failed ?? 0
  return {
    ok: true,
    warn: failed > 0 || (res.bills_skipped?.length ?? 0) > 0,
    message: msg,
    qboId: res.qbo_invoice_id ?? '',
    appUrl,
    bills: res.bill_results ?? [],
    failed,
  }
}

function billSentence(made: number, failed: number, skipped: number): string {
  let msg = ''
  if (made > 0) msg += ` ${made}${made === 1 ? ' supplier bill was' : ' supplier bills were'} created.`
  if (failed > 0) {
    msg += ` WARNING: ${failed}${failed === 1 ? ' supplier bill FAILED' : ' supplier bills FAILED'} and that cost has NOT reached QuickBooks. The invoice is fine. Do not ignore this - the bills can be created separately once the cause is fixed.`
  }
  if (skipped > 0) {
    msg += ` ${skipped}${skipped === 1 ? ' line was' : ' lines were'} left unbilled because two suppliers share one QuickBooks vendor but disagree about its currency.`
  }
  if (made === 0 && failed === 0 && skipped === 0) msg += ' There were no paythrough supplier costs to bill.'
  return msg
}

/**
 * ⚠️ `canRaise` hides the BUTTON only. The component stays mounted, because a
 * successful raise refetches the invoice, which locks it — and unmounting here
 * closed the modal before anyone could read what happened (17 Sep).
 */
export function RaiseInvoiceButton({ uuid, canRaise }: { uuid: string; canRaise: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<RaiseCheck | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  return (
    <>
      {canRaise && (
        <button
          type="button"
          className="btn btn-mono btn-outline"
          disabled={busy}
          onClick={async () => {
            // The pre-flight first, so the modal opens knowing what to say.
            setBusy(true)
            setOpenError(null)
            try {
              setCheck(await raiseCheck(uuid))
              setOpen(true)
            } catch (e) {
              setOpenError(e instanceof Error ? e.message : 'Could not check the invoice.')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'CHECKING…' : 'RAISE INVOICE'}
        </button>
      )}
      {openError && <span className="form-error">{openError}</span>}
      {open && check && <RaiseModal uuid={uuid} check={check} onClose={() => setOpen(false)} />}
    </>
  )
}

function RaiseModal({ uuid, check, onClose }: { uuid: string; check: RaiseCheck; onClose: () => void }) {
  const raise = useRaiseInvoice(uuid)
  const retry = useRetryBills(uuid)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [connecting, setConnecting] = useState(false)

  const sandbox = check.environment === 'sandbox'
  const connected = check.connected !== false
  const ready = connected && check.ok === true
  const s = check.summary

  const heading = outcome
    ? !outcome.ok
      ? 'Not raised'
      : outcome.warn
        ? 'Raised, but check this'
        : 'Raised'
    : ready
      ? 'Raise this invoice?'
      : 'Cannot raise yet'

  let intro = ''
  if (outcome) intro = outcome.message
  else if (!connected) intro = check.error ?? 'QuickBooks is not connected.'
  else if (!ready) intro = 'This invoice cannot be raised yet:'
  else {
    intro =
      'This creates the invoice in QuickBooks. It does NOT send it to the client - you do that from QuickBooks once you have checked it.'
    const bills = s?.bills_to_create ?? 0
    const converted = s?.converted_bills ?? 0
    if (bills > 0) {
      intro += ` It also creates ${bills}${bills === 1 ? ' supplier bill' : ' supplier bills'}.`
      if (converted > 0) {
        intro += ` ${converted === 1 ? 'One is' : `${converted} are`} in a different currency to this invoice and will be converted at QuickBooks’ own rate.`
      }
    }
  }

  const landed = outcome?.bills.filter((b) => b.ok && b.qbo_bill_id) ?? []

  const confirm = () => {
    raise.mutate(undefined, {
      onSuccess: (res) => setOutcome(outcomeOf(res)),
      onError: (e) =>
        setOutcome({
          ok: false,
          warn: false,
          message: `${e instanceof Error ? e.message : 'The raise did not complete.'} Nothing has been changed - you can try again.`,
          qboId: '',
          appUrl: '',
          bills: [],
          failed: 0,
        }),
    })
  }

  const retryBills = () => {
    retry.mutate(undefined, {
      onSuccess: (res) => {
        if (!outcome) return
        const failed = res.bills_failed ?? 0
        const skipped = res.bills_skipped?.length ?? 0
        const message = res.ok === false
          ? res.message ?? res.error ?? 'The bills could not be created.'
          : `Tried the missing bills again.${billSentence(res.bills_created ?? 0, failed, skipped)}`
        setOutcome({
          ...outcome,
          warn: failed > 0 || skipped > 0,
          message,
          bills: [...outcome.bills.filter((b) => b.ok), ...(res.bill_results ?? [])],
          failed,
        })
      },
      onError: (e) => setOutcome({ ...outcome!, message: e instanceof Error ? e.message : 'The bills could not be created.' }),
    })
  }

  return (
    <Modal onClose={raise.isPending || retry.isPending ? () => {} : onClose} className="rv-card">
      {!outcome && <div className="rv-eyebrow">{ready ? 'Confirm' : 'Not ready'}</div>}
      <h2 className="rv-heading">{heading}</h2>
      {sandbox && (
        <p className="rv-sandbox">
          TEST COMPANY: this goes to Intuit&rsquo;s sandbox, not Sequel&rsquo;s books. Live invoices are raised in the old app
          until the switch-over.
        </p>
      )}
      <p className="rv-intro">{intro}</p>

      {!outcome && ready && s && (
        <div className="rv-summary">
          <div>
            <div className="rv-label">Client</div>
            <div className="rv-value">{s.client_name || '—'}</div>
          </div>
          <div>
            <div className="rv-label">Total</div>
            <div className="rv-value">
              {s.currency_code} {formatMoney(Number(s.total_to_invoice ?? 0))}
            </div>
          </div>
          <div>
            <div className="rv-label">Supplier costs</div>
            <div className="rv-value">{s.line_count === 1 ? '1 line' : `${s.line_count} lines`}</div>
          </div>
        </div>
      )}

      {!outcome && connected && !ready && (
        <div className="rv-problems">
          {(check.problems ?? []).map((p) => (
            <div key={p} className="rv-problem">
              {p}
            </div>
          ))}
        </div>
      )}

      {outcome && outcome.bills.some((b) => !b.ok) && (
        <div className="rv-problems">
          {outcome.bills
            .filter((b) => !b.ok)
            .map((b) => (
              <div key={`${b.supplier}-${b.currency}`} className="rv-problem">
                {b.supplier} ({b.currency} {formatMoney(Number(b.total ?? 0))}): {b.detail}
                {b.qbo_error ? ` ${b.qbo_error}` : ''}
              </div>
            ))}
        </div>
      )}

      {!outcome && ready && <p className="rv-warning">Once raised, this invoice can no longer be edited.</p>}

      <div className="rv-actions">
        <button type="button" className="rv-cancel" onClick={onClose} disabled={raise.isPending || retry.isPending}>
          {outcome ? 'Done' : ready ? 'Cancel' : 'Close'}
        </button>

        {!outcome && !connected && sandbox && (
          <button
            type="button"
            className="rv-confirm"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true)
              try {
                await connectQuickBooks('sandbox')
              } catch {
                setConnecting(false)
              }
            }}
          >
            {connecting ? 'OPENING…' : 'CONNECT TEST COMPANY'}
          </button>
        )}

        {!outcome && ready && (
          <button type="button" className="rv-confirm" onClick={confirm} disabled={raise.isPending}>
            {raise.isPending ? 'RAISING…' : 'Yes, raise it'}
          </button>
        )}

        {outcome && outcome.failed > 0 && (
          <button type="button" className="rv-confirm" onClick={retryBills} disabled={retry.isPending}>
            {retry.isPending ? 'CREATING…' : 'CREATE MISSING BILLS'}
          </button>
        )}

        {/* The QuickBooks APP view, the one with the Send button. ⚠️ Lands on a
            blank form if you are not signed in to QuickBooks — sign in first. */}
        {outcome?.ok && outcome.qboId && (
          <a
            className="rv-confirm"
            href={`${outcome.appUrl}/app/invoice?txnId=${outcome.qboId}`}
            target="_blank"
            rel="noreferrer"
          >
            OPEN IN QUICKBOOKS
          </a>
        )}
        {outcome?.ok && landed.length > 0 && (
          <a
            className="rv-confirm"
            href={`${outcome.appUrl}/app/bill?txnId=${landed[0].qbo_bill_id}`}
            target="_blank"
            rel="noreferrer"
          >
            {landed.length === 1 && landed[0].supplier
              ? `OPEN ${landed[0].supplier.toUpperCase()} BILL`
              : 'OPEN BILL IN QUICKBOOKS'}
          </a>
        )}
      </div>
    </Modal>
  )
}
