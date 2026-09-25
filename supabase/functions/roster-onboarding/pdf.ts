// The composer agreement, filled in and signed on Andy's own template.
//
// Written ONTO the template (template.ts), not redrawn: it is nine pages of
// terms, and the fields are four blanks on page 1 and the two signature
// blocks on page 8. Every coordinate below was measured off the template with
// pdfplumber on 24 Sep 2026, as the text TOP a PDF reader reports, in points
// from the top of a US Letter page. Replace the template, re-measure.
//
// One wording change, Andy's (24 Sep): page 1's "whose principal place of
// residence is currently at:" reads "whose principal place of business is
// at:", because the form asks for a business address. It is written over the
// original line on a patch of the page colour.
//
// A signature here is a typed name in a handwriting face plus a ticked
// consent, as on the Schedule A. What makes it stand up is the record: a
// final page saying who signed for each side, when, from which IP and
// browser, and a hash of the details the composer was shown.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'
import type { Fonts } from '../song-schedule-a/pdf.ts'
import { londonTime } from '../song-schedule-a/pdf.ts'
import { TEMPLATE_B64 } from './template.ts'

export type AgreementDetails = {
  /** The team as it appears on the Roster. */
  team: string
  /** Party B: the person or company signing. */
  legalName: string
  businessAddress: string
  /** "24 September 2026": the day Sequel signed, which is the day it is made. */
  agreementDate: string
}

export type Signer = {
  name: string
  signedAt: Date
  email: string
  ip: string
  userAgent: string
}

export type SignRecord = {
  reference: string
  consent: string
  detailsHash: string
  sentTo: string
}

const PAGE_H = 792
const SAGE = rgb(0xd0 / 255, 0xdb / 255, 0xcd / 255) // the template's page fill, D0DBCD
const INK = rgb(0, 0, 0)
const BODY = 10.1 // the template's body size
const BODY_DROP = 0.75 // text top to baseline, as a fraction of the size (measured on the Schedule A)
const RIGHT = 522 // the template's right margin

const P1 = {
  date: { x: 210, top: 203.1, width: 95 },
  name: { x: 126, top: 321.9 },
  residence: { x0: 125.4, x1: 318.2, top: 347.6, bottom: 359.2 },
  address: { x: 126, top: 374.7, pitch: 13.2, lines: 4 },
}

// Page 8: the two signature blocks. `value` is where the template's
// underscores start; `behalf` is the empty line under "Signed for and on
// behalf of".
const P8 = {
  company: { value: 167.3, behalf: 95.3, right: 300 },
  composer: { value: 383.3, behalf: 311.3, right: RIGHT },
  signedBy: 549.9,
  name: 589.5,
  date: 629.1,
  behalf: 688.5,
}

const COMPANY = 'TBPB Ltd trading as Sequel'

const dropFor = new WeakMap<PDFFont, number>()
function baseline(font: PDFFont, size: number, top: number) {
  return PAGE_H - top - (dropFor.get(font) ?? BODY_DROP) * size
}

/** Anything the font cannot draw becomes a question mark, never a crash. */
function drawable(font: PDFFont, text: string): string {
  const set = font.getCharacterSet()
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!
    out += set.includes(cp) ? ch : cp < 32 ? ' ' : '?'
  }
  return out
}

function put(page: PDFPage, font: PDFFont, text: string, x: number, top: number, size = BODY) {
  if (!text) return
  page.drawText(text, { x, y: baseline(font, size, top), size, font, color: INK })
}

