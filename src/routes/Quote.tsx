import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import {
  useQuote,
  useQuoteLines,
  type QuoteDetail,
  type QuoteLine,
} from '../lib/xanoMirror'

/**
 * The quote document — Sequel Track's `/quotation`, rebuilt.
 *
 * This is the thing a client opens: one A4-shaped card, the project's details,
 * the fees, the licence terms, and the notes for that service. Measured off the
 * published page rather than designed — 794px wide, 2rem of padding, Fahkwang
 * at 2.8rem for the wordmark, Creato Display at 0.8rem for everything else.
 *
 * ⚠️ The layout is two columns, not three. A fee row is description on the
 * left, and the right half is its own two-column grid holding quantity and
 * subtotal. Same for the header row.
 *
 * Read-only, like the old app's. Full account of what was checked and why:
 * `claude/sequel-track-quote-page-forensics.md`.
 */

/* ------------------------------------------------------------------ sections
 * Line items fold into six named buckets. Supplier costs stay as separate
 * rows; Sequel fees are SUMMED into one. That asymmetry is the old app's and
 * it is deliberate — Andy's call, 14 Sep: it is a decision about what the
 * client sees, not an accident.
 *
 * ⚠️ Master and Publishing both map to "Licensing", which is why a commercial
 * quote shows two supplier rows under one heading.
 */
const SECTIONS = ['Search', 'Production', 'Licensing', 'Sonic Branding', 'Talent', 'Other'] as const

/** The static label on each section's single Sequel row, as the old app has it. */
const SEQUEL_ROW_LABEL: Record<string, string> = {
  Search: 'Sequel Search Fees',
  Production: 'Sequel Production Fee',
  Licensing: 'Sequel Licence Fee',
  'Sonic Branding': 'Sequel Sonic Branding Fee',
  Talent: 'Sequel Talent Fee',
  Other: 'Sequel Fee',
}

type Section = {
  name: string
  supplier: QuoteLine[]
  sequelSum: number
  sequelQty: number | null
}

/** Minor units in, major units out. Rounded ONCE, here, for display. */
const amount = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return ''
  return amount.format(Number(minor) / 100)
}

/**
 * The Quantity cell — the bare count, as the old app has it.
 *
 * ⚠️ A `2 @ 25,198` form was built here and taken out again — Andy's call,
 * 14 Sep: it does not work. The thing it was meant to solve is real and is
 * still here: the `cost` beside a count is ALREADY multiplied, so a client
 * checking the arithmetic on a two-track row will not be able to make 2 and
 * 50,397 agree. Live with it rather than reinventing the cell.
 *
 * ⚠️ Whatever else changes, never render `quantity × cost` as the subtotal.
 * It would double.
 */
function quantityCell(qty: number | null): string {
  return qty ? String(qty) : ''
}

function fold(lines: QuoteLine[]): Section[] {
  return SECTIONS.map((name) => {
    const mine = lines.filter((l) => l.section === name)
    const supplier = mine.filter((l) => l.fee_type === 'supplier_cost')
    const sequel = mine.filter((l) => l.fee_type === 'sequel_fee')
    return {
      name,
      supplier,
      sequelSum: sequel.reduce((sum, l) => sum + (Number(l.cost) || 0), 0),
      // One Sequel fee per section by construction, so the first row's count
      // is the section's count.
      sequelQty: sequel[0]?.quantity ?? null,
    }
  }).filter((s) => s.supplier.length > 0 || s.sequelSum > 0)
}

/* -------------------------------------------------------------------- theme
 * The old app recolours the card by swapping two brand variables ON THE CARD,
 * leaving the page silver. Every class paints from those two, so one swap
 * recolours the whole document.
 *
 * ⚠️ Keyed on the service ID here. The old app matches the service NAME, so
 * renaming a service in Xano silently drops its colour.
 */
const THEME: Record<number, { card: string; ink: string }> = {
  1: { card: '#d0dbcd', ink: '#372b29' }, // Composition — pale green, Andy's value
  2: { card: '#7daab1', ink: '#372b29' }, // Commercial
  3: { card: '#ad7186', ink: '#f1f0ee' }, // Library
  4: { card: '#a7521a', ink: '#f1f0ee' }, // Sonic Branding
  5: { card: '#1f415d', ink: '#f1f0ee' }, // Sound Design
  6: { card: '#a05252', ink: '#f1f0ee' }, // Talent
}
const UNTHEMED = { card: '#f1f0ee', ink: '#372b29' }

