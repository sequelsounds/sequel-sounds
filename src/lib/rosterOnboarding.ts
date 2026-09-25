import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Adding a composition team, and its composer agreement (Andy, 24 Sep 2026).
 *
 * Everything goes through the `roster-onboarding` edge function: the emails
 * need a key the browser must never hold, the team's pages are public (a
 * token is the credential), and the signature record is only worth anything
 * if the server makes it.
 *
 *   + Add team → an email → the team fills in /join-roster/:token
 *   → Request agreement → Andy reviews and signs for Sequel
 *   → the team signs at /agreement/:token → PDF in S3, CA Complete.
 */

const fn = (supabase as unknown as SupabaseClient).functions

export async function rosterCall<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await fn.invoke('roster-onboarding', { body })
  if (error) {
    let message = fallback
    const res = (error as { context?: Response }).context
    if (res && typeof res.json === 'function') {
      try {
        const b = (await res.json()) as { error?: string }
        if (b?.error) message = b.error
      } catch {
        /* keep the fallback */
      }
    }
    throw new Error(message)
  }
  return data as T
}

type Emailed = { emailed: boolean; email_error?: string }

function useRosterMutation<V, T>(run: (v: V) => Promise<T>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'roster'] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'roster-member'] })
    },
  })
}

export const useInviteTeam = () =>
  useRosterMutation((email: string) =>
    rosterCall<Emailed & { uuid: string }>({ action: 'invite', email }, "The team couldn't be added. Please try again."),
  )

export const useResendInvite = () =>
  useRosterMutation((supplierId: number) =>
    rosterCall<Emailed>({ action: 'resend_invite', supplier_id: supplierId }, "The email couldn't be sent."),
  )

export const useRequestAgreement = () =>
  useRosterMutation((supplierId: number) =>
    rosterCall<{ stage: string }>(
      { action: 'request_agreement', supplier_id: supplierId },
      "The agreement couldn't be requested.",
    ),
  )

export const useCompanySign = () =>
  useRosterMutation((v: { supplierId: number; name: string; consent: boolean }) =>
    rosterCall<Emailed & { stage: string }>(
      { action: 'company_sign', supplier_id: v.supplierId, name: v.name, consent: v.consent },
      "The agreement couldn't be signed.",
    ),
  )

export const useResendAgreement = () =>
  useRosterMutation((supplierId: number) =>
    rosterCall<Emailed>({ action: 'resend_agreement', supplier_id: supplierId }, "The email couldn't be sent."),
  )

export type AgreementPreview = {
  stage: string | null
  can_sign: boolean
  pdf: string
  team: string
  legal_name: string
  email: string | null
  consent: string
}

export const previewAgreement = (supplierId: number) =>
  rosterCall<AgreementPreview>({ action: 'preview', supplier_id: supplierId }, "The agreement couldn't be opened.")

export async function openSignedAgreement(supplierId: number): Promise<string> {
  const r = await rosterCall<{ url: string }>(
    { action: 'document', supplier_id: supplierId },
    "The signed agreement couldn't be opened.",
  )
  return r.url
}

/** base64 PDF bytes → a URL PdfView can read. Revoke it when done. */
export function pdfUrl(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

/* ------------------------------------------------------------ public side */

export type Option = { id: number; country?: string; region?: string }
export type TeamFields = Record<string, string | number | null>

export type FormState =
  | { state: 'invalid' | 'done' }
  | { state: 'open'; email: string; countries: Option[]; fields: TeamFields; error?: string }

export const teamForm = (token: string) =>
  rosterCall<FormState>({ action: 'form', token }, 'This link could not be opened.')

export const submitTeamForm = (token: string, fields: TeamFields) =>
  rosterCall<{ state: 'open' | 'done' | 'invalid'; error?: string }>(
    { action: 'form_submit', token, fields },
    "We couldn't save your details just now. Please try again in a minute.",
  )

export type AgreementToSign = {
  pdf: string
  team: string
  legal_name: string
  email: string | null
  consent: string
  details_hash: string
}

export type AgreementState = {
  state: 'invalid' | 'sign' | 'done'
  agreement?: AgreementToSign | null
  error?: string
}

export const agreementForToken = (token: string) =>
  rosterCall<AgreementState>({ action: 'agreement', token }, 'This link could not be opened.')

export const signAgreement = (token: string, name: string, consent: boolean, detailsHash: string) =>
  rosterCall<AgreementState>(
    { action: 'agreement_sign', token, name, consent, details_hash: detailsHash },
    "We couldn't sign your agreement just now. Please try again in a minute.",
  )
