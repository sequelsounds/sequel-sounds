// The release form as a PDF, drawn onto Sequel's own exported template.
//
// ⚠️ THE TEMPLATE IS THE DESIGN AND IS NEVER REBUILT HERE. Andy exports it from
// Word — the only thing that lays that document out correctly, since
// LibreOffice substitutes Creato Display and breaks the wordmark — and this
// file draws the two blocks that vary, at coordinates measured off the
// template's own placeholders with pdfplumber. Change the template, re-measure.
//
// This is the opposite choice to the Schedule A next door, which is drawn from
// nothing. That one had to be: it generates a signature page and places signing
// anchors. This one has eleven fixed lines of letterhead and a body, so keeping
// Andy's export as the page means a wording change is a re-export by him rather
// than a code change by us.
//
// ⚠️ THE TEMPLATE HAS NO BODY TEXT AT ALL. Its placeholders were REMOVED, not
// covered — scripts/strip-release-template.py. Drawing over them would have
// left them in the text layer: invisible on screen, still there to any text
// extractor. That is precisely the fault found in Sequel's own release form on
// 18 Sep, where a pale-grey "this is an estimate only, all quotes are valid for
// 30 days and are strictly subject to artist approval" sat at the foot of a
// letter whose entire purpose was to tell a broadcaster the opposite, and went
// out to a client that way.
//
// ⚠️ ONE TRACK PER FORM — Andy, 19 Sep. No track list, no pluralisation: "The
// below track has been cleared". Two tracks is two forms, which is also how
// their terms stay honest, since two songs rarely share a term and territory.
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'
import {
  CREATO_BOLD_GZ_B64,
  CREATO_REGULAR_GZ_B64,
  SIGNATURE_FONT_GZ_B64,
  TEMPLATE_GZ_B64,
} from './assets.ts'

export type ReleaseFormInput = {
  recipient_name: string
  recipient_address: string | null
  brand: string
  campaign: string
  track_name: string
  term: string
  territory: string
  media: string
  scripts: string
  /** From the database, never the browser — see track_create_release_form. */
  signer_name: string
  /**
   * The issuer's own signature, as an SVG path in a 600x200 box, snapshotted
   * onto the form when it was created. Null until they have drawn one, in
   * which case their name goes on in a handwriting face instead.
   */
  signer_signature: string | null
  /**
   * ⚠️ How to put it on the page. 'drawn' is a line and is STROKED; 'typed' is
   * letter outlines and is FILLED. Filling a drawn signature blobs every loop
   * in the handwriting; stroking a typed one outlines each letter and reads as
   * a font.
   */
  signer_signature_kind: 'drawn' | 'typed'
  /** As it prints: "18th September 2026". */
  issued_on: string
}

const INK = rgb(0, 0, 0)
const SIZE = 10.08
const LEFT = 182.4
/** The recipient block is right-aligned on this edge. */
const RIGHT = 550.1

/** Every line's position, as the placeholders sat in the template, in points
 *  from the TOP of the A4 page (595.2 x 841.9) as a PDF reader reports them. */
const Y = {
  recipientTop: 108.5,
  recipientStep: 11.9,
  concern: 300.7,
  cleared: 324.5,
  brand: 336.5,
  track: 360.2,
  usage: 384.0,
  term: 407.8,
  territory: 419.5,
  media: 431.5,
  scripts: 443.3,
  best: 479.0,
  signer: 514.6,
  title: 526.8,
  /** ⚠️ BESIDE THE SIGNATURE, not under the sign-off. The master carries no
   *  date at all — the Edelman sample had one typed in by hand, at x 260.9 with
   *  the signature to its left, and this is that position. */
  date: 578.5,
}

/** The date sits to the right of the signature, not at the left margin.
 *
 *  ⚠️ MOVED 260.9 → 400 — Andy, 21 Sep: "make the signature bigger". It could
 *  not get bigger while this stood here. The signature starts at LEFT (182.4),
 *  so the date at 260.9 left it 78.5pt of room and it was using 72 of them.
 *  Everything up to RIGHT (550.1) is free, so the date went right and the
 *  signature took the space. */
const DATE_X = 400

/**
 * Where the signature goes, measured off the one on the Edelman original: it
 * starts at the left margin and finishes clear of the date.
 *
 * ⚠️ THE 600x200 BOX MUST MATCH `SIGNATURE_BOX` IN SignaturePad.tsx. The pad
 * records the stroke in that space and this scales out of it, so changing one
 * without the other rescales every signature already stored.
 */
const SIGNATURE_BOX = { width: 600, height: 200 }
const SIG = { x: LEFT, top: 550, width: 150 }
const SIG_SCALE = SIG.width / SIGNATURE_BOX.width
/** In path units: the CTM scales it, so this lands at about 0.8pt on the page. */
const SIG_STROKE = 0.8 / SIG_SCALE
/** The fallback, for anyone who has not drawn one.
 *
 *  It used to sit HIGHER than a drawn signature: a name in this face runs
 *  about 100pt wide, past the old date position at 260.9, so it had to clear
 *  the date vertically — at the drawn signature's own height its descenders
 *  landed straight through "18th September". With the date out at 400 there
 *  is nothing to the right to hit, so it now sits on the signature's own
 *  line and is sized to match it. */
const SIG_FONT_SIZE = 30
const SIG_FONT_TOP = 555

