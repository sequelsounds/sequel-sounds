# Decisions

Why things are the way they are. Newest first. Add to this rather than
rediscovering an argument later.

---

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
