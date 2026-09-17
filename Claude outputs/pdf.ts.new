// The Schedule A as a PDF, filled in.
//
// Drawn rather than converted: Andy's template is a Word file, and converting
// Word to PDF on a server drops images (the Sequel mark) and re-wraps text.
// So the page is laid out here to match the template, measured
// off a LibreOffice render of "Schedule A Boldsign Template.docx" (16 Sep 2026)
// with its own fonts installed. Every number below is from that render, in PDF
// points from the TOP of a US Letter page (612 x 792), as a PDF reader reports
// them. Change the template, re-measure.
//
// Signed on Sequel's own page (Andy, 16 Sep 2026 — Firma was tried first and
// dropped): the signer's typed name goes on the dotted line in a handwriting
// face and again after "For and on behalf of", with a line saying when and
// how it was signed, and a second page carries the signature record.

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'

export type ScheduleAInput = {
  title: string
  writers: { full_name: string; cae_number: string | null; share_split: number }[]
  brand: string
  productionTitle: string
  /** As it prints: DD/MM/YYYY. */
  commencementDate: string
  ownership: string
}

export type Signature = {
  name: string
  signedAt: Date
  /** Who the link was sent to: the team's contract email. */
  email: string
  ip: string
  userAgent: string
  consent: string
  /** SHA-256 (hex) of the details the signer was shown. */
  detailsHash: string
  /** The song's uuid: the document's reference. */
  reference: string
  team: string
}

export type Fonts = { body: Uint8Array; heading: Uint8Array; signature: Uint8Array }

// Fonts come from jsDelivr, pinned, and are kept for the life of the worker.
// Roboto Condensed is the template's body face (the full font, so accented
// names print), Fahkwang Medium its heading, Mrs Saint Delafield the signature.
// All Google Fonts: Apache 2.0, OFL 1.1 and OFL 1.1.
const FONT_URLS = {
  body: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto-condensed@0.4.2/400Regular/RobotoCondensed_400Regular.ttf',
  heading: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/fahkwang@0.4.1/500Medium/Fahkwang_500Medium.ttf',
  signature:
    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/mrs-saint-delafield@0.4.1/400Regular/MrsSaintDelafield_400Regular.ttf',
}
let fontCache: Promise<Fonts> | null = null

export function loadFonts(): Promise<Fonts> {
  if (!fontCache) {
    fontCache = (async () => {
      const get = async (url: string) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`font download failed (${res.status})`)
        return new Uint8Array(await res.arrayBuffer())
      }
      const [body, heading, signature] = await Promise.all([
        get(FONT_URLS.body),
        get(FONT_URLS.heading),
        get(FONT_URLS.signature),
      ])
      return { body, heading, signature }
    })()
    // A failed download is not cached, so the next request tries again.
    fontCache.catch(() => {
      fontCache = null
    })
  }
  return fontCache
}

const PAGE_W = 612
const PAGE_H = 792
const SAGE = rgb(0xd0 / 255, 0xdb / 255, 0xcd / 255) // the template's page fill, D0DBCD
const INK = rgb(0, 0, 0)

const BODY_SIZE = 10
const HEADING_SIZE = 36
const LEFT = 90.1
const VALUE_X = 251.4 // where the template's own text started in the right column

// Table rules: [top, x0, x1]. The first and last run the full width.
const H_RULES: [number, number, number][] = [
  [177.55, 90.05, 516.35],
  [201.95, 90.55, 515.85],
  [377.95, 90.55, 515.85],
  [413.55, 90.55, 515.85],
  [449.15, 90.55, 515.85],
  [484.75, 90.55, 515.85],
  [532.05, 90.05, 516.35],
]
const V_RULES: [number, number, number][] = [
  [90.3, 177.3, 532.3],
  [246.0, 177.8, 531.8],
  [516.1, 177.3, 532.3],
]

// Label rows: the text top of each label, which is also where its value goes.
const ROW = {
  title: 179.6,
  composers: 204.0,
  brand: 391.6,
  production: 427.2,
  commencement: 462.9,
  ownership: 510.2,
}

// The composers cell runs from 201.95 to 377.95. Header on the label's line,
// then one writer a line.
const COL = { name: VALUE_X, cae: 401.9, share: 482.9 }
const COL_RIGHT = 511 // the cell's inner right edge
const COMPOSER_BOTTOM = 375

