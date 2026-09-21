import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * A staff user's own signature — drawn once on their record, reused by anything
 * that needs signing.
 *
 * ⚠️ IT IS A PATH, NOT A PICTURE. The stroke is stored as an SVG path `d` in a
 * fixed 600x200 box: a couple of KB, sharp at whatever size a PDF asks for, and
 * it drops straight into pdf-lib's drawSvgPath. A PNG would need a bucket, an
 * IAM policy, and would be soft at print size.
 *
 * ⚠️ YOU CAN ONLY SIGN FOR YOURSELF. `track_save_my_signature` takes no user
 * argument — it writes to the row matching auth.uid() and nothing else — so
 * there is no call in the app that puts one person's hand on another's
 * document. Hiding the pad on somebody else's page is tidiness, not the
 * control.
 */

const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

/** The coordinate space the path is stored in. Everything that draws a stored
 *  signature scales out of this — including `SIGNATURE_BOX` in the release
 *  form's pdf.ts — so it must never change without rescaling what is stored. */
export const SIGNATURE_BOX = { width: 600, height: 200 }

/**
 * ⚠️ `signature_kind` is not decoration. A drawn signature is a line and is
 * STROKED onto a page; a typed one is letter outlines and is FILLED. The path
 * alone does not say which, and getting it the wrong way round fills every loop
 * of a drawn signature into a blob, or traces round each typed letter twice so
 * it reads as a font rather than a signature.
 */
export type SignatureKind = 'drawn' | 'typed'

export type MySignature = {
  id: number
  signature_path: string | null
  signature_kind: SignatureKind
  signature_updated_at: string | null
}

export function useMySignature() {
  return useQuery({
    queryKey: ['my-signature'],
    queryFn: async () => {
      const { data, error } = await rpc('track_my_signature')
      if (error) throw error
      return data as MySignature
    },
  })
}

export function useSaveMySignature() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ path, kind }: { path: string | null; kind: SignatureKind }) => {
      const { error } = await rpc('track_save_my_signature', { p_path: path, p_kind: kind })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-signature'] })
    },
  })
}

/* --------------------------------------------------- typed signatures */

/**
 * The other way to make one: type your name and pick a hand.
 *
 * ⚠️ IT PRODUCES THE SAME THING A DRAWN ONE DOES — an SVG path in the 600x200
 * box. The font is used here, in the browser, and then thrown away: nothing
 * downstream knows or cares which route a signature came from, the PDF embeds
 * no extra font, and a font removed from this list later does not change a
 * signature already saved.
 *
 * ⚠️ The files are SELF-HOSTED in public/fonts, not pulled from a CDN. The rest
 * of the app's faces already are, and a signature that silently stops rendering
 * because someone else's server moved is not worth the saving.
 *
 * To add a hand: drop a .ttf in public/fonts and add a line here. opentype.js
 * cannot read woff2, which is why these are ttf while the CSS ones are not.
 */
export const SIGNATURE_FONTS = [
  { id: 'delafield', label: 'Mrs Saint Delafield', file: '/fonts/MrsSaintDelafield-Regular.ttf' },
] as const

export type SignatureFontId = (typeof SIGNATURE_FONTS)[number]['id']

/**
 * Where the ink sits in the box.
 *
 * ⚠️ THESE ARE THE INK'S BOUNDS, not the text's advance width. Sizing by
 * advance made a long name shrink into a smudge, because the em box of a script
 * face is mostly air.
 *
 * A long name is still small on the page — the slot on the letter is 72pt wide,
 * and twenty-three characters in 72pt are twenty-three small characters. That
 * is the person's choice to make: "A Stafford" fills it, "Andrew
 * Everson-Stafford" does not.
 */
const TYPED = { width: 540, height: 130, centreY: 105 }

const cache = new Map<string, Promise<import('opentype.js').Font>>()

/**
 * ⚠️ `opentype.load()` IS DEPRECATED IN v2 AND RETURNS UNDEFINED. It does not
 * throw — the next line simply fails on undefined — so fetch and parse instead.
 */
async function loadFont(file: string) {
  let f = cache.get(file)
  if (!f) {
    f = (async () => {
      const [ot, res] = await Promise.all([import('opentype.js'), fetch(file)])
      if (!res.ok) throw new Error(`That handwriting could not be loaded (${res.status}).`)
      return ot.parse(await res.arrayBuffer())
    })()
    cache.set(file, f)
    f.catch(() => cache.delete(file))
  }
  return f
}

const round = (n: number) => {
  // ⚠️ A guard, not a formality. See the note on toPathData below.
  if (!Number.isFinite(n)) throw new Error('That name could not be written out.')
  return Math.round(n * 10) / 10
}

/**
 * The path's own `d`, built from the commands.
 *
 * ⚠️ NOT `path.toPathData()`. opentype 2.0's serialiser emits `NaN` for the
 * first control point of certain quadratic segments — twice in "A Stafford"
 * alone — while the command objects it built are perfectly finite. A `NaN` in
 * the path crashes pdf-lib deep inside its own parser, with a message about
 * reading a property of undefined and nothing pointing at the cause.
 */
function toPathData(path: import('opentype.js').Path) {
  return path.commands
    .map((c) => {
      switch (c.type) {
        case 'M':
          return `M${round(c.x)} ${round(c.y)}`
        case 'L':
          return `L${round(c.x)} ${round(c.y)}`
        case 'Q':
          return `Q${round(c.x1)} ${round(c.y1)} ${round(c.x)} ${round(c.y)}`
        case 'C':
          return `C${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} ${round(c.x)} ${round(c.y)}`
        case 'Z':
          return 'Z'
        default:
          throw new Error('That name could not be written out.')
      }
    })
    .join('')
}

/**
 * Type a name, get a path the same shape a pen would have left — scaled and
 * centred so it carries the weight on the page that a drawn one does.
 */
export async function typedSignaturePath(name: string, file: string): Promise<string> {
  const text = name.trim()
  if (!text) return ''
  const font = await loadFont(file)

  // Measure the INK at a known size, then scale so it fills the box.
  const probe = 100
  const b = font.getPath(text, 0, 0, probe).getBoundingBox()
  const w = b.x2 - b.x1
  const h = b.y2 - b.y1
  if (!(w > 0) || !(h > 0)) return ''
  const size = probe * Math.min(TYPED.width / w, TYPED.height / h)

  // Re-measure at the real size: outlines do not scale perfectly linearly, and
  // a stale box puts it off-centre.
  const at = font.getPath(text, 0, 0, size).getBoundingBox()
  const dx = (SIGNATURE_BOX.width - (at.x2 - at.x1)) / 2 - at.x1
  const dy = TYPED.centreY - (at.y1 + at.y2) / 2
  return toPathData(font.getPath(text, dx, dy, size))
}
