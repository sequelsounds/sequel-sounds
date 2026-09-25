import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PdfView from '../components/PdfView'
import { agreementForToken, pdfUrl, signAgreement, type AgreementToSign } from '../lib/rosterOnboarding'

/**
 * `/agreement/:token` — a composition team reads Sequel's composer agreement,
 * already signed for Sequel by Andy, and signs it (24 Sep 2026). Public: the
 * token in the email is the only credential. Sequel's own signing, as on the
 * Schedule A: a typed name and a ticked consent, with the record kept by the
 * roster-onboarding function.
 */

type Screen = 'loading' | 'invalid' | 'done' | 'sign'

export default function Agreement() {
  const { token = '' } = useParams()
  const [screen, setScreen] = useState<Screen>('loading')
  const [doc, setDoc] = useState<AgreementToSign | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [justSigned, setJustSigned] = useState(false)

  const show = (a: AgreementToSign | null | undefined) => {
    if (!a) return setScreen('invalid')
    setDoc(a)
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return pdfUrl(a.pdf)
    })
    setScreen('sign')
  }

  useEffect(() => {
    document.title = 'Sequel | Composer agreement'
    let live = true
    agreementForToken(token)
      .then((r) => {
        if (!live) return
        if (r.state === 'sign') show(r.agreement)
        else setScreen(r.state)
      })
      .catch(() => live && setScreen('invalid'))
    return () => {
      live = false
    }
  }, [token])

  const sign = async () => {
    if (!doc || signing) return
    if (name.trim().length < 2) return setError('Please type your full name to sign.')
    if (!consent) return setError('Please tick the box to agree to sign electronically.')
    setSigning(true)
    setError(null)
    try {
      const r = await signAgreement(token, name.trim(), consent, doc.details_hash)
      if (r.state === 'done') {
        setJustSigned(true)
        setScreen('done')
      } else if (r.state === 'sign') {
        if (r.agreement && r.agreement.details_hash !== doc.details_hash) show(r.agreement)
        setError(r.error ?? null)
      } else setScreen('invalid')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="sc-body">
      <img className="sc-logo qw-logo" src="/sequel-wordmark.png" alt="Written Sequel Logo" width={425} height={96} />

      {screen === 'invalid' && (
        <div className="sc-state">
          <h2 className="sc-heading">This link isn't valid</h2>
          <p className="sc-subtext">Please check the link in your email, or contact Sequel if you think this is a mistake.</p>
        </div>
      )}

      {screen === 'done' && (
        <div className="sc-state">
          <h2 className="sc-heading">You're all set</h2>
          {justSigned ? (
            <p className="sc-subtext">
              {doc?.email ? (
                <>
                  Thanks for signing - we've emailed a copy to:
                  <br />
                  <br />
                  {doc.email}
                </>
              ) : (
                'Thanks for signing.'
              )}
              <br />
              <br />
              Welcome to the Sequel roster!
            </p>
          ) : (
            <p className="sc-subtext">This agreement has been signed. If you need a copy, contact Sequel.</p>
          )}
        </div>
      )}

      {screen === 'sign' && doc && (
        <div className="sc-sign">
          <div className="sc-sign-inner">
            <h2 className="sc-heading">Sign your composer agreement</h2>
            <p className="sc-subtext">
              Please read the agreement below. Sequel has signed it already. When you're ready, type your full name
              to sign.{doc.email ? ` We'll email a signed copy to ${doc.email}.` : ''}
            </p>

            <div className="ag-page-doc">{url && <PdfView url={url} />}</div>

            <div className="sc-signoff">
              <div className="sc-field-label">Signed for and on behalf of {doc.legal_name || doc.team}</div>
              <div className="sc-signature" aria-hidden="true">
                {name.trim() || ' '}
              </div>
              <label className="sc-field-group" htmlFor="ag-signer">
                <span className="sc-field-label">Your full name</span>
                <input
                  id="ag-signer"
                  className="sc-input"
                  placeholder="e.g. Alex Morgan"
                  autoComplete="name"
                  maxLength={120}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void sign()}
                />
              </label>
              <label className="sc-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked)
                    setError(null)
                  }}
                />
                <span>{doc.consent}</span>
              </label>
              {error && <p className="sc-warning">{error}</p>}
              <div className="sc-nav">
                <button type="button" className="bp-button" disabled={signing} onClick={() => void sign()}>
                  {signing ? 'SIGNING…' : 'SIGN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