// The template's footer line, with Sequel's registered address and company
// number added (Andy, 16 Sep) — the same details as the quote page's footer.
const FOOTER =
  'TBPB Ltd trading as Sequel · 20-22 Wenlock Rd, London N1 7GU · Company Reg No. 13803490'

function footer(page: PDFPage, body: PDFFont, pageNo: number) {
  put(page, body, drawable(body, FOOTER), LEFT, 721.25)
  put(page, body, String(pageNo), 516.05, 721.25)
}

const PARAGRAPH = [
  { top: 132.3, text: 'Musical Works created by the Composer for the Company shall be subject to the Terms and Definitions of this' },
  { top: 144.0, text: 'Agreement. In the case that the Company successfully places a Musical Work created by the Composer for' },
  { top: 155.7, text: 'any Production, said Musical Work shall be added to this Schedule.' },
]

// The Sequel mark (word/media/image1.png in the template, a 400 x 400 PNG):
// a Sequel Brown square with two slanted strokes in the page colour. Traced
// from the PNG into paths so the document carries no image — same shape, and
// sharp at any zoom.
const BROWN = rgb(55 / 255, 43 / 255, 41 / 255)
const MARK_PATH =
  'M219.5 128 L154 128.25 L161.5 129.75 L164 133.25 L162 146.5 L126 258.5 L119.5 267 L115.5 269 L110.25 269 L110.25 270.75 L174.75 270.5 L174.5 269 L168.25 268 L165.75 264.5 L165.75 258.25 L202.75 140.25 L209.25 130.75 Z ' +
  'M289.5 128 L224 128.25 L231.5 129.75 L234 133.25 L232 146.5 L196 258.5 L189.5 267 L185.5 269 L180.25 269 L180.25 270.75 L244.75 270.5 L244.5 269 L238.25 268 L235.75 264.5 L235.75 258.25 L272.75 140.25 L279.25 130.75 Z'

/**
 * A text top, as a PDF reader reports it for the template, to pdf-lib's
 * baseline. The ratios are measured, not derived: in the render the body
 * baseline sits 0.75 of the size below the reported top, the heading's 0.544.
 */
const BODY_DROP = 0.75
const HEADING_DROP = 19.58 / 36
// Keyed by the embedded font object, so every document registers its own.
const dropFor = new WeakMap<PDFFont, number>()
function baseline(font: PDFFont, size: number, top: number): number {
  return PAGE_H - top - (dropFor.get(font) ?? BODY_DROP) * size
}

/** Anything the font cannot draw becomes a plain question mark, never a crash. */
function drawable(font: PDFFont, text: string): string {
  const set = font.getCharacterSet()
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!
    out += set.includes(cp) ? ch : cp < 32 ? ' ' : '?'
  }
  return out
}

/** Shrinks, then trims with an ellipsis, so a value never crosses a rule. */
function fit(font: PDFFont, text: string, maxWidth: number, size = BODY_SIZE): { text: string; size: number } {
  let s = Math.min(size, BODY_SIZE)
  const floor = Math.min(8.5, s)
  while (s > floor && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5
  if (font.widthOfTextAtSize(text, s) <= maxWidth) return { text, size: s }
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', s) > maxWidth) t = t.slice(0, -1)
  return { text: t + '…', size: s }
}

function put(page: PDFPage, font: PDFFont, text: string, x: number, top: number, size = BODY_SIZE, color = INK) {
  if (!text) return
  page.drawText(text, { x, y: baseline(font, size, top), size, font, color })
}

/** Word-wraps, breaking inside a word only when it is wider than the line. */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  const push = (w: string) => {
    let word = w
    while (font.widthOfTextAtSize(word, size) > maxWidth) {
      let i = word.length - 1
      while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > maxWidth) i--
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, i))
      word = word.slice(i)
    }
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  for (const w of text.split(/\s+/).filter(Boolean)) push(w)
  if (line) lines.push(line)
  return lines
}

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})

export function londonTime(d: Date): string {
  // "16 September 2026 at 22:16:05 BST"
  const parts = LONDON.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')} at ${get('hour')}:${get('minute')}:${get('second')} ${get('timeZoneName')}`
}