/** "18th August 26" — the old app's `jS F y`, ordinal and all. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function quoteDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.getDate()
  const tens = day % 100
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th')
  return `${day}${suffix} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

function Pair({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="quote-pair">
      <span className="quote-label">{label}</span>
      <span className="quote-value">{value === null || value === undefined ? '' : String(value)}</span>
    </div>
  )
}

/**
 * A usage-term line.
 *
 * ⚠️ NOT the same grid as `Pair`. The old app's detail pairs are 0.5fr/1fr,
 * but its usage rows are 1fr/1fr — the value starts at the halfway stop, on
 * the same vertical as the Quantity column above it. Reusing `Pair` here puts
 * every term a third of the way in and the block stops lining up.
 */
function Term({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="quote-term">
      <span className="quote-label">{label}</span>
      <span className="quote-value">{value === null || value === undefined ? '' : String(value)}</span>
    </div>
  )
}

function Row({
  desc,
  qty,
  subtotal,
  bold,
}: {
  desc: string
  qty?: string
  subtotal?: string
  bold?: boolean
}) {
  return (
    <div className={`quote-row${bold ? ' is-bold' : ''}`}>
      <span className="quote-cell">{desc}</span>
      <div className="quote-row-right">
        <span className="quote-cell">{qty ?? ''}</span>
        <span className="quote-cell">{subtotal ?? ''}</span>
      </div>
    </div>
  )
}

function Terms({ q }: { q: QuoteDetail }) {
  const media = Array.isArray(q.media) ? q.media.filter(Boolean) : []
  const terms = [q.term, q.territory, q.scripts, q.duration]
  const hasTerms = terms.some((t) => t !== null && t !== undefined && String(t).trim() !== '')
  const hasTrack = !!(q.song_name?.trim() || q.artist_name?.trim())

  // ⚠️ Tested on the VALUES, not the quote type. A searches-only library quote
  // licenses nothing and has its terms blanked at source; a manual library or
  // commercial quote has real terms and no MCPS fee. Gating on the type hides
  // the wrong ones.
  if (!hasTerms && media.length === 0 && !hasTrack) return null

  const cutdowns =
    q.cutdowns_includedyn === null || q.cutdowns_includedyn === undefined
      ? ''
      : q.cutdowns_includedyn
        ? 'Yes'
        : 'No'

  // ⚠️ FIVE rules on this document, and each one opens a band rather than
  // closing the one before: letterhead, Fees, Usage, Notes, footer. The old
  // app hangs three of them off the top of a wrapper, which is easy to miss
  // when reading the tree — the Usage divider is the FIRST child of
  // `.quote-terms-wrapper`, not a sibling sitting between the two blocks.
  return (
    <>
      <div className="quote-rule" />
      <h2 className="quote-heading">Usage</h2>
      <div className="quote-terms">
        {hasTrack && (
          <>
            <Term label="Track" value={q.song_name} />
            <Term label="Artist" value={q.artist_name} />
            <div className="quote-terms-gap" />
          </>
        )}
        <Term label="Territory" value={q.territory} />
        <Term label="Term" value={q.term} />
        <Term label="Media" value={media.join(', ')} />
        <Term label="Scripts" value={q.scripts} />
        <Term label="Cutdowns" value={cutdowns} />
        <Term label="Duration(s)" value={q.duration} />
        {/* ⚠️ Gated on the VALUE, not on `service === 3`. Manual library quotes
            are service 3 too and carry no rate, so the old app prints the Rate
            label with nothing beside it. */}
        {q.mcps_track_rate?.trim() ? (
          <Term label="Rate" value={q.mcps_track_rate.replace(/_/g, ' ')} />
        ) : null}
      </div>
    </>
  )
}

/**
 * The notes, by service. Wording copied from the published page.
 *
 * The footer note is always shown; the others depend on the quote. The old app
 * repeats "This document constitutes an estimate only" in both the Note block
 * and the footer — dropped here, it only needs saying once.
 */
