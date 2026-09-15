import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import SharedAudio from '../components/viewer/SharedAudio'
import { fileKind, openShare, saveSharePeaks, type SharedFile as Shared } from '../lib/assets'

/**
 * `/link?id=…` — the page a shared project file opens on, the old app's
 * `/link` rebuilt. Public: the code is the credential, and `sign-asset`
 * checks it (expiry, rate limit) before signing anything.
 *
 * Layout and wording read off the staging page, its stylesheet and its Wized
 * bindings, 16 Sep. Spec: `sequel-track-share-page.md`.
 *
 * ⚠️ ONE DELIBERATE CHANGE: DOWNLOAD is a plain link to a URL signed with
 * `response-content-disposition`, so the browser saves the file itself. The
 * old page fetched the whole file into memory to save it, only because Xano
 * cannot sign that parameter — its own write-up names this as the fix. The
 * progress line went with it: the browser shows its own.
 */

const KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Image', doc: 'Document', other: 'File' } as const

/** The signed URLs last an hour; a page left open longer asks again. */
const FRESH_MS = 50 * 60 * 1000

function sizeText(raw: string | null): string {
  const total = Number(raw)
  if (!total) return ''
  const mb = total / 1048576
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB'
}

function errorText(code: string): string {
  if (code === 'expired') return 'This link has expired. Ask whoever shared it for a new one.'
  if (code === 'busy') return 'Too many requests. Please wait a few minutes and try again.'
  return 'This link is not valid. It may have been removed or the address may be incomplete.'
}

export default function SharedFile() {
  const [params] = useSearchParams()
  const code = params.get('id') ?? ''
  const [file, setFile] = useState<Shared | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const fetchedAt = useRef(0)

  useEffect(() => {
    document.title = 'Sequel | Shared file'
  }, [])

  useEffect(() => {
    let live = true
    if (!code) {
      setError(errorText('invalid'))
      setReady(true)
      return
    }
    void openShare(code).then((r) => {
      if (!live) return
      if ('error' in r) {
        setError(errorText(r.error))
        setReady(true)
      } else {
        fetchedAt.current = Date.now()
        setFile(r)
      }
    })
    return () => {
      live = false
    }
  }, [code])

  const kind = file ? fileKind(file.file_name) : 'other'

  // Hold the loading sheet until the preview itself can be used, not just
  // until the link resolves — and never for more than eight seconds.
  useEffect(() => {
    if (!file) return
    if (kind === 'other') {
      setReady(true)
      return
    }
    const t = window.setTimeout(() => setReady(true), 8000)
    return () => window.clearTimeout(t)
  }, [file, kind])
  // Metadata, not data: with preload="metadata" a browser may stop before it
  // has any frames, and loadeddata never comes — the sheet then sat for the
  // full eight seconds on a WAV.
  const loaded = () => setReady(true)

  const download = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!file || Date.now() - fetchedAt.current < FRESH_MS) return
    e.preventDefault()
    const r = await openShare(code)
    if ('error' in r) {
      setError(errorText(r.error))
      return
    }
    fetchedAt.current = Date.now()
    setFile(r)
    window.location.href = r.download_url
  }

  const expiry = file?.expires_at
    ? new Date(file.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
  const size = sizeText(file?.file_size ?? null)

  return (
    <div className="sf-page">
      <div className="sf-pin">Sequel</div>

      {(file || error) && (
        <div className="sf-card">
          <div className="sf-header">Project Asset</div>
          <div className="sf-name">{file?.file_name ?? ''}</div>
          <div className="sf-head">
            <div className="sf-meta">
              {file ? (size ? `${KIND_LABEL[kind]} - ${size}` : KIND_LABEL[kind]) : ''}
            </div>
          </div>

          {file && kind !== 'other' && (
            <div className={`sf-preview${kind === 'audio' ? ' is-audio' : ''}`}>
              {kind === 'video' && (
                <video className="sf-media" src={file.url} controls preload="metadata" onLoadedMetadata={loaded} onError={loaded} />
              )}
              {kind === 'audio' && (
                <SharedAudio
                  src={file.url}
                  onReady={loaded}
                  peaks={file.peaks}
                  size={Number(file.file_size) || 0}
                  onPeaks={(p) => void saveSharePeaks(code, p)}
                />
              )}
              {kind === 'image' && (
                <img className="sf-image" src={file.url} alt={file.file_name} onLoad={loaded} onError={loaded} />
              )}
              {kind === 'doc' && (
                <iframe className="sf-doc" src={file.url} title={file.file_name} onLoad={loaded} />
              )}
            </div>
          )}

          {file && (
            <div className="sf-actions">
              <a className="bp-button sf-download" href={file.download_url} onClick={download}>
                Download
              </a>
            </div>
          )}
          {error && <div className="sf-error">{error}</div>}
          {expiry && !error && <div className="sf-expiry">This link expires on {expiry}</div>}
        </div>
      )}

      {!ready && (
        <div className="sf-loading" role="status">
          <div className="sf-loading-text">sequel</div>
          <Loader />
        </div>
      )}
    </div>
  )
}
