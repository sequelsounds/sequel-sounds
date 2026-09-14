/**
 * The MCPS pricing engine — the old app's api 418, as arithmetic.
 *
 * This is the piece "Library (MCPS)" needs and the other six quote paths do
 * not. They add up what someone typed; this one decides the price itself from
 * a rate card, so it is the only path where the engine is the product.
 *
 * NOTHING HERE TOUCHES THE DATABASE OR THE NETWORK. Every input arrives as an
 * argument and every output is returned. That is deliberate: the old engine
 * could only be tested by raising a real quote against live Xano and reading
 * the row back, which is how three compounding pricing bugs survived in it
 * until 20 August. This one can be replayed against the quotes already stored
 * — see `verifyMcpsPricing.ts`.
 *
 * MONEY IS IN MINOR UNITS throughout, as the rate card stores it. 656300 is
 * £6,563.00. Round once, at the display layer, never in here.
 *
 * Read `sequel-track-quote-wizard_2.md` §8 before changing anything. The
 * numbered comments below point at the section each rule comes from, because
 * several of them look like bugs and are not.
 */

/**
 * Which column of the rate card is read. The enum value IS the column key —
 * the old app indexes the row with it directly, and so does this. Renaming
 * these for display would return nothing for every lookup; strip formatting at
 * the display layer instead.
 */
export type RateType = 'per_30s' | 'track_rate' | 'campaign_rate'

export type RateCardRow = {
  id: number
  media: string
  territory: string
  per_30s: number
  track_rate: number
  campaign_rate: number
}

/**
 * What the classifier returns. It describes the SHAPE of the territory and
 * prices nothing — an earlier version asked the model to pick a price tier and
 * it charged £4,688 against a real MCPS cost of £13,575 (§8.1).
 */
export type TerritoryStructure = {
  is_worldwide: boolean
  whole_continents: string[]
  countries: string[]
  distinct_continents: string[]
}

export type McpsAnswers = {
  /** The media buttons, as answered. */
  media: string[]
  /** The territory text as typed, kept for the stored row. */
  territoryText: string
  /** The classifier's reading of that text. */
  territory: TerritoryStructure
  multipleScripts: boolean
  /** The duration button's label. "Longer than 30 seconds" is the one that matters. */
  duration: string
  cutdowns: boolean
  /** Defaults TRUE. Online usage is worldwide in the large majority of cases (§8.7). */
  onlineWorldwide: boolean
  /** null = never asked, 0 = covers no tracks. BOTH mean charge once (§8.5). */
  tracks: number | null
  searchesCount: number
  searchesOnly: boolean
}

export type McpsReference = {
  rateCard: RateCardRow[]
  /** GBP row of `fx_rates`, keyed by lowercase currency column: gbp, usd, euro, sgd, jpy. */
  fx: Record<string, number>
  /** `region_uplifts`, region → multiplier. */
  uplifts: Record<string, number>
  /** `unilever_minimum_licensing_fees`, region → currency column → minor units. */
  minimumFees: Record<string, Record<string, number>>
  /** `unilever_library_search_fees`, same shape. */
  searchFees: Record<string, Record<string, number>>
}

export type McpsContext = {
  /**
   * The CLIENT'S region, not the licence territory. A North American client
   * licensing Spain and France gets the North American uplift and the North
   * American search fee. Correct by design, reads oddly, someone will query it.
   */
  region: string
  /**
   * As stored in table 48 — "EURO", not the ISO "EUR". Lowercased, it is the
   * column name in all three per-currency tables.
   */
  currency: string
}

export const ALL_MEDIA = 'All Media'

/** The two media the online override applies to (§8.7). */
export const ONLINE_INCL_SOCIAL = 'Online incl. Social (Excluding VOD)'
export const SOCIAL_ONLY = 'Social Media (Only)'

const TIER_WORLDWIDE = 'Worldwide'
const TIER_CONTINENT = 'Single Continent'
const TIER_COUNTRY = 'Single Country'

/**
 * How broad a licence a medium ended up bought at. The maximum across media
 * decides what the stored `Territory` says (§8.8).
 */
export const SCOPE_NONE = 0
export const SCOPE_COUNTRY = 1
export const SCOPE_CONTINENT = 2
export const SCOPE_WORLDWIDE = 3

