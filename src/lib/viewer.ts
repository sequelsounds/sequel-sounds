import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, use } from 'react'
import type { Database, Json, Tables } from './database.types'
import { supabase } from './supabase'

/**
 * Everything the viewer page reads and writes, behind one share token.
 *
 * The token travels as a header and RLS scopes every table to the one
 * playlist it names. A viewer who has signed in presents their own JWT as
 * well — that is what lets `app.current_playlist_id()` resolve a link that
 * requires a sign-in — and the two travel together on every request: the
 * client below takes its bearer from the app's own session, whatever that
 * is, so a signed-in viewer, a staff member previewing, and an anonymous
 * visitor all use the same code and differ only in what the database lets
 * through.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export type ViewerClient = SupabaseClient<Database>

export function viewerClient(token: string): ViewerClient {
  return createClient<Database>(url, key, {
    // With `accessToken` set the client never touches auth itself — signing
    // in happens on the app's main client, and this one only reads the
    // result. A null here means "no session", and the client falls back to
    // the publishable key, which is the anonymous case.
    accessToken: async () =>
      (await supabase.auth.getSession()).data.session?.access_token ?? null,
    global: { headers: { 'x-share-token': token } },
  })
}

// ---------------------------------------------------------------- context

export type ViewerContextValue = {
  token: string
  client: ViewerClient
  /** Who the request is made as; part of every query key so a sign-in refetches. */
  as: string
}

export const ViewerContext = createContext<ViewerContextValue | null>(null)

export function useViewer(): ViewerContextValue {
  const ctx = use(ViewerContext)
  if (!ctx) throw new Error('useViewer outside the viewer page')
  return ctx
}

// ------------------------------------------------------------------ types

/**
 * What a track shows a viewer. Deliberately not `TRACK_COLS`: the submitter,
 * the staff notes, the inbox it came through and the raw tags are the
 * office's business, and a forwarded link should not carry them.
 */
export const VIEWER_TRACK_COLS =
  'id, kind, title, artist, album, composer, publisher, label, duration_seconds, preview_key, artwork_s3_key, s3_key, original_filename, mime_type, size_bytes, processing_status, bpm, musical_key, lyrics'

export type ViewerTrack = Pick<
  Tables<'tracks'>,
  | 'id'
  | 'kind'
  | 'title'
  | 'artist'
  | 'album'
  | 'composer'
  | 'publisher'
  | 'label'
  | 'duration_seconds'
  | 'preview_key'
  | 'artwork_s3_key'
  | 's3_key'
  | 'original_filename'
  | 'mime_type'
  | 'size_bytes'
  | 'processing_status'
  | 'bpm'
  | 'musical_key'
  | 'lyrics'
>

export type ViewerRow = {
  id: string
  track_id: string
  section_id: string | null
  position: number
  note: string | null
  sync_offset_seconds: number | null
  tracks: ViewerTrack | null
}

export type ViewerPlaylist = Pick<
  Tables<'playlists'>,
  | 'id'
  | 'name'
  | 'description'
  | 'kind'
  | 'require_sign_in'
  | 'allow_download'
  | 'allow_originals'
  | 'video_track_id'
  | 'project_id'
  | 'updated_at'
> & {
  projects_mirror: { name: string; client_name: string | null } | null
  playlist_sections: Tables<'playlist_sections'>[]
  playlist_tracks: ViewerRow[]
  video: ViewerTrack | null
}

export type Gate =
  Database['public']['Functions']['playlist_gate']['Returns'][number]
export type Theme =
  Database['public']['Functions']['effective_theme']['Returns'][number]
export type ViewerComment = Pick<
  Tables<'comments'>,
  | 'id'
  | 'target_type'
  | 'target_id'
  | 'author_name'
  | 'body'
  | 'timestamp_seconds'
  | 'created_at'
>

// ---------------------------------------------------------------- queries

/**
 * What the link is, before it resolves. This works for anyone holding the
 * token, signed in or not, which is the point: it is how the page knows
 * whether to ask for a sign-in or to say the link is dead.
 */
export function useGate(token: string) {
  return useQuery({
    queryKey: ['viewer-gate', token],
    queryFn: async (): Promise<Gate | null> => {
      const { data, error } = await viewerClient(token).rpc('playlist_gate')
      if (error) throw error
      return data?.[0] ?? null
    },
  })
}

/**
 * The playlist itself. Filtered by token on purpose, not left to RLS: a
 * viewer's policies already narrow the table to this one row, but a member
 * of staff previewing the link sees every playlist, and an unfiltered
 * `.single()` came back with four rows and read as a dead link.
 */
export function useViewerPlaylist() {
  const { client, token, as } = useViewer()
  return useQuery({
    queryKey: ['viewer-playlist', token, as],
    queryFn: async () => {
      const { data, error } = await client
        .from('playlists')
        .select(
          `id, name, description, kind, require_sign_in, allow_download, allow_originals, video_track_id, project_id, updated_at, projects_mirror(name, client_name), playlist_sections(*), playlist_tracks(id, track_id, section_id, position, note, sync_offset_seconds, tracks(${VIEWER_TRACK_COLS})), video:tracks!playlists_video_track_id_fkey(${VIEWER_TRACK_COLS})`,
        )
        .eq('token', token)
        .single()
      if (error) throw error
      return data as unknown as ViewerPlaylist
    },
  })
}

