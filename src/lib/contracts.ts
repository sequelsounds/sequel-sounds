import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { mirror } from './xanoMirror'

/**
 * Contracts — the old app's Contracts group, rebuilt over `sign-contract` (S3
 * and the AI read) and the `track_*_contract` functions (migration 0040).
 * Files live in sequel-sounds-media under `contracts/{uuid}_{filename}`.
 *
 * ⚠️ The 27 contracts that predate the rebuild still have their files in the
 * old bucket (contract-hub) under `YYYY/…` keys. Their rows read fine; OPEN
 * says so plainly rather than signing a URL that would 403. The cutover copies
 * them across.
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

export type ContractRow = {
  id: number
  /** '#1013-C'. Built by `track_ref` in SQL — never rebuilt in a page. */
  ref: string
  uuid: string
  project_master_list_id: number | null
  file_name: string | null
  file_type: string | null
  file_size: string | null
  description: string | null
  contract_type_id: number | null
  contract_type: string | null
  supplier_list_id: number | null
  supplier: string | null
  artist: string | null
  song_name: string | null
  notes: string | null
  status: string | null
  confirmed: boolean | null
  start_date: string | null
  end_date: string | null
  term_value: number | null
  term_unit: string | null
  perpetual: boolean | null
  renewal_notify_at: string | null
  renewal_notified_at: string | null
  master_pct: number | null
  publishing_pct: number | null
  mcps_yn: boolean | null
  supplier_address: string | null
  url: string | null
  created_at: string | null
}

/** What the model suggests. Nothing here is saved until someone saves it. */
export type Suggested = {
  contract_type: string | null
  supplier_id: number | null
  supplier: string | null
  supplier_matched_on: string[]
  country_matched: boolean
  supplier_address: string | null
  artist: string | null
  song_name: string | null
  master_pct: number | null
  publishing_pct: number | null
  mcps: boolean
  start_date: string | null
  end_date: string | null
  term_value: number | null
  term_unit: string | null
  perpetual: boolean
  summary: string | null
  dates_resolved: boolean
}

/** The Contracting tab's list: confirmed and not archived, newest first. */
export function useProjectContracts(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'contracts', id],
    queryFn: async () => {
      const { data, error } = await mirror
        .from('project_contracts')
        .select('*')
        .eq('project_master_list_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ContractRow[]
    },
  })
}

export const TERM_UNITS = ['days', 'weeks', 'months', 'years'] as const

async function callFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
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

const signContract = (body: Record<string, unknown>) => callFunction('sign-contract', body)

/** The row first, unconfirmed, then the file — as with assets. */
export async function uploadContract(projectId: number, file: File): Promise<string> {
  const signed = await signContract({
    action: 'upload',
    project_id: projectId,
    file_name: file.name,
    size_bytes: file.size,
    file_type: file.type || 'application/pdf',
  })
  const put = await fetch(signed.upload_url as string, { method: 'PUT', body: file })
  if (!put.ok) {
    const detail = await put.text().catch(() => '')
    console.error('sign-contract: S3 refused the PUT', put.status, detail.slice(0, 500))
    void Promise.resolve(discardContract(signed.uuid as string)).catch(() => undefined)
    /**
     * ⚠️ 403 HERE IS AN IAM POLICY, NOT A BUG. `sequel-sounds-signer` needs
     * Put/Get on `contracts/*` in sequel-sounds-media, the same inline policy
     * project-assets has.
     */
    if (put.status === 403) {
      throw new Error(
        'Storage will not accept contracts yet — the upload key has no permission for that folder.',
      )
    }
    throw new Error('That file could not be uploaded. Please try again.')
  }
  return signed.uuid as string
}

/** The AI read. Suggestions only — it writes nothing. */
export async function extractContract(uuid: string): Promise<Suggested> {
  const r = await signContract({ action: 'extract', uuid })
  return r.suggested as Suggested
}

export async function contractUrl(uuid: string, opts: { download?: boolean } = {}) {
  const r = await signContract({ action: 'read', uuid, ...opts })
  return r.url as string
}

/** An abandoned upload: the row goes, and the file with it at cutover sweep. */
export function discardContract(uuid: string) {
  return rpc('track_discard_contract', { p_uuid: uuid })
}

export function shareLink(code: string) {
  return `${window.location.origin}/link?id=${code}`
}

export async function shareContract(uuid: string): Promise<{ link: string; expires: string }> {
  const { data, error } = await rpc('track_share_contract', { p_uuid: uuid })
  if (error) throw error
  const d = data as { code: string; expires_at: string }
  return { link: shareLink(d.code), expires: d.expires_at }
}

