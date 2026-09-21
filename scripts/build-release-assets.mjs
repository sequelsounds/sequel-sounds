#!/usr/bin/env node
// Rebuilds supabase/functions/release-form/assets.ts from the template PDF and
// the two Creato Display TTFs sitting next to it.
//
// Run this after re-exporting the release form template:
//
//   python3 scripts/strip-release-template.py \
//     "Music Release Form (blank template).pdf" \
//     supabase/functions/release-form/release-form-template.pdf
//   node scripts/build-release-assets.mjs
//
// ⚠️ THE STRIP STEP IS NOT OPTIONAL. A template that still carries its
// placeholder text leaves that text in every generated form's text layer,
// invisible on screen and perfectly readable to anything that extracts text.
// That is the fault this whole feature was built around avoiding.
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fn = join(here, '..', 'supabase', 'functions', 'release-form')

const HEADER = `// Generated — do not hand-edit. Rebuild with scripts/build-release-assets.mjs.
//
// ⚠️ WHY THESE ARE INLINED rather than sitting as files beside this one:
// every Supabase edge function deploy uploads its whole file list, and whether
// a non-code file survives that depends on how it was deployed. A release form
// that fails at runtime because an asset did not ship is a bad way to find out.
// Inlined, it either builds or it does not.
//
// Gzipped first, then base64: raw it is 192 KB of source, which is paid again
// on every single deploy. Deno unpacks it with DecompressionStream.
//
// release-form-template.pdf is Andy's own Word export with the placeholder text
// REMOVED (scripts/strip-release-template.py).
//
// Mrs Saint Delafield signs for anyone who has not drawn a signature yet. It is
// already glyf, so unlike Creato it needs no outline conversion — and it is the
// same face the Schedule A signs composer agreements in.
//
// The two Creato Display files are the letter's face. public/fonts has it as
// woff2, which fontkit cannot read, AND Creato Display is really an OTF: its
// outlines are CFF. pdf-lib embeds every font as a TrueType one, so embedding
// the CFF version makes readers report "Embedded font file may be invalid" on
// every generated form \u2014 21 times in one page, from poppler. So the outlines
// are converted to glyf first (scripts/otf2ttf.py), after which the same page
// embeds with no complaint from any reader tried.

`

const wrap = (name, b64) => {
  const lines = b64.match(/.{1,120}/g) ?? []
  return `export const ${name} =\n  '${lines.join("' +\n  '")}'\n`
}

const pack = (file) => gzipSync(readFileSync(join(fn, file)), { level: 9 }).toString('base64')

const out =
  HEADER +
  wrap('TEMPLATE_GZ_B64', pack('release-form-template.pdf')) +
  '\n' +
  wrap('CREATO_REGULAR_GZ_B64', pack('CreatoDisplay-Regular.ttf')) +
  '\n' +
  wrap('CREATO_BOLD_GZ_B64', pack('CreatoDisplay-Bold.ttf')) +
  '\n' +
  wrap('SIGNATURE_FONT_GZ_B64', pack('MrsSaintDelafield-Regular.ttf'))

writeFileSync(join(fn, 'assets.ts'), out)
console.log(`assets.ts rebuilt — ${out.length} bytes`)
