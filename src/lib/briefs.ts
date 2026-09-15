import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { mirror } from './xanoMirror'

/**
 * Briefs — the old app's Briefs API group and its Wized `brief_*` variables,
 * rebuilt. Spec: `sequel-track-briefs.md`; rules copied from Xano's
 * request_brief / get_brief_by_token / submit_brief / archive_brief, which
 * live here as `public.track_request_brief`, `public_brief`, `submit_brief`
 * and `track_archive_brief` (migration 0026).
 *
 * ⚠️ `briefs` is still in the hourly sync, so a brief made here is deleted on
 * the next full push. Test data only until the cutover.
 */

const rpc = (supabase as unknown as SupabaseClient).rpc.bind(supabase as unknown as SupabaseClient)

export type BriefQuestion = {
  key: string
  type: 'text' | 'long' | 'choice' | 'date'
  title: string
  required?: boolean
  help?: string
  choices?: { label: string; value: string }[]
}

/**
 * The whole form as data — Wized's `brief_questions`, word for word and in
 * order. `key` is what the database reads; a choice's `value` is what it
 * stores and its `label` is what the client reads. The brief view and EMAIL
 * BRIEF render from this same list, so rewording a question here rewords it
 * everywhere.
 */
export const BRIEF_QUESTIONS: BriefQuestion[] = [
  { key: 'name', type: 'text', required: true, title: "Let's start by giving this brief a name." },
  {
    key: 'brief_type',
    type: 'choice',
    required: true,
    title: 'What is your brief for?',
    choices: [
      { label: 'Library/production music', value: 'Library' },
      { label: 'A bespoke composition or re-record', value: 'Composition' },
      { label: 'Commercially released music', value: 'Commercial' },
    ],
  },
  { key: 'budget_note', type: 'text', title: 'Is there a budget we need to keep in mind?' },
  {
    key: 'one_sentence',
    type: 'long',
    title: 'In one sentence, describe the perfect music. Give us the elevator brief.',
  },
  { key: 'inspo', type: 'long', title: 'What was the inspo for the ad/scene?' },
  { key: 'genres', type: 'long', title: 'Are there any specific styles or genres you want to focus on?' },
  { key: 'audience', type: 'long', title: 'What audience are you most keen to engage?' },
  {
    key: 'feel',
    type: 'long',
    title: 'And what do you want them to feel?',
    help: 'We think music is what emotions sound like, so this is a great steer.',
  },
  {
    key: 'geography',
    type: 'long',
    title: 'Is there a geography, culture or period of time the music needs to work within?',
  },
  { key: 'off_limits', type: 'long', title: 'Is there anything that is off limits?' },
  {
    key: 'story',
    type: 'long',
    title:
      'Should the music move through a story arc? If so, what are the phases? Are there any moments the music should help to emphasise?',
  },
  {
    key: 'reference_tracks',
    type: 'long',
    title: 'Do you have any reference tracks?',
    help: 'If so, please link to them here. Feel free to add as many as you like...',
  },
  {
    key: 'ref_comments',
    type: 'long',
    title: 'What is it that you like about the reference tracks?',
    help: "Even if it's just a feeling, it can be helpful.",
  },
  {
    key: 'vocal_or_instrumental',
    type: 'choice',
    required: true,
    title: 'Are you looking for vocal or instrumental tracks?',
    choices: [
      { label: 'Vocal', value: 'Vocal' },
      { label: 'Instrumental', value: 'Instrumental' },
      { label: 'Either', value: 'Either' },
    ],
  },
  {
    key: 'lyrical_themes',
    type: 'long',
    title: 'Are there any lyrical themes you want to explore?',
    help: 'Type as many as you like.',
  },
  { key: 'client_deadline', type: 'date', required: true, title: 'When would you like to hear suggestions?' },
  { key: 'anything_else', type: 'long', title: 'Anything else that would be useful to know?' },
]

export type BriefAnswers = Record<string, string>

/**
 * `brief_flow`: the questions this client actually sees. Budget is asked only
 * for commercially released music; lyrics are skipped for instrumental. Both
 * branches are the Typeform's.
 */
export function briefFlow(answers: BriefAnswers): BriefQuestion[] {
  return BRIEF_QUESTIONS.filter((q) => {
    if (q.key === 'budget_note') return answers.brief_type === 'Commercial'
    if (q.key === 'lyrical_themes') return answers.vocal_or_instrumental !== 'Instrumental'
    return true
  })
}

/** Sequel needs two clear days: the earliest workable deadline is the day after tomorrow. */
export const MIN_NOTICE_DAYS = 2

/** `brief_date_invalid` — a complete date sooner than that. */
export function deadlineTooSoon(value: string | undefined): boolean {
  if (!value) return false
  const entered = new Date(value + 'T00:00:00')
  if (Number.isNaN(entered.getTime())) return true
  const earliest = new Date()
  earliest.setHours(0, 0, 0, 0)
  earliest.setDate(earliest.getDate() + MIN_NOTICE_DAYS)
  return entered < earliest
}

const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function briefDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value)
  return Number.isNaN(d.getTime()) ? '' : dateLabel.format(d)
}

/* ------------------------------------------------------------ the public form */

export type PublicBrief = {
  status: string | null
  agency: string
  brand: string | null
  project_title: string | null
  expires_at: string | null
  submitted_at: string | null
}

