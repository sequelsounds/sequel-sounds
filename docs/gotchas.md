# Gotchas

Things that cost time once. Each is real and was hit in this repo.

## S3 secret lengths are validated, on purpose

`sign-upload` checks that `S3_ACCESS_KEY_ID` is exactly 20 characters and
`S3_SECRET_ACCESS_KEY` exactly 40, and refuses to run if not.

Without it, a truncated or whitespace-padded secret pasted into the Supabase
dashboard fails at *signing* time — S3 returns `SignatureDoesNotMatch`, which
reads like a code bug and sends you looking in entirely the wrong place. The
check turns a mystery into `S3_SECRET_ACCESS_KEY is 39 chars, expected 40`.

The error response reports **names and lengths only, never values**. Keep it
that way: this endpoint is reachable by anyone holding a share token.

Secrets live in the Supabase dashboard (Edge Functions → Secrets) and never in
the repo: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_BUCKET`.

## An empty `file.type` breaks uploads

Browsers hand back `''` for `file.type` on plenty of real AIFF and FLAC files,
and `sign-upload` rejects anything that is not `audio/*` or `video/*` with a 415.
On a 50-file drop that silently loses files.

`contentTypeFor()` in `src/lib/upload.ts` falls back to an extension lookup.
Fixed client-side deliberately, so the Edge Function needs no redeploy — and the
same resolved type is used for the presign, the PUT header and the `mime_type`
column so all three agree.

## Tailwind v4: bare `rounded` is not a theme token

Zeroing `--radius-*` in `@theme` does **not** make `rounded` square — the bare
class is a hardcoded `.25rem`. Two elements stayed curved after the scale was
zeroed. Both are now done: the scale is zeroed *and* no `rounded*` class exists
in markup.

## `:autofill` and `:-webkit-autofill` cannot share a selector list

CSS drops an **entire rule** if any selector in its list is unrecognised. Putting
both in one rule means a browser that does not know `:autofill` loses the WebKit
fix too — yellow comes back on exactly the browsers that need the workaround.
They are separate rules in `src/index.css`. Keep them separate.

**The colours must follow the surface — and `currentColor` cannot do it.** This
took two passes to get right:

1. The first version hardcoded Sequel Silver as the inset shadow and Sequel
   Brown as the text. Correct while every page was light; it painted a silver
   box on the dark login page the moment one existed.
2. The fix used `currentColor` instead, which looked principled and produced
   *dark text on the dark surface*. `-webkit-text-fill-color` exists precisely
   because the browser has already overridden `color` on an autofilled field,
   so `currentColor` resolves to the browser's value — the very one being
   overridden.

Both now name `--surface-fg` / `--surface-bg`, published by `.surface-dark` and
`.surface-light`.

**It is not only colour — the font is replaced too.** Browsers restyle an
autofilled field rather than merely tinting it, deliberately, so a site cannot
disguise what has been filled in. `font-family` is part of that. Unlike the
background and the text colour, it needs no hack: it is overridable, but it has
to be declared in a rule that *matches the autofill state*. A family on the
field's own class does not, which is why an autofilled field came out in the
system font while everything around it stayed Creato. All three autofill rules
now restate it, and `.field-boxed` declares its family instead of inheriting
one — an inherited value is one more thing there is nothing to override. **Inside an autofilled field, treat `currentColor` as
unavailable.** `.field-underline` and `.field-boxed` take their border and text
from `--surface-fg` for the same reason: a border drawn from `currentColor`
turns dark as soon as Chrome fills the field.

The `transition: background-color 100000s` is the other half of the trick, not
decoration: the inset shadow hides the initial fill, and deferring the
transition by roughly a day stops Chrome repainting the background afterwards.

Related: the engines differ in kind, not just in prefix.

- WebKit/Blink paint a **background** that ignores `background-color` — cover it
  with a large inset `box-shadow`, and set `-webkit-text-fill-color` because
  `color` is ignored as well.
- Firefox applies a **`filter`** over the field. `filter: none` is what clears
  it; no background override will. Firefox before 86 knows only
  `:-moz-autofill`, and `:-moz-autofill-preview` is the ghosted value shown
  while a suggestion is merely highlighted — both in a third rule of their own,
  for the same reason.
- Firefox also draws `::-moz-focus-inner` on buttons and rings a half-typed
  `type="email"` via `:-moz-ui-invalid`. Both are reset.

## `:focus-visible` ignores programmatic focus

Calling `.focus()` from a script does not match `:focus-visible` — the browser
reserves it for keyboard interaction. A check that reported `outline: none` on a
button looked like a broken style and was a broken *test*. Send real Tab
keypresses.

## `useRef`'s initial value is evaluated once

`useRef(loadSent(token))` keeps the value from mount. React Router changes the
`:token` param **without remounting**, so switching inbox links client-side left
the page holding the previous inbox's keys and mis-flagging files.

Fixed structurally: the route is a wrapper rendering `<Inbox key={token} />`.
Prefer remounting over patching refs when *all* of a component's state belongs
to the thing that changed.

## `input.files = …` then reading it back reports zero

The change handler resets `e.target.value = ''` so the same file can be picked
twice in a row. Any test that assigns `input.files`, dispatches `change`, then
reads `input.files.length` sees `0` and looks like a failure. Measure before
dispatching.

Also: `new File(...)` without an explicit `lastModified` defaults to
`Date.now()`, so two "identical" test files get different dedupe keys. Set it
explicitly when testing duplicates.

## `text-transform: uppercase` does not change `textContent`

A button reading `BROWSE` on screen still has `textContent === 'Browse'`.
Case-insensitive matching in tests, always.

## Library tags can be sales copy

Production-music libraries stuff descriptions into the ID3 title field. One real
file arrived titled *"QUEEN OF THE NIGHT ARIA from The Magic Flute --- Fierce
soprano aria with famous ridiculously high climax. Wri…"*. The rule "filename
wins only when the tag is empty" does not help — the tag is not empty, just
useless. **Open question**, no decision yet.

## A scrolling column inside the grid needs `min-h-0` at every level

The staff shell is a CSS grid with a fixed-height row, and each column is a
flex column whose middle part scrolls. Flex and grid items default to
`min-height: auto`, which means "at least as tall as my content" — so the
list grew, the column grew, the grid grew past the viewport, and the player
bar slid off the bottom. Nothing scrolled and nothing looked broken until the
list was long. Every element between the grid row and the scrolling element
carries `min-h-0` (and the column an `overflow-hidden`), and that is the whole
fix. Check with a long list, not the two-row fixture.

## The dev server port is not pinned

`vite.config.ts` sets no port, so 5173 is only Vite's default. If something else
holds it, Vite silently increments and `.claude/launch.json` is then wrong. Add
`server: { port: 5173, strictPort: true }` if that ever bites.

## The Lambda lives outside this repo

Nothing here can change preview rendering, peaks, or the planned `content_hash`
work. The contract is written down in the README; the code is elsewhere.

## Edge Functions need deploying separately

Editing `supabase/functions/sign-upload/index.ts` changes nothing in production
until `supabase functions deploy sign-upload` runs. The duplicate pre-check is
currently **written but not deployed**.
