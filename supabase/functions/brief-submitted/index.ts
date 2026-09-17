// brief-submitted — emails the project's music supervisor when a brief is
// submitted. The new app's copy of Xano table trigger 15 (17 Sep 2026), with
// the same wording, sender and recipient rules.
//
// Called by the database, not the browser: trigger `briefs_email_supervisor`
// (migration 0036) queues a POST here through pg_net when a brief's status
// moves to Submitted. pg_net sends after the save has committed, so a failed
// email can never fail a client's submission — the reason Xano's is a trigger.
//
// No secret: verify_jwt is off and the body is just { brief_id }. What makes
// that safe is the claim below — a brief is emailed at most once, only while
// Submitted, and only within 15 minutes of submission — so a stranger calling
// this can at most send Sequel the one email it was going to get anyway.
//
// Recipient: the project's music_supervisor, else requested_by (whoever minted
// the link). No address, no email. PLAIN TEXT: the brief name and one-sentence
// answer are typed by the client, so nothing they type can become markup.
//
// Secrets: RESEND_API_KEY. Optional APP_BASE_URL for the project link.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const RESEND_API = 'https://api.resend.com/emails'
const EMAIL_FROM = 'Sequel <coda@sequelsounds.com>'
const WINDOW_MS = 15 * 60 * 1000

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let briefId: number
  try {
    briefId = Number((await req.json())?.brief_id)
  } catch {
    return json({ error: 'bad request' }, 400)
  }
  if (!Number.isInteger(briefId) || briefId <= 0) return json({ error: 'bad request' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
    db: { schema: 'xano_mirror' },
  })

  // Claim the brief first. Only one caller can win this update.
  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const { data: claimed, error: claimErr } = await db
    .from('briefs')
    .update({ supervisor_emailed_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('status', 'Submitted')
    .gte('submitted_at', since)
    .is('supervisor_emailed_at', null)
    .select('id, name, brief_type, client_deadline, one_sentence_brief, project_master_list_id, requested_by')
  if (claimErr) {
    console.error('claim failed', briefId, claimErr.message)
    return json({ error: 'claim failed' }, 500)
  }
  const brief = claimed?.[0]
  if (!brief) return json({ skipped: true }, 200)

  const fail = async (message: string, status = 200) => {
    console.error('brief email', briefId, message)
    await db.from('briefs').update({ supervisor_email_error: message }).eq('id', briefId)
    return json({ emailed: false, error: message }, status)
  }

  const { data: project } = brief.project_master_list_id
    ? await db
        .from('project_master_list')
        .select('id, title, brand, sequel_no, music_supervisor')
        .eq('id', brief.project_master_list_id)
        .maybeSingle()
    : { data: null }

  const recipientId =
    project?.music_supervisor && project.music_supervisor > 0 ? project.music_supervisor : brief.requested_by
  if (!recipientId) return fail('No music supervisor or requester to email.')

  const { data: recipient } = await db.from('user').select('name, email').eq('id', recipientId).maybeSingle()
  const to = (recipient?.email ?? '').trim()
  if (!to) return fail(`User ${recipientId} has no email address.`)

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return fail('RESEND_API_KEY is not set on the server.')

  let projectLabel = 'your project'
  if (project) {
    projectLabel = project.brand ? `${project.brand} - ${project.title ?? ''}` : (project.title ?? '')
  }
  const sequelNo = project?.sequel_no ? ` (${project.sequel_no})` : ''
  const base = (Deno.env.get('APP_BASE_URL') ?? 'https://app.sequelsounds.com').replace(/\/+$/, '')
  const projectUrl = project ? `${base}/projects/${project.id}?tab=briefs` : `${base}/projects`

  // Word for word as Xano trigger 15.
  const text =
    `Hi ${recipient?.name ?? ''},\n\n` +
    `A brief has just been submitted for ${projectLabel}${sequelNo}.\n\n` +
    `Brief: ${brief.name ?? ''}\n` +
    `Type: ${brief.brief_type ?? ''}\n` +
    `Deadline: ${brief.client_deadline ?? ''}\n` +
    `In one sentence: ${brief.one_sentence_brief ?? ''}\n\n` +
    `Open the project's Briefs tab to read it in full:\n${projectUrl}\n\n` +
    `Sequel`

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject: `Brief submitted | ${projectLabel}`.slice(0, 200),
        text,
      }),
    })
    if (!res.ok) return fail(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
  } catch (e) {
    return fail(`Resend unreachable: ${(e as Error).message}`)
  }

  await db.from('briefs').update({ supervisor_email_error: null }).eq('id', briefId)
  return json({ emailed: true }, 200)
})
