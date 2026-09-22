// The front door for Claude on the desktop.
//
// Everything here is routing. No secrets live in this Worker and it makes no
// decisions about who may do what — it exists because of one constraint:
//
// ⚠️ THE `coda` FUNCTION IS DEPLOYED WITH verify_jwt ON, so Supabase's gateway
// rejects any request without a valid token before our code runs. OAuth
// discovery is unauthenticated by definition, and so is the 401 that tells a
// client where to go and authenticate. Neither can come from behind that
// gateway. They come from here instead, and /mcp is proxied through with the
// caller's own token so the gateway still does its job.
//
// Static assets fall through to the SPA exactly as before.

const SUPABASE = 'https://sveirphsppyfhulymjiu.supabase.co'
const CODA = `${SUPABASE}/functions/v1/coda`
const CODA_OAUTH = `${SUPABASE}/functions/v1/coda-oauth`

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...extra,
    },
  })

const preflight = () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, content-type, mcp-protocol-version, mcp-session-id',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    // Built from the request rather than hardcoded, so this works the same on
    // the workers.dev address and on the custom domain.
    const base = url.origin

    const isOurs =
      path === '/mcp' ||
      path.startsWith('/oauth/') ||
      path.startsWith('/.well-known/oauth-')

    if (isOurs && request.method === 'OPTIONS') return preflight()

    // ------------------------------------------------------------ discovery --

    // RFC 9728. Says which server issues tokens for this resource.
    if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
      return json({
        resource: `${base}/mcp`,
        authorization_servers: [base],
        bearer_methods_supported: ['header'],
        resource_name: 'Sequel Track',
      })
    }

    // RFC 8414. Both spellings, because clients differ over which to try when
    // the issuer has no path.
    if (
      path === '/.well-known/oauth-authorization-server' ||
      path === '/.well-known/oauth-authorization-server/mcp'
    ) {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/connect`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['sequel'],
      })
    }

    // ---------------------------------------------------------------- OAuth --

    // Registration and the token exchange need the service role, so they live
    // in an edge function rather than here.
    if (path === '/oauth/register' || path === '/oauth/token') {
      const target = `${CODA_OAUTH}${path.replace('/oauth', '')}`
      const res = await fetch(target, {
        method: request.method,
        headers: {
          'Content-Type': request.headers.get('content-type') ?? 'application/json',
          // The gateway wants a project key even on a function that does not
          // verify JWTs. This is the publishable key, which identifies the
          // project and grants nothing.
          apikey: 'sb_publishable_mnv7wd-bN3ZnJ3BLzN9acg_l0dF1m1e',
        },
        body: request.method === 'POST' ? await request.text() : undefined,
      })
      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    }

    // ------------------------------------------------------------------ MCP --

    if (path === '/mcp') {
      const auth = request.headers.get('authorization')

      // The whole reason this Worker exists. Without the hint, a client has
      // nowhere to start.
      if (!auth) {
        return new Response(
          JSON.stringify({ error: 'unauthorized', error_description: 'Sign in to Sequel Track.' }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'WWW-Authenticate':
                `Bearer realm="Sequel Track", ` +
                `resource_metadata="${base}/.well-known/oauth-protected-resource"`,
            },
          },
        )
      }

      // Straight through, token untouched: the gateway validates it and the
      // function runs as that person.
      const res = await fetch(`${CODA}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'mcp-protocol-version': request.headers.get('mcp-protocol-version') ?? '2025-06-18',
        },
        body: await request.text(),
      })

      const out = new Response(res.body, { status: res.status, headers: res.headers })
      out.headers.set('Access-Control-Allow-Origin', '*')
      return out
    }

    return env.ASSETS.fetch(request)
  },
}
