/**
 * Replays the MCPS engine against quotes that are already stored, with the
 * arithmetic recorded in `sequel-track-quote-wizard_2.md` §12.
 *
 * Run:  node --experimental-strip-types scripts/verifyMcpsPricing.ts
 *
 * The rate card and the four per-region tables are pasted in as constants
 * rather than read from Supabase, on purpose: this has to fail when the ENGINE
 * changes, not when someone edits a rate. If a rate genuinely moves, update the
 * constants and the expected figures together, in one commit.
 *
 * Every figure below is minor units.
 */
import { priceMcps, type McpsAnswers, type McpsReference, type RateCardRow } from '../src/lib/mcpsPricing.ts'

const RATE_CARD: RateCardRow[] = [
  { id: 70, media: 'All Media', territory: 'Worldwide', per_30s: 875000, track_rate: 1357500, campaign_rate: 2184000 },
  { id: 71, media: 'All Media', territory: 'Single Continent + Single Country', per_30s: 750000, track_rate: 1125100, campaign_rate: 1800000 },
  { id: 72, media: 'All Media', territory: 'Two Countries', per_30s: 625000, track_rate: 937600, campaign_rate: 1500000 },
  { id: 73, media: 'All Media', territory: 'Single Continent', per_30s: 437500, track_rate: 656300, campaign_rate: 1050000 },
  { id: 74, media: 'All Media', territory: 'Single Country', per_30s: 312500, track_rate: 468800, campaign_rate: 750000 },
  { id: 75, media: 'Cinema / DVD', territory: 'Worldwide', per_30s: 100000, track_rate: 150000, campaign_rate: 240000 },
  { id: 80, media: 'Linear TV (Excluding VOD)', territory: 'Worldwide', per_30s: 585000, track_rate: 877500, campaign_rate: 1404000 },
  { id: 81, media: 'Linear TV (Excluding VOD)', territory: 'Single Continent + Single Country', per_30s: 450000, track_rate: 675000, campaign_rate: 1080000 },
  { id: 82, media: 'Linear TV (Excluding VOD)', territory: 'Two Countries', per_30s: 350000, track_rate: 525000, campaign_rate: 840000 },
  { id: 83, media: 'Linear TV (Excluding VOD)', territory: 'Single Continent', per_30s: 275000, track_rate: 412500, campaign_rate: 660000 },
  { id: 84, media: 'Linear TV (Excluding VOD)', territory: 'Single Country', per_30s: 175000, track_rate: 262500, campaign_rate: 420000 },
  { id: 85, media: 'Online incl. Social (Excluding VOD)', territory: 'Worldwide', per_30s: 90000, track_rate: 180000, campaign_rate: 300000 },
  { id: 86, media: 'Online incl. Social (Excluding VOD)', territory: 'Single Continent + Single Country', per_30s: 80000, track_rate: 163000, campaign_rate: 275000 },
  { id: 87, media: 'Online incl. Social (Excluding VOD)', territory: 'Two Countries', per_30s: 70000, track_rate: 136000, campaign_rate: 230000 },
  { id: 88, media: 'Online incl. Social (Excluding VOD)', territory: 'Single Continent', per_30s: 45000, track_rate: 95000, campaign_rate: 160000 },
  { id: 89, media: 'Online incl. Social (Excluding VOD)', territory: 'Single Country', per_30s: 35000, track_rate: 68000, campaign_rate: 115000 },
  { id: 90, media: 'Public Location', territory: 'Worldwide', per_30s: 21000, track_rate: 31500, campaign_rate: 50400 },
  { id: 99, media: 'Radio', territory: 'Single Country', per_30s: 95000, track_rate: 142500, campaign_rate: 228000 },
  { id: 100, media: 'Social Media (Only)', territory: 'Worldwide', per_30s: 40000, track_rate: 80000, campaign_rate: 150000 },
  { id: 101, media: 'Social Media (Only)', territory: 'Single Continent + Single Country', per_30s: 32500, track_rate: 56000, campaign_rate: 95000 },
  { id: 102, media: 'Social Media (Only)', territory: 'Two Countries', per_30s: 20000, track_rate: 30000, campaign_rate: 60000 },
  { id: 103, media: 'Social Media (Only)', territory: 'Single Continent', per_30s: 22500, track_rate: 41000, campaign_rate: 65000 },
  { id: 104, media: 'Social Media (Only)', territory: 'Single Country', per_30s: 10000, track_rate: 15000, campaign_rate: 30000 },
  { id: 105, media: 'Video On Demand', territory: 'Worldwide', per_30s: 200000, track_rate: 300000, campaign_rate: 480000 },
  { id: 106, media: 'Video On Demand', territory: 'Single Continent + Single Country', per_30s: 182000, track_rate: 272500, campaign_rate: 436500 },
  { id: 107, media: 'Video On Demand', territory: 'Two Countries', per_30s: 152000, track_rate: 227000, campaign_rate: 364000 },
  { id: 108, media: 'Video On Demand', territory: 'Single Continent', per_30s: 106000, track_rate: 159000, campaign_rate: 254500 },
  { id: 109, media: 'Video On Demand', territory: 'Single Country', per_30s: 76000, track_rate: 113500, campaign_rate: 182000 },
]

