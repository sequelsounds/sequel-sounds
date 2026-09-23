// The two OAuth endpoints that need the service role: client registration and
// the token exchange.
//
// Deployed with verify_jwt OFF, because both are called by a client that does
// not have a token yet — that is the point of them. Everything else about the
// MCP server keeps its gateway check.
//
// ⚠️ THIS FUNCTION NEVER ACTS AS A PERSON. It hands Claude a real Supabase
// session belonging to whoever pressed Allow, and then has nothing further to
// do with any request. Every MCP call afterwards carries that person's own
// access token, so row-level security and the role gates decide exactly as
// they do in the browser. There is deliberately no path where the MCP server
// runs with the service role and remembers who it is meant to be — a bug there
// would be a privilege escalation, and here it cannot be.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status)

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/** base64url(sha256(verifier)), which is what PKCE S256 compares against. */
async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Whatever the client sent, as a plain object. The spec allows form encoding
 * and clients differ, so both are accepted rather than guessed at.
 */
async function bodyOf(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? ''
  const raw = await req.text()
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return oauthError('invalid_request', 'POST only.', 405)

  const path = new URL(req.url).pathname
  const body = await bodyOf(req)
  const sb = admin()

  // ---------------------------------------------------------- registration --

  // Dynamic client registration. A registration is not a grant: it records a
  // name and the addresses a code may be returned to, and says nothing about
  // who is allowed to sign in. That is decided when a member of staff presses
  // Allow, in their own browser, under their own session.
  if (path.endsWith('/register')) {
    const uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : []
    if (!uris.length) {
      return oauthError('invalid_redirect_uri', 'At least one redirect address is required.')
    }

    const clientId = crypto.randomUUID()
    const { error } = await sb.from('coda_clients').insert({
      client_id: clientId,
      client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : null,
      redirect_uris: uris,
    })
    if (error) {
      console.error('register', error.message)
      return oauthError('server_error', 'Could not register.', 500)
    }

    return json({
      client_id: clientId,
      client_name: body.client_name ?? null,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201)
  }

  // ----------------------------------------------------------------- token --

  if (!path.endsWith('/token')) return oauthError('invalid_request', 'Unknown endpoint.', 404)

  // A refresh is Supabase's own business; we pass it through so Claude keeps a
  // working session without coming back through the Allow screen.
  if (body.grant_type === 'refresh_token') {
    const { data, error } = await sb.auth.refreshSession({ refresh_token: body.refresh_token })
    if (error || !data.session) {
      return oauthError('invalid_grant', 'That session has expired. Reconnect Sequel Track.')
    }
    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: 'Bearer',
      expires_in: data.session.expires_in,
    })
  }

  if (body.grant_type !== 'authorization_code') {
    return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token.')
  }

  const { code, code_verifier, redirect_uri, client_id } = body
  if (!code || !code_verifier) {
    return oauthError('invalid_request', 'A code and a PKCE verifier are required.')
  }

  const { data: row, error: readError } = await sb
    .from('coda_auth_codes')
    .select('code, client_id, auth_uid, redirect_uri, code_challenge, used_at, expires_at, scope')
    .eq('code', code)
    .maybeSingle()

  if (readError) {
    console.error('code read', readError.message)
    return oauthError('server_error', 'Could not check that code.', 500)
  }
  if (!row) return oauthError('invalid_grant', 'Unknown code.')

  // Single use, and spent the moment it is looked at. A code that has been
  // used before is not merely refused: it means somebody replayed one, so the
  // whole row goes.
  if (row.used_at) {
    await sb.from('coda_auth_codes').delete().eq('code', code)
    return oauthError('invalid_grant', 'That code has already been used.')
  }
  if (new Date(row.expires_at) < new Date()) return oauthError('invalid_grant', 'That code expired.')
  if (client_id && client_id !== row.client_id) {
    return oauthError('invalid_grant', 'That code belongs to a different client.')
  }
  if (redirect_uri && redirect_uri !== row.redirect_uri) {
    return oauthError('invalid_grant', 'Redirect address does not match.')
  }
  if ((await s256(String(code_verifier))) !== row.code_challenge) {
    return oauthError('invalid_grant', 'PKCE verification failed.')
  }

  await sb.from('coda_auth_codes').update({ used_at: new Date().toISOString() }).eq('code', code)

  // Now turn the proof into a genuine session for that person.
  const { data: person, error: personError } = await sb.auth.admin.getUserById(row.auth_uid)
  if (personError || !person?.user?.email) {
    console.error('user lookup', personError?.message)
    return oauthError('invalid_grant', 'That account has no email address to sign in with.')
  }

  // generateLink does not send anything — it returns the token that a magic
  // link would have carried, which we redeem here and now. This is the one
  // moment the service role is involved, and it happens under a code that a
  // signed-in member of staff produced by pressing Allow seconds earlier.
  const { data: link, error: linkError } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: person.user.email,
  })
  if (linkError || !link?.properties?.hashed_token) {
    console.error('generateLink', linkError?.message)
    return oauthError('server_error', 'Could not start a session.', 500)
  }

  const { data: session, error: verifyError } = await sb.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  })
  if (verifyError || !session.session) {
    console.error('verifyOtp', verifyError?.message)
    return oauthError('server_error', 'Could not start a session.', 500)
  }

  await sb.from('coda_auth_codes').delete().eq('code', code)

  return json({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    token_type: 'Bearer',
    expires_in: session.session.expires_in,
    scope: row.scope ?? 'sequel',
  })
})
