import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { supabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Raising a quote — the six non-MCPS paths of the old app's wizard.
 *
 * ⚠️ `quotes` and `quote_line_items` are still in the hourly sync, and they are
 * on the BLOCKED side of it: QuickBooks, BoldSign and Coda read them out of
 * Xano, so those tables cannot leave the sync yet and a quote raised here is
 * DELETED on the hour. That is expected — nothing moves across one table at a
 * time (known-issues §1.5), so this is built and tested against the mirror with
 * throwaway data and cut over once, at the end.
 *
 * ⚠️ THE MCPS PATH IS NOT HERE. "Library (MCPS)" prices itself: a rate card, a
 * cheapest-lawful-combination search, an All Media cap, FX, a currency uplift,
 * per-track minimum fees, and a Gemini call that reads the territory text. All
 * of that lives in Xano api 418 and has to be ported before the button can do
 * anything. The other six paths price nothing — they add up what someone typed,
 * which is what api 420 does.
 *
 * ⚠️ ONE WRITE PATH, and `authenticated` has no insert grant on either table.
 * Everything goes through `public.track_create_quote`, which is faithful to
 * api 420: Status "Draft", six categories multiplied by the track count and
 * searches NOT, costs ×100, a supplier line kept when its cost is above zero OR
 * it has a description, and the grand total written once at the end. Letting a
 * form assemble seven categories of money across two tables is how the old
 * app's create form drifted from its own stored total four separate times.
 */

/** One typed supplier line on a fee screen. */
export type FeeLine = { description: string; cost: string }

/** One fee screen: any number of supplier lines, and one Sequel fee. */
export type FeeCategory = {
  lines: FeeLine[]
  sequel: string
  /** Searches only — how many searches the fee covers. */
  searchQuantity?: string
}

export const FEE_KEYS = [
  'searches',
  'production',
  'master',
  'publishing',
  'sonic_branding',
  'talent',
  'other',
] as const

export type FeeKey = (typeof FEE_KEYS)[number]

/**
 * The seven fee screens, in the order the old app asks them.
 *
 * ⚠️ `sequelLabel` is the name of the Sequel fee box, and it is NOT what the
 * old app shows. There, Master, Publishing, Sonic Branding and Talent are all
 * labelled "Sequel Licensing Fee" and Other Fees is labelled "Sequel
 * Consultancy" — four identical boxes and one that matches nothing — while the
 * line each writes is stored under a different name again. These are the stored
 * names, so what staff type into and what the client's document says are the
 * same words.
 */
export const FEE_SCREENS: {
  key: FeeKey
  heading: string
  sequelLabel: string
  /** Multiplied by the track count. Searches are not. */
  multiply: boolean
}[] = [
  { key: 'production', heading: 'Production', sequelLabel: 'Sequel Production Fee', multiply: true },
  { key: 'master', heading: 'Master (Library or Sound Design)', sequelLabel: 'Sequel Master Fee', multiply: true },
  { key: 'publishing', heading: 'Publishing', sequelLabel: 'Sequel Publishing Fee', multiply: true },
  { key: 'sonic_branding', heading: 'Sonic Branding', sequelLabel: 'Sequel Sonic Branding Fee', multiply: true },
  { key: 'talent', heading: 'Talent', sequelLabel: 'Sequel Talent Fee', multiply: true },
  { key: 'other', heading: 'Other Fees', sequelLabel: 'Sequel Other Fee', multiply: true },
  { key: 'searches', heading: 'Search Fees', sequelLabel: 'Sequel Search Fees', multiply: false },
]

/** The six services this wizard can raise. Ids are Xano's Services table. */
export const QUOTE_TYPES: { id: number; label: string }[] = [
  { id: 1, label: 'Composition' },
  { id: 2, label: 'Commercial' },
  { id: 4, label: 'Sonic Branding' },
  { id: 5, label: 'Sound Design' },
  { id: 6, label: 'Talent' },
  { id: 3, label: 'Library (Manual)' },
]

/** ⚠️ Library (MCPS) is service 3 too — the same service, priced by the engine. */
export const MCPS_SERVICE_ID = 3

export type NewQuoteInput = {
  projectId: number
  clientId: number
  currencyId: number
  serviceId: number
  description: string
  term: string
  territory: string
  media: string
  scripts: string
  duration: string
  cutdowns: boolean | null
  songName: string
  artistName: string
  tracksQuoted: number | null
  fees: Record<FeeKey, FeeCategory>
}

/**
 * A typed amount, shown with thousands separators.
 *
 * ⚠️ Applied on BLUR, not on every keystroke. Reformatting as someone types
 * moves the caret — you type 2500, the field becomes 2,500 and the cursor
 * jumps to the front. The raw text is what state holds; this is only what the
 * field shows when it is not being typed in.
 */
export function formatAmount(raw: string): string {
  const cleaned = raw.replace(/[\s,£$€¥]/g, '')
  if (cleaned === '') return ''
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return raw
  const [whole, fraction] = cleaned.split('.')
  const grouped = Number(whole || 0).toLocaleString('en-GB')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** A typed amount → a number the database can take. Blank is zero. */
export function toAmount(raw: string): number {
  const cleaned = raw.replace(/[\s,£$€¥]/g, '')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * The running total, in major units.
 *
 * ⚠️ Mirrors `track_create_quote` exactly, and the two must change together.
 * The old app has the same duplication — a footer total and a summary total,
 * both reimplementing the endpoint — and it is how a quote once showed 0.00
 * under populated rows for weeks.
 *
 * Track count multiplies every category EXCEPT searches. A count of null
 * (never asked) or 0 (covers no tracks) still charges the fees once.
 */
export function quoteTotal(fees: Record<FeeKey, FeeCategory>, tracks: number | null): number {
  const multiplier = tracks && tracks > 0 ? tracks : 1
  let total = 0
  for (const screen of FEE_SCREENS) {
    const cat = fees[screen.key]
    if (!cat) continue
    let sum = toAmount(cat.sequel)
    for (const line of cat.lines) sum += toAmount(line.cost)
    total += screen.multiply ? sum * multiplier : sum
  }
  return total
}

export function emptyFees(): Record<FeeKey, FeeCategory> {
  return FEE_KEYS.reduce(
    (acc, key) => {
      acc[key] = { lines: [{ description: '', cost: '' }], sequel: '', searchQuantity: '' }
      return acc
    },
    {} as Record<FeeKey, FeeCategory>,
  )
}

function payload(fees: Record<FeeKey, FeeCategory>) {
  const out: Record<string, unknown> = {}
  const feeKeyFor: Record<FeeKey, string> = {
    searches: 'sequel_search_cost',
    production: 'sequel_production_cost',
    master: 'sequel_master_cost',
    publishing: 'sequel_publishing_cost',
    sonic_branding: 'sequel_sonic_branding_cost',
    talent: 'sequel_talent_cost',
    other: 'sequel_other_cost',
  }
  for (const key of FEE_KEYS) {
    const cat = fees[key]
    if (!cat) continue
    const body: Record<string, unknown> = {
      [feeKeyFor[key]]: toAmount(cat.sequel),
      lines: cat.lines
        .filter((l) => l.description.trim() !== '' || toAmount(l.cost) > 0)
        .map((l) => ({ description: l.description.trim(), cost: toAmount(l.cost) })),
    }
    if (key === 'searches') {
      const q = Number(cat.searchQuantity ?? '')
      body.sequel_search_quantity = Number.isFinite(q) && q > 0 ? Math.trunc(q) : 1
    }
    out[key] = body
  }
  return out
}

export function useCreateQuote(projectId: number | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewQuoteInput): Promise<{ id: number; uuid: string }> => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_create_quote',
        {
          p_project_id: input.projectId,
          p_client_id: input.clientId,
          p_currency_id: input.currencyId,
          p_service_id: input.serviceId,
          p_description: input.description,
          p_term: input.term || null,
          p_territory: input.territory || null,
          p_media: input.media || null,
          p_scripts: input.scripts || null,
          p_duration: input.duration || null,
          p_cutdowns: input.cutdowns,
          p_song_name: input.songName || null,
          p_artist_name: input.artistName || null,
          p_tracks_quoted: input.tracksQuoted,
          p_fees: payload(input.fees),
        },
      )
      if (error) throw new Error(error.message)
      const row = (Array.isArray(data) ? data[0] : data) as { id: number; uuid: string } | null
      if (!row?.uuid) throw new Error('The quote was created but has no link. Tell Andy.')
      return row
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'quotes', projectId] })
    },
  })
}

