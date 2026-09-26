import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Composition AND library licences — Sequel → the client. A library licence
 * (26 Sep 2026) is the same record with kind 'library': Sequel sub-licenses a
 * library track under its agreement with the library. Same list, same actions.
 * claude/sequel-track-library-licence-handoff.md
 *
 * ⚠️ INVOICE FIRST — Andy, 25 Sep 2026: "a client doesn't get a licence
 * without the invoice being raised first." A licence is made FROM a raised
 * invoice on the project; the invoice's number prints on the certificate and
 * comes from the database, never from here.
 *
 * ⚠️ ONE LIST — they sit in the Contracting tab with supplier contracts and
 * release forms, told apart by type (Andy, 25 Sep: "all in the same place").
 *
 * The PDF is drawn by the `composition-licence` function onto Andy's own Word
 * export. Nothing about the document is built here.
 * Decisions: claude/sequel-track-composition-licence-decisions.md
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

export type LicenceKind = 'composition' | 'library'

export type LicenceRow = {
  id: number
  uuid: string
  kind: LicenceKind
  /** '#12-L'. Built by `track_ref` in SQL — never rebuilt in a page. */
  ref: string
  licensee_name: string
  composition_title: string
  invoice_number: string
  issued_on: string
  brand: string
  campaign: string
  /** null until it has been emailed from here. */
  sent_at: string | null
  created_at: string
}

export type LicenceFields = {
  licensee_name: string
  licensee_address: string
  rights_granted: string
  licensor_share: string
  composition_title: string
  writer_names: string
  production_name: string
  client_name: string
  brand: string
  campaign: string
  scripts: string
  cutdowns: string
  media: string
  territory: string
  term: string
  first_transmission: string
  licence_fee: string
}

export const BLANK_LICENCE: LicenceFields = {
  licensee_name: '',
  licensee_address: '',
  rights_granted: '',
  licensor_share: '',
  composition_title: '',
  writer_names: '',
  production_name: '',
  client_name: '',
  brand: '',
  campaign: '',
  scripts: '',
  cutdowns: '',
  media: '',
  territory: '',
  term: '',
  first_transmission: '',
  licence_fee: '',
}

export type LicenceInvoice = {
  id: number
  invoice_number: string
  invoice_date: string | null
  status: string
  currency: string | null
  total: number | null
  client: string | null
  /** How many live licences already print this invoice's number. */
  licences: number
  /** Has a paythrough library line — the only invoices a library licence can
   *  be made from (Andy, 26 Sep: when the client pays the library direct, the
   *  library issues the licence). */
  library_fee: boolean
}

export type LicenceSong = { id: number; title: string; writers: string }

export type LicenceDetail = LicenceFields & {
  uuid: string
  kind: LicenceKind
  ref: string
  invoice_id: number
  invoice_number: string
  sequel_no: string
  issued_on: string
}

async function callFunction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const res = await fetch(`${FUNCTIONS_URL}/composition-licence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${data.session?.access_token ?? key}`,
    },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) throw new Error((payload?.error as string) ?? `That did not work (${res.status}).`)
  return payload ?? {}
}

export function useProjectLicences(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['licences', id],
    queryFn: async () => {
      const { data, error } = await rpc('track_project_composition_licences', { p_project_id: id })
      if (error) throw error
      return (data ?? []) as LicenceRow[]
    },
  })
}

/** Raised invoices on the project — the only ones a licence can print. */
export function useLicenceInvoices(projectId: number | undefined, enabled = true) {
  return useQuery({
    enabled: Number.isFinite(projectId) && enabled,
    queryKey: ['licence-invoices', projectId],
    queryFn: async () => {
      const { data, error } = await rpc('track_licence_invoices', { p_project_id: projectId })
      if (error) throw error
      return (data ?? []) as LicenceInvoice[]
    },
  })
}

export function useLicenceSongs(projectId: number | undefined, enabled = true) {
  return useQuery({
    enabled: Number.isFinite(projectId) && enabled,
    queryKey: ['licence-songs', projectId],
    queryFn: async () => {
      const { data, error } = await rpc('track_licence_songs', { p_project_id: projectId })
      if (error) throw error
      return (data ?? []) as LicenceSong[]
    },
  })
}

