/** 62 → "1:02". Hours only when there are any. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '–:––'
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "11 Sep", or "11 Sep 2025" once it is no longer this year. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.getFullYear() === new Date().getFullYear()
    ? dayMonth.format(d)
    : dayMonthYear.format(d)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const money = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Amounts arrive from the mirror already in major units — the views divide
 * where Xano stored minor ones, so nothing here has to know which table it
 * came from. The currency is Xano's own label ("GBP £", "SGD $"), printed as
 * given rather than mapped, because mapping it wrong is worse than showing it
 * verbatim.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return '—'
  const value = money.format(n)
  const label = currency?.trim()
  return label ? `${label} ${value}` : value
}

/** 1048576 → "1 MB". Sizes are for recognition, not accounting. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
