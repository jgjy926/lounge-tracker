// Calendar dates are plain 'YYYY-MM-DD' strings everywhere, so they compare with
// < and > and no timezone can shift a spend across a window boundary.
const pad = (n) => String(n).padStart(2, '0')

const toUtc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
export const addDays = (iso, n) => fromUtc(toUtc(iso) + n * 86400000)
export const diffDays = (a, b) => Math.round((toUtc(a) - toUtc(b)) / 86400000)

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const monthStart = (y, m) => `${y}-${pad(m)}-01`
const monthEnd = (y, m) => fromUtc(Date.UTC(y, m, 0))

export function calendarMonth(iso, offset = 0) {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  const yy = d.getUTCFullYear()
  const mm = d.getUTCMonth() + 1
  return { start: monthStart(yy, mm), end: monthEnd(yy, mm) }
}

export function calendarQuarter(iso, offset = 0) {
  const [y, m] = iso.split('-').map(Number)
  const first = Math.floor((m - 1) / 3) * 3 + offset * 3
  const a = new Date(Date.UTC(y, first, 1))
  const b = new Date(Date.UTC(y, first + 3, 0))
  return { start: fromUtc(a.getTime()), end: fromUtc(b.getTime()) }
}

export function calendarYear(iso) {
  const y = iso.slice(0, 4)
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

// The 12 months containing `iso`, starting on the card's anniversary ('MM-DD').
export function cardYear(iso, anniversary) {
  const y = Number(iso.slice(0, 4))
  const startThis = `${y}-${anniversary}`
  const startYear = iso >= startThis ? y : y - 1
  return {
    start: `${startYear}-${anniversary}`,
    end: addDays(`${startYear + 1}-${anniversary}`, -1),
  }
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso, { year = true } = {}) {
  if (!isIsoDate(iso)) return iso || '—'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${SHORT[m - 1]}${year ? ` ${y}` : ''}`
}

export function formatRange(start, end) {
  if (start === end) return formatDate(start)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${formatDate(start, { year: !sameYear })} – ${formatDate(end)}`
}
