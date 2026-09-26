import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { supabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { priceMcps, type McpsAnswers, type McpsPrice, type McpsReference, type RateCardRow, type TerritoryStructure } from './mcpsPricing'

/**
 * Everything the MCPS quote path needs that is not the arithmetic itself.
 *
 * The arithmetic lives in `mcpsPricing.ts`, deliberately with no database and
 * no network in it so it can be replayed against stored quotes. This file is
 * the other half: the rate card and the three per-region tables, the client's
 * region, the classifier call, and the write.
 *
 * ⚠️ THE CLIENT'S REGION, NOT THE LICENCE TERRITORY. A North American client
 * licensing Spain and France gets the North American minimum and the North
 * American search fee. Correct by design, reads oddly, and someone will query
 * it. The uplift is NOT regional any more - it follows the quote's currency
 * (25 Sep 2026, see priceMcps), so `region_uplifts` is no longer read.
 */

/** The eight media buttons.
 *
 * ⚠️ `label` is what the old app shows and `value` is what it sends, and they
 * are NOT the same — the screen says VOD and CINEMA DVD while the values are
 * "Video On Demand" and "Cinema / DVD". The value has to be the rate card's
 * media name exactly, because that is what the engine looks rows up by. Read
 * off the eight Wized click handlers on 14 September, not off the buttons.
 */
export const MEDIA_BUTTONS: { label: string; value: string }[] = [
  { label: 'ALL MEDIA', value: 'All Media' },
  { label: 'LINEAR TV (EXC VOD)', value: 'Linear TV (Excluding VOD)' },
  { label: 'VOD', value: 'Video On Demand' },
  // ⚠️ The newline is deliberate: unbroken, this label wraps mid-bracket and
  // reads "(EXC" then "VOD)". `.qw-media .qw-choice` sets white-space: pre-line
  // so it renders, and every media button carries the two-line height whether
  // it uses it or not — otherwise the middle row of the grid stands taller
  // than the two either side.
  { label: 'ONLINE INCL. SOCIAL\n(EXC VOD)', value: 'Online incl. Social (Excluding VOD)' },
  { label: 'SOCIAL MEDIA (ONLY)', value: 'Social Media (Only)' },
  { label: 'RADIO', value: 'Radio' },
  { label: 'PUBLIC LOCATION', value: 'Public Location' },
  { label: 'CINEMA DVD', value: 'Cinema / DVD' },
]

export const DURATION_LONGER = 'Longer than 30 seconds'
export const DURATION_SHORTER = '30 seconds or less'

/** The old app's dropdown runs 0 to 10. */
export const SEARCH_COUNTS = Array.from({ length: 11 }, (_, i) => i)

type PerRegion = Record<string, Record<string, number>>

/**
 * The rate card, the FX row and the two per-region tables.
 *
 * All four are reference data that changes perhaps once a year, so they are
 * fetched once and held. They are also all on the SAFE side of the sync —
 * nothing here is written, only read.
 */
export function useMcpsReference() {
  return useQuery({
    queryKey: ['mirror', 'mcps-reference'],
    staleTime: Infinity,
    queryFn: async (): Promise<McpsReference> => {
      const [rates, fx, minimums, searches] = await Promise.all([
        mirror.from('mcps_rate_card').select('id, media, territory, per_30s, track_rate, campaign_rate'),
        mirror.from('fx_rates').select('*').eq('base_currency', 'GBP').limit(1),
        mirror.from('unilever_minimum_licensing_fees').select('*'),
        mirror.from('unilever_library_search_fees').select('*'),
      ])
      const failed = [rates, fx, minimums, searches].find((r) => r.error)
      if (failed?.error) throw failed.error

      const rows = <T,>(r: { data: unknown }) => (r.data ?? []) as T[]

      /**
       * ⚠️ The currency column names are lower-cased Xano ones: gbp, usd, euro,
       * sgd, jpy. Note EURO, not the ISO EUR — table 48 stores it that way and
       * the lookup is `currency.toLowerCase()`, so renaming either end breaks
       * every price silently rather than loudly.
       */
      const perRegion = (list: Record<string, unknown>[]): PerRegion => {
        const out: PerRegion = {}
        for (const row of list) {
          const region = String(row.region ?? '')
          if (!region) continue
          const cols: Record<string, number> = {}
          for (const [k, val] of Object.entries(row)) {
            if (k === 'region' || k === 'id' || k === 'created_at') continue
            const n = Number(val)
            if (Number.isFinite(n)) cols[k] = n
          }
          out[region] = cols
        }
        return out
      }

      const fxRow = (rows<Record<string, unknown>>(fx)[0] ?? {}) as Record<string, unknown>
      const fxRates: Record<string, number> = {}
      for (const [k, val] of Object.entries(fxRow)) {
        if (k === 'id' || k === 'created_at' || k === 'base_currency') continue
        const n = Number(val)
        if (Number.isFinite(n)) fxRates[k] = n
      }

      return {
        rateCard: rows<RateCardRow>(rates),
        fx: fxRates,
        minimumFees: perRegion(rows<Record<string, unknown>>(minimums)),
        searchFees: perRegion(rows<Record<string, unknown>>(searches)),
      }
    },
  })
}

/** The client's region name, which drives the minimum and the search fee. */
export function useClientRegion(clientId: number | null) {
  return useQuery({
    enabled: clientId !== null,
    queryKey: ['mirror', 'client-region', clientId],
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await mirror.from('clients').select('region').eq('id', clientId!).limit(1)
      if (error) throw error
      const regionId = (data?.[0] as { region: number | null } | undefined)?.region
      if (!regionId) return null
      const lookup = await mirror.from('regions').select('region').eq('id', regionId).limit(1)
      if (lookup.error) throw lookup.error
      return (lookup.data?.[0] as { region: string | null } | undefined)?.region ?? null
    },
  })
}

