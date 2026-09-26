// The composition licence as a PDF, drawn onto Andy's own Word export.
//
// ⚠️ THE TEMPLATE IS THE DOCUMENT. Pages 2–4 — the eleven clauses — are never
// touched: the legal text is Andy's, exported from Word, and a wording change
// is a re-export by him, never a code change here. Only the certificate
// (page 1) and the schedule (page 5) carry values, and their placeholders were
// REMOVED from the template (scripts/strip-licence-template.py), not covered,
// so no "[Licence_Fee]" survives in the text layer of a generated licence.
//
// ⚠️ WHERE EACH VALUE GOES IS MEASURED, NOT TYPED: layout.ts is written by the
// same script that strips the template. Re-export → re-run the script.
//
// Decisions behind the content (Andy, 25 Sep 2026 —
// claude/sequel-track-composition-licence-decisions.md):
//  - invoice first: the licence prints the number of an invoice that has
//    already been raised; the database refuses one without it
//  - the schedule names the WRITERS, not the composer team
//  - both fee lines cover "one hundred per cent (100%) of the Rights Granted"
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'
import { ROBOTO_BOLD_GZ_B64, ROBOTO_REGULAR_GZ_B64, TEMPLATE_GZ_B64 } from './assets.ts'
import { LAYOUT } from './layout.ts'

export type LicenceInput = {
  sequel_no: string
  /** As it prints: "25th September 2026". */
  issued_on: string
  licensee_name: string
  licensee_address: string | null
  /** The raised invoice's number, from the database — never the browser. */
  invoice_number: string
  rights_granted: string
  licensor_share: string
  composition_title: string
  writer_names: string
  production_name: string
  client_name: string
  brand: string
  campaign: string
  scripts: string
  cutdowns: string
  media: string
  territory: string
  term: string
  first_transmission: string
  /** With its currency code, as it should print: "GBP 5,000.00". */
  licence_fee: string
}

/** Sequel brown, #372B29 — the colour every line of the template is set in. */
const INK = rgb(0.2156863, 0.1686275, 0.1607843)
const SIZE = 11.04
/** The smallest a value may be set to fit its line before it wraps. */
const MIN_SIZE = 8.5

/**
 * ⚠️ WORD CONDENSED THE CERTIFICATE PAGE. Every run on page 1 carries
 * Tc −0.0285 of an em (−0.3146pt at 11.04pt); the schedule does not. Drawing
 * page 1's values without it sets them visibly looser than the words beside
 * them.
 */
const TRACKING: Record<number, number> = { 0: -0.3146, 4: 0 }

/** Line step of the binding-acceptance paragraph, as Word set it. */
const LEADING = LAYOUT.binding.y - LAYOUT.binding_next.y

const BINDING_LINE = (invoice: string) =>
  `This document serves as a binding contract. By paying the associated Licence Fee invoice (${invoice}), the`

async function unpack(b64: string) {
  const bin = atob(b64)
  const gz = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i)
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