/** Calibrated against the template: a line's measured top against its baseline.
 *  Verified line by line — every one lands within 0.05pt of the placeholder. */
const BASELINE_DROP = 0.2343 * SIZE

const FIXED = {
  concern: 'To whom it may concern.',
  cleared: 'The below track has been cleared for use with the',
  tail: ' as per the below terms:',
  usage: 'Usage Terms:',
  best: 'Best',
  /** Fixed, deliberately — Andy, 19 Sep: every supervisor signs as this, him
   *  included. track_users.job_title is empty for all three Sequel users. */
  title: 'Music Supervisor',
  titleTail: ' – Sequel',
}

/** The assets ship gzipped so a deploy carries 115 KB rather than 192 KB. */
async function unpack(b64: string) {
  const bin = atob(b64)
  const gz = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i)
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Unpacked once per instance, not once per form. */
let assets:
  | Promise<{ template: Uint8Array; regular: Uint8Array; bold: Uint8Array; script: Uint8Array }>
  | null = null
function loadAssets() {
  if (!assets) {
    assets = (async () => ({
      template: await unpack(TEMPLATE_GZ_B64),
      regular: await unpack(CREATO_REGULAR_GZ_B64),
      bold: await unpack(CREATO_BOLD_GZ_B64),
      script: await unpack(SIGNATURE_FONT_GZ_B64),
    }))()
    assets.catch(() => {
      assets = null
    })
  }
  return assets
}

/** 1 → 1st, 2 → 2nd … so the date reads as it does when typed by hand. */
function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/** "18th September 2026", in London, whatever the server thinks the time is. */
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

export async function buildReleaseForm(f: ReleaseFormInput): Promise<Uint8Array> {
  const a = await loadAssets()
  const pdf = await PDFDocument.load(a.template)
  pdf.registerFontkit(fontkit)
  const regular = await pdf.embedFont(a.regular, { subset: true })
  const bold = await pdf.embedFont(a.bold, { subset: true })
  const script = await pdf.embedFont(a.script, { subset: true })
  const page = pdf.getPages()[0]
  const H = page.getHeight()

  /** The measurements are from the top of the page; pdf-lib draws from the
   *  bottom, and wants a baseline rather than a box. */
  const baseline = (top: number) => H - (top + SIZE) + BASELINE_DROP
  const width = (s: string, font = regular) => font.widthOfTextAtSize(s, SIZE)
  const text = (s: string, x: number, top: number, font = regular) =>
    page.drawText(s, { x, y: baseline(top), size: SIZE, font, color: INK })

  /* ---- the recipient, right-aligned, over however many lines it runs to */
  const lines = [f.recipient_name, ...String(f.recipient_address ?? '').split(/\r?\n/)]
    .map((l) => String(l ?? '').trim())
    .filter(Boolean)
  lines.forEach((line, i) => {
    const font = i === 0 ? bold : regular
    text(line, RIGHT - width(line, font), Y.recipientTop + i * Y.recipientStep, font)
  })

  /* ---- the body */
  text(FIXED.concern, LEFT, Y.concern)
  text(FIXED.cleared, LEFT, Y.cleared)

  /* Brand and campaign are bold and the tail after them is not, so the tail
   * starts wherever they happen to end rather than at a fixed offset. This is
   * the reason the template is stripped rather than filled: a placeholder
   * replaced in place would leave "as per the below terms:" stranded. */
  const head = `${f.brand} – ${f.campaign}`
  text(head, LEFT, Y.brand, bold)
  text(FIXED.tail, LEFT + width(head, bold), Y.brand)

  text(`Track: ${f.track_name}`, LEFT, Y.track)
  text(FIXED.usage, LEFT, Y.usage)
  text(`Term: ${f.term}`, LEFT, Y.term)
  text(`Territory: ${f.territory}`, LEFT, Y.territory)
  text(`Media: ${f.media}`, LEFT, Y.media)
  text(`Scripts: ${f.scripts}`, LEFT, Y.scripts)
  text(FIXED.best, LEFT, Y.best)

  text(f.signer_name, LEFT, Y.signer)
  text(FIXED.title, LEFT, Y.title, bold)
  text(FIXED.titleTail, LEFT + width(FIXED.title, bold), Y.title, bold)

  /* ---- the signature, then the date beside it */
  if (f.signer_signature) {
    // drawSvgPath takes the path's own coordinates with y running DOWN from
    // the point given, which is why this is the top of the box rather than a
    // baseline. Stroked, not filled: a signature is a line, and filling it
    // turns every closed loop in the handwriting into a blob.
    page.drawSvgPath(f.signer_signature, {
      x: SIG.x,
      y: H - SIG.top,
      scale: SIG_SCALE,
      ...(f.signer_signature_kind === 'typed'
        ? { color: INK }
        : { borderColor: INK, borderWidth: SIG_STROKE, borderLineCap: 1 }),
    })
  } else {
    // Nobody has drawn one. Their name in the same hand the Schedule A signs
    // composer agreements in — better than a gap, and it says who signed.
    page.drawText(f.signer_name, {
      x: SIG.x,
      y: H - (SIG_FONT_TOP + SIG_FONT_SIZE),
      size: SIG_FONT_SIZE,
      font: script,
      color: INK,
    })
  }

  text(f.issued_on, DATE_X, Y.date)

  return await pdf.save()
}
