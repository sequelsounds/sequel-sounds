// The email that carries a release form.
//
// ⚠️ IT CARRIES A LINK, NOT THE PDF — Andy, 19 Sep. Attaching it as well was
// considered and rejected: a recipient opens the attachment, never touches the
// link, and every figure in track_share_events reads zero on a form that was
// read the day it arrived. The tracking is only worth having if the link is the
// one way to the document.
//
// ⚠️ EMAIL CANNOT USE CREATO DISPLAY. Outlook ignores @font-face outright and
// Gmail's clients strip it, so a web font here is a font that works in the
// preview and nowhere that matters. The face is the system stack; what carries
// the brand is the wordmark, the colours and the spacing.
//
// ⚠️ TABLES AND INLINE STYLES, deliberately, in 2026. Outlook renders through
// Word, which has no flexbox, no grid, and drops a <style> block's contents
// often enough that nothing important can live there. Every rule that matters
// is on the element.

const BROWN = '#372b29'
const BONE = '#f1f0ee'
const PAPER = '#ffffff'
const RULE = '#d8d4d0'
const MUTED = '#6b5f5c'

export type ReleaseEmail = {
  /** The sender's own words, as typed. */
  message: string
  track: string
  brand: string
  campaign: string
  term: string
  territory: string
  media: string
  scripts: string
  ref: string
  link: string
  /** Where the wordmark is served from — the app's own /public. */
  baseUrl: string
}

export function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** The typed message, as typed: a blank line starts a paragraph, a single
 *  newline breaks the line. What someone writing in a plain box expects. */
function paragraphs(message: string) {
  return esc(message)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BROWN}">${p.replace(/\n/g, '<br />')}</p>`,
    )
    .join('')
}

function termRow(label: string, value: string) {
  if (!value) return ''
  return `<tr>
<td style="padding:6px 16px 6px 0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};white-space:nowrap;vertical-align:top">${esc(label)}</td>
<td style="padding:6px 0;font-size:14px;line-height:1.5;color:${BROWN};vertical-align:top">${esc(value)}</td>
</tr>`
}

export function releaseEmailHtml(e: ReleaseEmail) {
  const terms =
    termRow('Term', e.term) +
    termRow('Territory', e.territory) +
    termRow('Media', e.media) +
    termRow('Scripts', e.scripts)

  return `<!doctype html>
<html><body style="margin:0;padding:0;background-color:${BONE}">
<!-- The preheader: what an inbox shows after the subject. Hidden in the body
     itself, which is the only way to control that line. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Release form ${esc(e.ref)} — ${esc(e.track)} for ${esc(e.brand)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BONE}">
<tr><td align="center" style="padding:32px 16px">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:${PAPER};border:1px solid ${BROWN}">

  <tr><td style="padding:28px 32px 0">
    <!-- alt text carries it when images are blocked, which is the default in
         most corporate mail. -->
    <img src="${e.baseUrl}/sequel-wordmark.png" width="96" alt="Sequel"
         style="display:block;width:96px;height:auto;border:0" />
  </td></tr>

  <tr><td style="padding:22px 32px 0">
    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED}">Music Release Form ${esc(e.ref)}</div>
    <div style="margin-top:6px;font-size:22px;line-height:1.25;font-weight:600;color:${BROWN}">${esc(e.track)}</div>
    <div style="margin-top:4px;font-size:15px;color:${MUTED}">${esc(e.brand)} — ${esc(e.campaign)}</div>
  </td></tr>

  <tr><td style="padding:22px 32px 0">
    <hr style="height:1px;margin:0;border:0;background-color:${RULE}" />
  </td></tr>

  <tr><td style="padding:22px 32px 0">${paragraphs(e.message)}</td></tr>

  ${terms
    ? `<tr><td style="padding:6px 32px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background-color:${BONE};border:1px solid ${RULE}">
      <tr><td style="padding:14px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">${terms}</table>
      </td></tr>
    </table>
  </td></tr>`
    : ''}

  <tr><td style="padding:24px 32px 0">
    <!-- Bulletproof enough: a table cell with the background, an anchor filling
         it. A background on the <a> alone disappears in Outlook. -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="background-color:${BROWN}">
        <a href="${esc(e.link)}"
           style="display:inline-block;padding:13px 28px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;letter-spacing:0.02em;color:${BONE};text-decoration:none">View release form</a>
      </td></tr>
    </table>
    <div style="margin-top:12px;font-size:12px;line-height:1.5;color:${MUTED}">
      Or paste this into your browser:<br />
      <a href="${esc(e.link)}" style="color:${MUTED}">${esc(e.link)}</a>
    </div>
  </td></tr>

  <tr><td style="padding:24px 32px 28px">
    <hr style="height:1px;margin:0 0 14px;border:0;background-color:${RULE}" />
    <div style="font-size:11px;line-height:1.6;color:${MUTED}">
      Sequel Sounds · music supervision<br />
      This link does not expire. If it stops working, reply to this email.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

/** ⚠️ NOT OPTIONAL. A message with no text/plain part scores as spam with most
 *  filters, and some clients show it empty. */
export function releaseEmailText(e: ReleaseEmail) {
  const terms = [
    e.term && `Term: ${e.term}`,
    e.territory && `Territory: ${e.territory}`,
    e.media && `Media: ${e.media}`,
    e.scripts && `Scripts: ${e.scripts}`,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    `Music Release Form ${e.ref}`,
    `${e.track} — ${e.brand}, ${e.campaign}`,
    '',
    e.message,
    '',
    terms,
    '',
    `View the release form: ${e.link}`,
    '',
    'Sequel Sounds · music supervision',
    'This link does not expire.',
  ].join('\n')
}