export type Option = { id: number; label: string }

function byLabel(a: Option, b: Option) {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

/** The two pickers the wizard needs. Both effectively never change. */
export function useQuoteLookups() {
  return useQuery({
    queryKey: ['mirror', 'quote-lookups'],
    staleTime: Infinity,
    queryFn: async () => {
      const [clients, currencies] = await Promise.all([
        mirror.from('clients').select('id, company, status'),
        mirror.from('currencies_bank_accounts').select('id, currency'),
      ])
      const failed = [clients, currencies].find((r) => r.error)
      if (failed?.error) throw failed.error

      const rows = <T,>(r: { data: unknown }) => (r.data ?? []) as T[]

      return {
        clients: rows<{ id: number; company: string | null; status: string | null }>(clients)
          .filter((c) => c.status !== 'Archived')
          .map((c) => ({ id: c.id, label: c.company ?? '' }))
          .sort(byLabel),
        // ⚠️ Kept in table order, not alphabetical — and shown as the CODE.
        // The symbol is "$" for both USD and SGD, which is no use on a document
        // about money.
        currencies: rows<{ id: number; currency: string | null }>(currencies)
          .sort((a, b) => a.id - b.id)
          .map((c) => ({ id: c.id, label: c.currency ?? '' })),
      }
    },
  })
}

/**
 * Archives a quote: status Archived, never a hard delete. Any Sequel staff
 * member can, as in the old app's archive_quote.
 */
export function useArchiveQuote(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (quoteId: number) => {
      const { error } = await (supabase as unknown as SupabaseClient).rpc('track_archive_quote', {
        p_quote_id: quoteId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'quotes', projectId] })
    },
  })
}
