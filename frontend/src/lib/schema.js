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

// Rules and lounges name a programme in their own words, so "Plaza Premium Lounge"
// and "Plaza Premium" must count as the same one.
const programmeWords = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['lounge', 'lounges', 'programme', 'program', 'network', 'the'].includes(w))

export const programmeKey = (s) => programmeWords(s).join('')
export const sameProgramme = (a, b) => Boolean(programmeKey(a)) && programmeKey(a) === programmeKey(b)

// Versions of the same benefit share a group, so a new T&C version continues the
// same quota count instead of starting afresh.
export const ruleGroup = (cardId, network) => `${cardId}:${slug(programmeWords(network).join(' ')) || slug(network) || 'lounge'}`

export const defaultDocument = () => ({
  schema_version: SCHEMA_VERSION,
  last_updated: null,
  cards: [],
  lounges: [],
  rules: [],
  visits: [],
  spends: [],
  documents: [],
  trips: [],
})

export const emptyCard = () => ({
  card_id: uid('card'),
  bank: '',
  name: '',
  last4: '',
  anniversary: '', // 'YYYY-MM', only needed for card-year quotas
  status: 'active',
  notes: '',
})

export const emptyLounge = () => ({
  lounge_id: uid('lounge'),
  name: '',
  networks: [],
  airport_code: '',
  airport_name: '',
  city: '',
  country: '',
  terminal: '',
  zone: '',
  hours: '',
  notes: '',
  source_url: '',
  verified: true, // false until you confirm a lounge an AI found
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

// One departure. A return flight is its own trip, because it leaves another airport.
export const emptyTrip = () => ({
  trip_id: uid('trip'),
  name: '',
  date: '',
  airport_code: '',
  flight_number: '',
  flight: 'unknown', // 'international' | 'domestic' | 'unknown'
  lounge_id: '', // empty: any lounge at the airport
  card_id: '', // empty: the best card
  holder: 'principal',
  note: '',
  visit_id: '', // set once the visit is logged
})

// Old or partial documents gain any fields added since they were written.
export function normalizeDoc(raw) {
  const doc = { ...defaultDocument(), ...(raw || {}) }
  doc.cards = doc.cards.map((c) => ({ ...emptyCard(), ...c }))
  doc.lounges = doc.lounges.map((l) => ({ ...emptyLounge(), ...l }))
  doc.rules = doc.rules.map(normalizeRule)
  doc.visits = doc.visits.map((v) => ({ ...emptyVisit(), ...v }))
  doc.spends = doc.spends.map((s) => ({ ...emptySpend(), ...s }))
  doc.trips = doc.trips.map((t) => ({ ...emptyTrip(), ...t }))
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

// A card takes its rules, visits and spend with it. Lounges it alone listed go too,
// so a card added in error leaves nothing behind in search. A lounge stays if another
// card lists it or its programme, or a trip or remaining visit points at it.
export function withoutCard(doc, cardId) {
  const gone = doc.rules.filter((r) => r.card_id === cardId)
  const rules = doc.rules.filter((r) => r.card_id !== cardId)
  const visits = doc.visits.filter((v) => v.card_id !== cardId)
  const trips = doc.trips.map((t) => (t.card_id === cardId ? { ...t, card_id: '' } : t))
  const candidates = new Set(gone.flatMap((r) => r.lounge_ids || []))
  const inUse = (l) =>
    rules.some((r) => (r.lounge_ids || []).includes(l.lounge_id) || (r.lounge_scope !== 'specific' && (l.networks || []).some((n) => sameProgramme(n, r.network)))) ||
    visits.some((v) => v.lounge_id === l.lounge_id) ||
    trips.some((t) => t.lounge_id === l.lounge_id)
  return {
    ...doc,
    cards: doc.cards.filter((c) => c.card_id !== cardId),
    rules,
    visits,
    spends: doc.spends.filter((s) => s.card_id !== cardId),
    trips,
    lounges: doc.lounges.filter((l) => !candidates.has(l.lounge_id) || inUse(l)),
    documents: doc.documents.map((d) => ({ ...d, card_ids: (d.card_ids || []).filter((id) => id !== cardId) })),
  }
}

export const cardLabel = (card) =>
  card ? `${card.bank} ${card.name}`.trim() + (card.last4 ? ` ··${card.last4}` : '') : 'Unknown card'

export const loungeLabel = (lounge) =>
  lounge
    ? [lounge.airport_code, lounge.name, lounge.terminal].filter(Boolean).join(' · ')
    : 'Unknown lounge'
