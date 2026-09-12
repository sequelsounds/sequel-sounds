# infra

Files applied by hand to AWS. Neither is read by the app at runtime.

## s3-cors.json

The bucket's CORS rules. A new origin has to be added here as well as in
`ALLOWED_ORIGINS` in the two signing functions — see CLAUDE.md.

    aws s3api put-bucket-cors --bucket sequel-sounds-media --region eu-west-2 \
      --cors-configuration file://infra/s3-cors.json

## s3-list-policy.json

What `delete-track` needs from the Edge Functions' IAM key. The user is
**`sequel-sounds-signer`**, whose original inline policy
`sequel-sounds-media-tracks-rw` grants only PutObject, GetObject and the two
multipart actions on `tracks/*` — everything presigning needs and nothing
more. This file is attached alongside it as `sequel-studio-delete-track`
rather than folded into it, so the path the whole app depends on stays as
it was.

`s3:ListBucket` is granted on the **bucket** arn and `s3:DeleteObject` on
`bucket/tracks/*`. Getting those the same way round is the usual mistake:
listing is a bucket operation, deleting is an object one. With only the
first, the delete gets one step further and 403s on the object instead.
