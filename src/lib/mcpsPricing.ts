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
  /**
   * The worldwide YES/NO button, which is asked BEFORE the territory text and
   * replaces it. The old app stores "Worldwide" as the requested territory in
   * that case, not an empty string.
   */
  worldwideAnswer: boolean
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
  /** `unilever_minimum_licensing_fees`, region → currency column → minor units. */
  minimumFees: Record<string, Record<string, number>>
  /** `unilever_library_search_fees`, same shape. */
  searchFees: Record<string, Record<string, number>>
}

export type McpsContext = {
  /**
   * The CLIENT'S region, not the licence territory. A North American client
   * licensing Spain and France gets the North American minimum and the North
   * American search fee. Correct by design, reads oddly, someone will query it.
   * The region no longer decides the uplift - the currency does. See priceMcps.
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

  /** Hardcoded "Perpetuity", blanked on a searches-only quote. */
  term: string
  /** "Multiple" or "1", blanked on a searches-only quote. */
  scripts: string
  duration: string
  /** DERIVED from the rate that resolved, not from the cutdowns button. */
  cutdowns: boolean | null
  note: string

  tracks: number
  /** Per track, GBP, minor units. The Sequel fee needs this, not the multiplied figure. */
  perTrackGbp: number
  /** Per track, client currency, after FX and the currency uplift. */
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

/**
 * Sets the territory to worldwide when the classifier named nothing at all.
 *
 * Over-recovers rather than under-recovers — wrong in the safe direction. It
 * is also what a legitimate "Worldwide" answer looks like: is_worldwide true
 * and every array empty.
 */
export function normaliseTerritory(t: TerritoryStructure): TerritoryStructure {
  if (t.countries.length === 0 && t.whole_continents.length === 0) {
    return { ...t, is_worldwide: true }
  }
  return t
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
 *
 * ⚠️ The three options carry the old app's conditions exactly, including the
 * gap: buying SEVERAL whole continents and no countries is not one of them.
 * Europe + Asia on Linear TV is 825,000 as two continent licences and 877,500
 * worldwide, so the old app charges the dearer one. Recorded as a defect, not
 * corrected here — this is a port.
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
  const forcedWorldwide = isOnline && onlineWorldwide

  /**
   * ⚠️ Structural, and deliberately does NOT require a Worldwide row: the test
   * is the ABSENCE of the two narrower ones. Re-adding the phantom rate card
   * rows brings the 24 August territory bug straight back.
   */
  const worldwideOnly = cont == null && cty == null

  let price: number | null = null
  let scope = SCOPE_NONE

  if (ww != null) {
    price = ww
    scope = SCOPE_WORLDWIDE
  }

  // Narrowing is skipped entirely for forced-worldwide online and for a
  // worldwide request — there is nothing cheaper to look for.
  if (!forcedWorldwide && !t.is_worldwide) {
    // Buy the whole continent. Lawful only when everything sits in one.
    if (t.distinct_continents.length === 1 && cont != null) {
      if (price == null || cont < price) {
        price = cont
        scope = SCOPE_CONTINENT
      }
    }

    // Buy each country separately. Lawful only when no whole continent was asked for.
    if (t.whole_continents.length === 0 && t.countries.length > 0 && cty != null) {
      const opt = cty * t.countries.length
      if (price == null || opt < price) {
        price = opt
        scope = SCOPE_COUNTRY
      }
    }

    // Whole continents PLUS separately named countries.
    if (t.whole_continents.length > 0 && t.countries.length > 0 && cont != null && cty != null) {
      const opt = cont * t.whole_continents.length + cty * t.countries.length
      if (price == null || opt < price) {
        price = opt
        scope = SCOPE_CONTINENT
      }
    }
  }

  // Radio across a continent lands here: sold at Single Country only, and a
  // continent was asked for. The All Media cap becomes the price outright.
  const notSoldAtScope = price == null

  const tier =
    notSoldAtScope || scope === SCOPE_NONE
      ? ''
      : scope === SCOPE_WORLDWIDE
        ? TIER_WORLDWIDE
        : scope === SCOPE_CONTINENT
          ? TIER_CONTINENT
          : TIER_COUNTRY

  return {
    medium,
    price: price ?? 0,
    scope: notSoldAtScope ? SCOPE_NONE : scope,
    tier,
    worldwideOnly,
    forcedWorldwide,
    notSoldAtScope,
  }
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
  return TIER_WORLDWIDE
}

/** null and 0 both mean charge once. Getting this wrong silently zeroes a quote (§5.3). */
export function trackMultiplier(tracks: number | null): number {
  return tracks == null || tracks === 0 ? 1 : tracks
}

export function priceMcps(answers: McpsAnswers, ref: McpsReference, ctx: McpsContext): McpsPrice {
  const a = { ...answers, territory: normaliseTerritory(answers.territory) }
  const t = a.territory

  const rateType = rateTypeFor(a)
  const currencyKey = ctx.currency.toLowerCase()
  const fx = ref.fx[currencyKey] ?? 1
  /**
   * ⚠️ THE UPLIFT FOLLOWS THE QUOTE'S CURRENCY, NOT THE CLIENT'S REGION.
   * Andy, 25 Sep 2026. The 10% protects against the exchange rate moving
   * between quote and invoice, so every non-GBP quote carries it and no GBP
   * quote does. It used to come from `region_uplifts` by the client's region
   * (Europe 1.0, the rest 1.1), which left EUR quotes for European clients
   * unprotected - old-app quote 365 came out EUR 281.99 short - and put 10% on
   * GBP quotes for APAC and North American clients with nothing to protect.
   * Changed in the old app (api 418) the same day; the two must agree.
   */
  const uplift = ctx.currency === 'GBP' ? 1 : 1.1
  const minFee = ref.minimumFees[ctx.region]?.[currencyKey] ?? 0
  const searchRate = ref.searchFees[ctx.region]?.[currencyKey] ?? 0
  const tracks = trackMultiplier(a.tracks)
  const searchFee = searchRate * Math.max(0, a.searchesCount || 0)

  /** Answering worldwide REPLACES the typed text, it does not sit beside it. */
  const requested = a.worldwideAnswer ? 'Worldwide' : a.territoryText

  const mediaAnswered = a.searchesOnly ? [] : normaliseMedia(a.media)
  const perMedium = mediaAnswered.map((m) => priceMedium(m, ref.rateCard, rateType, t, a.onlineWorldwide))

  const mediaSum = perMedium.reduce((n, m) => n + m.price, 0)
  const notSoldAtScope = perMedium.some((m) => m.notSoldAtScope)

  const onlineSelected = mediaAnswered.some((m) => m === ONLINE_INCL_SOCIAL || m === SOCIAL_ONLY)
  const onlineForcedWorldwide = onlineSelected && a.onlineWorldwide

  const capTier = capTierFor(t, onlineForcedWorldwide)
  const capRow = ref.rateCard.find((r) => r.media === ALL_MEDIA && r.territory === capTier)
  const cap = capRow ? capRow[rateType] : null

  // ⚠️ The cap fires on a TIE — `>=`, not `>`. Not-sold-at-scope takes it outright.
  const capped = cap != null && (notSoldAtScope || mediaSum >= cap)
  const perTrackGbp = capped && cap != null ? cap : mediaSum

  /**
   * What the stored `Territory` says (§8.8). Three classes of medium are
   * excluded: online forced worldwide, worldwide-only media, and — since
   * 24 August — the cap. The cap is a pricing mechanism, not a widening of the
   * grant, so a capped quote can read All Media / Mexico: widened on media,
   * held on territory. Quote 380 is the worked example.
   */
  const rankable = perMedium.filter((m) => !m.forcedWorldwide && !m.worldwideOnly)
  const scope = rankable.reduce((n, m) => Math.max(n, m.scope), SCOPE_NONE)

  /**
   * ⚠️ ALL the distinct continents, joined — not the first one. A quote that
   * reaches rank 2 through the mixed option can legitimately span two, and
   * "Europe and North America" is what the old app writes. The literal string
   * "Single Continent" is its fallback when the classifier named none.
   */
  const continentNames = t.distinct_continents.length > 0 ? t.distinct_continents.join(' and ') : TIER_CONTINENT

  let territory = requested
  if (scope === SCOPE_WORLDWIDE) territory = 'Worldwide'
  else if (scope === SCOPE_CONTINENT) territory = continentNames

  const mediaBought = capped ? [ALL_MEDIA] : mediaAnswered

  /** The bundle really does decide whether the online lines are worldwide. */
  let onlineScope = perMedium
    .filter((m) => m.medium === ONLINE_INCL_SOCIAL || m.medium === SOCIAL_ONLY)
    .reduce((n, m) => Math.max(n, m.scope), SCOPE_NONE)
  if (capped && onlineSelected) {
    onlineScope =
      capTier === TIER_WORLDWIDE ? SCOPE_WORLDWIDE : capTier === TIER_CONTINENT ? SCOPE_CONTINENT : SCOPE_COUNTRY
  }

  /**
   * ⚠️ ROUNDING ORDER. The licence fee is the MULTIPLIED figure converted and
   * then rounded once; the per-track figure is converted and rounded on its
   * own, for the Sequel fee. Rounding per track and then multiplying gives a
   * different answer on fractional rates, and the stored quotes were written
   * the first way.
   */
  const finalGbp = perTrackGbp * tracks
  const licenceFeeLocal = Math.round(finalGbp * fx * uplift)
  const perTrackLocal = Math.round(perTrackGbp * fx * uplift)

  /**
   * ⚠️ The minimum applies to EACH TRACK, not once across the quote. Two tracks
   * means two licence fees, each floored at the regional minimum; flooring the
   * combined figure once would under-recover on multi-track quotes of small
   * tracks (§8.9).
   *
   * ⚠️ Guarded on a positive licence fee. The old app's `max:` returns the
   * LARGER of the two despite its name, so a zero licence fee came back as the
   * regional minimum — a licensing fee for a licence nobody bought (§8.12).
   *
   * ⚠️ NOT rounded, because the old app does not round it. 10% of an odd figure
   * stores fractional minor units. Recorded as a defect rather than corrected.
   */
  const sequelPerTrack = perTrackLocal > 0 ? Math.max(perTrackLocal * 0.1, minFee) : 0
  const sequelLicensingFee = sequelPerTrack * tracks

  /**
   * Cutdowns and the note are DERIVED from the rate that resolved, not from
   * the cutdowns button. Campaign and Track rates both include them.
   */
  let cutdowns: boolean | null = false
  let note = 'NA'
  if (rateType === 'campaign_rate') {
    cutdowns = true
    note = 'Includes unlimited cutdowns launched within 12 months of the first air date. '
  } else if (rateType === 'track_rate') {
    cutdowns = true
    note =
      'Includes unlimited adverts of a developing theme for a single product, under the same media and territory, launched within 12-months of the air date.'
  }

  let term = 'Perpetuity'
  let scripts = a.multipleScripts ? 'Multiple' : '1'
  let duration = a.duration
  let territoriesAsked = requested

  /**
   * A searches-only quote was never asked any of these. Blanked at the SOURCE,
   * not merely hidden on the page, so the stored row does not assert a
   * perpetual worldwide licence that nobody agreed and nobody paid for (§8.13).
   */
  if (a.searchesOnly) {
    term = ''
    scripts = ''
    duration = ''
    cutdowns = null
    territory = ''
    territoriesAsked = ''
  }

  return {
    rateType,
    perMedium,
    mediaSum,
    cap: cap ?? 0,
    capTier,
    capped,
    notSoldAtScope,
    mediaBought,
    mediaAnswered,
    territory,
    territoriesAsked,
    onlineWorldwide: onlineSelected ? onlineScope === SCOPE_WORLDWIDE : null,
    term,
    scripts,
    duration,
    cutdowns,
    note,
    tracks,
    perTrackGbp,
    perTrackLocal,
    licenceFeeLocal,
    sequelLicensingFee,
    searchFee,
    grandTotal: licenceFeeLocal + sequelLicensingFee + searchFee,
  }
}
