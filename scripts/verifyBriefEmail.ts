// node --experimental-strip-types scripts/verifyBriefEmail.ts
// Checks EMAIL BRIEF's content against the old app's rules. Exits 1 on a miss.
import { buildBriefEmail } from '../src/lib/briefEmail.ts'

let failed = 0
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failed++
}

const project = {
  brand: 'Vaseline', title: 'VxT ', term: '12 months', territory: 'UK', media: '', scripts: null,
  durations: '30"', cutdowns: true, studio_inbox_link: 'https://app.sequelsounds.com/inbox/abc', disco_inbox_link: 'https://disco',
}
const items = [
  { key: 'brief_type', question: 'What is your brief for?', answer: 'A bespoke composition or re-record' },
  { key: 'budget_note', question: 'Is there a budget?', answer: 'SECRET 20k' },
  { key: 'one_sentence', question: 'Elevator?', answer: 'Line one\nLine <two> & "three"' },
]
const m = buildBriefEmail({ answers: { name: 'Music', brief_type: 'Composition' }, source: 'share_link' }, items, project, true)

check('subject', m.subject === 'Composition Brief: Vaseline - VxT  - Music')
check('client budget left out (html)', !m.html.includes('SECRET'))
check('client budget left out (text)', !m.text.includes('SECRET'))
check('heading uppercased', m.html.includes('<strong>BRIEF: MUSIC</strong>'))
check('answers escaped', m.html.includes('Line &lt;two&gt; &amp; &quot;three&quot;') && !m.html.includes('<two>'))
check('line breaks kept', m.html.includes('Line one<br>Line'))
check('demo fee on composition', m.text.includes('Demo fee: [ADD DEMO FEE]'))
check('terms: blanks dropped, cutdowns Yes', m.text.includes('Term: 12 months\nTerritory: UK\nDurations: 30"\nCutdowns: Yes') && !m.text.includes('Media:'))
check('studio inbox wins over disco', m.text.includes('Please upload your submissions here: https://app.sequelsounds.com/inbox/abc') && !m.text.includes('https://disco'))
check('mac prompt', m.prompt.includes('Cmd+V'))

const lib = buildBriefEmail({ answers: { name: 'X', brief_type: 'Library' }, source: 'share_link' }, [], { ...project, studio_inbox_link: null, cutdowns: null, term: null, territory: null, durations: null }, false)
check('no budget on library', !lib.text.includes('BUDGET'))
check('no terms when none', !lib.text.includes('TERMS'))
check('disco fallback', lib.text.includes('https://disco'))
check('windows prompt', lib.prompt.includes('Ctrl+V'))

const com = buildBriefEmail({ answers: { name: 'Y', brief_type: 'Commercial' }, source: 'share_link' }, [], project, true)
check('commercial: budget, no demo fee', com.text.includes('BUDGET/LICENCE FEE') && !com.text.includes('Demo fee'))

const up = buildBriefEmail(
  { answers: { name: 'Upload' }, source: 'upload' }, [], project, true,
  { file: { name: 'brief.pdf', url: 'https://s3/x' }, assets: [{ label: 'Deck', link: 'https://app/link?id=abc' }] },
)
check('upload: file link first', up.text.indexOf('The brief (brief.pdf): https://s3/x') > up.text.indexOf('BRIEF: UPLOAD') && up.text.indexOf('The brief') < up.text.indexOf('BUDGET'))
check('upload: budget placeholder', up.text.includes('BUDGET/LICENCE FEE') && !up.text.includes('Demo fee'))
check('assets between terms and submissions', up.text.indexOf('TERMS') < up.text.indexOf('PROJECT ASSETS') && up.text.indexOf('PROJECT ASSETS') < up.text.indexOf('SUBMISSIONS'))
check('asset link line', up.text.includes('Deck: https://app/link?id=abc'))
check('no assets section when none', !m.text.includes('PROJECT ASSETS'))

process.exit(failed ? 1 : 0)
