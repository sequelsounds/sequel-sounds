import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import PdfView from '../components/PdfView'
import SequelLogo from '../components/SequelLogo'
import { openShare, type LicenceShareDetails, type SharedFile } from '../lib/assets'

/**
 * `/licence?id=…` — the page a client opens from a sent composition licence.
 * Public: the code is the credential, and `sign-asset` checks it (expiry,
 * rate limit) and records the open before signing anything.
 *
 * ⚠️ ITS OWN PAGE — Andy, 26 Sep: "not an asset page … a dedicated contract
 * page", and "NOT styled like an asset page either". The layout is the staff
 * contract page's (/contracts/:uuid): the app's header bar with the reference
 * beside the wordmark, the terms in a left panel with DOWNLOAD pinned at its
 * foot, the document on the right.
 *
 * ⚠️ WHY IT IS A PAGE AT ALL: a download has to be something the client does
 * here. Sent straight to the PDF, only the open could ever be seen. DOWNLOAD
 * re-resolves the code with event 'download' — that call is the record — and
 * then saves the file. Saving from the browser some other way is not counted.
 */

const ROWS: [keyof LicenceShareDetails, string][] = [
  ['composition_title', 'Composition'],
  ['writer_names', 'Writers'],
  ['licensee_name', 'Licensee'],
  ['client_name', 'Client'],
  ['brand', 'Brand'],
  ['campaign', 'Campaign'],
  ['production_name', 'Production'],
  ['rights_granted', 'Rights granted'],
  ['licensor_share', "Licensor's share"],
  ['scripts', 'Scripts'],
  ['cutdowns', 'Cutdowns included'],
  ['media', 'Media'],
  ['territory', 'Territory'],
  ['term', 'Term'],
  ['first_transmission', 'First transmission'],
  ['licence_fee', 'Licence fee'],
  ['invoice_number', 'Invoice'],
  ['issued_on', 'Date of issue'],
]

function errorText(code: string): string {
  if (code === 'expired') return 'This link has expired. Ask whoever sent it for a new one.'
  if (code === 'busy') return 'Too many requests. Please wait a few minutes and try again.'
  return 'This link is not valid. It may have been withdrawn or the address may be incomplete.'
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

export default function Licence() {
  const [params] = useSearchParams()
  const code = params.get('id') ?? ''
  const [file, setFile] = useState<SharedFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /* A library licence (0089) says so; anything older is a composition one. */
  const name = file?.details?.licence_kind === 'library' ? 'Library Licence' : 'Composition Licence'
  useEffect(() => {
    document.title = `Sequel | ${name}`
  }, [name])

  useEffect(() => {
    let live = true
    if (!code) {
      setError(errorText('invalid'))
      return
    }
    void openShare(code).then((r) => {
      if (!live) return
      if ('error' in r) setError(errorText(r.error))
      else if (r.kind !== 'licence' || !r.details) setError(errorText('invalid'))
      else setFile(r)
    })
    return () => {
      live = false
    }
  }, [code])

  /** ⚠️ ALWAYS RE-CALLS: the call is what records the download. */
  const download = async () => {
    if (saving) return
    setSaving(true)
    const r = await openShare(code, 'download')
    setSaving(false)
    if ('error' in r) {
      setError(errorText(r.error))
      return
    }
    window.location.href = r.download_url
  }

  if (!file && !error) return <Loader />
  const d = file?.details

  return (
    <div className="ct-page lc-page">
      <div className="qw-head">
        <SequelLogo wordmark className="qw-logo !h-auto !w-20" />
        {d && (
          <div className="ct-meta lc-meta">
            <span className="ct-meta-item is-bold">{name}</span>
            <span className="ct-meta-sep">|</span>
            <span className="ct-meta-item lc-no-case">{d.sequel_no}</span>
          </div>
        )}
      </div>

      {error || !d || !file ? (
        <div className="lc-error">{error}</div>
      ) : (
        <div className="ct-split lc-split">
          <div className="ct-ai lc-panel">
            <div className="ct-ai-scroll">
              <div className="ct-ai-head">About your licence</div>
              {/* ⚠️ Not an AI caveat: nothing here is generated. These are the
                  values printed on the certificate. The note settles which one
                  counts if they ever differ. */}
              <div className="ct-ai-note">
                The key terms at a glance. The full licence is alongside.
              </div>
              <p className="lc-effect">
                This licence comes into effect when invoice {d.invoice_number} is paid. No signature is
                needed.
              </p>
              <dl className="lc-terms">
                {ROWS.filter(([k]) => String(d[k] ?? '').trim() !== '').map(([k, label]) => (
                  <div key={k} className="lc-term">
                    <dt>{k === 'composition_title' && name === 'Library Licence' ? 'Track' : label}</dt>
                    <dd>{k === 'issued_on' ? longDate(String(d[k])) : d[k]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {/* The app's own button — the modals' CREATE / SEND (.am-submit
                .is-full .is-brief), not the contract page's 2rem bar. */}
            <button
              type="button"
              className={`am-submit is-full is-brief lc-download${saving ? ' is-off' : ''}`}
              onClick={() => void download()}
            >
              {saving ? 'DOWNLOADING…' : 'DOWNLOAD'}
            </button>
          </div>

          <div className="ct-pdf lc-pdf">
            <PdfView url={file.url} className="ct-frame" />
          </div>
        </div>
      )}
    </div>
  )
}
