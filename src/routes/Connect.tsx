import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * The Allow screen — where a member of staff connects an assistant like Claude
 * to Sequel Track.
 *
 * ⚠️ THIS PAGE IS THE SIGN-IN. There is no login form in the OAuth endpoints
 * and no password ever reaches them: the proof that somebody is who they say
 * they are is the session they already have in this browser, and pressing
 * Allow is what turns that into a code. The code is worth nothing on its own —
 * it is spent once, within two minutes, by a client that can prove it started
 * the request.
 *
 * ⚠️ WHAT IS BEING GRANTED IS THEIR OWN ACCESS, NOT MORE. The assistant ends
 * up holding an ordinary session for this person, so it sees and does exactly
 * what they can, and every tool call is written to coda_tool_calls with their
 * name on it. That is worth saying plainly on the screen rather than burying,
 * which is why the wording below is specific about writes.
 */
export default function Connect() {
  const [params] = useSearchParams()
  const [clientName, setClientName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const challenge = params.get('code_challenge') ?? ''
  const method = params.get('code_challenge_method') ?? ''
  const state = params.get('state')
  const scope = params.get('scope')

  useEffect(() => {
    if (!clientId || !redirectUri || !challenge) {
      setError('That link is missing something. Start again from your assistant.')
      return
    }
    // S256 only. Anything else is either a client we do not want to encourage
    // or somebody trying their luck.
    if (method && method !== 'S256') {
      setError('That assistant asked for a weaker security method than we allow.')
      return
    }
    supabase
      .rpc('coda_client_name', { p_client_id: clientId })
      .then(({ data }) => setClientName((data as string | null) ?? 'An assistant'))
  }, [clientId, redirectUri, challenge, method])

  /** Hand the answer back to whoever sent us here, good or bad. */
  function handBack(query: Record<string, string>) {
    const back = new URL(redirectUri)
    for (const [k, v] of Object.entries(query)) back.searchParams.set(k, v)
    if (state) back.searchParams.set('state', state)
    window.location.replace(back.toString())
  }

  async function allow() {
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('coda_authorize', {
      p_client_id: clientId,
      p_redirect_uri: redirectUri,
      p_code_challenge: challenge,
      p_scope: scope,
    })
    if (error || !data) {
      setBusy(false)
      setError(error?.message ?? 'Could not connect.')
      return
    }
    handBack({ code: data as string })
  }

  if (error) {
    return (
      <div className="bp-wrap">
        <div className="bp-screen">
          <h2 className="bp-heading">That didn't work.</h2>
          <p className="bp-help">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bp-wrap">
      <div className="bp-screen">
        <h2 className="bp-heading">Connect {clientName ?? '…'} to Sequel Track?</h2>

        <p className="bp-help">
          It will be able to do what you can do, as you — read projects, clients, quotes,
          invoices, songs and people, run the reports, and make the same changes you can from
          the app: raise a quote, create a project or a person, set an invoice's status.
        </p>

        <p className="bp-help">
          It cannot see anything you can't, and it cannot change the app or the database
          itself. Every action it takes is recorded against your name, and you can disconnect
          it from Settings at any time.
        </p>

        <div className="bp-nav">
          <button
            type="button"
            className="bp-button is-ghost"
            onClick={() => handBack({ error: 'access_denied' })}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`bp-button${busy ? ' is-disabled'   : ''}`}
            onClick={allow}
            disabled={busy}
          >
            {busy ? 'Connecting…' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  )
}
