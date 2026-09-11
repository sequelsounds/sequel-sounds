# Xano → Supabase sync

Xano is the system of record for projects and suppliers. This app keeps mirrors
of them so it can attach tracks, inboxes and playlists to a project without
calling Xano on every page load.

One Edge Function receives the changes: **`xano-webhook`**. Nothing else writes
to `projects_mirror` or `suppliers_mirror`.

```
POST https://sveirphsppyfhulymjiu.supabase.co/functions/v1/xano-webhook
```

## Before it will run

Two secrets, set in the Supabase dashboard (Edge Functions → Secrets). Until
both exist every call returns `500` naming the ones that are missing.

| Secret | Value |
| --- | --- |
| `XANO_WEBHOOK_SECRET` | 32+ character random string, shared with Xano |
| `APP_BASE_URL` | Origin of this app, no trailing path or slash — e.g. `https://app.sequelsounds.app` |

`APP_BASE_URL` is only used to build the inbox URL that comes back in the
response. Get it wrong and the links Xano stores will point at the wrong host.

## Auth

Send the shared secret in a header:

```
x-webhook-secret: <XANO_WEBHOOK_SECRET>
```

This function is deployed with **`verify_jwt` disabled**, so no Supabase anon
key or bearer token is needed — the header is the whole gate. That is deliberate:
the caller is a server, and the publishable key is public so it would prove
nothing. The comparison is constant-time over SHA-256 digests, so neither the
value nor its length leaks through timing.

**Keep the secret out of URLs and logs.** It is a bearer credential: anyone
holding it can write to the mirrors.

## Request

```jsonc
{
  "type": "project",   // or "supplier"
  "record": { /* fields below */ }
}
```

One record per call. To backfill, loop — there is no batch form, deliberately,
so a partial failure is always about exactly one record.

### `type: "project"`

| Field | Required | Notes |
| --- | --- | --- |
| `xano_id` | **yes** | Xano's own id, as a string. The upsert key. |
| `name` | **yes** | Shown to partners on the inbox page. |
| `client_name` | no | Internal — never rendered on partner-facing pages. |
| `status` | no | Free text, stored as-is. |
| `brief` | no | |
| `starts_on` | no | `YYYY-MM-DD`. Unparseable values become null rather than erroring. |
| `ends_on` | no | As above. |

### `type: "supplier"`

| Field | Required | Notes |
| --- | --- | --- |
| `xano_id` | **yes** | The upsert key. |
| `name` | **yes** | |
| `contact_email` | no | Lower-cased on the way in. |
| `notes` | no | |

Any extra fields you send are kept verbatim in a `raw` JSONB column, so adding
something in Xano does not require a change here before it is captured.

Empty strings are treated as null — Xano tends to send `""` rather than omitting
a field, and a date column will not accept `""`.

## Response

`200` on success. For a project:

```json
{
  "ok": true,
  "type": "project",
  "id": "a6cdb399-9f3c-41b4-92de-b2bc4fd5184c",
  "xano_id": "4821",
  "created": true,
  "inbox": {
    "token": "41a3da9d9be748f9a687bd46d602375f",
    "url": "https://app.sequelsounds.app/inbox/41a3da9d9be748f9a687bd46d602375f",
    "is_active": true,
    "expires_at": null
  }
}
```

For a supplier, the same without `inbox`.

- `id` — the Supabase uuid. Worth storing in Xano if you ever want to join.
- `created` — `true` if this call inserted the row, `false` if it updated one.
- `inbox.url` — **this is the link to give partners.** Store it on the Xano
  project record.

Every project gets exactly one inbox, created automatically when the project row
is first inserted. The token is stable: calling this endpoint again for the same
project returns the same URL, so it is safe to re-read rather than cache.

`inbox` can be `null` only if the inbox could not be created at all — treat that
as a failure worth alerting on, not a normal state.

## Errors

| Status | Body | Meaning |
| --- | --- | --- |
| `400` | `invalid json` | Body was not JSON |
| `400` | `type must be 'project' or 'supplier'` | Missing or unknown `type` |
| `400` | `record is required` | No `record` object |
| `400` | `record.xano_id is required` | |
| `400` | `record.name is required` | |
| `401` | `missing webhook secret` | No `x-webhook-secret` header |
| `401` | `invalid webhook secret` | Header did not match |
| `405` | `method not allowed` | Not a POST |
| `500` | `webhook is misconfigured` + `problems[]` | Secrets missing or malformed |
| `500` | `lookup failed` / `could not save record` | Database error |

## Retries

**Safe to retry.** Upserts key on `xano_id`, so replaying the same call converges
on the same row rather than creating another. A retry after a timeout is the
correct response, and `created` will simply come back `false` the second time.

Two consequences worth designing around in Xano:

- A `500` may mean the write *did* land and the response was lost. Retry anyway;
  it is idempotent.
- Field values are **last-write-wins**. If Xano and something else could both
  change a project, the last call here is what the mirror shows.

## Not supported

**Deletes.** There is no way to remove a mirrored project or supplier through
this endpoint, because tracks, playlists and comments hang off `projects_mirror`
by foreign key and would cascade. If a project genuinely needs removing, that is
a deliberate manual operation, not a webhook.

Renaming is fine — `xano_id` is the identity, not `name`.

## Worked examples

```bash
curl -X POST "$SUPABASE_URL/functions/v1/xano-webhook" \
  -H "content-type: application/json" \
  -H "x-webhook-secret: $XANO_WEBHOOK_SECRET" \
  -d '{
    "type": "project",
    "record": {
      "xano_id": "4821",
      "name": "Unilever - Spring Campaign",
      "client_name": "Unilever",
      "status": "active",
      "starts_on": "2026-03-01",
      "ends_on": "2026-05-31"
    }
  }'
```

```bash
curl -X POST "$SUPABASE_URL/functions/v1/xano-webhook" \
  -H "content-type: application/json" \
  -H "x-webhook-secret: $XANO_WEBHOOK_SECRET" \
  -d '{
    "type": "supplier",
    "record": {
      "xano_id": "77",
      "name": "Cavendish Music",
      "contact_email": "sync@cavendishmusic.com"
    }
  }'
```

## Wiring the Xano side

1. Add an environment variable in Xano for the shared secret. Do not inline it
   in a function stack where it ends up in request history.
2. On project create **and** update, call this endpoint with `type: "project"`.
   On create, write `inbox.url` back to the Xano project record.
3. Same for suppliers with `type: "supplier"`.
4. Treat any non-`200` as retryable, since every call is idempotent.
5. To backfill what already exists, loop over current projects and suppliers and
   send one call each. Existing rows come back `created: false`; projects that
   somehow lack an inbox get one created on the way through.
