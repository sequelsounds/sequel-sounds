# process-track

Runs when a partner's original lands in S3 and produces everything the app
needs from the file itself.

```
tracks/{uuid}/original.wav   partner upload   ← triggers this
tracks/{uuid}/preview.mp3    128k, or preview.mp4 at 720p for video
tracks/{uuid}/peaks.json     ~2000 min/max pairs
tracks/{uuid}/artwork.jpg    embedded cover, or a frame at 1s for video
```

It then POSTs the result to the `track-processed` Edge Function, which owns the
database write. **This function never touches Postgres** — it holds no database
credentials, only an S3 role and one shared secret.

## Why it is the authority on metadata

The browser reads tags on the way in so the partner sees something useful while
uploading. That pass is a courtesy and is overwritten here, because only this
function has the actual bytes. `embedded_tags` stores the ffprobe dump verbatim;
the named columns are extracted from it, not instead of it.

The title rule is the same in both places and has no cleverness in it: the
embedded title exactly as written, or the filename minus its extension.

## Trigger

Eleven S3 notifications, prefix `tracks/`, one per accepted extension, each
with the suffix `original.<ext>`.

Not a bare `.mp3` suffix. The outputs land in the same prefix, so `preview.mp3`
would re-trigger the function on its own output — and that loop bills by the
second.

## ffmpeg

`build-layer.sh` fetches a pinned static build, checks its digest and produces
`ffmpeg-layer.zip`, which is published as a layer and mounted at `/opt/bin`.

Not a public layer ARN: this binary runs over files strangers upload, so the
supply chain for it should be something chosen and checksummed rather than an
ARN in an account nobody here controls. The binary is not committed — it is
~80 MB and does not belong in git.

## Sizing

| Setting | Value | Why |
| --- | --- | --- |
| Memory | 3008 MB | ffmpeg is CPU-bound and Lambda scales CPU with memory |
| Timeout | 900 s | a long video at 720p is minutes, not seconds |
| Ephemeral storage | 10240 MB | uploads cap at 2 GB and `/tmp` defaults to 512 MB — the download alone would fail |

## Environment

- `SUPABASE_URL`
- `TRACK_PROCESSED_SECRET` — shared with the Edge Function