/** Everything the project and the chosen invoice already know. A starting
 *  point only: every box stays editable. */
export async function fetchLicencePrefill(projectId: number, invoiceId: number) {
  const { data, error } = await rpc('track_licence_prefill', {
    p_project_id: projectId,
    p_invoice_id: invoiceId,
  })
  if (error) throw error
  return data as LicenceFields & {
    fee_parts?: LicenceFeeParts | null
    /** The paythrough library lines only — a library licence's fee. */
    library_parts?: LicenceFeeParts | null
  }
}

/** The invoice's master and publishing parts (0088), read off its lines. The
 *  licence fee is whichever side(s) the rights granted cover. */
export type LicenceFeeParts = { currency: string | null; master: number; publishing: number }

export function useLicenceDetail(uuid: string | undefined) {
  return useQuery({
    enabled: Boolean(uuid),
    queryKey: ['licence', uuid],
    queryFn: async () => {
      const { data, error } = await rpc('track_composition_licence_detail', { p_uuid: uuid })
      if (error) throw error
      return data as LicenceDetail
    },
  })
}

export function useCreateLicence(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { invoice_id: number; kind: LicenceKind; fields: LicenceFields }) =>
      (await callFunction({ action: 'create', project_id: projectId, ...v })) as {
        uuid: string
        ref: string
        url: string
      },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['licences', projectId] })
      void qc.invalidateQueries({ queryKey: ['licence-invoices', projectId] })
    },
  })
}

/** ⚠️ Redrawn OVER THE SAME KEY. The invoice, its number, the Sequel No. and
 *  the issue date never change on an edit. */
export function useUpdateLicence(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { uuid: string; fields: LicenceFields }) =>
      (await callFunction({ action: 'update', ...v })) as { uuid: string; ref: string; url: string },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['licences', projectId] })
      void qc.invalidateQueries({ queryKey: ['licence', v.uuid] })
    },
  })
}

export async function licenceUrl(uuid: string, opts: { download?: boolean } = {}) {
  const r = await callFunction({ action: 'read', uuid, ...opts })
  return r.url as string
}

export async function shareLicence(uuid: string): Promise<{ link: string; expires: string }> {
  const { data, error } = await rpc('track_share_composition_licence', { p_uuid: uuid })
  if (error) throw error
  const d = data as { code: string; expires_at: string }
  return { link: `${window.location.origin}/licence?id=${d.code}`, expires: d.expires_at }
}

/** ⚠️ Archives. The licence was issued; the record is kept. Its share link goes. */
export function useArchiveLicence(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await rpc('track_archive_composition_licence', { p_uuid: uuid })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['licences', projectId] })
      void qc.invalidateQueries({ queryKey: ['licence-invoices', projectId] })
    },
  })
}

/**
 * Email a LINK to the licence, copying whoever is logged in. The words live in
 * the Resend template. ⚠️ The address is typed by the sender every time — the
 * function refuses a send without one and never falls back to anything stored.
 */
export function useSendLicence(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { uuid: string; to: string }) =>
      (await callFunction({ action: 'send', ...v })) as { sent_to: string; cc: string[]; link: string },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['licences', projectId] })
      void qc.invalidateQueries({ queryKey: ['licence-activity', v.uuid] })
    },
  })
}

export type LicenceActivity = {
  sent_at: string | null
  sent_to: string | null
  views: number
  downloads: number
  last_view: string | null
  last_download: string | null
  /** One per address it was sent to (0088): opens and downloads of THAT
   *  address's link. ⚠️ A forwarded email carries the same link. */
  recipients: LicenceRecipientActivity[]
}

export type LicenceRecipientActivity = {
  to: string
  sent_at: string
  views: number
  downloads: number
  last_view: string | null
  last_download: string | null
}

/**
 * Whether a sent licence has been opened. ⚠️ Opens of the LINK, not people —
 * a forwarded link is somebody else. Fetched when the share menu opens.
 */
export function useLicenceActivity(uuid: string | undefined, enabled = true) {
  return useQuery({
    enabled: Boolean(uuid) && enabled,
    queryKey: ['licence-activity', uuid],
    queryFn: async () => {
      const { data, error } = await rpc('track_licence_activity', { p_uuid: uuid })
      if (error) throw error
      return data as LicenceActivity
    },
  })
}