/** Shrinks to 8pt, then trims with an ellipsis, so a value never runs over. */
function putFitted(page: PDFPage, font: PDFFont, raw: string, x: number, top: number, maxWidth: number) {
  let text = drawable(font, raw)
  let size = BODY
  while (size > 8 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5
  if (font.widthOfTextAtSize(text, size) > maxWidth) {
    while (text.length > 1 && font.widthOfTextAtSize(text + '…', size) > maxWidth) text = text.slice(0, -1)
    text += '…'
  }
  put(page, font, text, x, top + (BODY - size) / 2, size)
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (!line || font.widthOfTextAtSize(next, size) <= maxWidth) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function signature(page: PDFPage, script: PDFFont, name: string, x: number, maxWidth: number) {
  const text = drawable(script, name)
  let size = 24
  while (size > 12 && script.widthOfTextAtSize(text, size) > maxWidth) size -= 1
  // Sits on the "Signed by" line's underscores.
  page.drawText(text, { x: x + 2, y: PAGE_H - P8.signedBy - 7.5, size, font: script, color: INK })
}

const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
export const ukDay = (d: Date) => DAY.format(d)

/**
 * The agreement. Unsigned (Andy's review), signed by Sequel (what the composer
 * reads and signs), or signed by both, with the record page (the stored copy).
 */
export async function buildAgreement(
  d: AgreementDetails,
  fonts: Fonts,
  company?: Signer,
  composer?: Signer,
  record?: SignRecord,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(Uint8Array.from(atob(TEMPLATE_B64), (c) => c.charCodeAt(0)))
  doc.registerFontkit(fontkit)
  doc.setTitle(`Composition Agreement — ${d.legalName || d.team}`)
  doc.setAuthor(COMPANY)
  doc.setCreator('Sequel')
  doc.setProducer('Sequel')

  const body = await doc.embedFont(fonts.body, { subset: true })
  const pages = doc.getPages()
  const p1 = pages[0]
  const p8 = pages[7]

  // Page 1.
  putFitted(p1, body, d.agreementDate, P1.date.x, P1.date.top, P1.date.width)
  putFitted(p1, body, d.legalName, P1.name.x, P1.name.top, RIGHT - P1.name.x)

  const r = P1.residence
  p1.drawRectangle({ x: r.x0, y: PAGE_H - r.bottom, width: r.x1 - r.x0, height: r.bottom - r.top, color: SAGE })
  put(p1, body, 'whose principal place of business is at:', P1.address.x, r.top + 0.7)

  const addressText = drawable(body, d.businessAddress.split(/\s*\n\s*/).filter(Boolean).join(', '))
  let size = BODY
  let lines = wrap(body, addressText, size, RIGHT - P1.address.x)
  while (lines.length > P1.address.lines && size > 7.5) {
    size -= 0.5
    lines = wrap(body, addressText, size, RIGHT - P1.address.x)
  }
  lines.slice(0, P1.address.lines).forEach((line, i) =>
    put(p1, body, line, P1.address.x, P1.address.top + i * P1.address.pitch, size),
  )

  // Page 8: who each side signs for is known before anyone signs.
  putFitted(p8, body, COMPANY, P8.company.behalf, P8.behalf, P8.company.right - P8.company.behalf)
  putFitted(p8, body, d.legalName, P8.composer.behalf, P8.behalf, P8.composer.right - P8.composer.behalf)

  const script = company || composer ? await doc.embedFont(fonts.signature, { subset: true }) : null
  // The Name and Date values replace their underscores (a patch of the page
  // colour), so a long name does not read as half underlined. The signature
  // keeps its line.
  const blank = (x: number, top: number) =>
    p8.drawRectangle({ x: x - 0.5, y: PAGE_H - top - 12, width: 67, height: 13, color: SAGE })
  const block = (s: Signer, col: { value: number; right: number }) => {
    signature(p8, script!, s.name, col.value, col.right - col.value - 8)
    blank(col.value, P8.name)
    putFitted(p8, body, s.name, col.value, P8.name, col.right - col.value)
    blank(col.value, P8.date)
    putFitted(p8, body, ukDay(s.signedAt), col.value, P8.date, col.right - col.value)
  }
  if (company) block(company, P8.company)
  if (composer) block(composer, P8.composer)

  if (company && composer && record) {
    const pageNo = pages.length + 1
    put(p8, body, `Signed electronically by both parties. Signature record on page ${pageNo}.`, 90, 750, 8)
    await drawRecord(doc, body, await doc.embedFont(fonts.heading, { subset: true }), d, company, composer, record, pageNo)
  }

  return await doc.save()
}

async function drawRecord(
  doc: PDFDocument,
  body: PDFFont,
  heading: PDFFont,
  d: AgreementDetails,
  company: Signer,
  composer: Signer,
  rec: SignRecord,
  pageNo: number,
) {
  const page = doc.addPage([612, PAGE_H])
  page.drawRectangle({ x: 0, y: 0, width: 612, height: PAGE_H, color: SAGE })
  dropFor.set(heading, 19.58 / 36)
  put(page, heading, 'SIGNATURE RECORD', 90, 88.72, 36)

  const LEFT = 90
  const VALUE_X = 210
  const WIDTH = RIGHT - VALUE_X
  let top = 150
  const intro =
    'This page was added by Sequel when the Composition Agreement was signed on Sequel’s website. ' +
    'It records who signed for each party, when, and from where, and identifies the details the Composer was shown.'
  for (const line of wrap(body, intro, 10, RIGHT - LEFT)) {
    put(page, body, line, LEFT, top, 10)
    top += 13
  }
  top += 14

  const rows: [string, string][] = [
    ['Document', `Composition Agreement — ${d.legalName}`],
    ['Reference', rec.reference],
    ['Composer', `${d.legalName}${d.team && d.team !== d.legalName ? ` (${d.team})` : ''}`],
    ['For Sequel', `${company.name}, ${company.email}`],
    ['Sequel signed at', `${londonTime(company.signedAt)} (${company.signedAt.toISOString()})`],
    ['Sequel IP address', company.ip || 'not available'],
    ['For the Composer', composer.name],
    ['Link sent to', rec.sentTo],
    ['Composer signed at', `${londonTime(composer.signedAt)} (${composer.signedAt.toISOString()})`],
    ['Composer IP address', composer.ip || 'not available'],
    ['Composer browser', composer.userAgent || 'not available'],
    ['Consent', `Each signer ticked: “${rec.consent}”`],
    ['Details shown (SHA-256)', rec.detailsHash],
  ]
  for (const [label, value] of rows) {
    put(page, body, label.toUpperCase(), LEFT, top + 1, 8.5)
    const lines = wrap(body, drawable(body, value), 10, WIDTH)
    lines.forEach((line, i) => put(page, body, line, VALUE_X, top + i * 13, 10))
    top += Math.max(1, lines.length) * 13 + 12
  }

  const foot =
    'The details hash is taken from the Composer’s legal name, business address and team name, the date of the ' +
    'agreement, and Sequel’s signature, exactly as shown on the signing page. Sequel keeps its own copy of this ' +
    'file and a SHA-256 of it.'
  top += 10
  for (const line of wrap(body, foot, 8, RIGHT - LEFT)) {
    put(page, body, line, LEFT, top, 8)
    top += 10
  }
  // The template's own page numbers: Times, 12pt, bottom right.
  const times = await doc.embedFont(StandardFonts.TimesRoman)
  put(page, times, String(pageNo), 516, 732.4, 12)
}