export type MediumPrice = {
  medium: string
  /** Minor units, per track, before the cap. */
  price: number
  scope: number
  tier: string
  /** MCPS sells this medium at Worldwide only — no continent row, no country row. */
  worldwideOnly: boolean
  /** The online override put this on the worldwide rate regardless of territory. */
  forcedWorldwide: boolean
  /** No lawful way to buy this medium at this scope — Radio across a continent (§8.6). */
  notSoldAtScope: boolean
}

export type McpsPrice = {
  rateType: RateType
  /** Per medium, before the cap — the workings, for the staff-facing breakdown. */
  perMedium: MediumPrice[]
  /** Sum of the per-medium winners, per track, minor units. */
  mediaSum: number
  /** All Media at the broadest lawful tier, per track, minor units. */
  cap: number
  capTier: string
  /** The cap came in under the sum, or a medium was not sold at scope. */
  capped: boolean
  notSoldAtScope: boolean

  /** What the client is buying. Collapses to ["All Media"] when the cap fires (§8.4). */
  mediaBought: string[]
  /** What was asked for, after the Social-dropped-into-Online rule. */
  mediaAnswered: string[]

  /** What was BOUGHT — continent name, "Worldwide", or the territories as typed (§8.8). */
  territory: string
  /** What was ASKED FOR, as typed. */
  territoriesAsked: string
  /** null when no online medium was selected. */
  onlineWorldwide: boolean | null

  tracks: number
  /** Per track, GBP, minor units. The Sequel fee needs this, not the multiplied figure. */
  perTrackGbp: number
  /** Per track, client currency, after FX and the regional uplift. */
  perTrackLocal: number
  /** perTrackLocal × tracks. */
  licenceFeeLocal: number
  /** 10% of perTrackLocal, floored at the regional minimum, × tracks. */
  sequelLicensingFee: number
  searchFee: number
  grandTotal: number
}

/**
 * Which rate column applies (§8.3).
 *
 * Order matters: multiple scripts wins over everything, then Track_Rate is
 * reached by EITHER a long duration OR cutdowns.
 */
export function rateTypeFor(a: Pick<McpsAnswers, 'multipleScripts' | 'duration' | 'cutdowns'>): RateType {
  if (a.multipleScripts) return 'campaign_rate'
  if (a.duration === 'Longer than 30 seconds' || a.cutdowns) return 'track_rate'
  return 'per_30s'
}

/**
 * The media list as the engine sees it.
 *
 * Empty strings are dropped by rebuilding the list, not by filtering it. The
 * old app's parse turned an empty answer into an array holding one empty
 * string, which matched no rate card row, set not-sold-at-scope, and priced a
 * searches-only quote at the dearest cell on the card — £10,375 instead of
 * £750 (§8.12).
 *
 * Social Media (Only) is dropped when Online incl. Social is also selected:
 * the latter already covers it. This is why the answer and what was bought can
 * differ on the same quote.
 */
export function normaliseMedia(media: string[]): string[] {
  const out: string[] = []
  for (const m of media) {
    const name = (m ?? '').trim()
    if (!name) continue
    if (!out.includes(name)) out.push(name)
  }
  if (out.includes(ONLINE_INCL_SOCIAL)) {
    return out.filter((m) => m !== SOCIAL_ONLY)
  }
  return out
}

function tiersFor(rateCard: RateCardRow[], medium: string, rateType: RateType) {
  const rows = rateCard.filter((r) => r.media === medium)
  const at = (tier: string) => {
    const row = rows.find((r) => r.territory === tier)
    return row ? row[rateType] : null
  }
  return { ww: at(TIER_WORLDWIDE), cont: at(TIER_CONTINENT), cty: at(TIER_COUNTRY) }
}

/** Everything asked for sits inside a single continent, so one continent licence covers it. */
function withinOneContinent(t: TerritoryStructure): boolean {
  return t.whole_continents.length <= 1 && t.distinct_continents.length === 1
}

/**
 * The cheapest lawful way to buy one medium across the requested territory.
 *
 * ⚠️ The search SEEDS from the Worldwide row and replaces it only on a STRICT
 * `<`, so a tie keeps the broader tier. That is not an oversight to tidy up:
 * eight phantom rate-card rows priced Cinema / DVD and Public Location at the
 * same figure across every tier, the strict comparison never displaced
 * worldwide, and one tied medium dragged a Mexico campaign's stated territory
 * to Worldwide (§8.14). The rows were deleted and those media are now detected
 * structurally instead. Changing this to `<=` would record Public Location as
 * Single Country, which is wrong the other way — MCPS only sells it worldwide.
 */
