// roster-onboarding — adding a composition team, and its composer agreement.
//
// Andy, 24 Sep 2026: a team is added by email only. It fills in its own
// details on a form, and only then can it be opened in the app. Staff request
// the composer agreement; Andy reviews it and signs for Sequel; only then is
// it emailed to the team, who sign it on Sequel's own page. The signed PDF is
// stored in S3 under contracts/ and the team's Composer Agreement becomes
// Complete. This replaces adding teams by hand and BoldSign.
//
// Staff (a signed-in staff session):
//   { action: "invite", email, kind? }            -> { uuid, emailed, email_error? }
//                                                   kind "partner" onboards a partner (no agreement)
//   { action: "resend_invite", supplier_id }      -> { emailed, email_error? }
//   { action: "request_agreement", supplier_id }  -> { stage }
//   { action: "preview", supplier_id }            -> { pdf (base64), stage, can_sign, consent }
//   { action: "company_sign", supplier_id, name, consent }   (the signatory only)
//                                                 -> { stage, emailed, email_error? }
//   { action: "resend_agreement", supplier_id }   -> { emailed, email_error? }
//   { action: "document", supplier_id }           -> { url }  the signed copy, 10 minutes
//
// Public (the team; a 48-hex token is the only credential):
//   { action: "form", token }                     -> { state, email?, countries?, regions?, fields? }
//   { action: "form_submit", token, fields }      -> { state, error? }
//   { action: "agreement", token }                -> { state, agreement? }
//   { action: "agreement_sign", token, name, consent, details_hash } -> { state, error?, agreement? }
//
// state is one of: invalid · open · sign · done.
//
// The signatory is andy@sequelsounds.com (Andy, 24 Sep: "it will be me that
// signs it", and he sees every agreement before it goes). Override with the
// secret AGREEMENT_SIGNATORY_EMAIL.
//
// Secrets: RESEND_API_KEY; S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID,
// S3_SECRET_ACCESS_KEY (the signer the contracts use — the file goes under
// contracts/, which it may already write). Nothing here returns or logs a key.

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { loadFonts } from '../song-schedule-a/pdf.ts'
import { londonTime } from '../song-schedule-a/pdf.ts'
import { buildAgreement, ukDay, type AgreementDetails, type Signer } from './pdf.ts'

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, any, any>

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
async function inBackground(p: Promise<unknown>): Promise<void> {
  const settled = p.catch((e) => console.error('background task failed', (e as Error).message))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(settled)
  else await settled
}

const RESEND_API = 'https://api.resend.com/emails'
const EMAIL_FROM = 'Sequel <registrations@sequelsounds.com>'
// The three emails as Resend templates (Andy, 24 Sep: "it should be in
// resend"), so the wording can be changed in Resend with no deploy. Readable
// copies: Claude outputs/roster-*-template.html. Published 24 Sep as "Roster
// invite", "Composer agreement" and "Composer agreement signed". A secret of
// the same name overrides an id; an empty one falls back to the email built
// here (sequelEmail below).
// ⚠️ Their variables have no fallbacks: every send passes every variable.
const TEMPLATE = {
  invite: Deno.env.get('ROSTER_INVITE_TEMPLATE_ID') ?? '9950ae48-fa23-47bf-81ed-7ed7aa3cabb2',
  agreement: Deno.env.get('ROSTER_AGREEMENT_TEMPLATE_ID') ?? '74a0aca0-66ad-40e5-8e2f-24c83a2d9888',
  signed: Deno.env.get('ROSTER_SIGNED_TEMPLATE_ID') ?? 'e397037e-a9d4-408f-b633-da14f3340bc2',
  // To Andy when someone else requests an agreement (Andy, 24 Sep).
  toSign: Deno.env.get('ROSTER_TO_SIGN_TEMPLATE_ID') ?? 'c92d53e5-a67a-40da-bd52-56a74845f8d5',
  // Navy, for partners (Andy, 25 Sep). Alias partner-invite.
  partnerInvite: Deno.env.get('PARTNER_INVITE_TEMPLATE_ID') ?? '57556970-86a3-437b-b7e3-4ecd0188368f',
}
const useTemplate = (id: string, variables: Record<string, string>) => (id ? { id, variables } : undefined)

// Replies to every roster email go to support@ (Andy, 24 Sep), not to
// whoever pressed the button.
const REPLY_TO = 'support@sequelsounds.com'
const COMPOSITION_TEAM = 'Composition Team'

// Partners (every supplier that is not a composition team) are onboarded the
// same way since 25 Sep 2026 (Andy): an email, then their own form at
// /join-partner/:token. They pick their own type there, so an invited partner
// has none yet. There is no agreement step for partners.
const PARTNER_TYPES = [
  'Agent',
  'Manager',
  'Publisher',
  'Label',
  'MCPS Library',
  'Non-MCPS Library',
  'Sync Rep',
  'Partner Library',
  'Musicologist',
] as const
type Kind = 'roster' | 'partner'
const joinPath = (k: Kind) => (k === 'roster' ? '/join-roster/' : '/join-partner/')
const CONSENT =
  'I agree to sign this agreement electronically, and that typing my name here is my signature.'
const SIGNATORY = (Deno.env.get('AGREEMENT_SIGNATORY_EMAIL') ?? 'andy@sequelsounds.com').toLowerCase()

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
]

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

/** Service role, on the mirror schema: the table this all writes. */
const admin = (): Client =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
    db: { schema: 'xano_mirror' },
  })

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

