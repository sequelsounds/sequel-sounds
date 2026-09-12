import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSession } from './auth'
import type { Tables } from './database.types'
import { supabase } from './supabase'

/**
 * Every read the staff app makes, in one place, so the query keys and the
 * column lists are not restated per route. Embedded selects are typed by hand
 * rather than inferred: the parser's inference is fragile on aggregates and
 * one wrong guess turns the whole result into an error type at build time.
 */

export const TRACK_COLS =
  'id, project_id, kind, title, artist, album, duration_seconds, preview_key, artwork_s3_key, processing_status, submitter_name, submitter_email, submitter_company, notes, submission_id, created_at'

export type Track = Pick<
  Tables<'tracks'>,
  | 'id'
  | 'project_id'
  | 'kind'
  | 'title'
  | 'artist'
  | 'album'
  | 'duration_seconds'
  | 'preview_key'
  | 'artwork_s3_key'
  | 'processing_status'
  | 'submitter_name'
  | 'submitter_email'
  | 'submitter_company'
  | 'notes'
  | 'submission_id'
  | 'created_at'
>

/** A track plus which playlists already hold it, for the "in N playlists" pill. */
export type TrackWithUse = Track & {
  playlist_tracks: { playlist_id: string }[]
  projects_mirror?: { id: string; name: string } | null
}

export function playlistCount(track: TrackWithUse): number {
  return new Set(track.playlist_tracks.map((p) => p.playlist_id)).size
}

// ---------------------------------------------------------------- projects

export type ProjectSummary = Pick<
  Tables<'projects_mirror'>,
  'id' | 'xano_id' | 'name' | 'client_name' | 'status' | 'created_at'
> & { tracks: { count: number }[]; playlists: { count: number }[] }

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects_mirror')
        .select('id, xano_id, name, client_name, status, created_at, tracks(count), playlists(count)')
        .order('name')
      if (error) throw error
      return data as unknown as ProjectSummary[]
    },
  })
}

export type ProjectDetail = Pick<
  Tables<'projects_mirror'>,
  'id' | 'xano_id' | 'name' | 'client_name' | 'status' | 'brief'
> & { inboxes: { token: string; is_active: boolean } | null }

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects_mirror')
        .select('id, xano_id, name, client_name, status, brief, inboxes(token, is_active)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as ProjectDetail
    },
  })
}

export function useProjectTracks(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['tracks', 'project', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tracks')
        .select(`${TRACK_COLS}, playlist_tracks(playlist_id)`)
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as TrackWithUse[]
    },
  })
}

