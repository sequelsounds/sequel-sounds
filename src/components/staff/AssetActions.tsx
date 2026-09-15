import { useEffect, useRef, useState } from 'react'
import {
  ASSET_TAGS,
  discardAsset,
  pickedSize,
  shareAsset,
  uploadAsset,
  useAttachBriefUpload,
  useDeleteAsset,
  useSaveAsset,
} from '../../lib/assets'
import type { ProjectFile } from '../../lib/xanoMirror'
import { ArchiveIcon, Modal, ShareIcon } from './RowActions'

/**
 * The Assets tab's moving parts: the upload modal (upload, edit and brief
 * modes — one modal, as the old app has it), the row's share and delete cells,
 * and the share modal. Wording and layout read off the staging page and its
 * stylesheet, 16 Sep; behaviour off the Wized bindings and Xano's Project
 * Assets endpoints. Spec: `sequel-track-assets_1.md`.
 */

export type AssetModalMode =
  | { kind: 'upload' }
  | { kind: 'brief' }
  | { kind: 'edit'; asset: ProjectFile }

/* --------------------------------------------------------------- the icons */

/** The ready state: a brown square with an upload arrow. */
function UploadIcon() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <rect width="100" height="100" fill="var(--color-sequel-brown)" />
      <g fill="none" stroke="var(--color-sequel-silver)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 70 L70 70" />
        <path d="M50 60 L50 30" />
        <path d="M38 42 L50 30 L62 42" />
      </g>
    </svg>
  )
}

/** Uploading: the brown square flipping, as the old embed does. */
function UploadingIcon() {
  return (
    <svg viewBox="0 0 20 20" width="85%" height="85%" aria-hidden="true" className="am-spin">
      <rect width="20" height="20" fill="var(--color-sequel-brown)" />
    </svg>
  )
}

function DoneIcon() {
  return (
    <svg viewBox="0 0 455 455" width="100%" height="100%" aria-hidden="true">
      <path fill="var(--color-sequel-brown)" d="M0,0v455h455V0H0z" />
      <path
        fill="var(--color-sequel-silver)"
        d="M194.93,319.897l-87.837-87.837l21.213-21.213l66.625,66.624l131.764-131.763l21.213,21.213 L194.93,319.897z"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <g fill="none" stroke="var(--color-sequel-brown)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M39.5,15.5h-9a2,2,0,0,1-2-2v-9h-18a2,2,0,0,0-2,2v35a2,2,0,0,0,2,2h27a2,2,0,0,0,2-2Z" />
        <line x1="28.5" y1="4.5" x2="39.5" y2="15.5" />
      </g>
    </svg>
  )
}

/* ---------------------------------------------------------- the upload modal */

/**
 * upload_asset_modal. Picking a file uploads it at once — the row first, then
 * the file — while the name and tag are filled in; SUBMIT confirms it.
 * Edit mode has no file step: the file is fixed once written. Brief mode has
 * no tags and saves a brief instead of an asset.
 *
 * Closing with an upload that was never submitted deletes it, file and row.
 * The old app left those for an hourly sweep that the new app does not have.
 */
