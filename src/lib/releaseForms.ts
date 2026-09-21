import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Release forms — the clearance letters Sequel sends broadcasters.
 *
 * ⚠️ THESE ARE NOT CONTRACTS and do not live with them. A release form grants
 * nothing; it states that a track has been cleared and on what terms, without
 * the money. It also usually goes out BEFORE any contract is written, so it
 * cannot hang off a contract row — Andy, 18 Sep. Hence its own table,
 * `public.track_release_forms`, outside the Xano mirror entirely.
 *
 * ⚠️ ONE TRACK PER FORM — Andy, 19 Sep. Two tracks is two forms.
 *
 * The PDF is drawn server-side by the `release-form` function onto Andy's own
 * Word export of the letterhead. Nothing about the document is built here.
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

export type ReleaseFormRow = {
  id: number
  uuid: string
  /** '#1000-R'. Built by `track_ref` in SQL — never rebuilt in a page. */
  ref: string
  recipient_name: string
  recipient_email: string
  track_name: string
  brand: string
  campaign: string
  signer_name: string
  issued_on: string
  /** null until it has been emailed from here. */
  sent_at: string | null
  created_at: string
}

export type ReleaseFormFields = {
  recipient_name: string
  recipient_address: string
  /** Only needed to SEND one. A form is perfectly valid without it. */
  recipient_email: string
  brand: string
  campaign: string
  track_name: string
  term: string
  territory: string
  media: string
  scripts: string
}

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

/** The Contracting tab's second list. Its own, not mixed in with contracts. */
export function useProjectReleaseForms(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['release-forms', id],
    queryFn: async () => {
      const { data, error } = await rpc('track_project_release_forms', { p_project_id: id })
      if (error) throw error
      return (data ?? []) as ReleaseFormRow[]
    },
  })
}

/**
 * Issue one. The row is written first — which is what decides the signer, the
 * date and the file's key — then the PDF is drawn and stored, and a signed url
 * comes back. If the drawing or the upload fails the row is discarded, so
 * anything in the list above has a file behind it.
 */
export function useCreateReleaseForm(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f: ReleaseFormFields) => {
      const r = await callFunction('release-form', {
        action: 'create',
        project_id: projectId,
        ...f,
      })
      return r as { uuid: string; ref: string; url: string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['release-forms', projectId] })
    },
  })
}

/**
 * The Send to picker. Clients, with their address already assembled into lines
 * by SQL.
 *
 * ⚠️ Picking one FILLS TWO BOXES and nothing more — no client id is stored on
 * the form. A release form goes to a broadcaster, which is often not the
 * project's client and sometimes not a client at all, so a typed name that
 * matches nobody is a good answer and is what prints.
 */
export type ClientOption = { id: number; company: string; address: string | null }

export function useClientsForPicker() {
  return useQuery({
    queryKey: ['clients-picker'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await rpc('track_clients_for_picker')
      if (error) throw error
      return (data ?? []) as ClientOption[]
    },
  })
}

export async function releaseFormUrl(uuid: string, opts: { download?: boolean } = {}) {
  const r = await callFunction('release-form', { action: 'read', uuid, ...opts })
  return r.url as string
}

/**
 * Change one that already exists.
 *
 * ⚠️ The PDF is redrawn OVER THE SAME KEY, so a link already shared keeps
 * working and shows the correction. The issue date does not move: it is the
 * date the broadcaster was told, and fixing a typo does not re-date that.
 */
export function useUpdateReleaseForm(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, ...f }: ReleaseFormFields & { uuid: string }) => {
      const r = await callFunction('release-form', { action: 'update', uuid, ...f })
      return r as { uuid: string; ref: string; url: string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['release-forms', projectId] })
    },
  })
}

/** What the modal needs to open on a row that already exists. */
export type ReleaseFormDetail = ReleaseFormFields & {
  uuid: string
  ref: string
  signer_name: string
  issued_on: string
  sent_at: string | null
  sent_to: string | null
  send_error: string | null
}

export function useReleaseFormDetail(uuid: string | undefined) {
  return useQuery({
    enabled: Boolean(uuid),
    queryKey: ['release-form', uuid],
    queryFn: async () => {
      const { data, error } = await rpc('track_release_form_detail', { p_uuid: uuid })
      if (error) throw error
      return data as ReleaseFormDetail
    },
  })
}

/**
 * The agency on a project, as a starting point for a new release form.
 *
 * ⚠️ A STARTING POINT, NEVER A BINDING — the same rule as the client picker.
 * A release form often goes to a broadcaster who is not on the project at all,
 * so this only fills boxes that stay editable, and no client id is stored.
 *
 * Address lines are assembled by the same SQL as `track_clients_for_picker`,
 * so a prefilled address and a picked one look identical.
 */
export function useProjectReleaseRecipient(projectId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(projectId),
    queryKey: ['release-form-recipient', projectId],
    queryFn: async () => {
      const { data, error } = await rpc('track_project_release_recipient', {
        p_project_id: projectId,
      })
      if (error) throw error
      return data as { name: string; address: string }
    },
  })
}

export function shareLink(code: string) {
  return `${window.location.origin}/link?id=${code}`
}

export async function shareReleaseForm(uuid: string): Promise<{ link: string; expires: string }> {
  const { data, error } = await rpc('track_share_release_form', { p_uuid: uuid })
  if (error) throw error
  const d = data as { code: string; expires_at: string }
  return { link: shareLink(d.code), expires: d.expires_at }
}

/** ⚠️ Archives. The letter was sent; it is not unsent by deleting the record.
 *  The share link goes with it, so a shared url stops resolving at once. */
export function useArchiveReleaseForm(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await rpc('track_archive_release_form', { p_uuid: uuid })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['release-forms', projectId] })
    },
  })
}

/**
 * Email the stored PDF, copying whoever is logged in. Nothing is drawn: what
 * arrives is the same bytes the link serves.
 *
 * ⚠️ THE WORDS ARE FIXED AND LIVE IN RESEND — Andy, 20 Sep. A per-send message
 * box was built and then removed: the email only ever needs to say that a
 * release form has been sent, and the template already prints the track, the
 * terms and the button. What this call still decides is WHO it goes to, which
 * is why the modal survives — a send is irreversible and the address is worth
 * a second look.
 */
export function useSendReleaseForm(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { uuid: string; to: string; subject: string }) => {
      const r = await callFunction('release-form', { action: 'send', ...v })
      return r as { sent_to: string; cc: string[]; link: string }
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['release-forms', projectId] })
      void qc.invalidateQueries({ queryKey: ['release-form-activity', v.uuid] })
    },
  })
}

export type ReleaseFormActivity = {
  sent_at: string | null
  sent_to: string | null
  views: number
  downloads: number
  last_view: string | null
  last_download: string | null
}

/**
 * Whether a sent release form has actually been looked at.
 *
 * ⚠️ IT COUNTS OPENS, NOT PEOPLE. A forwarded link is somebody else and
 * nothing here can tell the difference, so this answers "it reached someone"
 * and never "the person it was addressed to read it".
 *
 * ⚠️ A form sent before 0054, or one whose email carried an attachment, shows
 * zero however well it was received. Numbers only exist for links.
 */
export function useReleaseFormActivity(uuid: string | undefined, enabled = true) {
  return useQuery({
    enabled: Boolean(uuid) && enabled,
    queryKey: ['release-form-activity', uuid],
    queryFn: async () => {
      const { data, error } = await rpc('track_release_form_activity', { p_uuid: uuid })
      if (error) throw error
      return data as ReleaseFormActivity
    },
  })
}