type Staff = { id: number | null; email: string; name: string }

/** The caller, if they are signed-in Sequel staff. The database decides. */
async function staffCaller(req: Request): Promise<Staff | null> {
  const jwt = bearer(req)
  if (!jwt) return null
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: staff, error } = await caller.rpc('track_is_staff')
  if (error || staff !== true) return null
  const { data: user } = await caller.auth.getUser(jwt)
  const { data: id } = await caller.rpc('track_user_id')
  const email = (user?.user?.email ?? '').toLowerCase()
  const { data: me } = await admin().schema('public').from('track_users').select('full_name').ilike('email', email).maybeSingle()
  return {
    id: typeof id === 'number' ? id : Number(id) || null,
    email,
    name: ((me as { full_name: string | null } | null)?.full_name ?? '').trim() || email,
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TOKEN_RE = /^[0-9a-f]{48}$/

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function appOrigin(req: Request): string {
  const origin = req.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) return origin
  return (Deno.env.get('APP_BASE_URL') ?? 'https://app.sequelsounds.com').replace(/\/+$/, '')
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (req.headers.get('cf-connecting-ip') ?? forwarded ?? req.headers.get('x-real-ip') ?? '').slice(0, 100)
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ------------------------------------------------------------------ data

type Team = {
  id: number
  uuid: string
  title: string | null
  supplier_type: string | null
  brief_email: string | null
  contract_email: string | null
  legal_name: string | null
  business_address: string | null
  onboarding_status: string | null
  agreement_stage: string | null
  ca_status: string | null
  ca_pdf_key: string | null
  status: string | null
}
const TEAM_COLS =
  'id, uuid, title, supplier_type, brief_email, contract_email, legal_name, business_address, onboarding_status, agreement_stage, ca_status, ca_pdf_key, status'

type Onboarding = {
  supplier_id: number
  invite_token: string | null
  invite_email: string | null
  invited_by: number | null
  agreement_uuid: string | null
  agreement_token: string | null
  requested_by: number | null
  details: AgreementDetails | null
  company_name: string | null
  company_signed_at: string | null
  company_ip: string | null
  company_agent: string | null
  sent_to: string | null
}

async function teamById(db: Client, id: unknown): Promise<Team | null> {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return null
  const { data } = await db.from('supplier_list').select(TEAM_COLS).eq('id', n).maybeSingle()
  return (data as Team | null) ?? null
}

const onboarding = (db: Client) => db.schema('public').from('track_roster_onboarding')

async function onboardingFor(db: Client, supplierId: number): Promise<Onboarding | null> {
  const { data } = await onboarding(db).select('*').eq('supplier_id', supplierId).maybeSingle()
  return (data as Onboarding | null) ?? null
}

async function byToken(db: Client, column: 'invite_token' | 'agreement_token', token: unknown) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  const { data } = await onboarding(db).select('*').eq(column, token).maybeSingle()
  if (!data) return null
  const team = await teamById(db, (data as Onboarding).supplier_id)
  return team ? { row: data as Onboarding, team } : null
}

async function signatoryId(db: Client): Promise<number | null> {
  const { data } = await db.schema('public').from('track_users').select('id').ilike('email', SIGNATORY).maybeSingle()
  return (data as { id: number } | null)?.id ?? null
}

/** Never throws: a notification must not break the thing it reports. */
async function notify(db: Client, userId: number | null, kind: string, message: string, team: Team, link: string) {
  if (!userId) return
  const { error } = await db.schema('public').rpc('track_notify', {
    p_user: userId,
    p_kind: kind,
    p_message: message,
    p_project: null,
    p_subject_kind: 'supplier',
    p_subject: team.uuid,
    p_link: link,
    p_refresh: true,
  })
  if (error) console.warn('notify failed', kind, error.message)
}

const kindOf = (t: Team): Kind => (t.supplier_type === COMPOSITION_TEAM ? 'roster' : 'partner')
const teamName = (t: Team) => (t.title ?? '').trim() || t.brief_email || 'A composition team'
const sendTo = (t: Team) => t.contract_email || t.brief_email

// ---------------------------------------------------------------- email

async function sendEmail(msg: {
  to: string
  subject: string
  html: string
  text: string
  /** A Resend template, when one is set up: then html/text are not sent. */
  template?: { id: string; variables: Record<string, string> }
  replyTo?: string
  bcc?: string[]
  attachments?: { filename: string; content: string }[]
}): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 'The email could not be sent: RESEND_API_KEY is not set on the server.'
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        ...(msg.template ? { template: msg.template } : { html: msg.html, text: msg.text }),
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        ...(msg.bcc?.length ? { bcc: msg.bcc } : {}),
        ...(msg.attachments ? { attachments: msg.attachments } : {}),
      }),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      console.error('resend failed', res.status, detail)
      return `The email could not be sent (Resend ${res.status}): ${detail}`
    }
    return null
  } catch (e) {
    return `The email could not be sent: ${(e as Error).message}`
  }
}

// The emails are the release form's Resend template (Andy, 24 Sep: "style
// that like the release form template"), built here rather than kept in
// Resend: same shell, wordmark, sage panel, bordered brown button (the whole
// button is the link, Andy 24 Sep, not just its letters), "Button not
// working?" line and footer mark. Only the words change per email.
const P =
  "color:#372b29; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 400; line-height: 24px; letter-spacing: -0.3px; text-align:left;"

