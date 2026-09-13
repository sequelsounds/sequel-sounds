# Decisions

Why things are the way they are. Newest first. Add to this rather than
rediscovering an argument later.

---

## A link opens one of three pages

**2026-09-13.** The brief for shared playlists was three different rooms: a
client listening through a shortlist and taking the files; a director
trying takes against the cut; a composer's cuts being marked up at
timestamps by people who have to be named. One page with everything on it
would have been the wrong page for all three, so `playlists.kind` picks
one: `standard`, `sync`, `composition`. The Creator shows the three side
by side rather than in a menu, because the choice changes what the other
controls mean — "Add film" is a picture on a sync session and a curiosity
on a playlist.

A composition review cannot be an open link. The people on it are named
and their notes are attributed, which an anonymous visitor cannot be. That
is a check constraint, not a switch the UI greys out — the UI greys it out
too, but the database is where it is true.

## The artwork square is the transport

**2026-09-13.** A track's square played the track only in the Library, and
only once hovered; in the Creator it was decoration, on the viewer page it
showed nothing until the track was current, and on a sync session pressing
it re-picked the track rather than pausing it. Now it is one control
everywhere: a mark on hover that stays while playing, pause when pressed
on the current track, play otherwise. The row still plays on click where
it did — the square is the part that also *stops*.

## The section slider, not click-to-cue

**2026-09-13.** The first sync session cued by clicking in the track's
waveform: that moment of the music, at whatever moment the picture was at.
Precise, and wrong — what a director does is try *sections* of a track
against the opening, one after another. So the waveform carries a handle
instead. Dragging is live (the music follows the pointer, so the choice is
heard), and letting go restarts the picture from the top with the section
under it. The band from the handle shows how much of the track the
picture will cover. The staff preset still says where in the picture the
music comes in; the handle only says where in the music.

## The picture is the clock

**2026-09-13.** The staff player is one `<video>` for everything, for good
reasons. The sync session is deliberately not: two elements, the film
muted and the music chasing it. The person is scrubbing the *picture* —
that is the whole activity — and an audio element re-aligned on every tick
of the video is the arrangement that never lets the music drift from the
shot it is being judged against. The cue is two numbers: where in the
track the music starts (`inPoint`) and the film time it starts at
(`offset`, negative when the music leads the picture). Film time f plays
track time f − offset + inPoint; outside the track's length the music is
simply paused, so a run-up into the cue is a couple of seconds of picture
alone.

## Themes follow the brand