/** PostgREST filter syntax uses these; a search term must not. */
function safeTerm(q: string): string {
  return q.replace(/[,()."\\%]/g, ' ').trim()
}

export function useLibraryTracks(search: string) {
  const term = safeTerm(search)
  return useQuery({
    queryKey: ['tracks', 'library', term],
    queryFn: async () => {
      let query = supabase
        .from('tracks')
        .select(`${TRACK_COLS}, playlist_tracks(playlist_id), projects_mirror(id, name)`)
        .order('created_at', { ascending: false })
        .limit(500)
      if (term) {
        query = query.or(
          `title.ilike.%${term}%,artist.ilike.%${term}%,album.ilike.%${term}%,submitter_company.ilike.%${term}%`,
        )
      }
      const { data, error } = await query
      if (error) throw error
      return data as unknown as TrackWithUse[]
    },
  })
}

// ---------------------------------------------------------------- playlists

export type PlaylistSummary = Pick<
  Tables<'playlists'>,
  | 'id'
  | 'name'
  | 'project_id'
  | 'token'
  | 'require_sign_in'
  | 'visible_to_client'
  | 'video_track_id'
  | 'updated_at'
  | 'created_at'
> & {
  playlist_tracks: { count: number }[]
  projects_mirror: { id: string; name: string } | null
}

const PLAYLIST_SUMMARY_COLS =
  'id, name, project_id, token, require_sign_in, visible_to_client, video_track_id, updated_at, created_at, playlist_tracks(count), projects_mirror(id, name)'

/** undefined = every playlist; a project id = that project's; null = unattached. */
export function usePlaylists(projectId?: string | null) {
  return useQuery({
    queryKey: ['playlists', projectId === undefined ? 'all' : projectId],
    queryFn: async () => {
      let query = supabase
        .from('playlists')
        .select(PLAYLIST_SUMMARY_COLS)
        .order('updated_at', { ascending: false })
      if (projectId === null) query = query.is('project_id', null)
      else if (projectId) query = query.eq('project_id', projectId)
      const { data, error } = await query
      if (error) throw error
      return data as unknown as PlaylistSummary[]
    },
  })
}

export type PlaylistTrackRow = Tables<'playlist_tracks'> & { tracks: Track | null }

export type PlaylistDetail = Tables<'playlists'> & {
  playlist_sections: Tables<'playlist_sections'>[]
  playlist_tracks: PlaylistTrackRow[]
  projects_mirror: { id: string; name: string } | null
  video: Track | null
}

export function usePlaylist(id: string | null) {
  return useQuery({
    queryKey: ['playlist', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('playlists')
        .select(
          `*, playlist_sections(*), playlist_tracks(*, tracks(${TRACK_COLS})), projects_mirror(id, name), video:tracks!playlists_video_track_id_fkey(${TRACK_COLS})`,
        )
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as PlaylistDetail
    },
  })
}

// ---------------------------------------------------------------- recent

export type RecentProject = { id: string; name: string; hasNew: boolean }

export function useRecentProjects() {
  const session = useSession()
  const uid = session?.user.id
  return useQuery({
    queryKey: ['recent', uid],
    enabled: !!uid,
    queryFn: async (): Promise<RecentProject[]> => {
      const { data, error } = await supabase
        .from('staff_project_visits')
        .select('project_id, seen_at, projects_mirror(id, name)')
        .eq('user_id', uid!)
        .order('seen_at', { ascending: false })
        .limit(6)
      if (error) throw error
      const visits = data as unknown as {
        project_id: string
        seen_at: string
        projects_mirror: { id: string; name: string } | null
      }[]
      if (visits.length === 0) return []

      // Anything that arrived after the last look earns the dot.
      const oldest = visits.reduce((m, v) => (v.seen_at < m ? v.seen_at : m), visits[0].seen_at)
      const { data: fresh } = await supabase
        .from('tracks')
        .select('project_id, created_at')
        .in(
          'project_id',
          visits.map((v) => v.project_id),
        )
        .gt('created_at', oldest)
      const latest = new Map<string, string>()
      for (const t of fresh ?? []) {
        const prev = latest.get(t.project_id)
        if (!prev || t.created_at > prev) latest.set(t.project_id, t.created_at)
      }
      return visits
        .filter((v) => v.projects_mirror)
        .map((v) => ({
          id: v.project_id,
          name: v.projects_mirror!.name,
          hasNew: (latest.get(v.project_id) ?? '') > v.seen_at,
        }))
    },
  })
}

/** Opening a project marks it seen, which is what clears its dot. */
export function useRecordVisit(projectId: string | undefined) {
  const session = useSession()
  const qc = useQueryClient()
  const uid = session?.user.id
  useEffect(() => {
    if (!uid || !projectId) return
    void supabase
      .from('staff_project_visits')
      .upsert(
        { user_id: uid, project_id: projectId, seen_at: new Date().toISOString() },
        { onConflict: 'user_id,project_id' },
      )
      .then(() => qc.invalidateQueries({ queryKey: ['recent', uid] }))
  }, [uid, projectId, qc])
}

// ---------------------------------------------------------------- search

export type SearchResults = {
  projects: { id: string; name: string; client_name: string | null }[]
  playlists: { id: string; name: string; project_id: string | null }[]
  tracks: { id: string; title: string; artist: string | null; project_id: string }[]
}

export function useSearch(q: string) {
  const term = safeTerm(q)
  return useQuery({
    queryKey: ['search', term],
    enabled: term.length >= 2,
    staleTime: 10_000,
    queryFn: async (): Promise<SearchResults> => {
      const like = `%${term}%`
      const [projects, playlists, tracks] = await Promise.all([
        supabase.from('projects_mirror').select('id, name, client_name').ilike('name', like).limit(6),
        supabase.from('playlists').select('id, name, project_id').ilike('name', like).limit(6),
        supabase
          .from('tracks')
          .select('id, title, artist, project_id')
          .or(`title.ilike.${like},artist.ilike.${like}`)
          .limit(8),
      ])
      return {
        projects: projects.data ?? [],
        playlists: playlists.data ?? [],
        tracks: tracks.data ?? [],
      }
    },
  })
}

// ---------------------------------------------------------------- writes

export type OrderRow = {
  id: string
  track_id: string
  section_id: string | null
  position: number
}

export function usePlaylistActions() {
  const qc = useQueryClient()
  const session = useSession()

  const touched = (playlistId?: string | null) => {
    void qc.invalidateQueries({ queryKey: ['playlists'] })
    void qc.invalidateQueries({ queryKey: ['tracks'] })
    if (playlistId) void qc.invalidateQueries({ queryKey: ['playlist', playlistId] })
  }

  const createPlaylist = useMutation({
    mutationFn: async (input: { projectId: string | null; name?: string }) => {
      const { data, error } = await supabase
        .from('playlists')
        .insert({
          project_id: input.projectId,
          name: input.name ?? 'New playlist',
          created_by: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id
    },
    onSuccess: () => touched(),
  })

  const updatePlaylist = useMutation({
    mutationFn: async (input: { id: string } & Partial<Tables<'playlists'>>) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('playlists').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => touched(v.id),
  })

  const deletePlaylist = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('playlists').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => touched(),
  })

  const duplicatePlaylist = useMutation({
    mutationFn: async (source: PlaylistDetail) => {
      const { data: copy, error } = await supabase
        .from('playlists')
        .insert({
          project_id: source.project_id,
          name: `${source.name} copy`,
          description: source.description,
          video_track_id: source.video_track_id,
          require_sign_in: source.require_sign_in,
          visible_to_client: source.visible_to_client,
          created_by: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error

      const sectionMap = new Map<string, string>()
      if (source.playlist_sections.length) {
        const rows = source.playlist_sections.map((s) => {
          const id = crypto.randomUUID()
          sectionMap.set(s.id, id)
          return { id, playlist_id: copy.id, name: s.name, position: s.position }
        })
        const { error: e } = await supabase.from('playlist_sections').insert(rows)
        if (e) throw e
      }
      if (source.playlist_tracks.length) {
        const rows = source.playlist_tracks.map((pt) => ({
          playlist_id: copy.id,
          track_id: pt.track_id,
          section_id: pt.section_id ? (sectionMap.get(pt.section_id) ?? null) : null,
          position: pt.position,
          note: pt.note,
          sync_offset_seconds: pt.sync_offset_seconds,
        }))
        const { error: e } = await supabase.from('playlist_tracks').insert(rows)
        if (e) throw e
      }
      return copy.id
    },
    onSuccess: () => touched(),
  })

  /** Writes the whole order in one go; new rows are inserted by the same upsert. */
  const persistOrder = useMutation({
    mutationFn: async (input: { playlistId: string; rows: OrderRow[] }) => {
      const { error } = await supabase.from('playlist_tracks').upsert(
        input.rows.map((r) => ({
          id: r.id,
          playlist_id: input.playlistId,
          track_id: r.track_id,
          section_id: r.section_id,
          position: r.position,
        })),
        { onConflict: 'id' },
      )
      if (error) throw error
    },
    onSuccess: (_d, v) => touched(v.playlistId),
  })

  const removeTrack = useMutation({
    mutationFn: async (input: { playlistId: string; id: string }) => {
      const { error } = await supabase.from('playlist_tracks').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => touched(v.playlistId),
  })

  const addSection = useMutation({
    mutationFn: async (input: { playlistId: string; name: string; position: number }) => {
      const { data, error } = await supabase
        .from('playlist_sections')
        .insert({ playlist_id: input.playlistId, name: input.name, position: input.position })
        .select('id')
        .single()
      if (error) throw error
      return data.id
    },
    onSuccess: (_d, v) => touched(v.playlistId),
  })

  const updateSection = useMutation({
    mutationFn: async (input: { playlistId: string; id: string; name?: string; position?: number }) => {
      const { playlistId: _p, id, ...patch } = input
      const { error } = await supabase.from('playlist_sections').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => touched(v.playlistId),
  })

  const reorderSections = useMutation({
    mutationFn: async (input: { playlistId: string; rows: { id: string; name: string; position: number }[] }) => {
      const { error } = await supabase.from('playlist_sections').upsert(
        input.rows.map((r) => ({ ...r, playlist_id: input.playlistId })),
        { onConflict: 'id' },
      )
      if (error) throw error
    },
    onSuccess: (_d, v) => touched(v.playlistId),
  })

  const deleteSection = useMutation({
    mutationFn: async (input: { playlistId: string; id: string }) => {
      const { error } = await supabase.from('playlist_sections').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => touched(v.playlistId),
  })

  return {
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    duplicatePlaylist,
    persistOrder,
    removeTrack,
    addSection,
    updateSection,
    reorderSections,
    deleteSection,
  }
}
