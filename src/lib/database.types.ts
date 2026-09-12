export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          author_name: string
          body: string
          created_at: string
          id: string
          playlist_id: string
          resolved: boolean
          target_id: string
          target_type: Database["public"]["Enums"]["comment_target"]
          timestamp_seconds: number | null
          viewer_id: string | null
        }
        Insert: {
          author_name: string
          body: string
          created_at?: string
          id?: string
          playlist_id: string
          resolved?: boolean
          target_id: string
          target_type?: Database["public"]["Enums"]["comment_target"]
          timestamp_seconds?: number | null
          viewer_id?: string | null
        }
        Update: {
          author_name?: string
          body?: string
          created_at?: string
          id?: string
          playlist_id?: string
          resolved?: boolean
          target_id?: string
          target_type?: Database["public"]["Enums"]["comment_target"]
          timestamp_seconds?: number | null
          viewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          kind: Database["public"]["Enums"]["event_kind"]
          meta: Json | null
          playlist_id: string
          position_seconds: number | null
          track_id: string | null
          viewer_id: string | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          kind: Database["public"]["Enums"]["event_kind"]
          meta?: Json | null
          playlist_id: string
          position_seconds?: number | null
          track_id?: string | null
          viewer_id?: string | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["event_kind"]
          meta?: Json | null
          playlist_id?: string
          position_seconds?: number | null
          track_id?: string | null
          viewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      inboxes: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          label: string | null
          project_id: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          project_id: string
          token?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          project_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "inboxes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects_mirror"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_sections: {
        Row: {
          created_at: string
          id: string
          name: string
          playlist_id: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          playlist_id: string
          position?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          playlist_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "playlist_sections_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_themes: {
        Row: {
          accent_color: string | null
          background_color: string | null
          background_url: string | null
          font_family: string | null
          heading: string | null
          logo_url: string | null
          playlist_id: string
          preset_id: string | null
          text_color: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          background_color?: string | null
          background_url?: string | null
          font_family?: string | null
          heading?: string | null
          logo_url?: string | null
          playlist_id: string
          preset_id?: string | null
          text_color?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          background_color?: string | null
          background_url?: string | null
          font_family?: string | null
          heading?: string | null
          logo_url?: string | null
          playlist_id?: string
          preset_id?: string | null
          text_color?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_themes_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: true
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_themes_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "theme_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_tracks: {
        Row: {
          created_at: string
          id: string
          note: string | null
          playlist_id: string
          position: number
          section_id: string | null
          sync_offset_seconds: number | null
          track_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          playlist_id: string
          position?: number
          section_id?: string | null
          sync_offset_seconds?: number | null
          track_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          playlist_id?: string
          position?: number
          section_id?: string | null
          sync_offset_seconds?: number | null
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_tracks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "playlist_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          name: string
          project_id: string | null
          require_sign_in: boolean
          token: string
          updated_at: string
          video_track_id: string | null
          visible_to_client: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          project_id?: string | null
          require_sign_in?: boolean
          token?: string
          updated_at?: string
          video_track_id?: string | null
          visible_to_client?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string | null
          require_sign_in?: boolean
          token?: string
          updated_at?: string
          video_track_id?: string | null
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "playlists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_mirror"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlists_video_track_id_fkey"
            columns: ["video_track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_assets: {
        Row: {
          created_at: string
          id: string
          mime_type: string | null
          name: string
          project_id: string
          raw: Json | null
          size_bytes: number | null
          source_bucket: string | null
          source_key: string | null
          synced_at: string
          track_id: string | null
          xano_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type?: string | null
          name: string
          project_id: string
          raw?: Json | null
          size_bytes?: number | null
          source_bucket?: string | null
          source_key?: string | null
          synced_at?: string
          track_id?: string | null
          xano_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string
          raw?: Json | null
          size_bytes?: number | null
          source_bucket?: string | null
          source_key?: string | null
          synced_at?: string
          track_id?: string | null
          xano_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_mirror"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assets_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      projects_mirror: {
        Row: {
          brief: string | null
          client_name: string | null
          created_at: string
          ends_on: string | null
          id: string
          name: string
          raw: Json | null
          sequel_no: string | null
          starts_on: string | null
          status: string | null
          synced_at: string
          xano_id: string
          xano_uuid: string | null
        }
        Insert: {
          brief?: string | null
          client_name?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          name: string
          raw?: Json | null
          sequel_no?: string | null
          starts_on?: string | null
          status?: string | null
          synced_at?: string
          xano_id: string
          xano_uuid?: string | null
        }
        Update: {
          brief?: string | null
          client_name?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          name?: string
          raw?: Json | null
          sequel_no?: string | null
          starts_on?: string | null
          status?: string | null
          synced_at?: string
          xano_id?: string
          xano_uuid?: string | null
        }
        Relationships: []
      }
      staff: {
        Row: {
          created_at: string
          email: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_project_visits: {
        Row: {
          project_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          project_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          project_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_project_visits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_mirror"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers_mirror: {
        Row: {
          contact_email: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          raw: Json | null
          synced_at: string
          xano_id: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          raw?: Json | null
          synced_at?: string
          xano_id: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          raw?: Json | null
          synced_at?: string
          xano_id?: string
        }
        Relationships: []
      }
      theme_presets: {
        Row: {
          accent_color: string | null
          background_color: string | null
          background_url: string | null
          created_at: string
          font_family: string | null
          id: string
          logo_url: string | null
          name: string
          text_color: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          background_color?: string | null
          background_url?: string | null
          created_at?: string
          font_family?: string | null
          id?: string
          logo_url?: string | null
          name: string
          text_color?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          background_color?: string | null
          background_url?: string | null
          created_at?: string
          font_family?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          text_color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tracks: {
        Row: {
          album: string | null
          artist: string | null
          artwork_s3_key: string | null
          bpm: number | null
          comments: string | null
          composer: string | null
          contact_email: string | null
          content_hash: string | null
          created_at: string
          disc_no: number | null
          duplicate_of: string | null
          duration_seconds: number | null
          embedded_tags: Json | null
          genre: string | null
          grouping: string | null
          id: string
          inbox_id: string | null
          isrc: string | null
          iswc: string | null
          kind: Database["public"]["Enums"]["track_kind"]
          label: string | null
          lyrics: string | null
          mime_type: string | null
          musical_key: string | null
          notes: string | null
          original_filename: string | null
          preview_key: string | null
          pro_number: string | null
          processing_error: string | null
          processing_status: Database["public"]["Enums"]["processing_status"]
          project_id: string | null
          publisher: string | null
          release_date: string | null
          s3_key: string | null
          share_token: string
          size_bytes: number | null
          staff_notes: string | null
          submission_id: string | null
          submitter_company: string | null
          submitter_email: string | null
          submitter_name: string | null
          supplier_id: string | null
          title: string
          track_no: number | null
          updated_at: string
          waveform_peaks: Json | null
          writers: Json | null
          year: number | null
        }
        Insert: {
          album?: string | null
          artist?: string | null
          artwork_s3_key?: string | null
          bpm?: number | null
          comments?: string | null
          composer?: string | null
          contact_email?: string | null
          content_hash?: string | null
          created_at?: string
          disc_no?: number | null
          duplicate_of?: string | null
          duration_seconds?: number | null
          embedded_tags?: Json | null
          genre?: string | null
          grouping?: string | null
          id?: string
          inbox_id?: string | null
          isrc?: string | null
          iswc?: string | null
          kind?: Database["public"]["Enums"]["track_kind"]
          label?: string | null
          lyrics?: string | null
          mime_type?: string | null
          musical_key?: string | null
          notes?: string | null
          original_filename?: string | null
          preview_key?: string | null
          pro_number?: string | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          project_id?: string | null | null
          publisher?: string | null
          release_date?: string | null
          s3_key?: string | null
          share_token?: string
          size_bytes?: number | null
          staff_notes?: string | null
          submission_id?: string | null
          submitter_company?: string | null
          submitter_email?: string | null
          submitter_name?: string | null
          supplier_id?: string | null
          title: string
          track_no?: number | null
          updated_at?: string
          waveform_peaks?: Json | null
          writers?: Json | null
          year?: number | null
        }
        Update: {
          album?: string | null
          artist?: string | null
          artwork_s3_key?: string | null
          bpm?: number | null
          comments?: string | null
          composer?: string | null
          contact_email?: string | null
          content_hash?: string | null
          created_at?: string
          disc_no?: number | null
          duplicate_of?: string | null
          duration_seconds?: number | null
          embedded_tags?: Json | null
          genre?: string | null
          grouping?: string | null
          id?: string
          inbox_id?: string | null
          isrc?: string | null
          iswc?: string | null
          kind?: Database["public"]["Enums"]["track_kind"]
          label?: string | null
          lyrics?: string | null
          mime_type?: string | null
          musical_key?: string | null
          notes?: string | null
          original_filename?: string | null
          preview_key?: string | null
          pro_number?: string | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          project_id?: string
          publisher?: string | null
          release_date?: string | null
          s3_key?: string | null
          share_token?: string
          size_bytes?: number | null
          staff_notes?: string | null
          submission_id?: string | null
          submitter_company?: string | null
          submitter_email?: string | null
          submitter_name?: string | null
          supplier_id?: string | null
          title?: string
          track_no?: number | null
          updated_at?: string
          waveform_peaks?: Json | null
          writers?: Json | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tracks_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_mirror"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_mirror"
            referencedColumns: ["id"]
          },
        ]
      }
      viewer_profiles: {
        Row: {
          company: string | null
          created_at: string
          email: string
          name: string
          updated_at: string
          user_id: string
          user_type: Database["public"]["Enums"]["viewer_type"] | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          name: string
          updated_at?: string
          user_id: string
          user_type?: Database["public"]["Enums"]["viewer_type"] | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          name?: string
          updated_at?: string
          user_id?: string
          user_type?: Database["public"]["Enums"]["viewer_type"] | null
        }
        Relationships: []
      }
      viewers: {
        Row: {
          email: string
          first_seen_at: string
          id: string
          last_seen_at: string
          name: string
          playlist_id: string
          user_agent: string | null
          user_id: string | null
          view_count: number
        }
        Insert: {
          email: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name: string
          playlist_id: string
          user_agent?: string | null
          user_id?: string | null
          view_count?: number
        }
        Update: {
          email?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string
          playlist_id?: string
          user_agent?: string | null
          user_id?: string | null
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "viewers_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      register_viewer: {
        Args: { p_email: string; p_name: string }
        Returns: string
      }
    }
    Enums: {
      comment_target: "track" | "video"
      event_kind: "view" | "play" | "comment" | "sync_save"
      processing_status: "pending" | "processing" | "ready" | "failed"
      track_kind: "audio" | "video"
      viewer_type: "brand" | "agency" | "production_company" | "director" | "sound_post" | "composer" | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      comment_target: ["track", "video"],
      event_kind: ["view", "play", "comment", "sync_save"],
      processing_status: ["pending", "processing", "ready", "failed"],
      track_kind: ["audio", "video"],
      viewer_type: ["brand", "agency", "production_company", "director", "sound_post", "composer", "other"],
    },
  },
} as const
