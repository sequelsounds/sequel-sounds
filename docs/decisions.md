# Decisions

Why things are the way they are. Newest first. Add to this rather than
rediscovering an argument later.

---

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