function putFitted(page: PDFPage, font: PDFFont, raw: string, x: number, top: number, maxWidth: number) {
  const f = fit(font, drawable(font, raw), maxWidth)
  put(page, font, f.text, x, top + (BODY_SIZE - f.size) / 2, f.size)
}

export function formatShare(n: number): string {
  // 50 → "50%", 33.33 → "33.33%": as typed, without trailing zeros.
  return `${Number(n.toFixed(2))}%`
}

export async function buildScheduleA(
  input: ScheduleAInput,
  fonts: Fonts,
  signature?: Signature,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(`Schedule A — ${input.title}`)
  doc.setAuthor('TBPB Ltd trading as Sequel')
  doc.setCreator('Sequel')
  doc.setProducer('Sequel')

  const body = await doc.embedFont(fonts.body, { subset: true })
  const heading = await doc.embedFont(fonts.heading, { subset: true })
  dropFor.set(heading, HEADING_DROP)
  const script = signature ? await doc.embedFont(fonts.signature, { subset: true }) : null

  const page = doc.addPage([PAGE_W, PAGE_H])
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: SAGE })

  // The mark, top right: 435–518 across, 26–109 down.
  const MARK = 83.3
  page.drawRectangle({ x: 435.0, y: PAGE_H - 26.0 - MARK, width: MARK, height: MARK, color: BROWN })
  page.drawSvgPath(MARK_PATH, { x: 435.0, y: PAGE_H - 26.0, scale: MARK / 400, color: SAGE })

  // SCHEDULE  A — two spaces, as the template has it.
  put(page, heading, 'SCHEDULE', LEFT, 88.72, HEADING_SIZE)
  put(page, heading, 'A', 331.08, 88.72, HEADING_SIZE)

  for (const line of PARAGRAPH) put(page, body, line.text, LEFT, line.top)

  for (const [top, x0, x1] of H_RULES) {
    page.drawLine({ start: { x: x0, y: PAGE_H - top }, end: { x: x1, y: PAGE_H - top }, thickness: 0.5, color: INK })
  }
  for (const [x, t0, t1] of V_RULES) {
    page.drawLine({ start: { x, y: PAGE_H - t0 }, end: { x, y: PAGE_H - t1 }, thickness: 0.5, color: INK })
  }

  const labelX = 95.8
  put(page, body, 'MUSICAL WORK TITLE:', labelX, ROW.title)
  put(page, body, 'COMPOSER(S):', labelX, ROW.composers)
  put(page, body, 'BRAND:', labelX, ROW.brand)
  put(page, body, 'PRODUCTION TITLE:', labelX, ROW.production)
  put(page, body, 'COMMENCEMENT DATE:', labelX, ROW.commencement)
  put(page, body, 'OWNERSHIP', labelX, ROW.ownership)

  const valueWidth = COL_RIGHT - VALUE_X
  putFitted(page, body, input.title, VALUE_X, ROW.title, valueWidth)
  putFitted(page, body, input.brand, VALUE_X, ROW.brand, valueWidth)
  putFitted(page, body, input.productionTitle, VALUE_X, ROW.production, valueWidth)
  putFitted(page, body, input.commencementDate, VALUE_X, ROW.commencement, valueWidth)
  putFitted(page, body, input.ownership, VALUE_X, ROW.ownership, valueWidth)

  // Composers: the template's header words, in columns, then a line each.
  // Line pitch 11.7pt is the template's own; more writers than fit get a
  // tighter pitch rather than running off the cell.
  put(page, body, 'NAME', COL.name, ROW.composers)
  put(page, body, 'IPI/CAE', COL.cae, ROW.composers)
  const shareHead = 'SHARE %'
  put(page, body, shareHead, COL_RIGHT - body.widthOfTextAtSize(shareHead, BODY_SIZE), ROW.composers)

  const first = ROW.composers + 11.7 + 4
  const available = COMPOSER_BOTTOM - first - BODY_SIZE
  const n = input.writers.length
  const pitch = n > 1 ? Math.min(11.7, available / (n - 1)) : 11.7
  const size = pitch < 11 ? Math.max(6, pitch - 1.2) : BODY_SIZE
  input.writers.forEach((w, i) => {
    const top = first + i * pitch
    const name = fit(body, drawable(body, w.full_name), COL.cae - COL.name - 6, size)
    put(page, body, name.text, COL.name, top, name.size)
    const cae = fit(body, drawable(body, w.cae_number ?? ''), COL.share - COL.cae - 6, size)
    put(page, body, cae.text, COL.cae, top, cae.size)
    const share = formatShare(w.share_split)
    put(page, body, share, COL_RIGHT - body.widthOfTextAtSize(share, size), top, size)
  })

  // Signature block.
  put(page, body, 'Accepted and agreed,', LEFT, 545.8)
  put(page, body, '…………………………………………………………..', LEFT, 594.7)
  put(page, body, 'For and on behalf of', LEFT, 606.4)
  put(page, body, '(the “Composer”)', LEFT, 641.5)

  // The dotted line runs 90 to about 300. The signature sits on it, the name
  // follows "For and on behalf of", and a small line under "(the Composer)"
  // says how it was signed.
  if (signature && script) {
    const sigText = drawable(script, signature.name)
    let sigSize = 30
    while (sigSize > 14 && script.widthOfTextAtSize(sigText, sigSize) > 200) sigSize -= 1
    page.drawText(sigText, { x: LEFT + 4, y: PAGE_H - 596.5, size: sigSize, font: script, color: INK })
    putFitted(page, body, signature.name, 186, 606.4, COL_RIGHT - 186)
    const note = `Signed electronically by ${signature.name} on ${londonTime(signature.signedAt)}. Signature record on page 2.`
    wrap(body, drawable(body, note), 8, COL_RIGHT - LEFT).forEach((line, i) =>
      put(page, body, line, LEFT, 660 + i * 10, 8),
    )
  }

  footer(page, body, 1)

  if (signature) drawRecord(doc.addPage([PAGE_W, PAGE_H]), body, heading, input, signature)

  return await doc.save()
}