function sequelEmail(o: {
  title: string
  greeting: string
  /** HTML, already escaped. Each is one paragraph. */
  before: string[]
  button?: { label: string; url: string }
  after?: string[]
}): string {
  const row = (html: string, pad: string) => `<tr><td class="mlh-15" style="${P} ${pad}">${html}</td></tr>`
  const url = o.button ? escapeHtml(o.button.url) : ''
  const button = o.button
    ? `<tr><td align="left" style="padding-top: 32px;"><table border="0" cellspacing="0" cellpadding="0"><tr><td bgcolor="#372b29" style="padding: 2px;"><a href="${url}" target="_blank" style="display: inline-block; border: 1px solid #D0DBCD; padding: 12px 30px; color:#D0DBCD; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 400; line-height: 16px; letter-spacing: 2px; text-transform: uppercase; text-decoration: none;">${escapeHtml(o.button.label)}</a></td></tr></table></td></tr>`
    : ''
  const body = [
    row(o.greeting, 'padding-bottom: 20px;'),
    ...o.before.map((h, i) => row(h, i < o.before.length - 1 ? 'padding-bottom: 20px;' : '')),
    button,
    ...(o.after ?? []).map((h) => row(h, 'padding-top: 26px;')),
    row('Thanks,<br />Sequel', 'padding-top: 26px;'),
    o.button
      ? `<tr><td align="left" style="padding-top: 30px; color:#372b29; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 400; line-height: 16px; letter-spacing: -0.2px; text-align:left;">Button not working? <a href="${url}" target="_blank" style="color:#372b29; text-decoration: underline;">Click here instead.</a></td></tr>`
      : '',
  ].join('')

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${escapeHtml(o.title)}</title>
<style type="text/css" media="screen">
body { padding:0 !important; margin:0 auto !important; display:block !important; min-width:100% !important; width:100% !important; background:#fffffe; -webkit-text-size-adjust:none }
a { color:#372b29; text-decoration:none }
p { margin:0 !important }
table { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { margin: 0 !important; -ms-interpolation-mode: bicubic; }
img, a img { border:0; outline:none; text-decoration:none; }
strong { font-weight: 700; }
@media only screen and (max-device-width: 480px), only screen and (max-width: 480px) {
.mpx-15 { padding-left: 15px !important; padding-right: 15px !important; }
.mpt-30 { padding-top: 30px !important; }
.mpy-50 { padding-top: 50px !important; padding-bottom: 50px !important; }
.mlh-15 { line-height: 22px !important; }
.td, .m-shell { width: 100% !important; min-width: 100% !important; }
.fluid-img img { width: 100% !important; max-width: 100% !important; height: auto !important; }
}
</style>
</head>
<body class="body" id="body" style="padding:0 !important; margin:0 auto !important; display:block !important; min-width:100% !important; width:100% !important; background:#fffffe; -webkit-text-size-adjust:none;">
<center>
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0; padding: 0; width: 100%; height: 100%;" bgcolor="#fffffe">
<tr><td style="margin: 0; padding: 0; width: 100%; height: 100%;" align="center" valign="top">
<table width="640" border="0" cellspacing="0" cellpadding="0" class="m-shell">
<tr><td bgcolor="#372b29" style="font-size:0pt; line-height:0pt; height:8px;">&nbsp;</td></tr>
<tr><td class="td" bgcolor="#D0DBCD" style="width:640px; min-width:640px; font-size:0pt; line-height:0pt; padding:0; margin:0; font-weight:normal; border-left: 2px solid #372b29; border-right: 2px solid #372b29;">
<table width="100%" border="0" cellspacing="0" cellpadding="0">
<tr><td class="mpx-15 mpt-30 fluid-img" style="font-size:0pt; line-height:0pt; text-align:left; padding-left: 45px; padding-right: 45px; padding-top: 45px; padding-bottom: 40px;"><a href="https://sequelsounds.com/" target="_blank"><img src="https://sequel-sounds-email-assets.s3.eu-west-2.amazonaws.com/sequel-email-wordmark.png" width="610" height="124" border="0" alt="SEQUEL" /></a></td></tr>
<tr><td class="mpx-15 mpy-50" style="font-size:0pt; line-height:0pt; text-align:left; padding-left: 45px; padding-right: 45px; padding-top: 0px; padding-bottom: 44px;">
<table width="100%" border="0" cellspacing="0" cellpadding="0">${body}</table>
</td></tr>
<tr><td bgcolor="#372b29" style="font-size:0pt; line-height:0pt; text-align:center; padding-top: 22px; padding-bottom: 22px; padding-left: 15px; padding-right: 15px;"><a href="https://sequelsounds.com/" target="_blank"><img src="https://sequel-sounds-email-assets.s3.eu-west-2.amazonaws.com/sequel-email-footer-logo.png" width="37" height="36" border="0" alt="Sequel" /></a></td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</center>
</body>
</html>`
}

function inviteEmail(to: string, url: string, replyTo: string, kind: Kind = 'roster') {
  if (kind === 'partner') {
    // The navy "Partner invite" Resend template (Andy, 25 Sep); the html
    // below is only the fallback if no template id is set.
    return sendEmail({
      to,
      replyTo: REPLY_TO,
      bcc: [replyTo],
      subject: 'Work with Sequel | Add your details',
      template: useTemplate(TEMPLATE.partnerInvite, { details_url: url }),
      html: sequelEmail({
        title: 'Work with Sequel',
        greeting: 'Hey there!',
        before: [
          'We&rsquo;d like to add you to <strong style="font-weight: 700;">Sequel&rsquo;s partners</strong>. Please add your company&rsquo;s details using the button below.',
        ],
        button: { label: 'Add your details', url },
        after: ['Any questions, just reply to this email.'],
      }),
      text: `Hey there!\n\nWe'd like to add you to Sequel's partners. Please add your company's details here:\n${url}\n\nAny questions, just reply to this email.\n\nThanks,\nSequel`,
    })
  }
  return sendEmail({
    to,
    replyTo: REPLY_TO,
    bcc: [replyTo],
    subject: 'Join the Sequel roster | Add your details',
    template: useTemplate(TEMPLATE.invite, { details_url: url }),
    html: sequelEmail({
      title: 'Join the Sequel roster',
      greeting: 'Hey there!',
      before: [
        'We&rsquo;d like to add you to the <strong style="font-weight: 700;">Sequel composition roster</strong>. Please add your details using the button below.',
      ],
      button: { label: 'Add your details', url },
      after: ['Any questions, just reply to this email.'],
    }),
    text: `Hey there!\n\nWe'd like to add you to the Sequel composition roster. Please add your details here:\n${url}\n\nAny questions, just reply to this email.\n\nThanks,\nSequel`,
  })
}

