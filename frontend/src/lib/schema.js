// The one document stored on Koofr and cached in IndexedDB. A null anywhere in a
// rule means "the T&C does not say", which the engine treats differently from a
// stated value, so never default a rule field to a guess.
export const SCHEMA_VERSION = 1

export const SPEND_TYPES = [
  ['retail', 'Retail purchase'],
  ['instalment', 'Instalment plan (IPP/FPP)'],
  ['balance_transfer', 'Balance transfer'],
  ['cash_advance', 'Cash advance / quasi cash'],
  ['fee', 'Fees, interest or charges'],
  ['ewallet', 'E-wallet reload'],
  ['government', 'Government payment'],
  ['insurance', 'Insurance'],
  ['utilities', 'Utilities'],
  ['refund', 'Refund / credit'],
]
export const SPEND_TYPE_LABEL = Object.fromEntries(SPEND_TYPES)

export const QUOTA_PERIODS = [
  ['calendar_year', 'Calendar year'],
  ['card_year', 'Card year (from anniversary)'],
  ['calendar_quarter', 'Calendar quarter'],
  ['calendar_month', 'Calendar month'],
  ['lifetime', 'No reset'],
]

export const WINDOWS = [
  ['before_or_after', 'Days before and/or after the visit'],
  ['before', 'Days before the visit'],
  ['after', 'Days after the visit'],
  ['same_calendar_month', 'Same calendar month as the visit'],
  ['previous_calendar_month', 'Previous calendar month'],
  ['previous_calendar_quarter', 'Previous calendar quarter'],
  ['calendar_year', 'Calendar year to date'],
]
export const DAY_WINDOWS = ['before', 'after', 'before_or_after']

export const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// Versions of the same benefit share a group, so a new T&C version continues the
// same quota count instead of starting afresh.
export const ruleGroup = (cardId, network) => `${cardId}:${slug(network) || 'lounge'}`

export const defaultDocument = () => ({
  schema_version: SCHEMA_VERSION,
  last_updated: null,
  cards: [],
  lounges: [],
  rules: [],
  visits: [],
  spends: [],
  documents: [],
})

export const emptyCard = () => ({
  card_id: uid('card'),
  bank: '',
  name: '',
  last4: '',
  anniversary: '', // 'MM-DD', only needed for card-year quotas
  status: 'active',
  notes: '',
})

export const emptyLounge = () => ({
  lounge_id: uid('lounge'),
  name: '',
  networks: [],
  airport_code: '',
  airport_name: '',
  country: '',
  terminal: '',
  zone: '',
  hours: '',
  notes: '',
})

export const emptyCondition = () => ({
  type: null, // 'none' | 'min_spend' | 'min_txn' | null
  amount: null,
  count: null,
  overseas_only: null,
  window: null,
  days_before: null,
  days_after: null,
  sides_combine: null, // spend before + after add up to one total
  cumulative: null, // several transactions may add up
  boundary_inclusive: null, // the 30th day itself counts
  visit_day_counts: null,
  same_spend_reusable: null, // one spend can qualify several visits
  spend_holder: null, // 'same_holder' | 'principal_only' | 'any' | null
  excluded_spend_types: [],
  excluded_spend_text: null,
})

export const emptyRule = (cardId = '') => ({
  rule_id: uid('rule'),
  group: '',
  card_id: cardId,
  title: '',
  network: '',
  lounge_scope: 'network', // 'network' | 'specific'
  lounge_ids: [],
  countries: null, // ['Malaysia'] | ['worldwide'] | null
  flight_scope: null, // 'any' | 'international' | 'domestic' | null
  quota: { principal: null, supplementary: null, unlimited: false, period: null, per_day_limit: null },
  condition: emptyCondition(),
  guest: { allowed: null, consumes_quota: null, note: null },
  penalty: { amount: null, note: null },
  entry_requirements: null,
  duration_hours: null,
  notes: null,
  effective_from: null,
  effective_to: null,
  last_verified: null,
  source_document: null,
  document_id: null,
  confidence: null,
  evidence: {},
})

export const emptyVisit = () => ({
  visit_id: uid('visit'),
  card_id: '',
  lounge_id: '',
  rule_group: '',
  date: '',
  holder: 'principal',
  flight: 'unknown', // 'international' | 'domestic' | 'unknown'
  guests: 0,
  charged: false, // paid for, so it used no complimentary entry
  charged_amount: null,
  note: '',
})

export const emptySpend = () => ({
  spend_id: uid('spend'),
  card_id: '',
  date: '',
  amount: null,
  merchant: '',
  type: 'retail',
  holder: 'principal',
  overseas: false,
  note: '',
})

// Old or partial documents gain any fields added since they were written.
export function normalizeDoc(raw) {
  const doc = { ...defaultDocument(), ...(raw || {}) }
  doc.cards = doc.cards.map((c) => ({ ...emptyCard(), ...c }))
  doc.lounges = doc.lounges.map((l) => ({ ...emptyLounge(), ...l }))
  doc.rules = doc.rules.map(normalizeRule)
  doc.visits = doc.visits.map((v) => ({ ...emptyVisit(), ...v }))
  doc.spends = doc.spends.map((s) => ({ ...emptySpend(), ...s }))
  return doc
}

export function normalizeRule(r) {
  const base = emptyRule(r.card_id)
  const rule = {
    ...base,
    ...r,
    quota: { ...base.quota, ...(r.quota || {}) },
    condition: { ...base.condition, ...(r.condition || {}) },
    guest: { ...base.guest, ...(r.guest || {}) },
    penalty: { ...base.penalty, ...(r.penalty || {}) },
    evidence: r.evidence || {},
  }
  rule.group = r.group || ruleGroup(rule.card_id, rule.network)
  return rule
}

export const cardLabel = (card) =>
  card ? `${card.bank} ${card.name}`.trim() + (card.last4 ? ` ··${card.last4}` : '') : 'Unknown card'

export const loungeLabel = (lounge) =>
  lounge
    ? [lounge.airport_code, lounge.name, lounge.terminal].filter(Boolean).join(' · ')
    : 'Unknown lounge'