/** Page 2: what happened, in plain words, for anyone who ever needs to check. */
function drawRecord(page: PDFPage, body: PDFFont, heading: PDFFont, input: ScheduleAInput, sig: Signature) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: SAGE })
  // The same heading as page 1: same face, size and position (Andy, 16 Sep).
  // No rules and no grey on this page either.
  put(page, heading, 'SIGNATURE RECORD', LEFT, 88.72, HEADING_SIZE)

  const intro =
    'This page was added by Sequel when the Schedule A on page 1 was signed on Sequel’s website. ' +
    'It records who signed, when, and from where, and identifies the details they were shown.'
  let top = 150
  for (const line of wrap(body, intro, BODY_SIZE, COL_RIGHT - LEFT)) {
    put(page, body, line, LEFT, top)
    top += 13
  }
  top += 14

  const rows: [string, string][] = [
    ['Document', `Schedule A — ${input.title}`],
    ['Reference', sig.reference],
    ['Composer', sig.team],
    ['Signed by', sig.name],
    ['Link sent to', sig.email],
    ['Signed at', `${londonTime(sig.signedAt)} (${sig.signedAt.toISOString()})`],
    ['IP address', sig.ip || 'not available'],
    ['Browser', sig.userAgent || 'not available'],
    ['Consent', `The signer ticked: “${sig.consent}”`],
    ['Details shown (SHA-256)', sig.detailsHash],
  ]
  const valueX = 210
  for (const [label, value] of rows) {
    put(page, body, label.toUpperCase(), LEFT, top + 1, 8.5)
    const lines = wrap(body, drawable(body, value), BODY_SIZE, COL_RIGHT - valueX)
    lines.forEach((line, i) => put(page, body, line, valueX, top + i * 13))
    top += Math.max(1, lines.length) * 13 + 12
  }

  const foot =
    'The details hash is taken from the title, writers, brand, production title, commencement date, rights and ' +
    'composer exactly as shown on the signing page. Sequel keeps its own copy of this file and a SHA-256 of it.'
  top += 10
  for (const line of wrap(body, foot, 8, COL_RIGHT - LEFT)) {
    put(page, body, line, LEFT, top, 8)
    top += 10
  }

  footer(page, body, 2)
}