/** To Andy: someone else asked for an agreement, and it is his to sign. */
async function toSignEmail(db: Client, t: Team, requestedBy: string, url: string) {
  const { data } = await db.schema('public').from('track_users').select('full_name').ilike('email', SIGNATORY).maybeSingle()
  const first = ((data as { full_name: string | null } | null)?.full_name ?? '').trim().split(/\s+/)[0] || 'there'
  const team = teamName(t)
  return sendEmail({
    to: SIGNATORY,
    subject: `To sign | Composer agreement for ${team}`,
    template: useTemplate(TEMPLATE.toSign, {
      signatory_first_name: first,
      requested_by: requestedBy,
      team_name: team,
      review_url: url,
    }),
    html: sequelEmail({
      title: 'Composer agreement to sign',
      greeting: `Hi ${escapeHtml(first)},`,
      before: [
        `${escapeHtml(requestedBy)} has asked for a <strong style="font-weight: 700;">composer agreement</strong> with <strong style="font-weight: 700;">${escapeHtml(team)}</strong>.`,
        'Please check it and sign it for Sequel using the button below. It goes to them to sign as soon as you have.',
      ],
      button: { label: 'Review and sign', url },
    }),
    text: `Hi ${first},\n\n${requestedBy} has asked for a composer agreement with ${team}.\n\nPlease check it and sign it for Sequel here. It goes to them to sign as soon as you have:\n${url}\n\nThanks,\nSequel`,
  })
}

function agreementEmail(t: Team, to: string, url: string) {
  const name = teamName(t)
  return sendEmail({
    to,
    replyTo: REPLY_TO,
    subject: 'Action needed | Sign your Sequel composer agreement',
    template: useTemplate(TEMPLATE.agreement, { team_name: name, sign_url: url }),
    html: sequelEmail({
      title: 'Composer agreement',
      greeting: `Hi ${escapeHtml(name)},`,
      before: [
        'Here&rsquo;s your <strong style="font-weight: 700;">composer agreement</strong> with Sequel.',
        'We&rsquo;ve signed it already. Please read it through, then sign it using the button below.',
      ],
      button: { label: 'Review and sign', url },
      after: ['Any questions, just reply to this email.'],
    }),
    text: `Hi ${name},\n\nHere's your composer agreement with Sequel. We've signed it already. Please read it through, then sign it here:\n${url}\n\nAny questions, just reply to this email.\n\nThanks,\nSequel`,
  })
}

// ------------------------------------------------------------- agreement

/** The hash of exactly what the composer was shown. Fixed key order. */
function detailsHash(d: AgreementDetails, company: Signer): Promise<string> {
  return sha256Hex(
    JSON.stringify([d.team, d.legalName, d.businessAddress, d.agreementDate, company.name, company.signedAt.toISOString()]),
  )
}

function companySigner(row: Onboarding): Signer | null {
  if (!row.company_name || !row.company_signed_at) return null
  return {
    name: row.company_name,
    signedAt: new Date(row.company_signed_at),
    email: SIGNATORY,
    ip: row.company_ip ?? '',
    userAgent: row.company_agent ?? '',
  }
}

/** What the team's details would print as today (before Sequel signs). */
function draftDetails(t: Team): AgreementDetails {
  return {
    team: teamName(t),
    legalName: (t.legal_name ?? '').trim(),
    businessAddress: (t.business_address ?? '').trim(),
    agreementDate: ukDay(new Date()),
  }
}

