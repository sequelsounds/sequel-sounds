# Staff auth

Staff sign in with an emailed 6-digit code. There are no passwords, and no
magic links — the code is typed into the page.

Partners and clients are unaffected: they never have accounts and reach their
pages through share tokens. See [`architecture.md`](architecture.md).

## The flow

1. Staff enter an email. The app calls `signInWithOtp` with
   **`shouldCreateUser: false`**.
2. Supabase emails a 6-digit code, valid for 10 minutes.
3. Staff type the code. The app calls `verifyOtp` with `type: 'email'` and a
   session is created.

Resending is blocked for 60 seconds in the UI, because Supabase refuses a second
code inside a minute anyway and a button that earns a rate-limit error is worse
than one that says "Resend in 43s".

## How "only three staff" is actually enforced

**Not by a list in the frontend.** The rule is: *an account has to already
exist*, and accounts are only ever created by hand.

`shouldCreateUser: false` means an unknown address cannot sign itself up.
Supabase rejects the request with `otp_disabled`, which the page reports as
**"That email is not authorised."** No email is sent and no user is created.

Two consequences worth understanding:

- **The frontend never carries a list of staff emails.** It could not be
  trusted anyway — anything shipped to a browser can be read and edited — and
  putting three real addresses in a public bundle leaks them for no benefit.
- **Adding a fourth member of staff is a deliberate act**, not a config change:
  create the user in Supabase.

One tradeoff, stated plainly: telling an unknown address that it is "not
authorised" confirms which addresses *are* staff to anyone who guesses one. The
alternative is the vaguer "if that address is registered, a code is on its way",
which leaks nothing but is worse for the three people actually using this. The
specific message was asked for; the enumeration is the price.

## What still has to be set in the dashboard

None of this can be done from the repo — it is project configuration, not code.
Until the first two are done, **sign-in does not work at all**.

### 1. Send a code, not a link

Auth → Email Templates → **Magic Link**. Supabase sends a magic link by default;
the same template drives the OTP, and the difference is purely what it contains.
Replace the body with something like:

```html
<h2>Your Sequel sign-in code</h2>
<p style="font-size:2rem;letter-spacing:0.3em;font-weight:300">{{ .Token }}</p>
<p>This code expires in 10 minutes. If you didn't ask for it, ignore this email.</p>
```

The important part is `{{ .Token }}` and the **absence** of
`{{ .ConfirmationURL }}`. Leave a link in and mail scanners will click it,
burning the code before the person reads it.

### 2. Code expiry

Auth → Providers → Email → **Email OTP Expiration** → `600` (10 minutes).
Supabase caps this at 86400; longer windows give brute force more room.

### 3. Close signups

Auth → Providers → Email → **Allow new users to sign up** → **off**.

This is belt and braces with `shouldCreateUser: false`: one is the request
saying "do not create", the other is the project refusing regardless.

### 4. Sessions

Auth → Sessions.

| Setting | Value | Why |
| --- | --- | --- |
| JWT expiry | `604800` (7 days, the maximum) | How long an access token lasts before the client silently renews it |
| Refresh token rotation | **on** | Each refresh issues a new token and retires the old one |
| Reuse interval | `10` seconds | Lets a retried or racing request reuse a token briefly instead of logging someone out |

**On the free plan there is no way to cap a session at exactly 30 days.**
Time-boxed sessions and inactivity timeouts are Pro features. Without them a
refresh token stays valid until it is used, revoked, or the user signs out — so
staff stay signed in *indefinitely*, which overshoots the 30 days asked for
rather than falling short. If the 30-day boundary matters, that is a plan
upgrade, and then: Sessions → **Time-box user sessions** → `720h`.

### 5. Site URL

Auth → URL Configuration → **Site URL** → `https://studio.sequelsounds.com`.

### 6. Custom SMTP

Supabase's built-in sender is heavily throttled and shared, so codes arrive late
or not at all. Resend replaces it. Project Settings → Authentication → SMTP.

## What is needed to finish this

### The three staff email addresses

`auth.users` is **empty** — zero users, zero identities. Nobody can sign in
today, whatever the settings say. Send the three addresses and they can be
created; each person then signs in with a code, with no password ever set.

### Resend

Done in this order:

1. **Verify a sending domain in Resend** — `sequelsounds.com`, or a subdomain
   like `mail.sequelsounds.com`. Resend gives DNS records (DKIM, SPF, and a
   DMARC suggestion) to add. Codes sent from an unverified domain land in spam,
   which defeats the point of moving off Supabase's sender.
2. **Create a Resend API key** with send permission.
3. **Enter it in Supabase yourself** — Project Settings → Authentication → SMTP:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` (the literal word) |
   | Password | your Resend API key, `re_…` |
   | Sender email | e.g. `login@sequelsounds.com`, on the verified domain |
   | Sender name | e.g. `Sequel` |

**Do not paste the API key into this chat or the repo.** It is a live sending
credential; it belongs in the Supabase dashboard and nowhere else. The only
things needed here are the sender address you settle on and a word when the
domain is verified.