export function priceMedium(
  medium: string,
  rateCard: RateCardRow[],
  rateType: RateType,
  t: TerritoryStructure,
  onlineWorldwide: boolean,
): MediumPrice {
  const { ww, cont, cty } = tiersFor(rateCard, medium, rateType)

  const isOnline = medium === ONLINE_INCL_SOCIAL || medium === SOCIAL_ONLY
  const worldwideOnly = ww != null && cont == null && cty == null

  const base = { medium, worldwideOnly, forcedWorldwide: false, notSoldAtScope: false }

  // The online override, before anything else is considered (§8.7).
  if (isOnline && onlineWorldwide && ww != null) {
    return { ...base, price: ww, scope: SCOPE_WORLDWIDE, tier: TIER_WORLDWIDE, forcedWorldwide: true }
  }

  // Sold at one tier only — there is nothing to search.
  if (worldwideOnly) {
    return { ...base, price: ww, scope: SCOPE_WORLDWIDE, tier: TIER_WORLDWIDE }
  }

  if (t.is_worldwide) {
    if (ww == null) return { ...base, price: 0, scope: SCOPE_NONE, tier: '', notSoldAtScope: true }
    return { ...base, price: ww, scope: SCOPE_WORLDWIDE, tier: TIER_WORLDWIDE }
  }

  let best: { price: number; scope: number; tier: string } | null =
    ww == null ? null : { price: ww, scope: SCOPE_WORLDWIDE, tier: TIER_WORLDWIDE }

  // One continent licence, when everything sits inside one continent.
  if (cont != null && withinOneContinent(t)) {
    if (best == null || cont < best.price) {
      best = { price: cont, scope: SCOPE_CONTINENT, tier: TIER_CONTINENT }
    }
  }

  // Continents and countries bought individually. With no whole continent
  // requested this is simply the country rate times the count.
  const nCont = t.whole_continents.length
  const nCty = t.countries.length
  const haveRows = (nCont === 0 || cont != null) && (nCty === 0 || cty != null)
  if (haveRows && nCont + nCty > 0) {
    const combo = (cont ?? 0) * nCont + (cty ?? 0) * nCty
    if (best == null || combo < best.price) {
      best = {
        price: combo,
        scope: nCont > 0 ? SCOPE_CONTINENT : SCOPE_COUNTRY,
        tier: nCont > 0 ? TIER_CONTINENT : TIER_COUNTRY,
      }
    }
  }

  // Radio across a continent lands here: sold at Single Country only, and a
  // continent was asked for. The All Media cap becomes the price outright.
  if (best == null) {
    return { ...base, price: 0, scope: SCOPE_NONE, tier: '', notSoldAtScope: true }
  }

  return { ...base, ...best }
}

/**
 * The broadest tier the All Media bundle has to cover, in this order (§8.4).
 *
 * ⚠️ The first line is load-bearing. If online is bought worldwide, All Media
 * Single Continent is not a lawful substitute — it does not include worldwide
 * online. Without it, quotes capped against a bundle that did not cover what
 * was being licensed; it under-charged quote 347 by about £9,100.
 */
export function capTierFor(t: TerritoryStructure, onlineForcedWorldwide: boolean): string {
  if (onlineForcedWorldwide) return TIER_WORLDWIDE
  if (t.is_worldwide) return TIER_WORLDWIDE
  if (t.distinct_continents.length > 1) return TIER_WORLDWIDE
  if (t.whole_continents.length > 0) return TIER_CONTINENT
  if (t.countries.length > 1) return TIER_CONTINENT
  if (t.countries.length === 1) return TIER_COUNTRY
  // Nothing territory-driven at all. Over-recovers rather than under-recovers.
  return TIER_WORLDWIDE
}

/** null and 0 both mean charge once. Getting this wrong silently zeroes a quote (§5.3). */
export function trackMultiplier(tracks: number | null): number {
  return tracks == null || tracks === 0 ? 1 : tracks
}

