# Email image hosting

**Bucket: `sequel-sounds-email-assets` (eu-west-2). Created 20 Sep 2026.**

| File | Size | Dimensions | URL |
|---|---|---|---|
| `sequel-email-wordmark.png` | 15 270 B | 1219×248 | `https://sequel-sounds-email-assets.s3.eu-west-2.amazonaws.com/sequel-email-wordmark.png` |
| `sequel-email-button-submit.png` | 3 185 B | 348×84 | `…/sequel-email-button-submit.png` |
| `sequel-email-footer-logo.png` | 1 050 B | 90×72 | `…/sequel-email-footer-logo.png` |

## ⚠️ THESE FILES ARE NEVER RENAMED, MOVED OR DELETED

They are referenced by email sitting in other people's inboxes, which nobody at
Sequel can reach or update. A release form link never expires, so its email can
be opened years from now. Renaming one of these is breaking mail that has
already been sent.

Versioning is ON for the same reason: an accidental overwrite can be undone.

## Why a separate bucket and not `sequel-sounds-media`

`sequel-sounds-media` holds `contracts/`, `invoices/` and `project-assets/` and
is correctly locked down — all four Block Public Access flags on, no bucket
policy, ACLs disabled (BucketOwnerEnforced).

Making any prefix of it public means turning `BlockPublicPolicy` **off on a
bucket full of client contracts**. That is a bad trade for three logos. Here the
blast radius is three brand images that are meant to be public.

## Why not Xano, Webflow, or the app's own domain

These three images previously lived in **Xano's vault** (they still do — the old
registration template has not been repointed yet). Xano is being retired, and
when it goes every Sequel email ever sent loses its logo and its button.

The same argument rules out Webflow (also being left) and the app's own
hostname (`studio.` → `app.` is an unfinished migration). The rule that survives
all of it: **put email assets somewhere that is not part of any migration.**
AWS is the only piece of the stack nobody is moving.

## Bucket configuration

- Public read on objects only: `s3:GetObject` on `/*` for `*`. **No listing, no
  public writes.**
- `BlockPublicAcls` / `IgnorePublicAcls` stay **on** — access is by policy only,
  never by object ACL.
- Versioning enabled.
- **No CORS.** A PUT rule for `storage.googleapis.com` existed briefly so the
  browser could copy the files across from Xano; it was removed afterwards. Mail
  clients do not use CORS for `<img>`, so the bucket needs none.

## Verified `[V]`, 20 Sep 2026

- All three objects present, byte-for-byte the size of the Xano originals, with
  `Content-Type: image/png`.
- `sequel-email-wordmark.png` fetched **anonymously in a browser** and rendered
  correctly at 1219×248 — the public-read policy works end to end. The other two
  are covered by the same bucket-wide policy.
- No account-level Block Public Access to override it.

## Still to do

- **The old registration template still points at Xano.** `song-registration-request-v2`
  (`9a24f397-9f6f-4e27-a7dc-0a7a13749b0f`) must be repointed at these URLs
  before Xano is switched off, or every past and future registration email
  breaks.
- Optional: put `assets.sequelsounds.com` in front of the bucket, so the URL is
  Sequel's rather than AWS's and the storage behind it can change later.