/** get_brief_by_token. `null` = unknown token (or refused) — the form reads that as "not valid". */
export function usePublicBrief(token: string | null) {
  return useQuery({
    enabled: !!token,
    queryKey: ['public-brief', token],
    retry: false,
    queryFn: async (): Promise<PublicBrief | null> => {
      const { data, error } = await rpc('public_brief', { p_token: token! })
      if (error) throw error
      const d = data as (PublicBrief & { error?: string }) | null
      if (!d || d.error) return null
      return d
    },
  })
}

export function useSubmitBrief(token: string | null) {
  return useMutation({
    mutationFn: async (answers: BriefAnswers) => {
      const { data, error } = await rpc('submit_brief', { p_token: token, p_answers: answers })
      if (error) throw error
      const d = data as { success?: boolean; error?: string } | null
      if (!d?.success) throw new Error(d?.error || "That didn't send. Please try again.")
    },
  })
}

/* ---------------------------------------------------------- the staff side */

/**
 * The link a client opens. Built from the current host, as the old app does,
 * so a link minted on localhost opens on localhost and one minted on
 * app.sequelsounds.com opens there.
 */
export function briefLink(token: string, staff = false): string {
  return `${window.location.origin}/brief?token=${token}${staff ? '&mode=staff' : ''}`
}

export type MintedBrief = { brief_id: number; share_token: string; expires_at: string }

export function useRequestBrief(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (internal: boolean): Promise<MintedBrief> => {
      const { data, error } = await rpc('track_request_brief', {
        p_project_id: projectId,
        p_internal: internal,
      })
      if (error) throw error
      return data as MintedBrief
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'briefs', projectId] })
    },
  })
}

export function useArchiveBrief(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (briefId: number) => {
      const { error } = await rpc('track_archive_brief', { p_brief_id: briefId })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'briefs', projectId] })
    },
  })
}

/** One brief for the brief view — Xano's get_brief: answers keyed by question key. */
export type BriefDetail = {
  id: number
  status: string | null
  source: string | null
  created_at: string | null
  submitted_at: string | null
  answers: BriefAnswers
}

export function useBriefDetail(briefId: number | null) {
  return useQuery({
    enabled: briefId !== null,
    queryKey: ['mirror', 'brief', briefId],
    queryFn: async (): Promise<BriefDetail> => {
      const { data, error } = await mirror
        .from('briefs')
        .select(
          'id, status, source, created_at, submitted_at, name, brief_type, client_budget_note, one_sentence_brief, idea_inspo, styles_and_genres, target_audience, audience_to_feel, geography_or_time, off_limits, story_or_accents, reference_tracks, ref_comments, vocal_or_instrumental, lyrical_themes, client_deadline, anything_else',
        )
        .eq('id', briefId!)
        .single()
      if (error) throw error
      const b = data as Record<string, string | number | null>
      const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
      return {
        id: Number(b.id),
        status: b.status as string | null,
        source: b.source as string | null,
        created_at: b.created_at as string | null,
        submitted_at: b.submitted_at as string | null,
        answers: {
          name: s(b.name),
          brief_type: s(b.brief_type),
          budget_note: s(b.client_budget_note),
          one_sentence: s(b.one_sentence_brief),
          inspo: s(b.idea_inspo),
          genres: s(b.styles_and_genres),
          audience: s(b.target_audience),
          feel: s(b.audience_to_feel),
          geography: s(b.geography_or_time),
          off_limits: s(b.off_limits),
          story: s(b.story_or_accents),
          reference_tracks: s(b.reference_tracks),
          ref_comments: s(b.ref_comments),
          vocal_or_instrumental: s(b.vocal_or_instrumental),
          lyrical_themes: s(b.lyrical_themes),
          client_deadline: s(b.client_deadline),
          anything_else: s(b.anything_else),
        },
      }
    },
  })
}

export type BriefItem = { key: string; question: string; answer: string }

/**
 * `brief_view_items`: answered questions in form order, name left out (it is
 * the title), choices shown by label and dates written out.
 */
export function briefItems(answers: BriefAnswers): BriefItem[] {
  const out: BriefItem[] = []
  for (const q of BRIEF_QUESTIONS) {
    if (q.key === 'name') continue
    let val = answers[q.key]
    if (val === undefined || val === null || String(val).trim() === '') continue
    if (q.type === 'choice' && q.choices) {
      const hit = q.choices.find((c) => c.value === val)
      if (hit) val = hit.label
    }
    if (q.type === 'date') val = briefDate(val) || val
    out.push({ key: q.key, question: q.title, answer: String(val) })
  }
  return out
}

/**
 * Edit one answer on a brief that has come in — new, Andy 16 Sep: a client
 * often adds something before the brief goes out. `key` is the question key.
 * The date goes in as YYYY-MM-DD.
 */
export function useUpdateBrief(briefId: number, projectId: number | undefined) {
  const qc = useQueryClient()
  return async (key: string, value: string | null) => {
    const { error } = await rpc('track_update_brief', {
      p_brief_id: briefId,
      p_key: key,
      p_value: value,
    })
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['mirror', 'brief', briefId] })
    void qc.invalidateQueries({ queryKey: ['mirror', 'briefs', projectId] })
  }
}

/** "2026-09-20" → "20/09/2026", for the edit box. */
export function toUkDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** "20/9/2026" → "2026-09-20". Anything else goes through as typed, and the database refuses it. */
export function fromUkDate(uk: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(uk.trim())
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : uk
}
