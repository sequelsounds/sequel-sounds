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
      asset_peaks: {
        Row: {
          asset_uuid: string
          created_at: string
          peaks: Json
        }
        Insert: {
          asset_uuid: string
          created_at?: string
          peaks: Json
        }
        Update: {
          asset_uuid?: string
          created_at?: string
          peaks?: Json
        }
        Relationships: []
      }
      coda_auth_codes: {
        Row: {
          auth_uid: string
          client_id: string
          code: string
          code_challenge: string
          created_at: string
          expires_at: string
          redirect_uri: string
          scope: string | null
          used_at: string | null
        }
        Insert: {
          auth_uid: string
          client_id: string
          code: string
          code_challenge: string
          created_at?: string
          expires_at?: string
          redirect_uri: string
          scope?: string | null
          used_at?: string | null
        }
        Update: {
          auth_uid?: string
          client_id?: string
          code?: string
          code_challenge?: string
          created_at?: string
          expires_at?: string
          redirect_uri?: string
          scope?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coda_auth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coda_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      coda_clients: {
        Row: {
          client_id: string
          client_name: string | null
          created_at: string
          id: string
          redirect_uris: string[]
        }
        Insert: {
          client_id: string
          client_name?: string | null
          created_at?: string
          id?: string
          redirect_uris: string[]
        }
        Update: {
          client_id?: string
          client_name?: string | null
          created_at?: string
          id?: string
          redirect_uris?: string[]
        }
        Relationships: []
      }
      coda_conversations: {
        Row: {
          auth_uid: string
          created_at: string
          id: string
          provider: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          auth_uid?: string
          created_at?: string
          id?: string
          provider?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          auth_uid?: string
          created_at?: string
          id?: string
          provider?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coda_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: number
          role: string
          text: string | null
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          id?: number
          role: string
          text?: string | null
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: number
          role?: string
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coda_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "coda_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      coda_tool_calls: {
        Row: {
          actor_email: string | null
          args: Json | null
          auth_uid: string | null
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: number
          ok: boolean
          source: string
          summary: string | null
          tool: string
          track_user_id: number | null
        }
        Insert: {
          actor_email?: string | null
          args?: Json | null
          auth_uid?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: number
          ok: boolean
          source: string
          summary?: string | null
          tool: string
          track_user_id?: number | null
        }
        Update: {
          actor_email?: string | null
          args?: Json | null
          auth_uid?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: number
          ok?: boolean
          source?: string
          summary?: string | null
          tool?: string
          track_user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coda_tool_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "coda_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
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
          allow_download: boolean
          allow_originals: boolean
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["playlist_kind"]
          name: string
          project_id: string | null
          require_sign_in: boolean
          token: string
          updated_at: string
          video_track_id: string | null
          visible_to_client: boolean
        }
        Insert: {
          allow_download?: boolean
          allow_originals?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["playlist_kind"]
          name: string
          project_id?: string | null
          require_sign_in?: boolean
          token?: string
          updated_at?: string
          video_track_id?: string | null
          visible_to_client?: boolean
        }
        Update: {
          allow_download?: boolean
          allow_originals?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["playlist_kind"]
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
      qbo_connection: {
        Row: {
          access_expires_at: string | null
          access_token: string | null
          connected_at: string
          connected_by: string | null
          environment: string
          last_error: string | null
          realm_id: string
          refresh_expires_at: string | null
          refresh_lock_id: string | null
          refresh_lock_until: string | null
          refresh_token: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_expires_at?: string | null
          access_token?: string | null
          connected_at?: string
          connected_by?: string | null
          environment: string
          last_error?: string | null
          realm_id: string
          refresh_expires_at?: string | null
          refresh_lock_id?: string | null
          refresh_lock_until?: string | null
          refresh_token?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_expires_at?: string | null
          access_token?: string | null
          connected_at?: string
          connected_by?: string | null
          environment?: string
          last_error?: string | null
          realm_id?: string
          refresh_expires_at?: string | null
          refresh_lock_id?: string | null
          refresh_lock_until?: string | null
          refresh_token?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_env_config: {
        Row: {
          config: Json
          environment: string
          updated_at: string
        }
        Insert: {
          config: Json
          environment: string
          updated_at?: string
        }
        Update: {
          config?: Json
          environment?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_id_map: {
        Row: {
          environment: string
          kind: string
          qbo_id: string
          sequel_id: number
        }
        Insert: {
          environment: string
          kind: string
          qbo_id: string
          sequel_id: number
        }
        Update: {
          environment?: string
          kind?: string
          qbo_id?: string
          sequel_id?: number
        }
        Relationships: []
      }
      qbo_oauth_state: {
        Row: {
          created_at: string
          environment: string
          expires_at: string
          return_to: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          environment?: string
          expires_at?: string
          return_to: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          expires_at?: string
          return_to?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      qbo_raise_attempts: {
        Row: {
          created_at: string
          created_by: string | null
          doc_number: string
          environment: string
          error: string | null
          id: number
          invoice_id: number
          qbo_invoice_id: string | null
          request_id: string
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_number: string
          environment: string
          error?: string | null
          id?: never
          invoice_id: number
          qbo_invoice_id?: string | null
          request_id: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_number?: string
          environment?: string
          error?: string | null
          id?: never
          invoice_id?: number
          qbo_invoice_id?: string | null
          request_id?: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          hits: number
          limit_key: string
          window_start: string
        }
        Insert: {
          hits?: number
          limit_key: string
          window_start?: string
        }
        Update: {
          hits?: number
          limit_key?: string
          window_start?: string
        }
        Relationships: []
      }
      share_links: {
        Row: {
          asset_uuid: string | null
          code: string
          contract_uuid: string | null
          created_at: string
          created_by: number | null
          expires_at: string | null
          purpose: string
          release_form_uuid: string | null
        }
        Insert: {
          asset_uuid?: string | null
          code: string
          contract_uuid?: string | null
          created_at?: string
          created_by?: number | null
          expires_at?: string | null
          purpose?: string
          release_form_uuid?: string | null
        }
        Update: {
          asset_uuid?: string | null
          code?: string
          contract_uuid?: string | null
          created_at?: string
          created_by?: number | null
          expires_at?: string | null
          purpose?: string
          release_form_uuid?: string | null
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
          brand: string | null
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
          brand?: string | null
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
          brand?: string | null
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
      track_ai_prompts: {
        Row: {
          model: string | null
          prompt_key: string
          prompt_text: string
          prompt_version: string
          provider: string | null
          updated_at: string
        }
        Insert: {
          model?: string | null
          prompt_key: string
          prompt_text: string
          prompt_version: string
          provider?: string | null
          updated_at?: string
        }
        Update: {
          model?: string | null
          prompt_key?: string
          prompt_text?: string
          prompt_version?: string
          provider?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      track_notifications: {
        Row: {
          created_at: string
          id: number
          kind: string
          message: string
          project_id: number | null
          read_at: string | null
          subject_kind: string | null
          subject_uuid: string | null
          user_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          kind: string
          message: string
          project_id?: number | null
          read_at?: string | null
          subject_kind?: string | null
          subject_uuid?: string | null
          user_id: number
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          message?: string
          project_id?: number | null
          read_at?: string | null
          subject_kind?: string | null
          subject_uuid?: string | null
          user_id?: number
        }
        Relationships: []
      }
      track_release_forms: {
        Row: {
          aws_path: string
          brand: string
          campaign: string
          created_at: string
          created_by: number | null
          file_name: string
          id: number
          issued_on: string
          media: string
          project_master_list_id: number
          recipient_address: string | null
          recipient_email: string | null
          recipient_name: string
          scripts: string
          send_error: string | null
          sent_at: string | null
          sent_to: string | null
          signer_name: string
          signer_signature: string | null
          signer_signature_kind: string
          status: string
          term: string
          territory: string
          track_name: string
          uuid: string
        }
        Insert: {
          aws_path: string
          brand: string
          campaign: string
          created_at?: string
          created_by?: number | null
          file_name: string
          id?: number
          issued_on: string
          media: string
          project_master_list_id: number
          recipient_address?: string | null
          recipient_email?: string | null
          recipient_name: string
          scripts: string
          send_error?: string | null
          sent_at?: string | null
          sent_to?: string | null
          signer_name: string
          signer_signature?: string | null
          signer_signature_kind?: string
          status?: string
          term: string
          territory: string
          track_name: string
          uuid?: string
        }
        Update: {
          aws_path?: string
          brand?: string
          campaign?: string
          created_at?: string
          created_by?: number | null
          file_name?: string
          id?: number
          issued_on?: string
          media?: string
          project_master_list_id?: number
          recipient_address?: string | null
          recipient_email?: string | null
          recipient_name?: string
          scripts?: string
          send_error?: string | null
          sent_at?: string | null
          sent_to?: string | null
          signer_name?: string
          signer_signature?: string | null
          signer_signature_kind?: string
          status?: string
          term?: string
          territory?: string
          track_name?: string
          uuid?: string
        }
        Relationships: []
      }
      track_share_events: {
        Row: {
          code: string
          created_at: string
          event: string
          id: number
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          code: string
          created_at?: string
          event: string
          id?: number
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          event?: string
          id?: number
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      track_users: {
        Row: {
          auth_user_id: string | null
          company_client_id: number | null
          created_at: string
          email: string | null
          full_name: string | null
          id: number
          is_finance: boolean
          is_management: boolean
          job_title: string | null
          signature_kind: string
          signature_path: string | null
          signature_updated_at: string | null
          status: string
          user_type: string
        }
        Insert: {
          auth_user_id?: string | null
          company_client_id?: number | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: number
          is_finance?: boolean
          is_management?: boolean
          job_title?: string | null
          signature_kind?: string
          signature_path?: string | null
          signature_updated_at?: string | null
          status: string
          user_type: string
        }
        Update: {
          auth_user_id?: string | null
          company_client_id?: number | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: number
          is_finance?: boolean
          is_management?: boolean
          job_title?: string | null
          signature_kind?: string
          signature_path?: string | null
          signature_updated_at?: string | null
          status?: string
          user_type?: string
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
          project_id?: string | null
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
          project_id?: string | null
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
      brief_token: { Args: never; Returns: string }
      check_rate_limit: {
        Args: { p_limit: string; p_max: number; p_window_secs: number }
        Returns: boolean
      }
      coda_authorize: {
        Args: {
          p_client_id: string
          p_code_challenge: string
          p_redirect_uri: string
          p_scope?: string
        }
        Returns: string
      }
      coda_catalogue: { Args: never; Returns: Json }
      coda_client_name: { Args: { p_client_id: string }; Returns: string }
      coda_settings: { Args: never; Returns: Json }
      coda_whoami: { Args: never; Returns: Json }
      effective_theme: {
        Args: never
        Returns: {
          accent_color: string
          background_color: string
          background_url: string
          heading: string
          logo_url: string
          source: string
          text_color: string
        }[]
      }
      playlist_gate: {
        Args: never
        Returns: {
          kind: Database["public"]["Enums"]["playlist_kind"]
          name: string
          project_name: string
          require_sign_in: boolean
        }[]
      }
      public_brief: { Args: { p_token: string }; Returns: Json }
      public_quote: { Args: { p_uuid: string }; Returns: Json }
      qbo_claim_refresh: {
        Args: { p_environment?: string; p_lock: string; p_seconds?: number }
        Returns: string
      }
      qbo_mapped_id: {
        Args: {
          p_environment: string
          p_kind: string
          p_production: string
          p_sequel_id: number
        }
        Returns: string
      }
      qbo_mark_bill: {
        Args: { p_bill_id: string; p_line_ids: number[] }
        Returns: number
      }
      qbo_raise_check: {
        Args: { p_environment: string; p_invoice_id: number }
        Returns: Json
      }
      qbo_raise_context: {
        Args: { p_environment: string; p_invoice_id: number }
        Returns: Json
      }
      qbo_record_raise: {
        Args: {
          p_date: string
          p_due: string
          p_home_total: number
          p_invoice_id: number
          p_number: string
          p_qbo_id: string
          p_rate: number
        }
        Returns: boolean
      }
      register_viewer: {
        Args: { p_email: string; p_name: string }
        Returns: string
      }
      request_ip: { Args: never; Returns: string }
      resolve_share_link: {
        Args: { p_code: string; p_ip: string }
        Returns: Json
      }
      share_code: { Args: never; Returns: string }
      share_set_peaks: {
        Args: { p_code: string; p_peaks: Json }
        Returns: boolean
      }
      song_confirm_details: {
        Args: { p_title: string; p_uuid: string; p_writers: Json }
        Returns: Json
      }
      submit_brief: {
        Args: { p_answers: Json; p_token: string }
        Returns: Json
      }
      track_add_invoice_line: {
        Args: { p_category?: string; p_invoice_id: number }
        Returns: number
      }
      track_ai_prompt: { Args: { p_key: string }; Returns: Json }
      track_archive_brief: { Args: { p_brief_id: number }; Returns: undefined }
      track_archive_contract: { Args: { p_uuid: string }; Returns: undefined }
      track_archive_invoice: {
        Args: { p_invoice_id: number }
        Returns: undefined
      }
      track_archive_quote: { Args: { p_quote_id: number }; Returns: undefined }
      track_archive_release_form: {
        Args: { p_uuid: string }
        Returns: undefined
      }
      track_archive_supplier: {
        Args: { p_supplier_id: number }
        Returns: undefined
      }
      track_asset_key: { Args: { p_uuid: string }; Returns: string }
      track_attach_brief_upload: {
        Args: { p_asset_uuid: string; p_name: string }
        Returns: Json
      }
      track_can_see_project: { Args: { p_project: number }; Returns: boolean }
      track_client_profit: {
        Args: { p_client: number; p_year: number }
        Returns: {
          client_id: number
          invoices_counted: number
          invoices_unrated: number
          total_profit_gbp: number
          year: number
          ytd_profit_gbp: number
        }[]
      }
      track_clients_for_picker: { Args: never; Returns: Json }
      track_company_id: { Args: never; Returns: number }
      track_contract_dates: {
        Args: {
          p_end: string
          p_perpetual: boolean
          p_start: string
          p_term_unit: string
          p_term_value: number
        }
        Returns: Json
      }
      track_contract_detail: { Args: { p_uuid: string }; Returns: Json }
      track_contract_key: { Args: { p_uuid: string }; Returns: string }
      track_contract_renewals: { Args: never; Returns: Json }
      track_create_asset: {
        Args: {
          p_file_name: string
          p_file_size: string
          p_file_type: string
          p_project_id: number
        }
        Returns: Json
      }
      track_create_contract: {
        Args: {
          p_file_name: string
          p_file_size: string
          p_file_type: string
          p_project_id: number
        }
        Returns: Json
      }
      track_create_invoice_request: {
        Args: {
          p_artist_name?: string
          p_client_id: number
          p_currency_id: number
          p_description: string
          p_fees?: Json
          p_lines?: Json
          p_po_attachment_url?: string
          p_po_number?: string
          p_project_id: number
          p_song_name?: string
          p_usage_region?: string
          p_usage_territories?: string
        }
        Returns: {
          id: number
          uuid: string
        }[]
      }
      track_create_mcps_quote: {
        Args: {
          p_artist_name?: string
          p_client_id: number
          p_currency_id: number
          p_cutdowns?: boolean
          p_description: string
          p_duration?: string
          p_grand_total?: number
          p_mcps_fee_gbp?: number
          p_mcps_local_fee?: number
          p_mcps_territories?: string
          p_media?: string[]
          p_media_mcps?: string[]
          p_note?: string
          p_online_worldwide?: boolean
          p_project_id: number
          p_region?: string
          p_scripts?: string
          p_search_fee?: number
          p_searches_requested?: number
          p_sequel_licensing_fee?: number
          p_song_name?: string
          p_term?: string
          p_territory?: string
          p_track_rate?: string
          p_tracks_quoted?: number
        }
        Returns: {
          id: number
          uuid: string
        }[]
      }
      track_create_project: {
        Args: {
          p_account: string
          p_adpro_lead: string
          p_brand: string
          p_brand_category: string
          p_client: string
          p_client_job_no?: string
          p_client_user: string
          p_pipeline_gbp: number
          p_project_type: string
          p_proposed_start_date: string
          p_title: string
        }
        Returns: {
          project_id: number
          project_sequel_no: string
          project_uuid: string
        }[]
      }
      track_create_quote: {
        Args: {
          p_artist_name?: string
          p_client_id: number
          p_currency_id: number
          p_cutdowns?: boolean
          p_description: string
          p_duration?: string
          p_fees?: Json
          p_media?: string
          p_project_id: number
          p_scripts?: string
          p_service_id: number
          p_song_name?: string
          p_term?: string
          p_territory?: string
          p_tracks_quoted?: number
        }
        Returns: {
          id: number
          uuid: string
        }[]
      }
      track_create_release_form: {
        Args: {
          p_brand: string
          p_campaign: string
          p_media: string
          p_project_id: number
          p_recipient_address: string
          p_recipient_email?: string
          p_recipient_name: string
          p_scripts: string
          p_term: string
          p_territory: string
          p_track_name: string
        }
        Returns: Json
      }
      track_create_song: {
        Args: {
          p_ownership?: string
          p_project_id: number
          p_supplier_id: number
        }
        Returns: Json
      }
      track_create_user: {
        Args: {
          p_company: string
          p_email: string
          p_job_title?: string
          p_name: string
          p_notes?: string
          p_status?: string
          p_user_type?: string
        }
        Returns: {
          id: number
          uuid: string
        }[]
      }
      track_delete_asset: { Args: { p_uuid: string }; Returns: undefined }
      track_delete_invoice_line: {
        Args: { p_line_id: number }
        Returns: undefined
      }
      track_discard_contract: { Args: { p_uuid: string }; Returns: undefined }
      track_discard_release_form: {
        Args: { p_uuid: string }
        Returns: undefined
      }
      track_greeting_for_email: { Args: { p_email: string }; Returns: string }
      track_invoice_editable: {
        Args: { p_invoice_id: number }
        Returns: unknown
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      track_is_finance: { Args: never; Returns: boolean }
      track_is_management: { Args: never; Returns: boolean }
      track_is_staff: { Args: never; Returns: boolean }
      track_log_share_event: {
        Args: { p_agent: string; p_code: string; p_event: string; p_ip: string }
        Returns: undefined
      }
      track_mark_notifications_read: {
        Args: { p_ids?: number[] }
        Returns: undefined
      }
      track_mark_release_form_sent: {
        Args: { p_error: string; p_to: string; p_uuid: string }
        Returns: undefined
      }
      track_mark_renewal_seen: {
        Args: { p_seen: boolean; p_uuid: string }
        Returns: undefined
      }
      track_mark_renewals_seen: {
        Args: { p_seen: boolean; p_uuids: string[] }
        Returns: number
      }
      track_match_supplier: {
        Args: { p_country: string; p_names: string[] }
        Returns: Json
      }
      track_me: {
        Args: never
        Returns: {
          birthday: string
          email: string
          id: number
          name: string
        }[]
      }
      track_my_email: { Args: never; Returns: string }
      track_my_notifications: { Args: { p_limit?: number }; Returns: Json }
      track_my_signature: { Args: never; Returns: Json }
      track_notify_share_event: {
        Args: { p_code: string; p_event: string }
        Returns: undefined
      }
      track_project_release_forms: {
        Args: { p_project_id: number }
        Returns: Json
      }
      track_project_release_recipient: {
        Args: { p_project_id: number }
        Returns: Json
      }
      track_recompute_invoice_totals: {
        Args: { p_invoice_id: number }
        Returns: undefined
      }
      track_ref: { Args: { p_id: number; p_kind: string }; Returns: string }
      track_release_form_activity: { Args: { p_uuid: string }; Returns: Json }
      track_release_form_detail: { Args: { p_uuid: string }; Returns: Json }
      track_release_form_key: { Args: { p_uuid: string }; Returns: Json }
      track_release_form_send_link: { Args: { p_uuid: string }; Returns: Json }
      track_request_brief: {
        Args: { p_internal?: boolean; p_project_id: number }
        Returns: Json
      }
      track_save_asset: {
        Args: { p_description: string; p_tag: string; p_uuid: string }
        Returns: undefined
      }
      track_save_contract: {
        Args: {
          p_artist: string
          p_contract_type: number
          p_description: string
          p_end_date: string
          p_master_pct: string
          p_mcps_yn: boolean
          p_notes: string
          p_perpetual: boolean
          p_publishing_pct: string
          p_song_name: string
          p_start_date: string
          p_supplier_address: string
          p_supplier_id: number
          p_term_unit: string
          p_term_value: number
          p_uuid: string
        }
        Returns: Json
      }
      track_save_contract_summary: {
        Args: {
          p_status: string
          p_summary: string
          p_uuid: string
          p_version: string
        }
        Returns: undefined
      }
      track_save_my_signature: {
        Args: { p_kind?: string; p_path: string }
        Returns: undefined
      }
      track_set_asset_peaks: {
        Args: { p_peaks: Json; p_uuid: string }
        Returns: undefined
      }
      track_set_invoice_status: {
        Args: { p_invoice_id: number; p_status: string }
        Returns: undefined
      }
      track_share_asset: { Args: { p_uuid: string }; Returns: Json }
      track_share_contract: { Args: { p_uuid: string }; Returns: Json }
      track_share_project_assets: {
        Args: { p_project_id: number }
        Returns: Json
      }
      track_share_release_form: { Args: { p_uuid: string }; Returns: Json }
      track_supplier_norm: { Args: { p_text: string }; Returns: string }
      track_unilever_report: { Args: { p_year: number }; Returns: Json }
      track_update_brief: {
        Args: { p_brief_id: number; p_key: string; p_value: string }
        Returns: undefined
      }
      track_update_invoice: {
        Args: {
          p_artist_name?: string
          p_client_id?: number
          p_currency_id?: number
          p_description?: string
          p_fees?: Json
          p_invoice_id: number
          p_po_attachment_url?: string
          p_po_number?: string
          p_song_name?: string
          p_usage_region?: string
          p_usage_territories?: string
        }
        Returns: undefined
      }
      track_update_invoice_line: {
        Args: {
          p_amount?: number
          p_category?: string
          p_is_paythrough?: boolean
          p_line_id: number
          p_supplier_id?: number
        }
        Returns: undefined
      }
      track_update_release_form: {
        Args: {
          p_brand: string
          p_campaign: string
          p_media: string
          p_recipient_address: string
          p_recipient_email: string
          p_recipient_name: string
          p_scripts: string
          p_term: string
          p_territory: string
          p_track_name: string
          p_uuid: string
        }
        Returns: Json
      }
      track_user_id: { Args: never; Returns: number }
      valid_peaks: { Args: { p: Json }; Returns: boolean }
      xano_mirror_column_rules: {
        Args: { p_table: string }
        Returns: {
          blank_is_null: boolean
          column_name: string
          data_type: string
          zero_is_null: boolean
        }[]
      }
      xano_mirror_columns: {
        Args: { p_table: string }
        Returns: {
          column_name: string
          data_type: string
        }[]
      }
    }
    Enums: {
      comment_target: "track" | "video"
      event_kind: "view" | "play" | "comment" | "sync_save"
      playlist_kind: "standard" | "sync" | "composition"
      processing_status: "pending" | "processing" | "ready" | "failed"
      track_kind: "audio" | "video"
      viewer_type:
        | "brand"
        | "agency"
        | "production_company"
        | "director"
        | "sound_post"
        | "composer"
        | "other"
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
      playlist_kind: ["standard", "sync", "composition"],
      processing_status: ["pending", "processing", "ready", "failed"],
      track_kind: ["audio", "video"],
      viewer_type: [
        "brand",
        "agency",
        "production_company",
        "director",
        "sound_post",
        "composer",
        "other",
      ],
    },
  },
} as const
