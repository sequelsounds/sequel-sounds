import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import PdfView from '../components/PdfView'
import SequelLogo from '../components/SequelLogo'
import { contractUrl, summariseContract, useContractDetail } from '../lib/contracts'

/**
 * One contract — the old app's `/contract`, rebuilt.
 *
 * ⚠️ EVERY NUMBER AND EVERY STRING BELOW WAS READ OFF THE WEBFLOW PAGE
 * (`6a80e40403ff3bd567be8389`) and its Wized bindings, not chosen. The tree:
 *
 *   Contract header          flex, space-between, 0 40px, 1px bottom rule
 *     Image 21               the wordmark, 20px margins — 5rem band in total
 *     Div Block 62           supplier (w500) | type | sequel no | #id
 *   contract_split_wrap      flex, overflow hidden, calc(100vh - 5rem)
 *     contract_ai_panel      45%, 40/40/20/40, 1px right rule, column
 *       contract_ai_scroll   flex 1, min-height 0, overflow-y auto
 *         contract_ai_header      "Coda Overview"      1.3rem/1.4rem w500
 *         contract_ai_disclaimer  0.75rem, 1.5rem below
 *         contract_ai_state       0.8rem/1rem, 1rem padding — loading, error,
 *                                 TRY AGAIN
 *         contract_ai_body        0.8rem / 1.55, markdown
 *       download quote button + contract_download_pin   pinned, full width
 *     contract_pdf_panel     55%, the document
 *
 * ⚠️ THE PANEL SCROLLS, THE DOWNLOAD DOES NOT. `contract_ai_scroll` carries
 * `min-height: 0` because a flex child defaults to `min-height: auto` and
 * refuses to shrink below its content — without it the panel clips instead of
 * scrolling and DOWNLOAD walks off the bottom of the screen.
 *
 * ⚠️ NO NAV RAIL, as over there: it is a document, not a screen inside the
 * app. The one addition is that the wordmark goes back to the project. The old
 * page had no way off it at all, which its own write-up lists as a fault.
 *
 * ⚠️ THE SUMMARY IS CACHED AGAINST THE PROMPT VERSION, not generated on every
 * open. `track_contract_detail` decides: same version, status ok, non-empty
 * means show the stored copy and call nothing. Anything else calls
 * `summarise-contract`, which stores what it gets. Tuning the prompt in
 * `track_ai_prompts` — and bumping `prompt_version` in the same edit — is what
 * re-reads every contract.
 *
 * ⚠️ A FAILED READ DOES NOT RETRY ITSELF. It is stored as failed and waits for
 * TRY AGAIN, or for a prompt version that no longer matches — otherwise an
 * unreadable file re-runs the model on every single page load.
 *
 * ⚠️ THE PDF URL IS SIGNED ON EVERY LOAD AND NEVER STORED. A cached one
 * expires silently and the viewer then fails with nothing to explain it.
 *
 * The viewer is a plain iframe rather than the old app's PDF.js embed. Over
 * there the page was served from Webflow and the bytes from S3, so PDF.js meant
 * CORS, exposed range headers and a height-constraint trap. Here the browser
 * navigates to the signed URL itself and none of that applies.
 */

/* ------------------------------------------------------------- the markdown */

/** `**bold**` inside a line, which is all the prompt asks for. */
function inline(text: string, keyBase: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{part}</span>
    ),
  )
}

/**
 * Just enough markdown for what the prompt asks for: labelled lines, bullets
 * and the odd heading. Wized rendered the same field as markdown.
 *
 * Deliberately not a library — everything else one brings (tables, images, raw
 * HTML) is either unused or something we would have to sanitise, and model
 * output is not trusted input.
 */
function Summary({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let bullets: string[] = []

  const flush = () => {
    if (!bullets.length) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ct-list">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      bullets.push(bullet[1])
      return
    }
    flush()
    if (!line.trim()) return
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <h3 key={`h-${i}`} className="ct-heading">
          {inline(heading[2], `h-${i}`)}
        </h3>,
      )
      return
    }
    blocks.push(
      <p key={`p-${i}`} className="ct-para">
        {inline(line, `p-${i}`)}
      </p>,
    )
  })
  flush()
  return <>{blocks}</>
}

/* ------------------------------------------------------------------ the page */

