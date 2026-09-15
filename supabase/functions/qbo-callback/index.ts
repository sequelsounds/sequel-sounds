// qbo-callback — where Intuit sends the browser after someone approves the
// new app's QuickBooks connection.
//
// ⚠️ UNAUTHENTICATED BY NECESSITY. Intuit redirects a bare browser with no
// Authorization header, so this is deployed with verify_jwt off and the
// `state` value is the whole protection. It was minted by `quickbooks`
// (action "connect") for a finance user, stored in qbo_oauth_state, and is
// looked up here BY value and deleted in the same statement — so an unknown,
// expired or replayed state finds nothing and the code is never used.
//
// ⚠️ THE REDIRECT URI MUST BE BYTE FOR BYTE what is registered on the Intuit
// app "Sequel App New" and what `quickbooks` sent: Intuit refuses the exchange
// on any difference, including a trailing slash.
//
// This app is "Sequel App New", NOT the old app's "Sequel App". The two are
// separate connections on purpose — see migration 0025.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const REDIRECT_URI = 'https://sveirphsppyfhulymjiu.supabase.co/functions/v1/qbo-callback'

// Sequel's production company. Connecting any other company — a sandbox, or a
// test file someone has access to — would point every vendor mapping at the
// wrong books, so it is refused rather than stored.
const EXPECTED_REALM = '9341454843667472'

function back(returnTo: string | null, params: Record<string, string>) {
  // No state row means no trusted return address; a plain message is safer
  // than redirecting anywhere a URL parameter suggests.
  if (!returnTo) {
    const msg = params.qbo_error ?? 'QuickBooks connected.'
    return new Response(msg, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  const url = new URL(returnTo)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return Response.redirect(url.toString(), 302)
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })

  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  const realmId = url.searchParams.get('realmId') ?? ''
  const intuitError = url.searchParams.get('error')

  if (!state) return back(null, { qbo_error: 'This QuickBooks link is incomplete.' })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // Claim the state: delete it and read it back in one go, so it cannot be
  // used twice even by two requests arriving together.
  const { data: rows, error: stateError } = await admin
    .from('qbo_oauth_state')
    .delete()
    .eq('state', state)
    .gt('expires_at', new Date().toISOString())
    .select('user_id, return_to')
  if (stateError) {
    return back(null, { qbo_error: 'QuickBooks could not be connected (state lookup failed).' })
  }
  const claimed = rows?.[0] as { user_id: string; return_to: string } | undefined
  if (!claimed) {
    return back(null, {
      qbo_error: 'This QuickBooks request was not recognised or has expired. Start again from the app.',
    })
  }

  if (intuitError) {
    // access_denied is someone pressing Cancel on Intuit's screen.
    return back(claimed.return_to, {
      qbo_error: intuitError === 'access_denied' ? 'QuickBooks connection was cancelled.' : `QuickBooks refused: ${intuitError}`,
    })
  }
  if (!code || !realmId) {
    return back(claimed.return_to, { qbo_error: 'QuickBooks sent back an incomplete answer.' })
  }
  if (realmId !== EXPECTED_REALM) {
    return back(claimed.return_to, {
      qbo_error: 'That is not Sequel’s QuickBooks company. Connect again and pick the Sequel company.',
    })
  }

  const clientId = Deno.env.get('QBO_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('QBO_CLIENT_SECRET') ?? ''
  if (!clientId || !clientSecret) {
    return back(claimed.return_to, { qbo_error: 'QuickBooks keys are not set on the server.' })
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    // The error name only — Intuit's body can echo request details.
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
    return back(claimed.return_to, { qbo_error: `QuickBooks would not issue a connection (${reason}).` })
  }

  const now = Date.now()
  const { error: saveError } = await admin.from('qbo_connection').upsert({
    environment: 'production',
    realm_id: realmId,
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    access_expires_at: new Date(now + Number(body.expires_in ?? 3600) * 1000).toISOString(),
    refresh_expires_at: new Date(now + Number(body.x_refresh_token_expires_in ?? 8726400) * 1000).toISOString(),
    status: 'Connected',
    last_error: null,
    connected_by: claimed.user_id,
    connected_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    refresh_lock_id: null,
    refresh_lock_until: null,
  })
  if (saveError) {
    return back(claimed.return_to, { qbo_error: 'QuickBooks connected but the connection could not be saved.' })
  }

  // Old handshakes are dead weight; tidy them while we are here.
  await admin.from('qbo_oauth_state').delete().lt('expires_at', new Date().toISOString())

  return back(claimed.return_to, { qbo: 'connected' })
})