export type ContractFields = {
  uuid: string
  contract_type: number | null
  supplier_id: number | null
  description: string
  artist: string
  song_name: string
  notes: string
  master_pct: string
  publishing_pct: string
  mcps_yn: boolean
  start_date: string | null
  end_date: string | null
  term_value: number | null
  term_unit: string | null
  perpetual: boolean
  supplier_address: string
}

export function useSaveContract(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f: ContractFields) => {
      const { data, error } = await rpc('track_save_contract', {
        p_uuid: f.uuid,
        p_contract_type: f.contract_type,
        p_supplier_id: f.supplier_id,
        p_description: f.description,
        p_artist: f.artist,
        p_song_name: f.song_name,
        p_notes: f.notes,
        p_master_pct: f.master_pct,
        p_publishing_pct: f.publishing_pct,
        p_mcps_yn: f.mcps_yn,
        p_start_date: f.start_date,
        p_end_date: f.end_date,
        p_term_value: f.term_value,
        p_term_unit: f.term_unit,
        p_perpetual: f.perpetual,
        p_supplier_address: f.supplier_address,
      })
      if (error) throw error
      return data as { uuid: string; end_date: string | null; perpetual: boolean }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'contracts', projectId] })
      void qc.invalidateQueries({ queryKey: ['contract-renewals'] })
    },
  })
}

/** ⚠️ Archives. A contract is the evidence we had the right to use the music. */
export function useArchiveContract(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await rpc('track_archive_contract', { p_uuid: uuid })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'contracts', projectId] })
      void qc.invalidateQueries({ queryKey: ['contract-renewals'] })
    },
  })
}

export function useContractTypes() {
  return useQuery({
    queryKey: ['mirror', 'contract-types'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await mirror.from('contract_types').select('id, type').order('type')
      if (error) throw error
      return (data ?? []) as { id: number; type: string }[]
    },
  })
}

/**
 * The supplier picker's list. No Supplier_Type filter, deliberately — a
 * composition team is one of the commonest contract counterparties.
 */
export function useSuppliersForPicker() {
  return useQuery({
    queryKey: ['mirror', 'suppliers-picker'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await mirror
        .from('supplier_list')
        .select('id, title, countries_list_id')
        .or('status.is.null,status.neq.Archived')
        .order('title')
      if (error) throw error
      return (data ?? []) as { id: number; title: string | null; countries_list_id: number | null }[]
    },
  })
}

/* ------------------------------------------------------- the contract page */

/**
 * One contract, with everything `/contracts/:uuid` shows — including the stored
 * AI summary and whether it is still current.
 *
 * ⚠️ `summary_current` is the whole caching decision, made in SQL: the stored
 * prompt version against the live one, with '' counted as never read. The page
 * calls the model ONLY when this is false.
 */
export type ContractDetail = {
  id: number
  /** '#1013-C'. Built by `track_ref` in SQL — never rebuilt in a page. */
  ref: string
  uuid: string
  file_name: string | null
  contract_type: string | null
  supplier: string | null
  artist: string | null
  song_name: string | null
  start_date: string | null
  end_date: string | null
  perpetual: boolean
  mcps_yn: boolean
  master_pct: number | null
  publishing_pct: number | null
  project_id: number | null
  project_uuid: string | null
  project_title: string | null
  project_sequel_no: string | null
  summary: string | null
  summary_status: string | null
  summary_version: string | null
  prompt_version: string | null
  summary_current: boolean
}

export function useContractDetail(uuid: string | undefined) {
  return useQuery({
    queryKey: ['contract-detail', uuid],
    enabled: Boolean(uuid),
    queryFn: async () => {
      const { data, error } = await rpc('track_contract_detail', { p_uuid: uuid })
      if (error) throw error
      return data as ContractDetail
    },
  })
}

/**
 * Read the whole document and write the result onto the row.
 *
 * Costs money and a few seconds, so it is called only when the cache says to,
 * or when someone presses TRY AGAIN. A refusal comes back as status 'failed'
 * with the reason, not as a thrown error — a failed read is stored so a second
 * visit does not re-run the model on a file that cannot be read.
 */
export async function summariseContract(
  uuid: string,
): Promise<{ status: 'ok' | 'failed'; summary: string; version: string }> {
  const r = await callFunction('summarise-contract', { action: 'summarise', uuid })
  return r as { status: 'ok' | 'failed'; summary: string; version: string }
}