export function AssetModal({
  mode,
  projectId,
  onClose,
  onSaved,
}: {
  mode: AssetModalMode
  projectId: number
  onClose: () => void
  /** The uuid of what was saved, so the list can flash that row. */
  onSaved?: (uuid: string) => void
}) {
  const editing = mode.kind === 'edit' ? mode.asset : null
  const [meta, setMeta] = useState<{ name: string; size: number } | null>(null)
  const [uuid, setUuid] = useState<string | null>(editing?.uuid ?? null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [description, setDescription] = useState(editing?.description ?? '')
  const [tag, setTag] = useState<string | null>(editing?.asset_tag ?? null)
  const input = useRef<HTMLInputElement>(null)
  const save = useSaveAsset(projectId)
  const attach = useAttachBriefUpload(projectId)

  // An upload not yet submitted, to be discarded if the modal closes.
  const pending = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (pending.current) void discardAsset(pending.current).catch(() => undefined)
    },
    [],
  )

  const title = mode.kind === 'brief' ? 'Upload Brief' : editing ? 'Edit Asset' : 'Upload Asset'
  const subtitle =
    mode.kind === 'brief'
      ? "Add the client's brief - any file type - and give it a name."
      : editing
        ? 'Update the description or the tag.'
        : 'Add your file and a short description.'
  const label = mode.kind === 'brief' ? 'SAVE BRIEF' : editing ? 'SAVE CHANGES' : 'SUBMIT'
  const busy = save.isPending || attach.isPending
  const ok = !!uuid && !uploading && description.trim() !== '' && (mode.kind === 'brief' || !!tag)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setMeta({ name: file.name, size: file.size })
    setUploading(true)
    setError(null)
    try {
      const id = await uploadAsset(projectId, file)
      pending.current = id
      setUuid(id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const reset = () => {
    if (pending.current) void discardAsset(pending.current).catch(() => undefined)
    pending.current = null
    setUuid(null)
    setMeta(null)
    setError(null)
    setUploading(false)
    // Cleared without an input event, so nothing re-fires.
    if (input.current) input.current.value = ''
  }

  const submit = () => {
    if (!ok || busy || !uuid) return
    const done = () => {
      pending.current = null
      onSaved?.(uuid)
      onClose()
    }
    const fail = (e: Error) => setError(e.message || "That didn't save. Please try again.")
    if (mode.kind === 'brief') {
      attach.mutate({ uuid, name: description.trim() }, { onSuccess: done, onError: fail })
    } else {
      save.mutate({ uuid, description: description.trim(), tag }, { onSuccess: done, onError: fail })
    }
  }

  return (
    <Modal onClose={onClose} className="am-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">{title}</div>
      <div className="rm-subheader">{subtitle}</div>

      {error ? (
        <div className="am-error">
          <div className="am-label">{error}</div>
          <button type="button" className="am-submit" onClick={reset}>
            START AGAIN
          </button>
        </div>
      ) : (
        <div className="am-form">
          {!editing && (
            <>
              {!uuid && !uploading && (
                <div className="am-zone">
                  <input
                    ref={input}
                    type="file"
                    className="am-file"
                    aria-label="Choose a file"
                    onChange={(e) => void pick(e.target.files?.[0])}
                  />
                  <div className="am-zone-icon">
                    <UploadIcon />
                  </div>
                  <div className="am-zone-text">Drag &amp; drop your file here, or click to browse</div>
                </div>
              )}
              {uploading && (
                <div className="am-zone">
                  <div className="am-zone-icon">
                    <UploadingIcon />
                  </div>
                  <div className="am-zone-text">Uploading...</div>
                </div>
              )}
              {uuid && !uploading && (
                <div className="am-zone">
                  <div className="am-zone-icon">
                    <DoneIcon />
                  </div>
                  <div className="am-zone-text">Done!</div>
                </div>
              )}
              {(uuid || uploading) && (
                <div className="am-picked">
                  <div className="am-picked-icon">
                    <FileIcon />
                  </div>
                  <div className="am-picked-text">
                    {meta ? [meta.name, pickedSize(meta.size)].filter(Boolean).join('  ·  ') : 'Nothing loaded yet...'}
                  </div>
                  {uuid && (
                    <button type="button" className="am-picked-x" aria-label="Remove this file" onClick={reset} />
                  )}
                </div>
              )}
            </>
          )}

          {uuid && !uploading && (
            <div className="am-group">
              <label className="am-label" htmlFor="am-description">
                Give it a memorable name*
              </label>
              <input
                id="am-description"
                type="text"
                // No browser suggestions: the name is new every time — Andy, 16 Sep.
                autoComplete="off"
                maxLength={256}
                className="am-input"
                placeholder="e.g. Director's Treatment"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}

          {mode.kind !== 'brief' && (
            <div className="am-group">
              <div className="am-label">What is this?*</div>
              <div className="am-tags">
                {ASSET_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`am-tag${tag === t ? ' is-selected' : ''}`}
                    onClick={() => setTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dimmed rather than hidden, so what is still needed stays visible. */}
          <button
            type="button"
            className={`am-submit is-full${ok && !busy ? '' : ' is-off'}`}
            onClick={submit}
          >
            {busy ? 'SAVING…' : label}
          </button>
        </div>
      )}
    </Modal>
  )
}

/* ----------------------------------------------------------- the share modal */

type ShareState = { kind: 'pending' } | { kind: 'failed'; message: string } | { kind: 'ready'; link: string; expires: string }

/** shareable_link_menu. */
function AssetShareModal({ state, onClose }: { state: ShareState; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = state.kind === 'ready' ? state.link : null
  return (
    <Modal onClose={onClose}>
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">Shareable Link Generated</div>
      <div className="rm-subheader">This link will remain active for 7 days and will then expire.</div>
      <div className="rm-buttons">
        <div className="rm-link">
          {link ?? (state.kind === 'failed' ? state.message : 'Generating link...')}
        </div>
        <button
          type="button"
          className="wizard-btn rm-copy"
          onClick={() => {
            if (!link) return
            void navigator.clipboard.writeText(link).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? 'COPIED!' : 'COPY'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ the row cells */

/** share_asset_link_button and delete_asset_row_trigger. */
export function AssetRowActions({ asset, projectId }: { asset: ProjectFile; projectId: number | undefined }) {
  const [share, setShare] = useState<ShareState | null>(null)
  const [deleting, setDeleting] = useState(false)
  const del = useDeleteAsset(projectId)

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this file"
          onClick={(e) => {
            stop(e)
            setShare({ kind: 'pending' })
            shareAsset(asset.uuid).then(
              (s) => setShare({ kind: 'ready', link: s.link, expires: s.expires }),
              (err: Error) => setShare({ kind: 'failed', message: err.message }),
            )
          }}
        >
          <ShareIcon />
        </button>
      </span>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Delete this file"
          onClick={(e) => {
            stop(e)
            del.reset()
            setDeleting(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {share && <AssetShareModal state={share} onClose={() => setShare(null)} />}
      {deleting && (
        <Modal onClose={() => setDeleting(false)}>
          <div className="rm-header">Are you sure you want to delete this asset?</div>
          <div className="rm-subheader">Your client will no longer be able to see it.</div>
          {del.error && <p className="form-error">{del.error.message}</p>}
          <div className="rm-buttons">
            <button
              type="button"
              className="wizard-btn rm-button"
              disabled={del.isPending}
              onClick={() => del.mutate(asset.uuid, { onSuccess: () => setDeleting(false) })}
            >
              {del.isPending ? 'DELETING…' : 'CONFIRM'}
            </button>
            <button type="button" className="wizard-btn rm-button" onClick={() => setDeleting(false)}>
              CANCEL
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * The row body: opens the file's share page in a new tab, as the old row's
 * overlay does. The tab opens during the click (one opened after the link is
 * minted is blocked as a popup) and is pointed at the page once it exists.
 */
export function openAssetPage(uuid: string) {
  const tab = window.open('about:blank', '_blank')
  shareAsset(uuid).then(
    (s) => {
      if (tab && !tab.closed) tab.location.href = s.link
      else window.location.href = s.link
    },
    () => tab?.close(),
  )
}

