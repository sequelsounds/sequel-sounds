import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * In-app notifications for Sequel staff.
 *
 * ⚠️ NOT `xano_mirror.notifications`. That table exists and even has the right
 * vocabulary from the old app (`schedule_a_viewed`, `schedule_a_signed`), but
 * the Xano sync overwrites the whole mirror hourly, so anything written there
 * is gone within the hour. These live in `public.track_notifications`.
 *
 * ⚠️ RAISED IN THE DATABASE, NOT HERE. `track_log_share_event` writes the event
 * and the notification in one function, so recording that a release form was
 * opened and telling somebody about it cannot drift apart.
 */

const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

export type Notification = {
  id: number
  kind: string
  message: string
  project_id: number | null
  subject_kind: string | null
  subject_uuid: string | null
  created_at: string
  read_at: string | null
}

export type Notifications = { unread: number; items: Notification[] }

/**
 * ⚠️ POLLED, NOT LIVE. A minute is soon enough for "a broadcaster opened your
 * release form" and costs one small query per staff member per minute. A
 * realtime subscription would be the upgrade if these ever become urgent.
 */
export function useNotifications(limit = 50) {
  return useQuery({
    queryKey: ['notifications', limit],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Notifications> => {
      const { data, error } = await rpc('track_my_notifications', { p_limit: limit })
      if (error) throw error
      return data as Notifications
    },
  })
}

/** `ids` omitted marks everything read. The database only ever touches the
 *  caller's own rows — the user is taken from the session, never sent. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids?: number[]) => {
      const { error } = await rpc('track_mark_notifications_read', { p_ids: ids ?? null })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** Where a notification points, when it points anywhere. */
export function notificationHref(n: Notification): string | null {
  if (n.subject_kind === 'release_form' && n.project_id) {
    return `/projects/${n.project_id}?tab=Contracting`
  }
  return n.project_id ? `/projects/${n.project_id}` : null
}
