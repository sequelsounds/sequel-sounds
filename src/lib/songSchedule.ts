import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { mirror } from './xanoMirror'

/**
 * A new song and its Schedule A — the old app's New_song, the composer's
 * /song-confirmation form, and (new, Andy 16 Sep) the Schedule A signed on the
 * same page, on Sequel's own signing step, instead of SharePoint and BoldSign.
 * (Firma's embedded signing was tried first the same evening and dropped.)
 *
 * Everything goes through the `song-schedule-a` edge function: the emails need
 * a key the browser must never hold, and the signature record (IP, time,
 * details hash, the signed PDF) is only worth anything if the server makes it.
 * Spec: `claude/sequel-track-song-confirmation.md`.
 *
 * ⚠️ `sequel_songs` is still in the hourly Xano sync. A song made here is test
 * data until the cutover.
 */

const fn = (supabase as unknown as SupabaseClient).functions

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await fn.invoke('song-schedule-a', { body })
  if (error) {
    // A non-2xx arrives with our own message in the body; dig it out rather
    // than showing "Edge Function returned a non-2xx status code".
    let message = fallback
    const res = (error as { context?: Response }).context
    if (res && typeof res.json === 'function') {
      try {
        const b = (await res.json()) as { error?: string }
        if (b?.error) message = b.error
      } catch {
        /* keep the fallback */
      }
    }
    throw new Error(message)
  }
  return data as T
}

/* ------------------------------------------------------------ staff side */

export const OWNERSHIP_OPTIONS = ['Master & Publishing', 'Master', 'Publishing'] as const
export type Ownership = (typeof OWNERSHIP_OPTIONS)[number]

export type CreatedSong = {
  song_id: number
  uuid: string
  emailed: boolean
  /** Set when the song was made but the email did not go. Never silent. */
  email_error?: string
}

export function useCreateSong(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { supplierId: number; ownership: Ownership }) =>
      call<CreatedSong>(
        { action: 'create', project_id: projectId, supplier_id: v.supplierId, ownership: v.ownership },
        "The song couldn't be created. Please try again.",
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'songs', projectId] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'songs'] })
    },
  })
}

export function resendSongLink(songId: number) {
  return call<{ emailed: boolean; email_error?: string }>(
    { action: 'resend_link', song_id: songId },
    "The email couldn't be sent. Please try again.",
  )
}

export async function openSignedScheduleA(songId: number): Promise<string> {
  const r = await call<{ url: string }>(
    { action: 'document', song_id: songId },
    "The signed Schedule A couldn't be opened.",
  )
  return r.url
}

/* --------------------------------------------------------- composer side */

export type ConfirmState = 'invalid' | 'open' | 'sign' | 'done'

/** What the signing step shows: the Schedule A as it will be signed. */
export type Schedule = {
  team: string
  title: string
  writers: { full_name: string; cae_number: string | null; share_split: number }[]
  brand: string
  productionTitle: string
  commencementDate: string
  ownership: string
  /** Sent back on signing, so a signature is only ever for what was shown. */
  details_hash: string
  /** The wording of the tick box, word for word as it is recorded. */
  consent: string
  /** Where the signed copy goes. */
  email: string | null
}

export type ConfirmResult = {
  state: ConfirmState
  schedule?: Schedule
  /** A message for the composer, or a form error from the database. */
  error?: string
}

export type WriterInput = { full_name: string; cae_number: string; share_split: number }

export const songStatus = (uuid: string) =>
  call<ConfirmResult>({ action: 'status', uuid }, 'status failed')

export const submitSong = (uuid: string, trackTitle: string, writers: WriterInput[]) =>
  call<ConfirmResult>({ action: 'submit', uuid, track_title: trackTitle, writers }, 'submit_failed')

export const signSchedule = (uuid: string, name: string, consent: boolean, detailsHash: string) =>
  call<ConfirmResult>(
    { action: 'sign', uuid, name, consent, details_hash: detailsHash },
    "We couldn't sign your Schedule A just now. Please try again in a minute, or contact Sequel if the problem continues.",
  )

/* ------------------------------------------------------ the song page's view */

export type SongSigning = {
  schedule_a_via: string | null
  contract_email: string | null
  composer_reg_form_status: string | null
  link_emailed_at: string | null
  link_email_error: string | null
  confirmed_at: string | null
  schedule_a_sent_at: string | null
  schedule_a_signed_at: string | null
  schedule_a_signer_name: string | null
  schedule_a_pdf_path: string | null
  schedule_a_signer_ip: string | null
  signed_copy_emailed_at: string | null
  signed_copy_email_error: string | null
  /** Despite the name: the last thing that went wrong signing, for staff. */
  firma_error: string | null
}

export type SongWriter = { id: number; full_name: string | null; cae_number: string | null; share_split: number | null }

/** The signing columns (Xano never sends these), and the writers as confirmed. */
export function useSongSigning(songId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(songId),
    queryKey: ['mirror', 'song-signing', songId],
    queryFn: async (): Promise<{ signing: SongSigning | null; writers: SongWriter[] }> => {
      const [s, w] = await Promise.all([
        mirror
          .from('sequel_songs')
          .select(
            'schedule_a_via, contract_email, composer_reg_form_status, link_emailed_at, link_email_error, confirmed_at, schedule_a_sent_at, schedule_a_signed_at, schedule_a_signer_name, schedule_a_pdf_path, schedule_a_signer_ip, signed_copy_emailed_at, signed_copy_email_error, firma_error',
          )
          .eq('id', songId!)
          .maybeSingle(),
        mirror
          .from('sequel_song_writer')
          .select('id, full_name, cae_number, share_split')
          .eq('song_id', songId!)
          .order('id'),
      ])
      if (s.error) throw s.error
      if (w.error) throw w.error
      return { signing: (s.data as SongSigning | null) ?? null, writers: (w.data ?? []) as SongWriter[] }
    },
  })
}
