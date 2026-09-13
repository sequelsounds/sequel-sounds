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

## Three kinds of link (13 Sep 2026)

A playlist's link opens one of three pages. `playlists.kind` says which, and
the Creator shows the three side by side because the choice changes what
every other control on the panel means.

| kind | in the Creator | what the page is |
| --- | --- | --- |
| `standard` | **Playlist** | Listen through, download what the switches allow, leave a note on a track. A film in the list plays in a picture above the rows. |
| `sync` | **Sync session** | The playlist's film (Add film) at the top, the tracks under it. Pick a track and it plays against the picture; click in its waveform to start the music from that moment, wherever the picture is; nudge by tenths; **Save this sync** records the cue as a note on the track and a `sync_save` event. |
| `composition` | **Composition** | The films in the list are the work — a composer's cuts. One plays large, notes are left at a moment in it, and every note's timestamp takes the picture back there. **Sign-in is required and cannot be switched off** (a database constraint, not just the UI). |

"Sync session" is a working name for what the brief called the super
playlist; it is the industry's word for music against picture and reads as
one on a client's screen. Change the label in `KINDS` in `Creator.tsx` if a
better one turns up — the kind's value stays `sync`.

**Downloads** are two switches per playlist: *Downloads* (the preview
renders — the mp3, or the 720p mp4) and *Original files too* (the file as
delivered, uncompressed). `sign-media` enforces both: a viewer never gets a
URL the switches do not back, whatever the page asks for. Staff are not
switched.

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

- **Themes follow the brand.** A preset carries the brand it dresses
  (`theme_presets.brand`, matched case-insensitively to the project's
  `raw->>'brand'` as Track sends it), and every playlist on that brand's
  projects wears it without anyone choosing. A playlist can keep a theme of
  its own (`playlist_themes`), which wins over the preset field by field.
- Fields: background colour, text colour, accent, logo URL, background
  image URL, a heading above the title. Colours are hex. The viewer page
  derives every other tone (rules, hover, secondary text, the bar) from
  the two main colours, so any pair a brand turns up with dresses the page.
- The Creator's **Theme** button opens the panel: dress this playlist, then
  *Save for this playlist* or *Save as {brand} preset*. Logos are URLs for
  now — there is no upload path for theme assets yet.
- The page resolves the theme server-side (`effective_theme()`), so a
  viewer never reads presets or the project's raw record.

## Stats

- Per playlist "Activity": who opened it, when, how often, which tracks they played and for how long, comments and saved syncs.
- Per project: the same rolled up, plus inbox stats (partners, track counts).
- Capture events now (view, play with duration, comment, sync-save); the display can be simple to start.

## Not in scope

- Watermarking, mailouts, contact management, public search, tag taxonomy (later), custom fields.
- **Lyrics moved into scope 12 Sep 2026** — `tracks.lyrics`, typed by staff on the Lyrics tab of the track editor. The Lambda never writes it: an empty tag read would wipe what someone entered.

## Priorities

1. Xano→Supabase sync incl. assets, and the Track side (column, Creative tab, Open in Studio).
2. Staff app: projects, inbox, playlist creator, player.
3. Viewer sign-in + viewer page + comments. **Built 13 Sep** — see "Three kinds of link".
4. Video sync. **Built 13 Sep** as the sync session.
5. Themes (**built 13 Sep**, by brand), activity views.

## Known gaps

**Viewer sign-in is untested end to end.** The gate sends the code with
`shouldCreateUser: true` and the profile step writes `viewer_profiles`, but
neither has been driven with a real inbox from this machine. If the
project's auth settings refuse sign-ups the gate reports "Sign-in is
switched off for this link" — check *Authentication → Sign In / Providers →
Allow new users to sign up* in the dashboard. The composition page is
behind that gate, so it has only been checked as code.

**Theme logos are URLs.** There is no `purpose: 'theme'` in `sign-upload`
yet; paste a hosted image (the Webflow asset library works) into the
panel. Adding an upload path means a `themes/` prefix in the bucket and a
matching clause in `sign-media`'s key pattern.

Things that exist as data but not yet as anything you can use. Checked
against the live database, 13 Sep.

**Video does not play.** The player is one `new Audio()` element living above
the router — audio only, with nowhere to put a picture. Every video track
has its `preview.mp4` and it is signed like any other key, so the
soundtrack comes through and nothing appears.

**Decided: a film opens over the page.** Not in the 72px player bar and not
inside the Creator — a viewer over the whole window, with the transport,
the waveform and next/previous still driving the same queue underneath, so
stepping from a film to a track closes it rather than being a separate
mode. Escape and a close mark dismiss it; the audio keeps playing when it
is dismissed, because a film's soundtrack is still a take you are
listening to.

**Project assets have no page.** `project_assets` is populated by the
webhook — briefs, contracts, artwork — and nothing lists them. The
placeholder squares already know how to draw a pdf, an image and a
document for when they do.

**Activity has no page.** The `events` table records viewer plays; the tab
that used to hold the empty state was removed with the split view.

**Deleted objects are not reclaimed.** The bucket has versioning on, so
`delete-track` writes delete markers and the bytes stay — 341MB of
noncurrent versions as of tonight. Purging them needs
`s3:ListBucketVersions` and `s3:DeleteObjectVersion` and makes deletes
genuinely permanent, which is a decision rather than a bug.