export default function Contract() {
  const { uuid } = useParams()
  const detail = useContractDetail(uuid)
  const [pdf, setPdf] = useState<string | null>(null)

  const [summary, setSummary] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  // The document, signed fresh. Independent of the summary, so it paints while
  // a first read is still running.
  useEffect(() => {
    if (!uuid) return
    let live = true
    setPdf(null)
    contractUrl(uuid).then(
      (url) => live && setPdf(url),
      (e: Error) => live && setFailed(e.message),
    )
    return () => {
      live = false
    }
  }, [uuid])

  const read = (u: string) => {
    setReading(true)
    setFailed(null)
    summariseContract(u).then(
      (r) => {
        setReading(false)
        if (r.status === 'ok') setSummary(r.summary)
        else setFailed(r.summary)
      },
      (e: Error) => {
        setReading(false)
        setFailed(e.message)
      },
    )
  }

  // The cache decision, made once the detail lands.
  const d = detail.data
  useEffect(() => {
    if (!d || !uuid) return
    if (d.summary_current && d.summary) {
      setSummary(d.summary)
      setFailed(null)
      return
    }
    // Stale, missing or failed — and a stale version overrides a stored
    // failure, which is how a fixed prompt heals every failed row.
    setSummary(null)
    read(uuid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.uuid, d?.summary_current, uuid])

  /**
   * The old app's download, function for function: fetch the signed url as a
   * blob and save it as "Supplier - Type.pdf", with the characters Windows
   * refuses stripped out. The stored file name is the supplier's own reference
   * and means nothing to anyone here.
   */
  const download = async () => {
    if (!pdf || !d) return
    setSaving(true)
    try {
      const blob = await (await fetch(pdf)).blob()
      const url = URL.createObjectURL(blob)
      const name = `${d.supplier || 'Contract'} - ${d.contract_type || ''}`
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Contract download failed', e)
    } finally {
      setSaving(false)
    }
  }

  if (detail.isPending) return <Loader />
  if (detail.error) return <div className="form-error">{(detail.error as Error).message}</div>
  if (!d) return null

  return (
    <div className="ct-page">
      {/* The app's own header bar — the same .qw-head the quote form, the
          invoice form and the shared-file page use: 4.5rem, 2.5rem padding,
          one brown rule. The old Webflow page's bar is its own 41px; Andy's
          standing call is that every page uses this one. */}
      <div className="qw-head">
        {/* Back to the project. The old page has no navigation off it at all. */}
        {d.project_id ? (
          <Link to={`/projects/${d.project_id}?tab=Contracting`} className="ct-logo-link">
            <SequelLogo wordmark className="qw-logo !h-auto !w-20" />
          </Link>
        ) : (
          <SequelLogo wordmark className="qw-logo !h-auto !w-20" />
        )}
        <div className="ct-meta">
          <span className="ct-meta-item is-bold">{d.supplier || '—'}</span>
          <span className="ct-meta-sep">|</span>
          <span className="ct-meta-item">{d.contract_type || '—'}</span>
          <span className="ct-meta-sep">|</span>
          <span className="ct-meta-item">{d.project_sequel_no || '—'}</span>
          <span className="ct-meta-sep">|</span>
          {/* Built in SQL by `track_ref`, not here: the reference belongs to
              the record, so the page, the list, an export and anything we ever
              send by mail all print the same string. */}
          <span className="ct-meta-item">{d.ref}</span>
        </div>
      </div>

      <div className="ct-split">
        <div className="ct-ai">
          <div className="ct-ai-scroll">
            <div className="ct-ai-head">Coda Overview</div>
            {/* Above the summary, not below it, so it is read before the
                content rather than after. Always true, so it never changes. */}
            <div className="ct-ai-note">
              AI can make mistakes — check anything you rely on against the contract itself.
            </div>
            {reading && <div className="ct-ai-state">Reading the contract...</div>}
            {!reading && failed && (
              <>
                <div className="ct-ai-state">{failed}</div>
                <button
                  type="button"
                  className="ct-ai-state ct-retry"
                  onClick={() => uuid && read(uuid)}
                >
                  TRY AGAIN
                </button>
              </>
            )}
            {!reading && !failed && summary && (
              <div className="ct-ai-body">
                <Summary text={summary} />
              </div>
            )}
          </div>
          <button type="button" className="ct-download" disabled={!pdf} onClick={() => void download()}>
            {saving ? 'DOWNLOADING…' : 'DOWNLOAD'}
          </button>
        </div>

        <div className="ct-pdf">
          {pdf && <PdfView url={pdf} className="ct-frame" />}
        </div>
      </div>
    </div>
  )
}
