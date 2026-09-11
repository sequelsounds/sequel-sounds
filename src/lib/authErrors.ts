import type { AuthError } from '@supabase/supabase-js'

/**
 * Supabase's auth errors are accurate but not written for the person reading
 * them. This maps the ones this flow can actually produce.
 *
 * The important one is `otp_disabled`. Because sign-in requests are sent with
 * `shouldCreateUser: false`, an address with no account cannot be signed up,
 * and Supabase reports that as "Signups not allowed for otp" — which is what
 * "not authorised" means here.
 */
export function loginErrorMessage(error: AuthError): string {
  const code = error.code ?? ''
  const message = error.message.toLowerCase()

  if (code === 'otp_disabled' || message.includes('signups not allowed')) {
    return 'That email is not authorised.'
  }
  if (code === 'over_email_send_rate_limit' || message.includes('rate limit')) {
    return 'Too many requests. Wait a minute and try again.'
  }
  if (code === 'otp_expired' || message.includes('expired')) {
    return 'That code has expired. Request a new one.'
  }
  if (code === 'invalid_credentials' || message.includes('invalid')) {
    return 'That code is not right. Check it and try again.'
  }
  if (message.includes('email')) {
    return 'That email is not authorised.'
  }
  return 'Something went wrong. Try again.'
}
