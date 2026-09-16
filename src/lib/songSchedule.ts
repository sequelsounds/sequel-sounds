import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { mirror } from './xanoMirror'

/**
 * A new song and its Schedule A — the old app's New_song, the composer's
 * /song-confirmation form, and (new, Andy 16 Sep) the Schedule A signed on the
 * same page through Firma instead of SharePoint and BoldSign.
 *
 * Everything goes through the `song-schedule-a` edge function, because the
 * email (Resend) and the signing (Firma) both need keys the browser must never
 * hold. Spec: `claude/sequel-track-song-confirmation.md`.
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

/** Asks Firma, through the server, whether the composer has signed. */
export function refreshSigning(songId: number) {
  return call<{ state: string; declined?: boolean }>(
    { action: 'refresh', song_id: songId },
    "Couldn't check the signature just now.",
  )
}

/** After a decline: the composer's link makes a fresh signing request. */
export function resetSigning(songId: number) {
  return call<{ ok: boolean }>({ action: 'reset_signing', song_id: songId }, "Couldn't reset the signing.")
}

export async function openSignedScheduleA(songId: number): Promise<string> {
  const r = await call<{ url: string }>(
    { action: 'document', song_id: songId },
    "The signed Schedule A couldn't be opened.",
  )
  return r.url
}

/* --------------------------------------------------------- composer side */

export type ConfirmState = 'invalid' | 'open' | 'sign' | 'done' | 'preparing'

export type ConfirmResult = {
  state: ConfirmState
  signing_url?: string | null
  /** A message for the composer, or a form error from the database. */
  error?: string
  declined?: boolean
}

export type WriterInput = { full_name: string; cae_number: string; share_split: number }

export const songStatus = (uuid: string) =>
  call<ConfirmResult>({ action: 'status', uuid }, 'status failed')

export const submitSong = (uuid: string, trackTitle: string, writers: WriterInput[]) =>
  call<ConfirmResult>({ action: 'submit', uuid, track_title: trackTitle, writers }, 'submit_failed')

export const openSigning = (uuid: string) =>
  call<ConfirmResult>({ action: 'sign', uuid }, 'sign_failed')

export const checkSigned = (uuid: string) =>
  call<ConfirmResult>({ action: 'check', uuid }, 'check_failed')

/** The only origin the signing frame may talk to us from. */
export const FIRMA_ORIGIN = 'https://app.firma.dev'

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
            'schedule_a_via, contract_email, composer_reg_form_status, link_emailed_at, link_email_error, confirmed_at, schedule_a_sent_at, schedule_a_signed_at, schedule_a_signer_name, schedule_a_pdf_path, firma_error',
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