export function priceMcps(a: McpsAnswers, ref: McpsReference, ctx: McpsContext): McpsPrice {
  const rateType = rateTypeFor(a)
  const currencyKey = ctx.currency.toLowerCase()
  const fx = ref.fx[currencyKey] ?? 1
  const uplift = ref.uplifts[ctx.region] ?? 1
  const minFee = ref.minimumFees[ctx.region]?.[currencyKey] ?? 0
  const searchRate = ref.searchFees[ctx.region]?.[currencyKey] ?? 0
  const tracks = trackMultiplier(a.tracks)
  const searchFee = searchRate * Math.max(0, a.searchesCount || 0)

  const mediaAnswered = a.searchesOnly ? [] : normaliseMedia(a.media)

  const perMedium = mediaAnswered.map((m) =>
    priceMedium(m, ref.rateCard, rateType, a.territory, a.onlineWorldwide),
  )

  const mediaSum = perMedium.reduce((n, m) => n + m.price, 0)
  const notSoldAtScope = perMedium.some((m) => m.notSoldAtScope)

  const onlineSelected = mediaAnswered.some((m) => m === ONLINE_INCL_SOCIAL || m === SOCIAL_ONLY)
  const onlineForcedWorldwide = onlineSelected && a.onlineWorldwide

  const capTier = capTierFor(a.territory, onlineForcedWorldwide)
  const capRow = ref.rateCard.find((r) => r.media === ALL_MEDIA && r.territory === capTier)
  const cap = capRow ? capRow[rateType] : 0

  // ⚠️ The cap fires on a TIE — `>=`, not `>`.
  const capped = mediaAnswered.length > 0 && (notSoldAtScope || mediaSum >= cap)
  const perTrackGbp = mediaAnswered.length === 0 ? 0 : capped ? cap : mediaSum

  /**
   * What the stored `Territory` says (§8.8). Three classes of medium are
   * excluded: online forced worldwide, worldwide-only media, and — since
   * 24 August — the cap. The cap is a pricing mechanism, not a widening of the
   * grant, so a capped quote can read All Media / Mexico: widened on media,
   * held on territory. Quote 380 is the worked example.
   */
  const rankable = perMedium.filter((m) => !m.forcedWorldwide && !m.worldwideOnly && !m.notSoldAtScope)
  const scope = rankable.reduce((n, m) => Math.max(n, m.scope), SCOPE_NONE)
  const continentName = a.territory.whole_continents[0] ?? a.territory.distinct_continents[0] ?? ''

  let territory = ''
  if (!a.searchesOnly) {
    if (scope === SCOPE_WORLDWIDE) territory = 'Worldwide'
    else if (scope === SCOPE_CONTINENT && continentName) territory = continentName
    // Rank 1 and rank 0 both fall through to what was typed. Rank 0 means every
    // medium was online-forced or worldwide-only; "Worldwide" would overstate it.
    else territory = a.territoryText
  }

  const mediaBought = capped || notSoldAtScope ? [ALL_MEDIA] : mediaAnswered

  /** The bundle really does decide whether the online lines are worldwide. */
  const onlineLinesWorldwide = capped
    ? capTier === TIER_WORLDWIDE
    : perMedium.some(
        (m) =>
          (m.medium === ONLINE_INCL_SOCIAL || m.medium === SOCIAL_ONLY) && m.tier === TIER_WORLDWIDE,
      )

  // Rounded to whole minor units BEFORE the 10% is taken, because the Sequel
  // fee is a percentage of the rounded figure, not of the raw product.
  const perTrackLocal = Math.round(perTrackGbp * fx * uplift)
  const licenceFeeLocal = perTrackLocal * tracks

  /**
   * ⚠️ The minimum applies to EACH TRACK, not once across the quote. Two tracks
   * means two licence fees, each floored at the regional minimum; flooring the
   * combined figure once would under-recover on multi-track quotes of small
   * tracks (§8.9).
   *
   * ⚠️ Guarded on a positive licence fee. The old app's `max:` returns the
   * LARGER of the two despite its name, so a zero licence fee came back as the
   * regional minimum — a licensing fee for a licence nobody bought (§8.12).
   */
  const sequelPerTrack = perTrackLocal > 0 ? Math.max(Math.round(perTrackLocal * 0.1), minFee) : 0
  const sequelLicensingFee = sequelPerTrack * tracks

  return {
    rateType,
    perMedium,
    mediaSum,
    cap,
    capTier,
    capped,
    notSoldAtScope,
    mediaBought,
    mediaAnswered,
    territory,
    territoriesAsked: a.territoryText,
    onlineWorldwide: onlineSelected ? onlineLinesWorldwide : null,
    tracks,
    perTrackGbp,
    perTrackLocal,
    licenceFeeLocal,
    sequelLicensingFee,
    searchFee,
    grandTotal: licenceFeeLocal + sequelLicensingFee + searchFee,
  }
}
