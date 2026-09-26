#!/usr/bin/env node
// Rebuilds supabase/functions/composition-licence/assets.ts from the stripped
// template and the two Roboto Condensed TTFs sitting next to it.
//
// After Andy re-exports the licence from Word:
//
//   python3 scripts/strip-licence-template.py \
//     "Claude outputs/Composition Licence (template).pdf"
//   node scripts/build-licence-assets.mjs
//
// ⚠️ THE STRIP STEP IS NOT OPTIONAL — it is also what re-measures layout.ts.
// A re-export moves things; drawing at the old coordinates would misplace
// every value on the certificate and the schedule.
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fn = join(here, '..', 'supabase', 'functions', 'composition-licence')

const HEADER = `// Generated — do not hand-edit. Rebuild with scripts/build-licence-assets.mjs.
//
// Inlined for the same reason as release-form/assets.ts: a deploy either
// carries these or does not build, rather than failing at runtime.
//
// licence-template.pdf is Andy's own Word export (25 Sep 2026) with the
// placeholder text REMOVED by scripts/strip-licence-template.py.
//
// Roboto Condensed is the licence's body face. These are the Google Fonts
// TTFs (already glyf, so no outline conversion is needed, unlike Creato).
// ⚠️ They are a slightly different build from the copy on Andy's Mac that Word
// embedded — glyphs run ~2-4% wider — so a drawn value is a hair wider than
// Word would have set it. Values start exactly where the placeholders did.

`

const wrap = (name, b64) => {
  const lines = b64.match(/.{1,120}/g) ?? []
  return `export const ${name} =\n  '${lines.join("' +\n  '")}'\n`
}
const pack = (file) => gzipSync(readFileSync(join(fn, file)), { level: 9 }).toString('base64')

const out =
  HEADER +
  wrap('TEMPLATE_GZ_B64', pack('licence-template.pdf')) +
  '\n' +
  wrap('ROBOTO_REGULAR_GZ_B64', pack('RobotoCondensed-Regular.ttf')) +
  '\n' +
  wrap('ROBOTO_BOLD_GZ_B64', pack('RobotoCondensed-Bold.ttf'))

writeFileSync(join(fn, 'assets.ts'), out)
console.log(`assets.ts rebuilt — ${out.length} bytes`)
