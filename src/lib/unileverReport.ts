import type { SupabaseClient } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * The Unilever annual report — `public.track_unilever_report(year)`,
 * migration 0038, a port of Xano's get_unilever_report (api 587). Finance
 * only: the function refuses anyone else.
 *
 * ⚠️ Only the five `*_eur` figures are in euros. Everything `*_local` is in the
 * invoice's own currency, and `rate` is the frozen per-invoice rate Unilever
 * checks the conversion against. See sequel-track-unilever-reporting.md.
 */
export type UnileverRow = {
  id: number
  uuid: string | null
  _region_id: number | null
  _region_text: string | null
  /** What Unilever expects that this row does not have. Empty when clean. */
  issues: string[]
} & Record<string, string | number | boolean | null | string[] | undefined>

export type UnileverReport = {
  year: number
  years: number[]
  count: number
  rows: UnileverRow[]
}

export function useUnileverReport(year: number, enabled: boolean) {
  return useQuery({
    queryKey: ['unilever-report', year],
    enabled,
    queryFn: async (): Promise<UnileverReport> => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_unilever_report',
        { p_year: year },
      )
      if (error) throw error
      return data as UnileverReport
    },
  })
}

/**
 * Unilever's sheet, column for column, copied from the old app's export
 * (Wized, read 17 Sep). The spelling is theirs and is kept exactly: two
 * spaces in "Total  Cost", the trailing spaces on "Extension? " and "License
 * 3rd Party Fees (Local Curr.) ", and "Artist/composer8". Their template
 * matches on these headers — do not tidy them.
 */
export const UNILEVER_COLUMNS: [string, string][] = [
  ['Date', 'date'],
  ['Business Group', 'business_group'],
  ['Category', 'category'],
  ['Brand Position', 'brand_position'],
  ['Brand', 'brand'],
  ['Memo/Description', 'memo'],
  ['Type', 'type'],
  ['Country Job Was Logged', 'country_logged'],
  ['Usage Territories', 'usage_territories'],
  ['Usage Region', 'usage_region'],
  ['AdPro number', 'adpro_number'],
  ['Total  Cost (EUR)', 'total_cost_eur'],
  ['Total Fees (EUR)', 'total_fees_eur'],
  ['Total 3rd Party Fees (EUR)', 'total_third_party_fees_eur'],
  ['Total Service Fees (EUR)', 'total_service_fees_eur'],
  ['Total Cost Avoidance (EUR)', 'total_cost_avoidance_eur'],
  ['Extension? ', 'extension'],
  ['Invoice Number', 'invoice_number'],
  ['Date of Invoice', 'date_of_invoice'],
  ['Service JobNo.', 'service_job_no'],
  ['Invoicee', 'invoicee'],
  ['Currency', 'currency'],
  ['Rate', 'rate'],
  ['Demo 3rd Party Fees (Local Curr.)', 'demo_third_party_local'],
  ['Demo 3rd Party Supplier Count', 'demo_supplier_count'],
  ['Demo Cost Avoidance (Local Curr.)', 'demo_cost_avoidance_local'],
  ['Demo Service Fees (Local Curr.)', 'demo_service_fees_local'],
  ['Search 3rd Party Supplier (Local Curr.)', 'search_third_party_local'],
  ['Search 3rd Party Supplier Count', 'search_supplier_count'],
  ['Search Cost Avoidance (Local Curr.)', 'search_cost_avoidance_local'],
  ['Search Service Fees (Local Curr.)', 'search_service_fees_local'],
  ['Artist/composer8', 'artist_composer'],
  ['Song', 'song'],
  ['Initial Cost (Master & Pub.) (Local Curr.)', 'initial_cost_master_pub_local'],
  ['Total Master Fee (Local Curr.)', 'total_master_fee_local'],
  ['Total Publishing Fee (Local Curr.)', 'total_publishing_fee_local'],
  ['License 3rd Party Fees (Local Curr.) ', 'licence_third_party_local'],
  ['Publisher Supplier Count', 'publisher_supplier_count'],
  ['License Cost Avoidance (Local Curr.)', 'licence_cost_avoidance_local'],
  ['License Service Fees (Local Curr.)', 'licence_service_fees_local'],
  ['Other 3rd Party Fees (Local Curr.)', 'other_third_party_local'],
  ['Other Cost Avoidance (Local Curr.)', 'other_cost_avoidance_local'],
  ['Other Service Fees (Local Curr.)', 'other_service_fees_local'],
]

/** One cell as the old export wrote it: booleans YES/NO, fractions to 2 dp,
 *  everything quoted with quotes doubled. */
function cell(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ''
  else if (value === true) text = 'YES'
  else if (value === false) text = 'NO'
  else if (typeof value === 'number')
    text = String(Number.isInteger(value) ? value : Math.round(value * 100) / 100)
  else text = String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * The whole year, whatever tab or search is showing — the old export did the
 * same, and Unilever want the year. BOM first so Excel reads the accents
 * (Tresemmé, Hellmann's), CRLF line ends.
 */
export function downloadUnileverCsv(rows: UnileverRow[], year: number) {
  const lines = [
    UNILEVER_COLUMNS.map(([header]) => cell(header)).join(','),
    ...rows.map((r) => UNILEVER_COLUMNS.map(([, key]) => cell(r[key])).join(',')),
  ]
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Unilever reporting ${year}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
