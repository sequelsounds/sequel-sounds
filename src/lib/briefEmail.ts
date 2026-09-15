import type { BriefDetail, BriefItem } from './briefs'
import type { Project } from './xanoMirror'

/**
 * EMAIL BRIEF's content — the old app's `brief_email_button` script, rebuilt.
 * Pure, so `scripts/verifyBriefEmail.ts` can run it without a browser.
 *
 * Recipient blank: the supervisor picks who it goes to. Budget and demo fee
 * are placeholders — the figure depends on who is emailed. The client's own
 * budget answer is deliberately left out: it is what the client told Sequel,
 * not what a supplier should see. No font is set, so the paste takes the mail
 * client's default. Answers come from a public form, so every one is escaped
 * before it goes into the HTML.
 *
 * The brief goes via the clipboard because mailto bodies are plain text and
 * truncate past about 2,000 characters; the body only carries a paste prompt.
 *
 * ⚠️ PROJECT ASSETS is not written yet. The old email lists each asset's share
 * link; the new app has no asset share links until the shared file link
 * (/link) is built. Add the section then, between TERMS and SUBMISSIONS.
 *
 * ⚠️ Uploaded briefs put the file's 7-day link first. Not here either — upload
 * brief comes with the asset upload.
 */
export function buildBriefEmail(
  d: Pick<BriefDetail, 'answers' | 'source'>,
  items: BriefItem[],
  p: Pick<
    Project,
    'brand' | 'title' | 'term' | 'territory' | 'media' | 'scripts' | 'durations' | 'cutdowns' | 'studio_inbox_link' | 'disco_inbox_link'
  >,
  isMac: boolean,
): { html: string; text: string; subject: string; prompt: string } {
  const ans = d.answers
  const briefName = ans.name || 'Brief'
  const type = ans.brief_type

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html: string[] = []
  const text: string[] = []
  const heading = (label: string) => {
    html.push(`<p><strong>${esc(label)}</strong></p>`)
    text.push(label)
  }
  const para = (s: string) => {
    html.push(`<p>${esc(s).replace(/\n/g, '<br>')}</p>`)
    text.push(s, '')
  }
  const qa = (q: string, a: string) => {
    html.push(`<p><strong>${esc(q)}</strong><br>${esc(a).replace(/\n/g, '<br>')}</p>`)
    text.push(q, a, '')
  }
  const link = (label: string, url: string) => {
    html.push(`<p>${esc(label)}: <a href="${esc(url)}">${esc(url)}</a></p>`)
    text.push(`${label}: ${url}`)
  }

  para('Hi,')
  para('Please see the brief below.')

  heading(`BRIEF: ${briefName.toUpperCase()}`)
  for (const item of items) {
    if (item.key === 'budget_note') continue
    qa(item.question, item.answer)
  }

  // Uploads have no brief type, so they always get the budget placeholder.
  if (d.source === 'upload' || type === 'Composition' || type === 'Commercial') {
    heading('BUDGET/LICENCE FEE')
    para(
      'Budget/licence fee: [ADD BUDGET/LICENCE FEE]' +
        (type === 'Composition' ? '\nDemo fee: [ADD DEMO FEE]' : ''),
    )
  }

  // The project's terms as they are now. The Terms tab saves on blur and the
  // project refetches, so these are never the page-load values the old app
  // had to work around.
  const yn = (v: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : '')
  const terms: [string, string | null][] = [
    ['Term', p.term],
    ['Territory', p.territory],
    ['Media', p.media],
    ['Scripts', p.scripts],
    ['Durations', p.durations],
    ['Cutdowns', yn(p.cutdowns)],
  ]
  const filled = terms.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
  if (filled.length) {
    heading('TERMS')
    para(filled.map(([k, v]) => `${k}: ${v}`).join('\n'))
  }

  // The Studio inbox, falling back to DISCO for projects that never got one.
  const inbox = p.studio_inbox_link || p.disco_inbox_link
  if (inbox) {
    heading('SUBMISSIONS')
    link('Please upload your submissions here', inbox)
    text.push('')
  }

  para('Thanks')

  // "Composition Brief: Vaseline - VxT - music"
  const subject =
    (type ? `${type} ` : '') +
    'Brief: ' +
    [p.brand, p.title, briefName].filter((s) => s && String(s).trim()).join(' - ')

  return {
    html: html.join(''),
    text: text.join('\r\n'),
    subject,
    prompt: `Brief copied - press ${isMac ? 'Cmd+V' : 'Ctrl+V'} to paste it here, then delete this line.`,
  }
}