let assets: Promise<{ template: Uint8Array; regular: Uint8Array; bold: Uint8Array }> | null = null
function loadAssets() {
  if (!assets) {
    assets = (async () => ({
      template: await unpack(TEMPLATE_GZ_B64),
      regular: await unpack(ROBOTO_REGULAR_GZ_B64),
      bold: await unpack(ROBOTO_BOLD_GZ_B64),
    }))()
    assets.catch(() => {
      assets = null
    })
  }
  return assets
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/** "25th September 2026", in London. The same form the release form prints. */
export function londonLongDate(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${ordinal(Number(get('day')))} ${get('month')} ${get('year')}`
}

/** One line of text, possibly two runs in different weights. */
type Run = { text: string; font: PDFFont }

export async function buildLicence(f: LicenceInput): Promise<Uint8Array> {
  const a = await loadAssets()
  const pdf = await PDFDocument.load(a.template)
  pdf.registerFontkit(fontkit)
  const regular = await pdf.embedFont(a.regular, { subset: true })
  const bold = await pdf.embedFont(a.bold, { subset: true })
  const pages = pdf.getPages()
  const RIGHT = LAYOUT.page_right

  const widthOf = (runs: Run[], size: number, tc: number) =>
    runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size) + tc * r.text.length, 0)

  const drawRuns = (page: PDFPage, pn: number, runs: Run[], x: number, y: number, size: number) => {
    const tc = TRACKING[pn] ?? 0
    page.pushOperators(setCharacterSpacing(tc))
    let cx = x
    for (const r of runs) {
      if (!r.text) continue
      page.drawText(r.text, { x: cx, y, size, font: r.font, color: INK })
      cx += r.font.widthOfTextAtSize(r.text, size) + tc * r.text.length
    }
    page.pushOperators(setCharacterSpacing(0))
  }

  /** Greedy word wrap of plain text into lines no wider than `max`. */
  const wrap = (text: string, font: PDFFont, size: number, tc: number, max: number) => {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (!cur || widthOf([{ text: next, font }], size, tc) <= max) cur = next
      else {
        lines.push(cur)
        cur = w
      }
    }
    if (cur) lines.push(cur)
    return lines
  }

  /**
   * A value on one line where it fits; set smaller if it does not; wrapped
   * onto a second line only as a last resort, and never more than two — the
   * next line of the document is only one line-step below.
   */
  const place = (
    key: keyof typeof LAYOUT,
    runs: Run[],
    opts: { maxLines?: 1 | 2; step?: number } = {},
  ) => {
    const spot = LAYOUT[key] as { page: number; x: number; y: number }
    const page = pages[spot.page]
    const tc = TRACKING[spot.page] ?? 0
    const max = RIGHT - spot.x
    for (let size = SIZE; size >= MIN_SIZE - 1e-9; size -= 0.25) {
      if (widthOf(runs, size, tc) <= max) {
        drawRuns(page, spot.page, runs, spot.x, spot.y, size)
        return
      }
    }
    // Still too long at the smallest size: two lines, plain weight only.
    const text = runs.map((r) => r.text).join('')
    const font = runs[runs.length - 1].font
    const maxLines = opts.maxLines ?? 2
    let size = MIN_SIZE
    let lines = wrap(text, font, size, tc, max)
    while (lines.length > maxLines && size > 6) {
      size -= 0.25
      lines = wrap(text, font, size, tc, max)
    }
    const step = opts.step ?? size * 1.2
    lines.slice(0, maxLines).forEach((l, i) =>
      drawRuns(page, spot.page, [{ text: l, font }], spot.x, spot.y - i * step, size),
    )
  }

  const R = (text: string): Run => ({ text: String(text ?? '').trim(), font: regular })

  /* ------------------------------------------------ page 1, the certificate */
  place('sequel_no', [R(f.sequel_no)], { maxLines: 1 })
  place('date', [R(f.issued_on)], { maxLines: 1 })
  place('licensee_name', [R(f.licensee_name)], { maxLines: 1 })

  /* The address is one flowing line, commas between its parts, wrapped to at
   * most two lines — there is exactly one line-step of room before
   * "(the "Licensee")". */
  const address = String(f.licensee_address ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
  if (address) {
    const spot = LAYOUT.licensee_address
    const tc = TRACKING[spot.page]
    const max = RIGHT - spot.x
    let size = SIZE
    let lines = wrap(address, regular, size, tc, max)
    while (lines.length > 2 && size > MIN_SIZE) {
      size -= 0.25
      lines = wrap(address, regular, size, tc, max)
    }
    lines.slice(0, 2).forEach((l, i) =>
      drawRuns(pages[spot.page], spot.page, [R(l)], spot.x, spot.y - i * LEADING, size),
    )
  }

  /* The first line of BINDING ACCEPTANCE, redrawn whole with the number in
   * it. The two lines under it are Word's and untouched; an invoice number is
   * always shorter than "[Invoice_Number]", so this line only gets shorter. */
  place('binding', [R(BINDING_LINE(f.invoice_number))], { maxLines: 1 })

  /* ----------------------------------------------------- page 5, the schedule */
  place('rights_granted', [R(`: ${f.rights_granted}`)])
  place('licensor_share', [R(`: ${f.licensor_share}`)])
  place('composition_title', [R(f.composition_title)])
  place('writer_names', [R(f.writer_names)])
  place('production_name', [R(f.production_name)])
  place('client_name', [R(f.client_name)])
  place('brand', [R(f.brand)])
  place('campaign', [R(f.campaign)])
  place('scripts', [R(f.scripts)])
  place('cutdowns', [R(f.cutdowns)])
  place('media', [R(f.media)])
  place('territory', [R(f.territory)])
  place('term', [R(f.term)])
  place('first_transmission', [R(f.first_transmission)])
  /* The fee line is redrawn from the value onwards because everything after
   * the fee moves with its width — including the bold "Rights Granted." */
  place('licence_fee', [
    { text: `${String(f.licence_fee ?? '').trim()} to cover one hundred per cent (100%) of the `, font: regular },
    { text: 'Rights Granted.', font: bold },
  ])

  return await pdf.save()
}