function s3() {
  const bucket = Deno.env.get('S3_BUCKET') ?? ''
  const region = Deno.env.get('S3_REGION') ?? ''
  const accessKeyId = Deno.env.get('S3_ACCESS_KEY_ID') ?? ''
  const secretAccessKey = Deno.env.get('S3_SECRET_ACCESS_KEY') ?? ''
  if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error('S3 is not configured on the server.')
  const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' })
  const url = (key: string) =>
    new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`)
  return { aws, url }
}

const KEY_RE = /^contracts\/[0-9a-f-]{36}_[^/\\]+$/

async function signedGet(key: string): Promise<string> {
  if (!KEY_RE.test(key)) throw new Error('That is not an agreement file.')
  const { aws, url } = s3()
  const target = url(key)
  target.searchParams.set('X-Amz-Expires', '600')
  const signed = await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })
  return signed.url
}

async function agreementPayload(db: Client, t: Team, row: Onboarding) {
  const company = companySigner(row)
  if (!company || !row.details) return null
  void inBackground(loadFonts())
  const pdf = await buildAgreement(row.details, await loadFonts(), company)
  return {
    pdf: bytesToB64(pdf),
    team: row.details.team,
    legal_name: row.details.legalName,
    email: row.sent_to ?? sendTo(t),
    consent: CONSENT,
    details_hash: await detailsHash(row.details, company),
  }
}

type SignResult = { state: 'done' } | { state: 'sign'; error: string }

async function composerSign(db: Client, req: Request, t: Team, row: Onboarding, body: Record<string, unknown>): Promise<SignResult> {
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
  if (name.length < 2 || name.length > 120 || !/\p{L}/u.test(name)) {
    return { state: 'sign', error: 'Please type your full name to sign.' }
  }
  if (body.consent !== true) return { state: 'sign', error: 'Please tick the box to agree to sign electronically.' }

  const company = companySigner(row)
  if (!company || !row.details || !row.agreement_uuid) throw new Error('agreement not signed by Sequel')
  const hash = await detailsHash(row.details, company)
  if (body.details_hash !== hash) {
    return { state: 'sign', error: 'This agreement has changed since the page loaded. Please read it again, then sign.' }
  }

  const signedAt = new Date()
  const composer: Signer = {
    name,
    signedAt,
    email: row.sent_to ?? '',
    ip: clientIp(req),
    userAgent: (req.headers.get('user-agent') ?? '').slice(0, 500),
  }
  const pdf = await buildAgreement(row.details, await loadFonts(), company, composer, {
    reference: row.agreement_uuid,
    consent: CONSENT,
    detailsHash: hash,
    sentTo: row.sent_to ?? '',
  })
  const pdfHash = await sha256Hex(pdf)

  // contracts/, which the signer already writes: the agreement is a contract.
  const safe = row.details.legalName.replace(/[^\p{L}\p{N} ()&.,'-]+/gu, '').trim().slice(0, 80) || 'Composer'
  const key = `contracts/${row.agreement_uuid}_Composer Agreement - ${safe}.pdf`
  const { aws, url } = s3()
  const put = await aws.fetch(url(key).toString(), {
    method: 'PUT',
    body: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
    headers: { 'Content-Type': 'application/pdf' },
  })
  if (!put.ok) throw new Error(`storing the signed agreement failed (S3 ${put.status}): ${(await put.text()).slice(0, 200)}`)

  const { data: marked, error: markErr } = await db
    .from('supplier_list')
    .update({
      ca_status: 'Complete',
      ca_pdf_key: key,
      ca_signed_at: signedAt.toISOString(),
      agreement_stage: null,
    })
    .eq('id', t.id)
    .eq('agreement_stage', 'awaiting_composer')
    .select('id')
  if (markErr) throw new Error(`signed, but saving it failed: ${markErr.message}`)
  if (!marked || marked.length === 0) return { state: 'done' } // another tab signed first

  await onboarding(db)
    .update({
      composer_name: name,
      composer_signed_at: signedAt.toISOString(),
      composer_ip: composer.ip || null,
      composer_agent: composer.userAgent || null,
      consent: CONSENT,
      details_sha256: hash,
      pdf_sha256: pdfHash,
      pdf_key: key,
    })
    .eq('supplier_id', t.id)

  const link = `/roster/${t.uuid}`
  const message = `${teamName(t)} signed the composer agreement.`
  await notify(db, await signatoryId(db), 'agreement_signed', message, t, link)
  if (row.requested_by) await notify(db, row.requested_by, 'agreement_signed', message, t, link)

  // The signer sees "done" at once; the copy follows.
  await inBackground(
    (async () => {
      const error = await sendEmail({
        to: row.sent_to ?? '',
        bcc: [SIGNATORY],
        replyTo: REPLY_TO,
        subject: 'Your signed composer agreement | Sequel',
        template: useTemplate(TEMPLATE.signed, {
          team_name: row.details!.team || 'there',
          signer_name: name,
          signed_at: londonTime(signedAt),
        }),
        html: sequelEmail({
          title: 'Your signed composer agreement',
          greeting: `Hi ${escapeHtml(row.details!.team || 'there')},`,
          before: [
            'Thanks for signing. Your <strong style="font-weight: 700;">composer agreement</strong> with Sequel is attached.',
            `Signed by ${escapeHtml(name)} on ${escapeHtml(londonTime(signedAt))}.`,
          ],
          after: ['Welcome to the Sequel roster. Any questions, just reply to this email.'],
        }),
        text: `Hi ${row.details!.team || 'there'},\n\nThanks for signing. Your composer agreement with Sequel is attached.\n\nSigned by ${name} on ${londonTime(signedAt)}.\n\nWelcome to the Sequel roster. Any questions, just reply to this email.\n\nThanks,\nSequel`,
        attachments: [{ filename: `Sequel Composer Agreement - ${safe}.pdf`, content: bytesToB64(pdf) }],
      })
      await onboarding(db).update({ signed_copy_error: error }).eq('supplier_id', t.id)
    })(),
  )
  return { state: 'done' }
}

// ------------------------------------------------------------------ form

const FIELDS = {
  title: 200,
  legal_name: 200,
  business_address: 600,
  brief_email: 200,
  contract_email: 200,
  finance_email: 200,
  phone_number: 60,
  website: 300,
  city: 120,
  bio: 600,
  studio_setup: 2000,
  strengths: 1000,
  stand_out_work: 2000,
  composition_showreel: 500,
  sounddesign_showreel: 500,
  library_link: 500,
} as const
type FieldName = keyof typeof FIELDS
const EMAIL_FIELDS: FieldName[] = ['brief_email', 'contract_email', 'finance_email']
const REQUIRED: [FieldName, string][] = [
  ['title', 'your team or company name'],
  ['legal_name', 'the legal name the agreement is made with'],
  ['business_address', 'your business address'],
  ['brief_email', 'a contact email'],
]

// The partner form (Andy, 25 Sep 2026): at least one creative, one clearance
// and one finance contact, plus the name and the type they pick.
const PARTNER_FIELDS = {
  title: 200,
  supplier_type: 60,
  bio: 600,
  strengths: 1000,
  brief_email: 200,
  contract_email: 200,
  finance_email: 200,
  phone_number: 60,
  website: 300,
  city: 120,
  creative_team_member_1_name: 200,
  creative_team_member_1_email: 200,
  creative_team_member_2_name: 200,
  creative_team_member_2_email: 200,
  creative_team_member_3_name: 200,
  creative_team_member_3_email: 200,
  clearance_contact_name_1: 200,
  clearance_contact_email_1: 200,
  clearance_contact_name_2: 200,
  clearance_contact_email_2: 200,
} as const
const PARTNER_REQUIRED: [string, string][] = [
  ['title', 'your company name'],
  ['supplier_type', 'what kind of company you are'],
  ['creative_team_member_1_name', 'a creative contact'],
  ['creative_team_member_1_email', "your creative contact's email"],
  ['clearance_contact_name_1', 'a clearance contact'],
  ['clearance_contact_email_1', "your clearance contact's email"],
  ['finance_email', 'a finance email'],
]
const PARTNER_EMAIL_FIELDS = [
  'brief_email',
  'contract_email',
  'finance_email',
  'creative_team_member_1_email',
  'creative_team_member_2_email',
  'creative_team_member_3_email',
  'clearance_contact_email_1',
  'clearance_contact_email_2',
]

const fieldsFor = (kind: Kind): Record<string, number> => (kind === 'roster' ? FIELDS : PARTNER_FIELDS)

async function formPayload(db: Client, t: Team, row: Onboarding) {
  const kind = kindOf(t)
  const [{ data: countries }, { data: full }] = await Promise.all([
    db.from('countries_list').select('id, country').order('country'),
    db
      .from('supplier_list')
      .select(`${Object.keys(fieldsFor(kind)).join(', ')}, countries_list_id, regions_id`)
      .eq('id', t.id)
      .single(),
  ])
  const fields = { ...(full as unknown as Record<string, unknown>) }
  // The row is titled with the email until the team names itself.
  if (fields.title === row.invite_email) fields.title = ''
  return {
    kind,
    email: row.invite_email,
    countries: countries ?? [],
    fields,
    ...(kind === 'partner' ? { types: PARTNER_TYPES } : {}),
  }
}

function cleanFields(raw: unknown, kind: Kind): { patch: Record<string, unknown>; error?: string } {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const [name, max] of Object.entries(fieldsFor(kind))) {
    const v = typeof f[name] === 'string' ? (f[name] as string).trim() : ''
    patch[name] = v ? v.slice(0, max) : null
  }
  const required = kind === 'roster' ? REQUIRED : PARTNER_REQUIRED
  for (const [name, label] of required) if (!patch[name]) return { patch, error: `Please add ${label}.` }
  const emails: string[] = kind === 'roster' ? EMAIL_FIELDS : PARTNER_EMAIL_FIELDS
  for (const name of emails) {
    if (patch[name] && !EMAIL_RE.test(patch[name] as string)) return { patch, error: `“${patch[name]}” is not an email address.` }
  }
  if (kind === 'partner' && !(PARTNER_TYPES as readonly string[]).includes(patch.supplier_type as string)) {
    return { patch, error: 'Please choose what kind of company you are.' }
  }
  if (!patch.contract_email) patch.contract_email = patch.brief_email
  const country = Number(f.countries_list_id)
  patch.countries_list_id = Number.isInteger(country) && country > 0 ? country : null
  return { patch }
}

// --------------------------------------------------------------- handler

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad request' }, 400, origin)
  }
  const db = admin()
  const action = String(body.action ?? '')

  try {
    // ------------------------------------------------------------ staff
    if (
      ['invite', 'resend_invite', 'request_agreement', 'preview', 'company_sign', 'resend_agreement', 'document'].includes(action)
    ) {
      const me = await staffCaller(req)
      if (!me) return json({ error: 'Staff only.' }, 403, origin)
      const isSignatory = me.email === SIGNATORY

      if (action === 'invite') {
        const kind: Kind = body.kind === 'partner' ? 'partner' : 'roster'
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        if (!EMAIL_RE.test(email)) return json({ error: 'Please enter an email address.' }, 400, origin)
        const { data: sameEmail } = await db
          .from('supplier_list')
          .select('id, title, supplier_type')
          .eq('status', 'Active')
          .or(`brief_email.ilike.${email},contract_email.ilike.${email}`)
        // A clash is the same email on the same side: a roster team, or a partner.
        const clash = ((sameEmail ?? []) as { title: string; supplier_type: string | null }[]).filter(
          (r) => (r.supplier_type === COMPOSITION_TEAM) === (kind === 'roster'),
        )
        if (clash && clash.length) {
          return json({ error: `${(clash[0] as { title: string }).title} already uses that email.` }, 400, origin)
        }
        const { data: created, error } = await db
          .from('supplier_list')
          .insert(
            kind === 'roster'
              ? {
                  title: email,
                  supplier_type: COMPOSITION_TEAM,
                  brief_email: email,
                  contract_email: email,
                  ca_status: 'Not Sent',
                  onboarding_status: 'Invited',
                }
              : { title: email, supplier_type: null, brief_email: email, onboarding_status: 'Invited' },
          )
          .select(TEAM_COLS)
          .single()
        if (error || !created) return json({ error: error?.message ?? 'The team could not be added.' }, 400, origin)
        const team = created as Team
        const token = newToken()
        const emailError = await inviteEmail(email, `${appOrigin(req)}${joinPath(kind)}${token}`, me.email, kind)
        await onboarding(db).insert({
          supplier_id: team.id,
          invite_token: token,
          invite_email: email,
          invited_by: me.id,
          invited_at: new Date().toISOString(),
          invite_email_error: emailError,
        })
        return json({ uuid: team.uuid, emailed: !emailError, email_error: emailError ?? undefined }, 200, origin)
      }

      const team = await teamById(db, body.supplier_id)
      if (!team) return json({ error: 'Team not found.' }, 404, origin)
      const row = await onboardingFor(db, team.id)

      if (action === 'resend_invite') {
        if (team.onboarding_status !== 'Invited' || !row?.invite_token || !row.invite_email) {
          return json({ error: 'This team has already added its details.' }, 400, origin)
        }
        const kind = kindOf(team)
        const emailError = await inviteEmail(
          row.invite_email,
          `${appOrigin(req)}${joinPath(kind)}${row.invite_token}`,
          me.email,
          kind,
        )
        await onboarding(db).update({ invite_email_error: emailError }).eq('supplier_id', team.id)
        return json({ emailed: !emailError, email_error: emailError ?? undefined }, 200, origin)
      }

      if (action === 'document') {
        if (!team.ca_pdf_key) return json({ error: 'No signed agreement yet.' }, 404, origin)
        return json({ url: await signedGet(team.ca_pdf_key) }, 200, origin)
      }

      if (action === 'request_agreement') {
        if (team.onboarding_status === 'Invited') return json({ error: 'This team has not added its details yet.' }, 400, origin)
        if (team.ca_status === 'Complete') return json({ error: 'This team has already signed.' }, 400, origin)
        if (team.agreement_stage) return json({ stage: team.agreement_stage }, 200, origin)
        const missing = [
          !team.legal_name?.trim() && 'Legal Name',
          !team.business_address?.trim() && 'Business Address',
          !sendTo(team) && 'Contract Email',
        ].filter(Boolean)
        if (missing.length) return json({ error: `Add the team's ${missing.join(', ')} first (Contact tab).` }, 400, origin)

        await db.from('supplier_list').update({ agreement_stage: 'awaiting_sequel', ca_status: 'Pending' }).eq('id', team.id)
        await onboarding(db).upsert(
          { supplier_id: team.id, requested_by: me.id, requested_at: new Date().toISOString() },
          { onConflict: 'supplier_id' },
        )
        if (!isSignatory) {
          await notify(
            db,
            await signatoryId(db),
            'agreement_to_sign',
            `${teamName(team)}: composer agreement ready for you to check and sign.`,
            team,
            `/roster/${team.uuid}?agreement=1`,
          )
          // And an email (Andy, 24 Sep). A failure is logged, never blocks the request.
          const err = await toSignEmail(db, team, me.name, `${appOrigin(req)}/roster/${team.uuid}?agreement=1`)
          if (err) console.error('to-sign email failed', team.id, err)
        }
        return json({ stage: 'awaiting_sequel' }, 200, origin)
      }

      if (action === 'preview') {
        if (team.agreement_stage === 'awaiting_composer' && row) {
          const p = await agreementPayload(db, team, row)
          if (p) return json({ stage: team.agreement_stage, can_sign: false, ...p }, 200, origin)
        }
        const d = draftDetails(team)
        const pdf = await buildAgreement(d, await loadFonts())
        return json(
          {
            stage: team.agreement_stage,
            can_sign: isSignatory && team.agreement_stage === 'awaiting_sequel',
            pdf: bytesToB64(pdf),
            team: d.team,
            legal_name: d.legalName,
            email: sendTo(team),
            consent: CONSENT,
            signatory: SIGNATORY,
          },
          200,
          origin,
        )
      }

      if (action === 'company_sign') {
        if (!isSignatory) return json({ error: `Only ${SIGNATORY} can sign for Sequel.` }, 403, origin)
        if (team.agreement_stage !== 'awaiting_sequel') return json({ error: 'This agreement is not waiting for Sequel.' }, 400, origin)
        const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
        if (name.length < 2 || !/\p{L}/u.test(name)) return json({ error: 'Please type your full name to sign.' }, 400, origin)
        if (body.consent !== true) return json({ error: 'Please tick the box to agree to sign electronically.' }, 400, origin)
        const to = sendTo(team)
        if (!to) return json({ error: "Add the team's Contract Email first." }, 400, origin)

        const details = draftDetails(team)
        const token = newToken()
        await onboarding(db).upsert(
          {
            supplier_id: team.id,
            agreement_uuid: crypto.randomUUID(),
            agreement_token: token,
            details,
            company_name: name,
            company_signed_at: new Date().toISOString(),
            company_ip: clientIp(req) || null,
            company_agent: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
            sent_to: to,
            sent_at: new Date().toISOString(),
            agreement_opened_at: null,
          },
          { onConflict: 'supplier_id' },
        )
        await db.from('supplier_list').update({ agreement_stage: 'awaiting_composer' }).eq('id', team.id)
        const emailError = await agreementEmail(team, to, `${appOrigin(req)}/agreement/${token}`)
        // The person who asked for it hears it has gone (Andy, 24 Sep).
        if (row?.requested_by && row.requested_by !== me.id) {
          await notify(db, row.requested_by, 'agreement_sent',
            `${name} signed the composer agreement for ${teamName(team)}. It has gone to them to sign.`,
            team, `/roster/${team.uuid}`)
        }
        await onboarding(db).update({ send_error: emailError }).eq('supplier_id', team.id)
        return json({ stage: 'awaiting_composer', emailed: !emailError, email_error: emailError ?? undefined }, 200, origin)
      }

      if (action === 'resend_agreement') {
        if (team.agreement_stage !== 'awaiting_composer' || !row?.agreement_token || !row.sent_to) {
          return json({ error: 'There is no agreement waiting for this team to sign.' }, 400, origin)
        }
        const emailError = await agreementEmail(team, row.sent_to, `${appOrigin(req)}/agreement/${row.agreement_token}`)
        await onboarding(db).update({ send_error: emailError }).eq('supplier_id', team.id)
        return json({ emailed: !emailError, email_error: emailError ?? undefined }, 200, origin)
      }
    }

    // ----------------------------------------------------------- public
    if (action === 'form' || action === 'form_submit') {
      const found = await byToken(db, 'invite_token', body.token)
      if (!found || found.team.status === 'Archived') return json({ state: 'invalid' }, 200, origin)
      const { row, team } = found
      if (team.onboarding_status !== 'Invited') return json({ state: 'done' }, 200, origin)
      if (action === 'form') return json({ state: 'open', ...(await formPayload(db, team, row)) }, 200, origin)

      const kind = kindOf(team)
      const { patch, error } = cleanFields(body.fields, kind)
      if (error) return json({ state: 'open', error }, 200, origin)
      // The region follows the country (Andy, 24 Sep): the form does not ask.
      if (patch.countries_list_id) {
        const { data: cr } = await db
          .schema('public')
          .from('track_country_regions')
          .select('region_id')
          .eq('country_id', patch.countries_list_id as number)
          .maybeSingle()
        patch.regions_id = (cr as { region_id: number } | null)?.region_id ?? null
      }
      const { error: saveErr } = await db
        .from('supplier_list')
        .update({ ...patch, onboarding_status: 'Details received' })
        .eq('id', team.id)
        .eq('onboarding_status', 'Invited')
      if (saveErr) {
        console.error('form save failed', saveErr.message)
        return json({ state: 'open', error: "We couldn't save your details just now. Please try again in a minute." }, 200, origin)
      }
      await onboarding(db).update({ details_at: new Date().toISOString() }).eq('supplier_id', team.id)
      const fresh = (await teamById(db, team.id)) ?? team
      if (kind === 'roster') {
        await notify(db, row.invited_by, 'roster_details_received', `${teamName(fresh)} added their details to the roster.`, fresh, `/roster/${fresh.uuid}`)
      } else {
        await notify(db, row.invited_by, 'partner_details_received', `${teamName(fresh)} added their details as a partner.`, fresh, `/partners/${fresh.uuid}`)
      }
      return json({ state: 'done' }, 200, origin)
    }

    if (action === 'agreement' || action === 'agreement_sign') {
      const found = await byToken(db, 'agreement_token', body.token)
      if (!found) return json({ state: 'invalid' }, 200, origin)
      const { row, team } = found
      if (team.ca_status === 'Complete') return json({ state: 'done' }, 200, origin)
      if (team.agreement_stage !== 'awaiting_composer') return json({ state: 'invalid' }, 200, origin)

      if (action === 'agreement') {
        // The first open: Andy and whoever requested it hear (Andy, 24 Sep).
        const { data: first } = await onboarding(db)
          .update({ agreement_opened_at: new Date().toISOString() })
          .eq('supplier_id', team.id)
          .is('agreement_opened_at', null)
          .select('supplier_id')
        if (first && first.length) {
          const msg = `${teamName(team)} opened the composer agreement.`
          const andy = await signatoryId(db)
          await notify(db, andy, 'agreement_opened', msg, team, `/roster/${team.uuid}`)
          if (row.requested_by && row.requested_by !== andy) {
            await notify(db, row.requested_by, 'agreement_opened', msg, team, `/roster/${team.uuid}`)
          }
        }
        return json({ state: 'sign', agreement: await agreementPayload(db, team, row) }, 200, origin)
      }

      let result: SignResult
      try {
        result = await composerSign(db, req, team, row, body)
      } catch (e) {
        console.error('agreement sign failed', team.id, (e as Error).message)
        result = {
          state: 'sign',
          error: "We couldn't sign your agreement just now. Please try again in a minute, or contact Sequel if it keeps happening.",
        }
      }
      if (result.state === 'sign') return json({ ...result, agreement: await agreementPayload(db, team, row) }, 200, origin)
      return json(result, 200, origin)
    }

    return json({ error: 'unknown action' }, 400, origin)
  } catch (e) {
    console.error('roster-onboarding', action, (e as Error).message)
    return json({ error: 'Something went wrong.' }, 500, origin)
  }
})