const REF: McpsReference = {
  rateCard: RATE_CARD,
  fx: { gbp: 1, usd: 1.32, euro: 1.1235, jpy: 206.7, sgd: 1.6875 },
  minimumFees: {
    'Asia Pacific': { euro: 40000, gbp: 35000, sgd: 60000, usd: 45000, jpy: 7250000 },
    Europe: { euro: 50000, gbp: 50000, sgd: 75000, usd: 60000, jpy: 9000000 },
    'Latin America': { euro: 35000, gbp: 30000, sgd: 50000, usd: 40000, jpy: 6000000 },
    'North America': { euro: 40000, gbp: 35000, sgd: 60000, usd: 50000, jpy: 7500000 },
    'Middle East & Turkey': { euro: 35000, gbp: 30000, sgd: 50000, usd: 40000, jpy: 6000000 },
  },
  searchFees: {
    'Asia Pacific': { euro: 65000, gbp: 60000, sgd: 100000, usd: 80000, jpy: 12500000 },
    Europe: { euro: 75000, gbp: 75000, sgd: 110000, usd: 90000, jpy: 14000000 },
    'Latin America': { euro: 60000, gbp: 50000, sgd: 100000, usd: 75000, jpy: 11500000 },
    'North America': { euro: 80000, gbp: 70000, sgd: 120000, usd: 100000, jpy: 15000000 },
    'Middle East & Turkey': { euro: 60000, gbp: 50000, sgd: 95000, usd: 75000, jpy: 11500000 },
  },
}

const blank: McpsAnswers = {
  media: [],
  territoryText: '',
  worldwideAnswer: false,
  territory: { is_worldwide: false, whole_continents: [], countries: [], distinct_continents: [] },
  multipleScripts: false,
  duration: '30 seconds or less',
  cutdowns: false,
  onlineWorldwide: true,
  tracks: null,
  searchesCount: 0,
  searchesOnly: false,
}

let failures = 0
let checks = 0

function check(label: string, actual: unknown, expected: unknown) {
  checks++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`)
  } else {
    console.log(`  ok    ${label} = ${a}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nQuote 377 — All Media, "Spain, France.", Track_Rate, NA client, 1 search')
// §12, verified 21 Aug. Arithmetic confirmed against rate card row 73 directly.
{
  const r = priceMcps(
    {
      ...blank,
      media: ['All Media'],
      territoryText: 'Spain, France.',
      territory: {
        is_worldwide: false,
        whole_continents: [],
        countries: ['France', 'Spain'],
        distinct_continents: ['Europe'],
      },
      duration: 'Longer than 30 seconds',
      cutdowns: true,
      searchesCount: 1,
    },
    REF,
    { region: 'North America', currency: 'GBP' },
  )
  check('rate type', r.rateType, 'track_rate')
  check('mcps_fee_GBP', r.perTrackGbp, 656300)
  check('Territory (bought)', r.territory, 'Europe')
  check('MCPS_territories (asked)', r.territoriesAsked, 'Spain, France.')
  // ⚠️ Stored as 721,930 / 72,193 / 864,123 - the NA client's 1.1 regional
  // uplift. The uplift follows the currency since 25 Sep 2026, and this is a
  // GBP quote, so it now prices with none.
  check('local licence fee', r.licenceFeeLocal, 656300)
  check('Sequel licensing fee', r.sequelLicensingFee, 65630)
  check('search fee', r.searchFee, 70000)
  check('Local_grand_total', r.grandTotal, 791930)
  check('Online_worldwide', r.onlineWorldwide, null)
}

// ---------------------------------------------------------------------------
console.log('\nQuote 379 — TV + VOD + Online, Mexico, online NOT worldwide, Campaign_Rate')
// §12, 24 Aug. Uncapped: All Media Single Country campaign is 750,000.
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Linear TV (Excluding VOD)', 'Video On Demand', 'Online incl. Social (Excluding VOD)'],
      territoryText: 'Mexico',
      territory: {
        is_worldwide: false,
        whole_continents: [],
        countries: ['Mexico'],
        distinct_continents: ['North America'],
      },
      multipleScripts: true,
      onlineWorldwide: false,
    },
    REF,
    { region: 'Latin America', currency: 'GBP' },
  )
  check('rate type', r.rateType, 'campaign_rate')
  check('media sum', r.mediaSum, 717000)
  check('cap tier', r.capTier, 'Single Country')
  check('cap', r.cap, 750000)
  check('capped', r.capped, false)
  check('mcps_fee_GBP', r.perTrackGbp, 717000)
  check('Territory (bought)', r.territory, 'Mexico')
  check('Media (bought)', r.mediaBought.length, 3)
}

