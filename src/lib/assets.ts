import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { peaksFromFile } from './peaks'

/**
 * Project assets and their share links — the old app's Project Assets API
 * group, rebuilt over `sign-asset` (S3) and the `track_*_asset` functions
 * (migration 0028). Files live in sequel-sounds-media under
 * `project-assets/{uuid}_{filename}`, the key shape Xano uses.
 *
 * ⚠️ `project_assets` is still in the hourly sync: an asset made here loses its
 * ROW on the next full push, and keeps its FILE. Test files need deleting by
 * hand (or through the row ✕ before the hour).
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

export const ASSET_TAGS = ['Final edit', 'WIP', 'Deck', 'Reference', 'Other'] as const

async function signAsset(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const res = await fetch(`${FUNCTIONS_URL}/sign-asset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${data.session?.access_token ?? key}`,
    },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const err = new Error((payload?.error as string) ?? `That did not work (${res.status}).`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return payload ?? {}
}

/**
 * create_asset_row, then the file. The row is written first, unconfirmed, so a
 * failed upload leaves a row (hidden) rather than a file nothing knows about.
 */
export async function uploadAsset(projectId: number, file: File): Promise<string> {
  const signed = await signAsset({
    action: 'upload',
    project_id: projectId,
    file_name: file.name,
    size_bytes: file.size,
    file_type: file.type,
  })
  const put = await fetch(signed.upload_url as string, { method: 'PUT', body: file })
  if (!put.ok) {
    // S3 explains itself in the XML and nowhere else.
    const detail = await put.text().catch(() => '')
    console.error('sign-asset: S3 refused the PUT', put.status, detail.slice(0, 500))
    // Leave nothing behind: the row goes too.
    void signAsset({ action: 'delete', uuid: signed.uuid }).catch(() => undefined)
    /**
     * ⚠️ 403 HERE IS AN IAM POLICY, NOT A BUG. `sequel-sounds-signer` needs
     * `sequel-sounds-media-project-assets-rw` (Put/Get/Delete on
     * project-assets/*) before this can work.
     */
    if (put.status === 403) {
      throw new Error('Storage will not accept project files yet — the upload key has no permission for that folder.')
    }
    throw new Error('That file could not be uploaded. Please try again.')
  }
  // An audio file gets its waveform worked out here, from the copy already on
  // this machine, so the share page never has to download it to draw one.
  // Never waited on, and a failure only means a flat bar.
  if (fileKind(file.name) === 'audio') {
    void peaksFromFile(file)
      .then((peaks) =>
        peaks ? rpc('track_set_asset_peaks', { p_uuid: signed.uuid, p_peaks: peaks }) : null,
      )
      .catch(() => undefined)
  }
  return signed.uuid as string
}

/** The dropzone ✕, and a modal closed before SUBMIT: the file and its row. */
export function discardAsset(uuid: string) {
  return signAsset({ action: 'delete', uuid })
}

/** A signed URL to open (or, with `download`, save) a file. */
export async function assetUrl(uuid: string, opts: { email?: boolean; download?: boolean } = {}) {
  const r = await signAsset({ action: 'read', uuid, ...opts })
  return r.url as string
}

export function shareLink(code: string) {
  return `${window.location.origin}/link?id=${code}`
}

export async function shareAsset(uuid: string): Promise<{ link: string; expires: string }> {
  const { data, error } = await rpc('track_share_asset', { p_uuid: uuid })
  if (error) throw error
  const d = data as { code: string; expires_at: string }
  return { link: shareLink(d.code), expires: d.expires_at }
}

/** A fresh link for every file on a project — EMAIL BRIEF's PROJECT ASSETS. */
export async function shareProjectAssets(projectId: number): Promise<{ label: string; link: string }[]> {
  const { data, error } = await rpc('track_share_project_assets', { p_project_id: projectId })
  if (error) throw error
  return ((data ?? []) as { label: string; code: string }[]).map((r) => ({
    label: r.label,
    link: shareLink(r.code),
  }))
}

export function useSaveAsset(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { uuid: string; description: string; tag: string | null }) => {
      const { error } = await rpc('track_save_asset', {
        p_uuid: v.uuid,
        p_description: v.description,
        p_tag: v.tag,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mirror', 'files', projectId] }),
  })
}

export function useDeleteAsset(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) => discardAsset(uuid),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mirror', 'files', projectId] }),
  })
}

export function useAttachBriefUpload(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { uuid: string; name: string }) => {
      const { error } = await rpc('track_attach_brief_upload', { p_asset_uuid: v.uuid, p_name: v.name })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mirror', 'briefs', projectId] }),
  })
}

/* ---------------------------------------------------------------- the share page */

export type SharedFile = {
  file_name: string
  file_type: string | null
  file_size: string | null
  expires_at: string
  url: string
  download_url: string
  /** The waveform, if it has been worked out yet. */
  peaks: number[] | null
}

/** `null` with a reason when the code is unknown, expired or throttled. */
export async function openShare(code: string): Promise<SharedFile | { error: string }> {
  try {
    return (await signAsset({ action: 'share', code })) as unknown as SharedFile
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/**
 * The share page's backfill: a file uploaded before waveforms existed gets one
 * the first time someone plays it. Write-once; the database ignores a second.
 */
export function saveSharePeaks(code: string, peaks: number[]) {
  return signAsset({ action: 'peaks', code, peaks }).catch(() => undefined)
}

/* ------------------------------------------------------------------ formatting */

export type FileKind = 'video' | 'audio' | 'image' | 'doc' | 'other'

/** share_kind: off the extension, as the old page decides it. */
export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'other'
  const ext = name.slice(dot + 1).toLowerCase()
  if (['mp4', 'mov', 'm4v', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'aac', 'm4a', 'aiff', 'aif', 'flac', 'ogg'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'doc'
  return 'other'
}

/** file_selected_text's size: KB under a megabyte, GB over a gigabyte. */
export function pickedSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}

/** brief_row_type for an uploaded brief: what kind of file it is. */
export function fileTypeLabel(fileType: string | null, fileName: string | null): string {
  const mime = String(fileType || '').toLowerCase()
  const ext = (String(fileName || '').split('.').pop() || '').toLowerCase()
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('audio/')) return 'Audio'
  if (mime.startsWith('image/')) return 'Image'
  const byExt: Record<string, string> = {
    key: 'Keynote',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',
    doc: 'Word',
    docx: 'Word',
    pages: 'Pages',
    xls: 'Excel',
    xlsx: 'Excel',
    zip: 'Zip',
    txt: 'Text',
    rtf: 'Text',
  }
  if (byExt[ext]) return byExt[ext]
  return ext ? ext.toUpperCase() : 'File'
}