export type ClassifyResult =
  | { ok: true; territory: TerritoryStructure }
  | { ok: false; error: string }

/**
 * Asks the edge function to read the typed territory.
 *
 * ⚠️ It REFUSES rather than guessing, and the wizard must respect that. The old
 * app falls back to Worldwide — the dearest cell on the card — both when the
 * model is unreachable and when it cannot read the text, in both cases
 * silently. Andy's call on 14 September was to stop instead. Do not add a
 * fallback here: the whole point is that no client is sent a guessed price.
 */
export async function classifyTerritory(text: string): Promise<ClassifyResult> {
  const { data, error } = await (supabase as unknown as SupabaseClient).functions.invoke(
    'classify-territory',
    { body: { text } },
  )

  // A non-2xx comes back as an error with the body on `context`. The body is
  // where our own message lives, so dig it out rather than showing "Edge
  // Function returned a non-2xx status code", which tells nobody anything.
  if (error) {
    let message = 'The territory could not be read. Try again in a moment.'
    const res = (error as { context?: Response }).context
    if (res && typeof res.json === 'function') {
      try {
        const body = (await res.json()) as { error?: string }
        if (body?.error) message = body.error
      } catch {
        /* keep the default */
      }
    }
    return { ok: false, error: message }
  }

  const body = data as { ok?: boolean; error?: string; territory?: TerritoryStructure } | null
  if (!body?.ok || !body.territory) {
    return { ok: false, error: body?.error ?? 'The territory could not be read.' }
  }
  return { ok: true, territory: body.territory }
}

export type McpsQuoteInput = {
  projectId: number
  clientId: number
  currencyId: number
  description: string
  songName: string
  artistName: string
  answers: McpsAnswers
  price: McpsPrice
}

/**
 * Prices a quote without writing it — what the summary screen shows.
 *
 * Returns null while the reference data or the region is still loading, so the
 * caller can tell "not yet" from "nothing to charge".
 */
export function quoteEstimate(
  answers: McpsAnswers,
  reference: McpsReference | undefined,
  region: string | null | undefined,
  currency: string | undefined,
): McpsPrice | null {
  if (!reference || !region || !currency) return null
  return priceMcps(answers, reference, { region, currency })
}

/**
 * ⚠️ ONE WRITE PATH, as with the six other quote paths. `authenticated` has no
 * insert grant on `quotes` or `quote_line_items`; everything goes through a
 * SECURITY DEFINER function so a form cannot assemble money across two tables.
 *
 * The prices are computed in the browser and sent, which is the one place this
 * differs from api 418 — Xano prices server-side. That is a deliberate trade
 * for now: the engine is pure TypeScript so it can be tested, and the same
 * module can move behind an edge function later without changing its shape. It
 * matters before cutover, not before then, because a quote raised here is
 * deleted on the hour anyway.
 *
 * ⚠️ `quotes` is on the BLOCKED side of the sync. A quote raised here is GONE
 * on the hour until cutover. Expected, not a bug.
 */
export function useCreateMcpsQuote(projectId: number | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: McpsQuoteInput): Promise<{ id: number; uuid: string }> => {
      const p = input.price
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc('track_create_mcps_quote', {
        p_project_id: input.projectId,
        p_client_id: input.clientId,
        p_currency_id: input.currencyId,
        p_description: input.description,
        p_song_name: input.songName || null,
        p_artist_name: input.artistName || null,
        p_tracks_quoted: input.answers.tracks,
        p_term: p.term || null,
        p_territory: p.territory || null,
        p_mcps_territories: p.territoriesAsked || null,
        p_scripts: p.scripts || null,
        p_duration: p.duration || null,
        p_cutdowns: p.cutdowns,
        p_note: p.note,
        p_track_rate: rateEnum(p.rateType),
        p_media: p.mediaBought,
        p_media_mcps: input.answers.media,
        p_online_worldwide: p.onlineWorldwide,
        p_region: null, // resolved server-side from the client, as Xano does
        p_mcps_fee_gbp: p.perTrackGbp * p.tracks,
        p_mcps_local_fee: p.licenceFeeLocal,
        p_sequel_licensing_fee: p.sequelLicensingFee,
        p_search_fee: p.searchFee,
        p_searches_requested: input.answers.searchesCount,
        p_grand_total: p.grandTotal,
      })
      if (error) throw new Error(error.message)
      const row = (Array.isArray(data) ? data[0] : data) as { id: number; uuid: string } | null
      if (!row?.uuid) throw new Error('The estimate was created but has no link. Tell Andy.')
      return row
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'quotes', projectId] })
    },
  })
}

/**
 * ⚠️ `MCPS_track_rate` is an ENUM whose values double as rate card column keys —
 * Per_30s, Track_Rate, Campaign_Rate. The engine uses the lower-cased Postgres
 * column names, so they are mapped back here. Renaming either side for display
 * would return nothing for every price lookup; strip formatting at the display
 * layer instead.
 */
function rateEnum(rate: McpsPrice['rateType']): string {
  if (rate === 'campaign_rate') return 'Campaign_Rate'
  if (rate === 'track_rate') return 'Track_Rate'
  return 'Per_30s'
}