// ---------------------------------------------------------------------------
console.log('\nQuote 380 — the same + Public Location, Mexico. The run that exercises both 24 Aug fixes')
{
  const r = priceMcps(
    {
      ...blank,
      media: [
        'Linear TV (Excluding VOD)',
        'Video On Demand',
        'Online incl. Social (Excluding VOD)',
        'Public Location',
      ],
      territoryText: 'Mexico',
      territory: {
        is_worldwide: false,
        whole_continents: [],
        countries: ['Mexico'],
        distinct_continents: ['North America'],
      },
      multipleScripts: true,
      onlineWorldwide: false,
    },
    REF,
    { region: 'Latin America', currency: 'GBP' },
  )
  check('media sum', r.mediaSum, 767400)
  check('capped', r.capped, true)
  check('mcps_fee_GBP', r.perTrackGbp, 750000)
  check('Media collapses', r.mediaBought, ['All Media'])
  check('Territory HELD at Mexico', r.territory, 'Mexico')
  // ⚠️ Stored as 825,000 / 82,500 / 907,500 under the old regional uplift.
  // GBP quote, so no uplift since 25 Sep 2026.
  check('local licence fee', r.licenceFeeLocal, 750000)
  check('Sequel licensing fee', r.sequelLicensingFee, 75000)
  check('Local_grand_total', r.grandTotal, 825000)
}

// ---------------------------------------------------------------------------
console.log('\nQuote 371 — searches only. £750, zero licence figures, no terms')
// §8.12. The old app reached this by consequence rather than design and got
// £10,375 before 20 Aug.
{
  const r = priceMcps(
    { ...blank, searchesOnly: true, searchesCount: 1, territoryText: '' },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  check('mcps_fee_GBP', r.perTrackGbp, 0)
  check('licence fee', r.licenceFeeLocal, 0)
  check('Sequel licensing fee (NOT the regional minimum)', r.sequelLicensingFee, 0)
  check('search fee', r.searchFee, 75000)
  check('Local_grand_total', r.grandTotal, 75000)
  check('Territory blanked', r.territory, '')
}

// ---------------------------------------------------------------------------
console.log('\nRadio across a continent — not sold at scope, cap becomes the price outright (§8.6)')
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Radio'],
      territoryText: 'Europe',
      territory: {
        is_worldwide: false,
        whole_continents: ['Europe'],
        countries: [],
        distinct_continents: ['Europe'],
      },
      duration: 'Longer than 30 seconds',
    },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  check('not sold at scope', r.notSoldAtScope, true)
  check('cap tier', r.capTier, 'Single Continent')
  check('priced at the cap outright', r.perTrackGbp, 656300)
  check('Media collapses', r.mediaBought, ['All Media'])
}

// ---------------------------------------------------------------------------
console.log('\nTrack multiplier — 2 tracks doubles licence and Sequel fee, search fee unchanged')
{
  const base = {
    ...blank,
    media: ['All Media'],
    territoryText: 'Spain, France.',
    territory: {
      is_worldwide: false,
      whole_continents: [],
      countries: ['France', 'Spain'],
      distinct_continents: ['Europe'],
    },
    duration: 'Longer than 30 seconds',
    cutdowns: true,
    searchesCount: 1,
  }
  const ctx = { region: 'North America', currency: 'GBP' }
  const one = priceMcps(base, REF, ctx)
  const two = priceMcps({ ...base, tracks: 2 }, REF, ctx)
  check('licence fee doubles', two.licenceFeeLocal, one.licenceFeeLocal * 2)
  check('Sequel fee doubles', two.sequelLicensingFee, one.sequelLicensingFee * 2)
  check('search fee unchanged', two.searchFee, one.searchFee)
  check('per-track GBP unchanged (cap compared at 1 track)', two.perTrackGbp, one.perTrackGbp)
}