export function useTheme() {
  const { client, token, as } = useViewer()
  return useQuery({
    queryKey: ['viewer-theme', token, as],
    queryFn: async (): Promise<Theme | null> => {
      const { data, error } = await client.rpc('effective_theme')
      if (error) throw error
      return data?.[0] ?? null
    },
  })
}

/** The notes on this playlist — by id, for the same reason as above. */
export function useComments(playlistId: string | null) {
  const { client, token, as } = useViewer()
  return useQuery({
    queryKey: ['viewer-comments', token, as],
    enabled: !!playlistId,
    queryFn: async () => {
      const { data, error } = await client
        .from('comments')
        .select(
          'id, target_type, target_id, author_name, body, timestamp_seconds, created_at',
        )
        .eq('playlist_id', playlistId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ViewerComment[]
    },
  })
}

/** Peaks for one track, fetched when it is on the player and not before. */
export function useViewerPeaks(trackId: string | null) {
  const { client, token, as } = useViewer()
  return useQuery({
    queryKey: ['viewer-peaks', token, as, trackId],
    enabled: !!trackId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await client
        .from('tracks')
        .select('waveform_peaks')
        .eq('id', trackId!)
        .single()
      if (error) throw error
      return Array.isArray(data.waveform_peaks)
        ? (data.waveform_peaks as number[])
        : null
    },
  })
}

// --------------------------------------------------------------- identity

/**
 * Who is leaving the note. A `viewers` row per playlist per email, minted
 * by `register_viewer`, is what the comment and event policies check. It is
 * kept per token in localStorage so a returning visitor is not asked twice,
 * and so a signed-in viewer is registered silently from their profile.
 */
export type Identity = { viewerId: string; name: string; email: string }

const identityKey = (token: string) => `sequel.viewer.${token}`

export function loadIdentity(token: string): Identity | null {
  try {
    const raw = localStorage.getItem(identityKey(token))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Identity>
    return parsed.viewerId && parsed.name && parsed.email
      ? { viewerId: parsed.viewerId, name: parsed.name, email: parsed.email }
      : null
  } catch {
    return null
  }
}

export function useRegister() {
  const { client, token } = useViewer()
  return useMutation({
    mutationFn: async (input: {
      name: string
      email: string
    }): Promise<Identity> => {
      const { data, error } = await client.rpc('register_viewer', {
        p_name: input.name.trim(),
        p_email: input.email.trim().toLowerCase(),
      })
      if (error) throw error
      const identity = {
        viewerId: data,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
      }
      try {
        localStorage.setItem(identityKey(token), JSON.stringify(identity))
      } catch {
        // Asking again next time is fine.
      }
      return identity
    },
  })
}

// --------------------------------------------------------------- writing

export function useAddComment() {
  const { client, token, as } = useViewer()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      playlistId: string
      identity: Identity
      targetType: 'track' | 'video'
      targetId: string
      body: string
      timestamp: number | null
    }) => {
      const { error } = await client.from('comments').insert({
        playlist_id: input.playlistId,
        target_type: input.targetType,
        target_id: input.targetId,
        viewer_id: input.identity.viewerId,
        author_name: input.identity.name,
        body: input.body.trim(),
        timestamp_seconds: input.timestamp,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['viewer-comments', token, as] })
    },
  })
}

/**
 * Activity, written and forgotten. Nothing on the page waits for these and
 * nothing is shown if one fails — a play that went unrecorded is not the
 * viewer's problem.
 */
export function useLogEvent() {
  const { client } = useViewer()
  return (input: {
    playlistId: string
    kind: Database['public']['Enums']['event_kind']
    trackId?: string | null
    viewerId?: string | null
    duration?: number | null
    position?: number | null
    meta?: Json | null
  }) => {
    void client
      .from('events')
      .insert({
        playlist_id: input.playlistId,
        kind: input.kind,
        track_id: input.trackId ?? null,
        viewer_id: input.viewerId ?? null,
        duration_seconds: input.duration ?? null,
        position_seconds: input.position ?? null,
        meta: input.meta ?? null,
      })
      .then(
        () => undefined,
        () => undefined,
      )
  }
}

// ---------------------------------------------------------------- profile

/** The once-only questions after a first sign-in, on the app's own client. */
export function useViewerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['viewer-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('viewer_profiles')
        .select('user_id, email, name, company, user_type')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useSaveProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      userId: string
      email: string
      name: string
      company: string | null
      userType: Database['public']['Enums']['viewer_type'] | null
    }) => {
      const { error } = await supabase.from('viewer_profiles').upsert({
        user_id: input.userId,
        email: input.email,
        name: input.name,
        company: input.company,
        user_type: input.userType,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['viewer-profile', v.userId] })
    },
  })
}