**2026-09-13.** The spec had presets "one per client brand", picked by
hand. Every project already carries its brand from Track (`raw->>'brand'`:
Hellmann's, Knorr, Dove, Tresemmé…), so a preset names the brand it
dresses and the playlist wears it unless it has a theme of its own.
Resolved in the database (`effective_theme()`), so the page never reads
presets or the project record — a forwarded link tells the recipient the
colours and nothing about the job.

The viewer page derives every tone from two colours. Rules, hover, the
secondary text, the bar's inversion: all `color-mix()` off `--v-bg` and
`--v-fg`. A brand turns up with any pair and the page still reads.

## The viewer sends the token and its own session together

**2026-09-13.** A sign-in link only resolves for a signed-in request, and a
signed-in request only reaches one playlist through its token — so the
page has to send both on every call. supabase-js's `accessToken` option
does that without a second auth client: the page's client reads the app's
own session for its bearer and carries the token as a header, and the
same code serves an anonymous visitor (bearer falls back to the
publishable key), a signed-in viewer and a member of staff previewing.

## Downloads are decided in the function

**2026-09-13.** The two switches — downloads, originals too — live on the
playlist, but the page is not what enforces them. `sign-media` reads them
by token and refuses to sign a URL they do not back, so a page that asks
for the wrong thing gets nothing rather than a file. A download is a
signed read with `response-content-disposition` on it, which is part of
the signature and so cannot be added after the fact; the name on it is the
track's title, not `original.wav` forty times over.

## The volume slider is not an input

**2026-09-13.** It rendered square in Chromium and round in Firefox. A range
input is three parts with a different name in each engine, and each part has
defaults that must be turned *off* rather than overridden — setting the
thumb's width, height, border and colour still leaves the engine's own
corner radius, which is where this one came from.

Completing the reset would have fixed the reported difference. It was
rebuilt from two divs and a span instead, because the appearance of a
vendor pseudo-element can only be confirmed by opening that vendor's
browser, and Firefox could not be driven from here — headless hangs on the
dev server. A control with no engine-specific parts is one that checking
once checks everywhere, which is worth more on something looked at all day
than the accessibility an input gives free.

That part is written out: `role="slider"`, `aria-valuenow` and
`aria-valuetext`, arrow keys, Home and End, and pointer capture so a drag
that leaves the 80px track goes on setting the level rather than stopping at
the edge.

## One media element, and it is a video

**2026-09-13.** Films did not play. Nothing was broken exactly — every video
track had its `preview.mp4` and it was signed like any other key — but the
player was a `new Audio()`, so the soundtrack came through and there was
nowhere for a picture to go.

**One element, and it is a `<video>`.** A video element plays an mp3 perfectly
well, so audio goes through the same one: one set of listeners, one source of
truth for position, one thing that can be playing. Two elements would have to
be kept in step and would eventually drift — on the day someone hits next
from a film into a track and both are playing, the bug is unfindable.

**It never moves in the DOM.** Showing a film changes where the element sits
on screen, not where it sits in the tree. Re-parenting a media element
reloads its source and loses the position; on a panel opened and dismissed
all day that would be the whole feature. Closed, it is parked off-screen
rather than `display: none`, because a hidden media element is the browser's
business to pause and an off-screen one is not.

**The stage stops short of the player.** `inset: 0 0 4.5rem 0`, so the
transport driving the film stays visible and clickable underneath it, and
video never becomes a mode with its own controls. Starting a film opens it;
stepping to an audio track closes it; Escape dismisses it and the sound keeps
playing, because a film's soundtrack is still a take somebody is listening to.

## A placeholder square says what the file is

**2026-09-13.** Most of what partners send carries no embedded cover, so the
placeholder is what is actually on screen nearly all the time. It was a
blank block — grey, or brown for a film — which said only "nothing here".

It now carries a drawn mark: a waveform for audio, a film for video. Sized
as a fraction of the square rather than in pixels, because the same square
is drawn at 40px in a row and at 48 in the track dialog, which had been
setting a `♪` character instead — the same bet on a glyph existing that
`icons.tsx` exists to avoid.

`tracks.kind` is only audio or video, but the mapping already covers image,
pdf and document, because `project_assets` holds briefs and contracts and
will want the same squares the day that list gets a page. `artKindFromMime`
turns a mime type into one of the five, and anything unrecognised is a
document rather than nothing: an unknown file still has to draw as
something.

## The inbox lists what came through the inbox

**2026-09-13.** A project with no partner submissions was showing three,
all of them uploads the office had made from the Creator.

`groupSubmissions` grouped every track in the project by `submission_id`,
and a staff upload mints one of those per drop — deliberately, so a drop of
forty files stays one drop rather than forty. Which made a staff upload
indistinguishable from a partner's, in the one place whose whole meaning is
"what a partner sent". Checked against the live database: all twelve tracks
under the Bisma project's Inbox had `inbox_id` null.

`inbox_id` is the test, because the inbox link is the thing that makes a
submission. It is set only by the anon insert policy, which requires it to
match the token's own inbox — so it cannot be faked from the staff side, and
a staff upload passes null.

Staff uploads are not hidden, they are simply not submissions: they are in
the playlist they were dropped into, and in the Library. The preview now
carries one of each, since a fixture where every drop is a partner's is a
fixture that cannot fail this way.

## A playlist is a draft until it is saved

**2026-09-13.** Pressing + wrote a `playlists` row immediately, because a
dropped file needs a playlist id to attach to. So a playlist appeared in
the project's column the instant you asked for one, named "New playlist",
before it meant anything — and the Save button beside the title was
unclickable, since it only ever saved the name and clicking it blurred the
field, which had already saved.

The panel with nothing open is now the new playlist: an empty title on
"Untitled playlist", 0 tracks, Save, the menu. Nothing is written until you
save it or drop the first file, so nothing appears on the left until it is
real, and Save is a button that does something again. The + in the bar goes
with it — the panel no longer needs a control to reach a state it is
already in.

`uploadFiles` already created a playlist when there was none, so dropping
into a draft needed nothing new beyond carrying the typed name into the
insert.

## Fahkwang had one weight, and the app asked for five

**2026-09-13.** Only `Fahkwang-Regular.woff2` was ever committed, declared at
`font-weight: 400`. Every heavier request in the app therefore rendered as
Regular: PLAYLISTER asked for 600 and "PLAYLISTER" measured **106.89px at
300, 400, 500, 600 and 700 alike** — the browser did not even synthesise a
bolder one. Type that looked subtly wrong was type the font could not set.

Fahkwang is not in Webflow's custom fonts — that library holds only Switzer
and Creato Display. Webflow pulls it from Google, and the live site loads
300 to 700. So the six weights come from Google too, latin and latin-ext,
`unicode-range` intact so a project named "Mãe Terra" pulls the second file
and nothing else does. Under the SIL Open Font License, which permits
self-hosting.

The Regular fetched this way is **byte-identical** to the one already
committed, which confirms the original came from the same subset of the same
version — so the other five cannot shift the metrics of anything already on
screen.

## The page header is header_app's element tree, not its class list

**2026-09-12.** Reading the classes was not enough, and reading only the
classes produced three wrong headers in a row. `header_app`'s own tree:

```
.header_app                6rem, flex column, no justification
  .project_subtitle_app    margin-top 1rem, 0.8rem/0.8rem, weight 400
  .main-title-wrap         flex row, space-between, align centre
    .Title_app             Fahkwang 2rem/2rem uppercase
    .main-add-new-button   11rem x 2rem — the button is in the title row
  .project_subtitle2_app   0.8rem/0.8rem, weight 300, no margin
```

Three things that only the tree shows. The line above the title and the
line below it are **different classes** — 400 above, 300 below. Only the
top one has the 1rem margin, so the lines otherwise touch and the slack
falls at the bottom of the band, which is what sits the heading high in it
rather than centred. And the page's button belongs **inside** the title
row, which is why the Playlists button no longer crowds the heading.

Copied as `.page-eyebrow` / `.title-row` / `.page-title` / `.page-subtitle`.

## The nav is Webflow's App Nav, measured

**2026-09-12.** `nav_text_app` and `nav_links_app` were read off the live
Webflow styles rather than eyeballed: 0.8rem at weight 400, 0.5rem above and
below, 1rem between links, no horizontal padding — `nav_sidebar`'s own 3rem
left inset is what positions them — and `app_logo_wrap` 6rem clear of the
first link.

The colour **is** copied, contrary to what this file said for a few hours.
Resolving the variables rather than assuming: `nav_text_app` is
`--_colors---sequel-brown` `#372b29` and `nav_sidebar` is
`--_colors---sequel-silver` `#f1f0ee`. That component stands on exactly the
same two colours this rail does. The earlier claim that it was silver text
on a dark ground was wrong, and it had leaked into `CLAUDE.md` as well —
which is what a guess dressed as a measurement costs.

So the links are Sequel Brown, not a muted grey, and a current page is
marked by weight rather than by fading every other link.

`line-height: 0.8px` is the one value not copied literally, and it is a
load-bearing typo: it collapses the line box so each link is about 17px
tall, which with the 1rem margin puts them on a 33px pitch. Copying 0.8px
would be fragile, so the same pitch is reached with a real line-height and
a smaller margin.

## Staff are an allowlist table, not "anyone signed in"

**2026-09-12.** `app.is_staff()` was `auth.uid() is not null`, which was true
while only staff had accounts. The Studio spec makes viewers Supabase Auth
users, so the first client to sign in would have been staff. `public.staff`
is the allowlist; every account that existed when the migration ran was
inserted, and adding a fourth member of staff is now an insert as well as a
user. The frontend checks the same table for what it shows, but the database
is the enforcement.

## Tracks have no status

**2026-09-12.** The init schema gave tracks new/shortlisted/rejected. The spec
says an inbox is the permanent record and the only actions on a track are
play and drag-into-playlist, so the column, its enum and its index are gone.
A track's "state" is which playlists it sits in — shown as the "in N
playlists" pill.

## A submission is an id minted by the inbox page

**2026-09-12.** The staff inbox stacks drops as expandable submissions. Rather
than guess a drop from timestamps and sender, the inbox page mints one
`submission_id` per send and every row in that send carries it. A retry
keeps the id. Rows from before the column fall back to sender-and-hour.

## Open in Track is keyed by the project's UUID

**2026-09-12.** Track's project page is
`https://www.sequelsounds.app/project?uuid={uuid}` — singular, and the uuid is
the Project Master List's UUID column, not the numeric id the mirror already
keyed on. So the mirror carries both: `xano_id` stays the upsert key, and the
webhook now takes `uuid` into `xano_uuid`. A project without one shows no
button rather than a wrong link.

## Deleting a track happens in a function, not the browser

**2026-09-12.** There was no way to delete a track at all. The gap was never
the database — `staff_all` is `FOR ALL`, `playlist_tracks` and `comments`
cascade, and `playlists.video_track_id`, `project_assets.track_id`,
`events.track_id` and `tracks.duplicate_of` all null out. The gap was S3:
nothing in the app has ever removed an object, so a deleted row would have
left its original, preview, peaks and artwork in the bucket with nothing
pointing at them.

So `delete-track` does both halves behind a staff session. The browser is
given no S3 delete rights, because a delete the page can issue is a delete
anyone holding the page can issue.

**Objects first, then the row.** A half-finished delete then leaves the
track still listed and the call repeatable. The other order loses the only
record that the files exist.

The prefix is built from the id, so the id is checked against a uuid
pattern before it is used as one. And the keys are listed rather than
assumed: the Lambda writes a known handful today, but a key added later
would otherwise be the one thing left behind.

## Tracks no longer say how many playlists they are in

**2026-09-12.** The "in N playlists" pill came from the approved mockup and
was the one thing a track row said about its own state, back when tracks
had a status column and the pill replaced it.

It is gone from every row. In the project page's half-width pane it
truncated to "in 1 playli…"; on the Library it fitted but was still
sitting between a title and nothing, on rows whose titles are long enough
to want the width. `playlistCount` stays in queries.ts — the count is
still there to read if it comes back as a column of its own, which is the
only place it would earn the room.

## A project is a split, not three tabs

**2026-09-12.** Inbox and Playlists were separate tabs, so seeing what a
partner sent and what had been built from it meant switching between two
full-page lists. They are one view now, the shape DISCO uses for the same
job: the left column indexes everything, the right reads whichever one is
open.

Both kinds sit in the same column because both are lists of tracks —
staff playlists first under **Playlists**, the partner drops under
**Inbox**, newest first within each. A drop is a playlist nobody in the
office made, which is the only real difference between them.

Whatever is first opens on landing, so the page is never empty. `?tab=inbox`
still resolves rather than 404ing on a stale link; it lands on the split.

## The project title is the link to Track

**2026-09-12.** Open in Track was a button beside the title pointing at the
same project the title names. The title carries the link instead, in
Fahkwang caps like every other page heading, and the button is gone.

The rule about a missing uuid still holds, and is why this is a condition
rather than a plain anchor: a project with no `xano_uuid` has nowhere to
point, so its title stays plain text rather than becoming a dead link.

## Open in Studio goes to /projects/:id, not /p/:id

**2026-09-12.** The spec wrote `studio.sequelsounds.com/p/{id}`, but `/p/` is
the viewer playlist route and has been since the first migration. Changing a
share-link prefix breaks every link already handed out; changing a button
that does not exist yet costs nothing. The webhook returns `studio_url`
pointing at `/projects/{id}` so Track never has to know the rule.

## The tool has a third button size

**2026-09-12.** The approved mockup's buttons are Creato at 14px with 6×12
padding — neither the marketing `.btn-wide` nor the mono `.btn-mono`. Added as
`.btn-tool`, sizing only; colour still comes from `.btn-dark` / `.btn-outline`
/ `.btn-quiet`. Row hover is Sequel Brown, where the mockup used asphalt: the
mockup is the layout reference, the brand values are the brand's.

## No keyboard shortcuts

**2026-09-12.** The spec's "keyboard and speed matter more than anything" was
withdrawn with the mockup: no ⌘K, no space-to-play. Search is a field in the
rail; the player is clicked. Escape still closes a menu — that is the
browser's convention, not an app shortcut.

## One design system file, two button languages

**2026-09-11.** Shared styles live in `src/styles/design-system.css`, imported
by `index.css`. Tokens stay in `@theme`; this file is only the components built
from them, so a page never restates a padding or a weight.

The awkward finding: the Webflow site speaks **two** button languages, and they
are not reconcilable.

| | Where | Spec |
| --- | --- | --- |
| `.btn-wide` | login, marketing | Creato, sentence case, 0.85rem, padding 0.85/2.2rem, auto width |
| `.btn-mono` | the app shell | Azeret Mono 300, uppercase, 0.7rem, fixed 11 x 2rem |

Collapsing them into one would have broken whichever page lost. They are kept as
named variants instead, with colour as a separate axis (`.btn-light` for dark
grounds, `.btn-dark` / `.btn-outline` for light ones), so either language works
on either surface.

Fields and surfaces follow the same split: `.field-underline` is the login
treatment, `.field-boxed` the tool's. Both take their borders from
`currentColor` rather than naming a colour, so a field inherits whichever
surface it is placed on instead of needing a variant per ground.

Two things fell out of reading the login page that were open questions before:

- **The error colour is `#eb9a93`**, not Tailwind red. That was the last
  off-palette colour in the app and is now `--color-sequel-error`.
- **The login page is inverted** — Sequel Brown ground, Sequel Silver text. The
  app is not uniformly light; it has two true surfaces.

## Login matches the Webflow page, but not its auth

**2026-09-11.** Layout, type, spacing, logo treatment and button styles are
copied from Webflow `/login`, verified by measuring both: heading Creato 300 at
32px/32px, fields underline-only on transparent, the button 47px tall with
0.85/2.2rem padding, mark 4rem square inset 3rem, copyright and help link pinned
to the bottom corners.

**The flows differ and that is deliberate.** Webflow logs in with an email and a
4-digit pin (Wized-driven); this app uses Supabase Auth with a password. The
look was the brief, not the mechanism, and changing the auth model is not a
styling task. Consequences: there is a Password field where Webflow has a Pin
field, the button reads Login rather than Request pin, and the "Sign Up" link is
omitted — staff accounts are created by hand, so there is nothing to sign up to.

## Duplicate uploads are advisory, never blocked

**2026-09-11.** A real duplicate was found in production:
`QUEEN_OF_THE_NIGHT_ARIA.wav`, 42 MB, uploaded twice 2m17s apart — two `tracks`
rows, two S3 objects.

The original dedupe lived only in React state, so it survived exactly as long as
the page did. Reloading — or the old "Clear sent" button — made the app forget
what it had sent, which is precisely when someone re-drags a folder "to be sure".

Fixed in layers, deliberately none of which reject an upload:

- `localStorage` per inbox token — the cheap courtesy that avoids a pointless
  42 MB transfer
- `sign-upload` filename + byte length per project — catches other devices
- Lambda SHA-256 — the only layer that sees the actual bytes

**No unique constraint.** Two different masters can legitimately share a filename
and byte count. A duplicate costs storage and one Lambda run and shows a track
twice in the library; refusing an upload on a guess loses a track that belonged.
The second error is much worse, so the columns record findings and staff decide.

**The browser does not hash.** Hashing 50 × 100 MB client-side is a minute of
nothing happening before the upload starts, to prevent something harmless — and
the answer would still only be as good as one browser's memory. The Lambda
already downloads every file to render the preview, so the hash is free there.

## Bulk drop, no forms

**2026-09-11.** Partners drop 20–50 files at a time and will not fill in forms.
The page was rebuilt around that: one dropzone (files or folders), a row per
file, no per-track inputs, and identity captured once per browser.

Consequences that follow from the same premise:

- **Title comes from tags, falling back to the tidied filename.** Leading track
  numbers are stripped only when a separator follows, so a track called `1979`
  survives.
- **One batch note**, not one per file.
- **The queue rows are the receipt.** A separate "Sent in this session" panel
  duplicated the same information, and "Clear sent" only felt safe *because* of
  that duplication. Both removed; a tick on the row is the record.
- **No Save button for identity.** It writes to `localStorage` with no round
  trip and nothing to fail, so it persists as you type and the section collapses
  when the fields are valid and focus leaves. The sticky bar is already the gate
  that refuses to upload without details.

## Folder drops are supported; the folder *button* is not

**2026-09-11.** Challenged as unnecessary complexity, and half right. The second
"Choose a folder" input was clutter and is gone. The `webkitGetAsEntry` walk on
drop stayed: `dataTransfer.files` is **empty** for a dropped directory, so
without it a partner drags in an album folder and nothing happens, with no error
to explain why.

## Brand values are read from Webflow, not chosen

**2026-09-11.** Every visual decision was taken from the live site rather than
invented:

- `#372b29` **Sequel Brown** for every line — it is the site's own
  `--_colors---sequel-brown`, used on 55 borders of the Projects page
- `#f1f0ee` **Sequel Silver** for the page ground
- **Zero border radius** — surveying the live Projects page returns an empty set
  of radii
- **Buttons**: 11rem × 2rem, 1.2rem horizontal padding, Azeret Mono 300 at
  0.7rem/1rem, uppercase, `letter-spacing: normal`
- The logo is the site's own brown **II** mark. The purple bolt that was in
  `public/favicon.svg` was never a Sequel asset.

## Creato Display with no fallback

**2026-09-11.** Asked for explicitly: Creato every time, no substitute.

- Licensed from Zetafonts and **self-hosted** — converted from the OTFs on the
  Webflow site to woff2 (~60% smaller). Not loaded from a CDN, so nothing
  external can take the brand face down.
- `--font-sans` names only `'Creato Display', sans-serif`. The generic is the
  browser's own last resort; naming a real substitute is what would let
  something else paint.
- `font-display: block`, not `swap` — `swap` paints a system font first and
  reflows, which means visibly non-Creato text on every cold load.
- Above-the-fold faces are **preloaded** in `index.html`, because `block` holds
  text invisible until the face lands.

Azeret Mono (buttons) and Fahkwang (project title) follow the same rules. Azeret
is a variable font: Google's three per-weight URLs return byte-identical files,
so one 26 KB file covers 100–900.

## Partner identity is self-declared

**2026-09-11.** `submitter_name/email/company` are typed by whoever holds the
link and are **not verified**. The share token is the only real authorisation.
`contact_email` is populated with the same address so existing staff views that
read it keep working.

## Internal fields stay off the partner page

**2026-09-11.** The header briefly showed `projects_mirror.client_name`, which
renders as "Internal" or "Sequel" depending on the project — internal
bookkeeping leaking to an external audience. The page shows the project name and
nothing else. The query no longer even selects the other columns.

## Focus rings: kept on buttons, dropped on text fields

**2026-09-11.** Text inputs already show a caret, so the ring was redundant and
visually doubled the 1px border. Buttons and links have no caret, so removing it
there would make keyboard focus invisible. Split accordingly rather than
removing it wholesale.
