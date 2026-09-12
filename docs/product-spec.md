# Sequel Studio — product spec (12 Sep 2026)

## Layout reference

**`docs/mockups/sequel-studio-mockup.html` is the approved layout for the staff
app (phase 2). Match it closely.** Open it in a browser; it is a static page.
The notes that came with it, which take precedence over the mockup's own CSS
where they differ:

- Background is Sequel Silver `#f1f0ee`. Body font is Creato Display, the
  self-hosted faces already in `public/fonts/` (taken from the Webflow site).
- The project title is shown in all caps **without** the project number; the
  number is shown small alongside. `256-OLD-26-II Nachips` renders as
  **NACHIPS** with `256-OLD-26-II` beside it.
- Row hover is Sequel Brown `#372b29` with silver text (the mockup uses
  asphalt; brown is the brand value).
- No rounded corners anywhere.
- **No keyboard shortcuts.** This replaces the earlier "keyboard and speed
  matter more than anything" line: no ⌘K, no space-to-play, no J/K.
- Inbox is stacked submissions, expandable, newest first. A submission is one
  partner's drop: name, email, date, track count, the batch note.
- Tracks that already sit in a playlist carry an "in N playlists" pill.
- "Edit all" lives under the Creator's ⋮ menu, with Add section, Attach to
  project, Duplicate and Delete.
- The Creator has a brown "PLAYLIST CREATOR" bar, then an editable title row
  with the track count and running time under it, Save, and the ⋮ menu.

## Model

- Projects come from Sequel Track (Xano) via webhook mirror. Each project has exactly one inbox, auto-created. The inbox link mirrors back to Track and is shown on Track's Creative tab. Track also gets an "Open in Studio" button linking to studio.sequelsounds.com/p/{id}, landing on that project's Inbox tab.
- Inbox = the permanent record of everything partners sent to a project. Tracks have NO status. No shortlist, no reject, no hide. The only actions on an inbox track are play and drag-into-playlist. Inbox tracks stay forever for second searches.
- Playlist = an ordered list of any tracks (from any project), with named sections. Optionally attached to a project (auto when created inside one; can be attached/moved later). Unattached playlists live under a top-level Playlists page.
- A track can be a video (kind=video). A playlist can have one video attached ("Add picture") — either picked from the project's Sequel Track assets (mirrored via the same webhook; file copied from sequel-uploaded-project-assets into the media bucket and processed) or uploaded directly. Video tracks belong to the project and can be reused across playlists.

## Viewers (clients, agencies, directors, sound teams)

- All playlist links are shareable and forward freely. Sign-in is REQUIRED by default: email → 6-digit code, no password, month-long session. Staff can flip an individual playlist to "open link".
- First sign-in asks once: name, company (prefilled from email domain), user type (Brand / Agency / Production company / Director / Sound & post / Composer / Other).
- Viewer role via Supabase Auth: can only see playlists shared to them, never the inbox.
- Per playlist, one visibility switch: "visible to client" = appears in the client's Sequel Track project (portal to be built later). Independent of the link.

## Viewer page

- Playlist with sections, player, waveform, timestamped comments on tracks.
- If the playlist has a video: video on top, tracks below; the playing track's waveform is draggable under the picture to change the music's offset against the film; play from any point. "Save this sync" stores track + offset as a comment. Staff can pre-set an offset per track so it opens aligned. Timestamped comments on the video use the same timeline.

## Staff app layout

See the layout reference above for the approved screen.

- Left rail: global search (across projects / playlists / tracks, grouped), nav: Projects (default) · Playlists · Library (all tracks, cross-project search), then recent projects with a dot for new submissions.
- Middle: project workspace with header (name, client, inbox link copy button, Open in Track) and tabs: Inbox · Playlists · Shares/Activity.
- Right: Playlist Creator, scoped to the current project — drag tracks in from the middle, reorder, create/rename/reorder sections, remove; Share, Theme, "Add picture", "visible to client" toggle, "sign-in required" toggle.
- Bottom: persistent player that survives navigation. Waveform from peaks.json (2000 min/max pairs), click to seek, prev/next in the current list.
- Speed matters; supes live here all day. Mouse-driven — no keyboard shortcuts.
- Visual language: the mockup first, then the Sequel Track app pages on Webflow (site 68e6c2e8dbcd39de2547a97d, /projects and /songs), not the login page.

## Themes

- Per playlist: logo, colours, background image. A few saved presets (one per client brand). Applies to the viewer page only.

## Stats

- Per playlist "Activity": who opened it, when, how often, which tracks they played and for how long, comments and saved syncs.
- Per project: the same rolled up, plus inbox stats (partners, track counts).
- Capture events now (view, play with duration, comment, sync-save); the display can be simple to start.

## Not in scope

- Watermarking, mailouts, contact management, public search, tag taxonomy (later), lyrics, custom fields.

## Priorities

1. Xano→Supabase sync incl. assets, and the Track side (column, Creative tab, Open in Studio).
2. Staff app: projects, inbox, playlist creator, player.
3. Viewer sign-in + viewer page + comments.
4. Video sync.
5. Themes, activity views.