// ---------------------------------------------------------------------------
console.log('\nBlank vs zero track count — both charge ONCE, not nothing (§5.3)')
{
  const base = {
    ...blank,
    media: ['All Media'],
    territoryText: 'Spain',
    territory: {
      is_worldwide: false,
      whole_continents: [],
      countries: ['Spain'],
      distinct_continents: ['Europe'],
    },
  }
  const ctx = { region: 'Europe', currency: 'GBP' }
  const nul = priceMcps({ ...base, tracks: null }, REF, ctx)
  const zero = priceMcps({ ...base, tracks: 0 }, REF, ctx)
  check('null charges once', nul.tracks, 1)
  check('zero charges once', zero.tracks, 1)
  check('same total', zero.grandTotal, nul.grandTotal)
}

// ---------------------------------------------------------------------------
console.log('\nRegional minimum — cheap track, 2 tracks, expect 2 x the minimum (§8.9)')
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Social Media (Only)'],
      territoryText: 'Spain',
      territory: {
        is_worldwide: false,
        whole_continents: [],
        countries: ['Spain'],
        distinct_continents: ['Europe'],
      },
      onlineWorldwide: false,
      tracks: 2,
    },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  check('per-track licence', r.perTrackLocal, 10000)
  check('10% would be 1,000, floored to the Europe minimum', r.sequelLicensingFee, 100000)
  check('licence fee', r.licenceFeeLocal, 20000)
}

// ---------------------------------------------------------------------------
console.log('\nThe uplift follows the CURRENCY, not the region (25 Sep 2026)')
{
  const base = {
    ...blank,
    media: ['All Media'],
    territoryText: 'Spain',
    territory: {
      is_worldwide: false,
      whole_continents: [],
      countries: ['Spain'],
      distinct_continents: ['Europe'],
    },
  }
  const eu = priceMcps(base, REF, { region: 'Europe', currency: 'GBP' })
  const apac = priceMcps(base, REF, { region: 'Asia Pacific', currency: 'GBP' })
  const euEur = priceMcps(base, REF, { region: 'Europe', currency: 'EURO' })
  const apacSgd = priceMcps(base, REF, { region: 'Asia Pacific', currency: 'SGD' })
  check('GBP, Europe client: no uplift', eu.perTrackLocal, eu.perTrackGbp)
  check('GBP, APAC client: no uplift either', apac.perTrackLocal, apac.perTrackGbp)
  check('EURO, Europe client: 1.1', euEur.perTrackLocal, Math.round(eu.perTrackGbp * 1.1235 * 1.1))
  check('SGD, APAC client: 1.1', apacSgd.perTrackLocal, Math.round(eu.perTrackGbp * 1.6875 * 1.1))
}

// ---------------------------------------------------------------------------
console.log('\nQuote 365 — Edelman Milan, Italy, Linear TV + VOD, Per_30s, EURO, Europe client')
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Linear TV (Excluding VOD)', 'Video On Demand'],
      territoryText: 'Italy',
      territory: {
        is_worldwide: false,
        whole_continents: [],
        countries: ['Italy'],
        distinct_continents: ['Europe'],
      },
    },
    REF,
    { region: 'Europe', currency: 'EURO' },
  )
  // Stored at 281,999 / 50,000 / 331,999 with no uplift - the case that
  // prompted the change. 251,000 x 1.1235 x 1.1 = 310,198.
  check('GBP fee', r.perTrackGbp, 251000)
  check('local licence fee', r.licenceFeeLocal, 310198)
  check('10% is 31,020, floored to the Europe EUR minimum', r.sequelLicensingFee, 50000)
  check('Local_grand_total', r.grandTotal, 360198)
}

// ---------------------------------------------------------------------------
console.log('\nSocial Media dropped when Online incl. Social is also selected (§8.7)')
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Online incl. Social (Excluding VOD)', 'Social Media (Only)'],
      territoryText: 'Spain',
      territory: {
        is_worldwide: false,
        whole_continents: [],
        countries: ['Spain'],
        distinct_continents: ['Europe'],
      },
      onlineWorldwide: false,
    },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  check('answered list drops Social', r.mediaAnswered, ['Online incl. Social (Excluding VOD)'])
  check('priced once', r.mediaSum, 35000)
}