function Notes({ q, sections }: { q: QuoteDetail; sections: Section[] }) {
  const svc = q.service_id
  const hasSearch = sections.some((s) => s.name === 'Search')
  const hasProduction = sections.some((s) => s.name === 'Production')

  const blocks: { title: string; paras: string[] }[] = []

  if (svc === 3) {
    blocks.push({
      title: 'Note',
      paras: [
        'You might notice the usage terms here look slightly more generous than those you originally requested. You’re not wrong. We’ve done this deliberately to get you the best deal. All our library partners license their catalogues in perpetuity, meaning no renewals, no cease & desists, and no risk of needing to take content down on account of the music.',
        'Often, pricing tiers mean it is more cost-effective to secure a whole continent or "all media" than it is to licence specific countries or platforms. Don’t worry, we’ve done the calculation for you to ensure you’re paying the lowest possible fee while gaining extra media coverage at no additional cost.',
      ],
    })
  }

  if (svc === 2 || svc === 6) {
    blocks.push({
      title: 'Note',
      paras: [
        'All quotes are pending artist/writer approval and subject to approval.',
        'All quoted fees are exclusive of VAT and any applicable taxes, duties, or withholding obligations. Payment is due within 30 days, net of any bank charges or deductions. Union fees are excluded unless explicitly stated.',
      ],
    })
  }

  if (hasProduction && svc !== 3 && svc !== 2 && svc !== 6) {
    blocks.push({
      title: 'Note',
      paras: [
        'All quoted fees are exclusive of VAT and any applicable taxes, duties, or withholding obligations.',
      ],
    })
  }

  if (hasSearch) {
    blocks.push({
      title: 'Music Searches',
      paras: [
        '-Every search fee covers our team turning the music industry upside down to curate the perfect tracks for one specific brief. Should the creative direction shift into a new brief, then we’ll need to quote for an additional search to cover the new creative.',
        '-While we love making things fit perfectly, cutting tracks to picture isn’t included in a standard search so let us know if you need some audio editing magic, and we can easily quote for it separately.',
      ],
    })
  }

  if (blocks.length === 0) return null

  // The wrapper carries the 2rem that separates the last note from the rule
  // the footer opens with — without it that rule is drawn over the text.
  return (
    <>
      <div className="quote-rule" />
      <div className="quote-notes">
        {blocks.map((b) => (
          <div key={b.title} className="quote-note">
            <h2 className="quote-heading">{b.title}</h2>
            {b.paras.map((p, i) => (
              <p key={i} className="quote-para">
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * DOWNLOAD — the old app's, ported.
 *
 * The old app's button is a Wized click workflow that runs html2pdf over the
 * card: html2canvas at scale 2 onto a jsPDF page sized to the element, then a
 * `/OpenAction … /XYZ null null 0.4` written into the PDF so it opens at 40%
 * rather than filling a monitor with a single page.
 *
 * ⚠️ The inline-every-computed-colour loop is the old app's too, and it earns
 * its keep: html2canvas reads inline and computed styles but chokes on colour
 * functions it does not know, and Tailwind v4's resets are oklch. Painting the
 * resolved colour onto each node before the capture, and putting it back
 * after, sidesteps the whole question.
 *
 * ⚠️ NOT ported: the `log_quote_download` POST the old app fires alongside it.
 * That writes to Xano, and quotes are on the blocked side of the migration —
 * QuickBooks and BoldSign still read them there. It needs doing at cutover.
 */
async function downloadQuote(card: HTMLElement, fileName: string, background: string) {
  const { default: html2pdf } = await import('html2pdf.js')

  const nodes = [card, ...Array.from(card.querySelectorAll<HTMLElement>('*'))]
  const restore = nodes.map((node) => {
    const computed = getComputedStyle(node)
    const previous = {
      node,
      color: node.style.color,
      backgroundColor: node.style.backgroundColor,
      borderColor: node.style.borderColor,
    }
    node.style.color = computed.color
    if (computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      node.style.backgroundColor = computed.backgroundColor
    }
    if (computed.borderColor) node.style.borderColor = computed.borderColor
    return previous
  })

  const width = card.clientWidth
  const height = card.scrollHeight

  try {
    const pdf = await html2pdf()
      .set({
        margin: 0,
        filename: fileName,
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: background, logging: false, width, height },
        jsPDF: { unit: 'px', format: [width, height], orientation: 'portrait' },
      })
      .from(card)
      .toPdf()
      .get('pdf')

    try {
      const pageObjId = pdf.internal.getPageInfo(1).objId
      pdf.internal.write(`/OpenAction [${pageObjId} 0 R /XYZ null null 0.4]`)
    } catch {
      // Older jsPDF builds do not expose this; the file still downloads, it
      // just opens at the viewer's default zoom.
    }

    pdf.save(fileName)
  } finally {
    for (const previous of restore) {
      previous.node.style.color = previous.color
      previous.node.style.backgroundColor = previous.backgroundColor
      previous.node.style.borderColor = previous.borderColor
    }
  }
}

export default function Quote() {
  const { uuid } = useParams()
  const quote = useQuote(uuid)
  const lines = useQuoteLines(uuid)
  const cardRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)

  if (quote.isPending) {
    return (
      <Loader />
    )
  }
  if (quote.error) return <p className="form-error px-8 py-8">{quote.error.message}</p>
  if (!quote.data) return <p className="empty-note py-8">No quote with that link.</p>

  const q = quote.data
  const sections = fold(lines.data ?? [])
  const theme = (q.service_id !== null && THEME[q.service_id]) || UNTHEMED

  const fileName = `Sequel Quote ${q.quote_no ?? ''}${q.client_name ? ` - ${q.client_name}` : ''}`
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()

  return (
    <div className="quote-page">
      <button
        type="button"
        className="quote-download"
        disabled={saving}
        onClick={() => {
          if (!cardRef.current) return
          setSaving(true)
          void downloadQuote(cardRef.current, `${fileName}.pdf`, theme.card).finally(() =>
            setSaving(false),
          )
        }}
      >
        {saving ? 'Preparing…' : 'Download'}
      </button>
      <div
        ref={cardRef}
        className="quote-card"
        style={
          { '--quote-card': theme.card, '--quote-ink': theme.ink } as React.CSSProperties
        }
      >
        <div className="quote-title-row">
          <span className="quote-wordmark">SEQUEL</span>
          <span className="quote-wordmark quote-wordmark-right">QUOTE</span>
        </div>
        <div className="quote-rule" />

        <div className="quote-details">
          <div className="quote-details-col">
            <Pair label="FAO" value={q.username} />
            <Pair label="Client" value={q.client_name} />
            <Pair label="Brand" value={q.brand} />
            <Pair label="Product" value={q.product} />
            <Pair label="Client No." value={q.brand_no} />
            <Pair label="Project" value={q.project_title} />
          </div>
          <div className="quote-details-col">
            <Pair label="Date" value={quoteDate(q.created_at)} />
            <Pair label="Quote Type" value={q.quote_service} />
            <Pair label="Quote No." value={q.quote_no} />
            <Pair label="Region" value={q.region} />
            <Pair label="Sequel No." value={q.sequel_no} />
            <Pair label="Supe" value={q.music_supervisor} />
          </div>
        </div>

        <div className="quote-rule" />
        <h2 className="quote-heading">Fees</h2>
        <Row desc="Service Type" qty="Quantity" subtotal="Subtotal" bold />

        {lines.isPending && <Loader />}
        {lines.error && <p className="form-error">{lines.error.message}</p>}

        {sections.map((s) => (
          <div key={s.name} className="quote-section">
            <Row desc={s.name} bold />
            {s.supplier.map((l: QuoteLine) => (
              <Row
                key={l.id}
                desc={l.fee_description ?? ''}
                qty={quantityCell(l.quantity)}
                subtotal={money(l.cost)}
              />
            ))}
            {s.sequelSum > 0 && (
              <Row
                desc={SEQUEL_ROW_LABEL[s.name] ?? 'Sequel Fee'}
                qty={quantityCell(s.sequelQty)}
                subtotal={money(s.sequelSum)}
              />
            )}
          </div>
        ))}

        <div className="quote-total-row">
          <Row
            desc=""
            qty="Total"
            subtotal={`${money(q.local_grand_total)} ${q.currency_code ?? ''}`.trim()}
            bold
          />
        </div>

        <Terms q={q} />
        <Notes q={q} sections={sections} />

        <div className="quote-rule" />
        <div className="quote-footer">
          <span className="quote-wordmark quote-footer-word">{q.quote_service ?? ''}</span>
          <div className="quote-footer-notes">
            <p className="quote-para">This document constitutes an estimate only.</p>
            <p className="quote-para">
              All quoted fees are exclusive of VAT or local equivalent and any applicable taxes,
              duties, or withholding tax obligations.
            </p>
            <p className="quote-para">
              Payment is due within 14 days of air date, net of any bank charges or deductions.
            </p>
            <p className="quote-para">
              Sequel is the trading name of TBPB Ltd Registered Address 20-22 Wenlock Rd, N1 7GU,
              London. Company Reg No. 13803490
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
