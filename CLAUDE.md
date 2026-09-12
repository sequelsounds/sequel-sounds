# CLAUDE.md

Working notes for Claude in this repo. Read `docs/overview.md` first for what
the product is, `docs/product-spec.md` for what is being built, and
`docs/mockups/sequel-studio-mockup.html` for what the staff app looks like;
this file is about how to work here.

## Commands

```bash
npm run dev     # Vite dev server on :5173 (not pinned — see gotchas)
npm run build   # tsc -b && vite build
npm run lint    # oxlint
npm run types   # regenerate src/lib/database.types.ts (needs the supabase CLI)
```

There is **no Prettier config**, but the codebase is Prettier-formatted with
`--no-semi --single-quote`. Match it. If a scripted edit disturbs formatting,
reformat with exactly those flags rather than hand-fixing indentation.

The `supabase` CLI is **not installed** on this machine. `npm run types` will
fail; patch `src/lib/database.types.ts` by hand after a migration and keep it
alphabetical, the way the generator emits it.

## Before you change anything

- **Read the live database, not just the migrations.** They have matched so far,
  but the Supabase MCP can query `sveirphsppyfhulymjiu` directly and that is the
  truth. Several "bugs" this session were data, not code — a string in
  `projects_mirror.client_name`, not a hardcoded label.
- **Read the Webflow site for anything visual.** Brand values are not guesses:
  the site at `sequelsounds.app` (id `68e6c2e8dbcd39de2547a97d`) is queryable,
  and computed styles off the live page settle colour, spacing and type
  questions exactly. See `docs/decisions.md`.

## Conventions

- Tailwind v4. Design tokens live in `@theme` in `src/index.css`; brand colours
  are `sequel-brown`, `sequel-silver`, `sequel-asphalt`, `sequel-error`. **No
  `neutral-*` classes, and no Tailwind `red-*`** — both are cool on a warm
  palette and read as washed out or foreign.
- **Build pages from `src/styles/design-system.css`**, not from ad-hoc
  utilities: `.surface-dark` / `.surface-light`, `.display-heading`,
  `.field-label`, `.field-underline` / `.field-boxed`, `.corner-note`,
  `.form-error`, and `.btn` plus a language (`.btn-wide` for landing pages,
  `.btn-mono` for the tool) and a colour (`.btn-light`, `.btn-dark`,
  `.btn-outline`). Add to that file rather than restating values in a route.
- **Zero border radius.** The whole radius scale is zeroed in `@theme` and there
  are no `rounded*` classes in markup. Both, deliberately — see gotchas.
- Fonts are self-hosted in `public/fonts/`, never linked from a CDN. All use
  `font-display: block`, and the above-the-fold faces are preloaded in
  `index.html`.
- Comments explain *why*, not what. Match the density already in `src/lib/`.

## Things that are easy to get wrong

- **Partners never fill in forms.** The inbox page takes a name/email/company
  once per browser and nothing else. Do not add per-track fields; staff edit
  metadata in the library.
- **Browser-side metadata is a first pass.** The Lambda re-reads tags server-side
  and is authoritative. Never make an upload depend on a browser tag read.
- **Nothing blocks an upload on a guess.** Duplicate detection is advisory at
  every layer. Losing a track that belonged is worse than storing it twice.
- **Never commit font files you have not licensed**, and never write secret
  values into the repo or into error messages. `sign-upload` reports secret
  *names and lengths* only, on purpose.

## Verifying work

Prefer checking the running app over asserting it works. The in-app browser can
drive `localhost:5173`, and reading computed styles or the DOM beats reasoning
about CSS. Staff sign-in needs an emailed code you cannot receive, so for the
staff shell use **`/__preview/projects/p1`** — a dev-only route that mounts the
real components over fixture data (`src/dev/Preview.tsx`). It is compiled out
of production builds. When testing uploads, clean up afterwards: delete both the `tracks`
row and the S3 object.

`:focus-visible` does not match a programmatic `.focus()` — only real keyboard
interaction. Test focus styles by sending Tab keypresses.

## Deployment

The app is a static build on **Cloudflare Workers** at
**https://studio.sequelsounds.com** (`wrangler.jsonc`, assets from `./dist`,
SPA not-found handling).

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are **build-time**
variables — Vite inlines them, so they belong in Cloudflare's build environment,
not as Worker secrets. Set as Worker secrets they do nothing and the app throws
`Missing VITE_SUPABASE_URL` on load.

**A new origin has to be added in four places, or uploads fail in ways that
look unrelated:**

1. `ALLOWED_ORIGINS` in `supabase/functions/sign-upload/index.ts` **and**
   `supabase/functions/sign-media/index.ts`, then redeploy both
2. the S3 bucket CORS — `infra/s3-cors.json`, applied with
   `aws s3api put-bucket-cors --bucket sequel-sounds-media --region eu-west-2
   --cors-configuration file://infra/s3-cors.json`
3. `APP_BASE_URL` in the Supabase secrets, which is what `xano-webhook` uses to
   build the inbox links Xano stores

Miss (1) and the presign call is blocked — or, for `sign-media`, every artwork
and preview in the staff app silently fails to load; miss (2) and the presign succeeds but
the PUT to S3 is blocked — the page looks fine until someone actually drops a
file. Miss (3) and every partner link Xano hands out points at the wrong host.

Edge Functions deploy separately from the app; editing a file under
`supabase/functions/` changes nothing until it is deployed. There is no supabase
CLI on this machine, but the Supabase MCP can deploy — keep `verify_jwt` as it
was (`true` for `sign-upload` and `sign-media`, `false` for `xano-webhook` and
`track-processed`, which authenticate themselves with a shared secret).