// ---------------------------------------------------------------------------
console.log('\nThe first line of the cap order — online bought worldwide forces a Worldwide cap (§8.4)')
// This is the rule that looks redundant and is not. Without it the quote caps
// against a bundle that does not cover worldwide online, which under-charged
// quote 347 by about £9,100. One country asked for, so every other line of the
// order would give Single Country.
{
  const answers = {
    ...blank,
    media: ['Linear TV (Excluding VOD)', 'Online incl. Social (Excluding VOD)'],
    territoryText: 'Mexico',
    territory: {
      is_worldwide: false,
      whole_continents: [],
      countries: ['Mexico'],
      distinct_continents: ['North America'],
    },
    onlineWorldwide: true,
  }
  const ctx = { region: 'Latin America', currency: 'GBP' }
  const r = priceMcps(answers, REF, ctx)
  check('cap tier is Worldwide, not Single Country', r.capTier, 'Worldwide')
  check('cap', r.cap, 875000)
  check('online line is on the worldwide rate', r.onlineWorldwide, true)

  // The same quote with online NOT forced worldwide caps at Single Country.
  const narrow = priceMcps({ ...answers, onlineWorldwide: false }, REF, ctx)
  check('without the override, cap tier narrows', narrow.capTier, 'Single Country')
  check('and the cap is far lower', narrow.cap, 312500)
}

// ---------------------------------------------------------------------------
console.log('\nWorldwide answered by button — replaces the typed text (§8 input worldwide_yn)')
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Linear TV (Excluding VOD)'],
      territoryText: '',
      worldwideAnswer: true,
      territory: { is_worldwide: true, whole_continents: [], countries: [], distinct_continents: [] },
    },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  check('Territory', r.territory, 'Worldwide')
  check('MCPS_territories', r.territoriesAsked, 'Worldwide')
  check('priced at the worldwide row', r.perTrackGbp, 585000)
}

// ---------------------------------------------------------------------------
console.log('\nTerritory at rank 2 names ALL the distinct continents, joined')
// Europe plus one country outside it, reached through the mixed option.
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Video On Demand'],
      territoryText: 'Europe and USA',
      territory: {
        is_worldwide: false,
        whole_continents: ['Europe'],
        countries: ['USA'],
        distinct_continents: ['Europe', 'North America'],
      },
    },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  // Continent 106,000 + country 76,000 = 182,000, against 200,000 worldwide.
  check('mixed option wins', r.perTrackGbp, 182000)
  check('Territory joins both', r.territory, 'Europe and North America')
}

// ---------------------------------------------------------------------------
console.log('\nTwo whole continents and no countries — the old app has no option for it (DEFECT, ported as-is)')
{
  const r = priceMcps(
    {
      ...blank,
      media: ['Linear TV (Excluding VOD)'],
      territoryText: 'Europe and Asia',
      territory: {
        is_worldwide: false,
        whole_continents: ['Europe', 'Asia'],
        countries: [],
        distinct_continents: ['Europe', 'Asia'],
      },
    },
    REF,
    { region: 'Europe', currency: 'GBP' },
  )
  // Two Single Continent licences at the per-30s rate would be 550,000. The
  // old app has no option that expresses that, so it falls back to the
  // worldwide row at 585,000 and over-charges by 35,000 a track.
  check('falls back to worldwide', r.perTrackGbp, 585000)
  check('two continent licences would have been cheaper', 275000 * 2 < 585000, true)
}

// ---------------------------------------------------------------------------
console.log('\nCutdowns and the note are derived from the rate, not the button')
{
  const base = {
    ...blank,
    media: ['All Media'],
    territoryText: 'Spain',
    territory: {
      is_worldwide: false,
      whole_continents: [],
      countries: ['Spain'],
      distinct_continents: ['Europe'],
    },
  }
  const ctx = { region: 'Europe', currency: 'GBP' }
  check('per-30s: no cutdowns', priceMcps(base, REF, ctx).cutdowns, false)
  check('per-30s: note', priceMcps(base, REF, ctx).note, 'NA')
  check('cutdowns answered yes -> Track_Rate -> derived true',
    priceMcps({ ...base, cutdowns: true }, REF, ctx).cutdowns, true)
  check('multiple scripts -> Campaign_Rate -> derived true',
    priceMcps({ ...base, multipleScripts: true }, REF, ctx).cutdowns, true)
  check('scripts', priceMcps({ ...base, multipleScripts: true }, REF, ctx).scripts, 'Multiple')
}

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
