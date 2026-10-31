// Parse an AI-produced paste into reviewable drafts. The paste is deliberately
// forgiving: markdown fences, prose around the JSON, a bare array or object.
// Everything is coerced towards the schema, and each coercion or gap is reported
// as an issue so the preview shows it before anything is saved.
import { DAY_WINDOWS, QUOTA_PERIODS, SPEND_TYPES, WINDOWS, emptyLounge, emptySpend, emptyTrip, normalizeRule, programmeKey, ruleGroup, sameProgramme, uid } from './schema'
import { addDays, todayIso } from './dates'
import { LOUNGES_SCHEMA, RULES_SCHEMA, SPEND_SCHEMA, TRIPS_SCHEMA } from './prompts'

const issue = (level, field, message) => ({ level, field, message })
const pad = (n) => String(n).padStart(2, '0')
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

// ---------- text to JSON ----------

export function extractJsonText(text) {
  if (typeof text !== 'string') return ''
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const firstObj = t.indexOf('{')
  const firstArr = t.indexOf('[')
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr)
  if (start === -1) return t
  const close = t[start] === '{' ? '}' : ']'
  const end = t.lastIndexOf(close)
  return end > start ? t.slice(start, end + 1) : t.slice(start)
}

// ---------- coercion ----------

// ISO, DD/MM/YYYY (Malaysian order), "1 Jan 2026", "Jan 1, 2026", "August 2026".
export function coerceDate(value) {
  if (value === null || value === undefined || value === '') return { value: null }
  const s = String(value).trim()
  const valid = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false
    const date = new Date(Date.UTC(y, m - 1, d))
    return date.getUTCMonth() === m - 1
  }
  const iso = (y, m, d) => (valid(+y, +m, +d) ? `${y}-${pad(m)}-${pad(d)}` : null)

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    const v = iso(m[1], m[2], m[3])
    return v ? { value: v } : { value: null, error: `unusable date "${s}"` }
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const v = iso(m[3], m[2], m[1])
    return v ? { value: v, note: `read "${s}" as DD/MM/YYYY` } : { value: null, error: `unusable date "${s}"` }
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    const v = iso(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1])
    if (v) return { value: v }
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    const v = iso(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2])
    if (v) return { value: v }
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return {
      value: iso(m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], 1),
      note: `read "${s}" as the first of that month`,
    }
  }
  return { value: null, error: `unusable date "${s}"` }
}

// "RM 1,000", "1000.50", 500, "- RM 1,122.00"
export function coerceMoney(value) {
  if (value === null || value === undefined || value === '') return { value: null }
  if (typeof value === 'number') return Number.isFinite(value) ? { value } : { value: null }
  const s = String(value).trim()
  const n = Number(s.replace(/rm|myr|[,\s]/gi, ''))
  return Number.isFinite(n) ? { value: n } : { value: null, error: `unusable amount "${s}"` }
}

const coerceInt = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : null
}

const coerceBool = (value) => {
  if (value === true || value === false) return value
  const s = String(value ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y'].includes(s)) return true
  if (['false', 'no', 'n'].includes(s)) return false
  return null
}

const coerceEnum = (value, allowed) => {
  const s = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return allowed.includes(s) ? s : null
}

const cleanText = (value) => {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return !s || /^(null|n\/?a|none)$/i.test(s) ? null : s
}

const asList = (value) =>
  (Array.isArray(value) ? value : value ? String(value).split(/[,;]/) : []).map((x) => String(x).trim()).filter(Boolean)

// T&Cs usually name the bank twice ("AEON" + "AEON Member Plus Gold"), which
// would read "AEON AEON Member Plus Gold" everywhere.
function cleanCardName(card) {
  const bank = cleanText(card?.bank) || ''
  let name = cleanText(card?.name) || ''
  if (bank && name.toLowerCase().startsWith(`${bank.toLowerCase()} `)) name = name.slice(bank.length + 1)
  return { bank, name }
}

// ---------- rules ----------

const PERIODS = QUOTA_PERIODS.map(([k]) => k)
const WINDOW_KEYS = WINDOWS.map(([k]) => k)
const TYPE_KEYS = SPEND_TYPES.map(([k]) => k)

function normalizeDraftRule(raw, sourceDocument, today) {
  const issues = []
  const gap = (field, label) => issues.push(issue('gap', field, `${label} not stated`))

  const q = raw.quota || {}
  const quota = {
    principal: coerceInt(q.principal),
    supplementary: coerceInt(q.supplementary),
    unlimited: coerceBool(q.unlimited) === true,
    period: coerceEnum(q.period, PERIODS),
    per_day_limit: coerceInt(q.per_day_limit),
  }
  if (!quota.unlimited && quota.principal === null) gap('quota.principal', 'Visits for the principal cardholder')
  if (!quota.unlimited && !quota.period) gap('quota.period', 'When visits reset')

  const c = raw.condition || {}
  const amount = coerceMoney(c.amount)
  if (amount.error) issues.push(issue('warn', 'condition.amount', amount.error))
  const condition = {
    type: coerceEnum(c.type, ['none', 'min_spend', 'min_txn']),
    amount: amount.value,
    count: coerceInt(c.count),
    overseas_only: coerceBool(c.overseas_only),
    window: coerceEnum(c.window, WINDOW_KEYS),
    days_before: coerceInt(c.days_before),
    days_after: coerceInt(c.days_after),
    sides_combine: coerceBool(c.sides_combine),
    cumulative: coerceBool(c.cumulative),
    boundary_inclusive: coerceBool(c.boundary_inclusive),
    visit_day_counts: coerceBool(c.visit_day_counts),
    same_spend_reusable: coerceBool(c.same_spend_reusable),
    spend_holder: coerceEnum(c.spend_holder, ['same_holder', 'principal_only', 'any']),
    excluded_spend_types: asList(c.excluded_spend_types).map((t) => t.toLowerCase()).filter((t) => TYPE_KEYS.includes(t)),
    excluded_spend_text: cleanText(c.excluded_spend_text),
  }
  if (!condition.type) gap('condition.type', 'Spend condition')
  if (condition.type === 'min_spend' && condition.amount === null) gap('condition.amount', 'Minimum spend amount')
  if (condition.type === 'min_txn' && condition.count === null) gap('condition.count', 'Number of transactions')
  if (condition.type && condition.type !== 'none') {
    if (!condition.window) gap('condition.window', 'Spend window')
    if (DAY_WINDOWS.includes(condition.window)) {
      if (condition.window !== 'after' && condition.days_before === null) gap('condition.days_before', 'Days before the visit')
      if (condition.window !== 'before' && condition.days_after === null) gap('condition.days_after', 'Days after the visit')
      // These don't block an answer, but the engine reads them strictly until known.
      const soft = [
        ['boundary_inclusive', 'Whether the last day of the window counts'],
        ['visit_day_counts', 'Whether the visit day counts'],
        ['same_spend_reusable', 'Whether one spend can qualify several visits'],
      ]
      if (condition.window === 'before_or_after') soft.push(['sides_combine', 'Whether spend before and after adds up'])
      for (const [k, label] of soft) if (condition[k] === null) issues.push(issue('soft', `condition.${k}`, `${label} not stated, so it is read strictly`))
    }
    if (condition.cumulative === null) issues.push(issue('soft', 'condition.cumulative', 'Whether transactions add up not stated, so it is read strictly'))
    if (condition.spend_holder === null) issues.push(issue('soft', 'condition.spend_holder', 'Whose spend counts not stated, so it is read strictly'))
  }

  const from = coerceDate(raw.effective_from)
  const to = coerceDate(raw.effective_to)
  if (from.error) issues.push(issue('warn', 'effective_from', from.error))
  if (from.note) issues.push(issue('note', 'effective_from', from.note))
  if (to.error) issues.push(issue('warn', 'effective_to', to.error))
  if (!from.value) issues.push(issue('soft', 'effective_from', 'Start date not stated, so it applies to all dates'))

  const confidence = coerceEnum(raw.confidence, ['high', 'medium', 'low'])
  if (confidence === 'low') issues.push(issue('warn', 'confidence', 'The AI marked this as low confidence'))

  const scope = coerceEnum(raw.flight_scope, ['any', 'international', 'domestic'])
  const evidence = raw._source && typeof raw._source === 'object' ? raw._source : {}
  const penalty = coerceMoney(raw.penalty?.amount)

  const network = cleanText(raw.network) || ''
  if (!network) issues.push(issue('warn', 'network', 'Lounge programme missing, so this rule can’t match any lounge'))
  if (!Object.keys(evidence).length) issues.push(issue('warn', '_source', 'No T&C quotes included, so check this one against the T&C'))

  const countries = asList(raw.countries)
  return {
    issues,
    card: cleanCardName(raw.card),
    rule: normalizeRule({
      rule_id: uid('rule'),
      card_id: '',
      group: 'pending',
      title: cleanText(raw.title) || network || 'Lounge access',
      network,
      lounge_scope: 'network',
      countries: countries.length ? countries : null,
      flight_scope: scope,
      quota,
      condition,
      guest: {
        allowed: coerceBool(raw.guest?.allowed),
        consumes_quota: coerceBool(raw.guest?.consumes_quota),
        note: cleanText(raw.guest?.note),
      },
      penalty: { amount: penalty.value, note: cleanText(raw.penalty?.note) },
      entry_requirements: cleanText(raw.entry_requirements),
      duration_hours: coerceInt(raw.duration_hours),
      notes: cleanText(raw.notes),
      effective_from: from.value,
      effective_to: to.value,
      last_verified: today,
      source_document: sourceDocument,
      confidence,
      evidence,
    }),
  }
}

function normalizeDraftLounge(raw) {
  const name = cleanText(raw.name)
  if (!name) return null
  return {
    ...emptyLounge(),
    name,
    networks: asList(raw.networks ?? raw.network),
    airport_code: (cleanText(raw.airport_code) || '').toUpperCase(),
    airport_name: cleanText(raw.airport_name) || '',
    country: cleanText(raw.country) || '',
    terminal: cleanText(raw.terminal) || '',
    zone: cleanText(raw.zone) || '',
    hours: cleanText(raw.hours) || '',
  }
}

// ---------- matching ----------

const tokens = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

// Fuzzy bank + product match. A bank mismatch rules a card out.
export function matchCard(cards, bank, name) {
  const wanted = tokens(name)
  let best = null
  let bestScore = 0
  for (const card of cards) {
    if (bank && tokens(card.bank).join(' ') !== tokens(bank).join(' ')) continue
    const have = tokens(card.name)
    const overlap = wanted.filter((t) => have.includes(t)).length
    const score = wanted.length || have.length ? overlap / Math.max(wanted.length, have.length) : 1
    if (score > bestScore) {
      best = card
      bestScore = score
    }
  }
  return bestScore >= 0.5 ? best : null
}

// ---------- paste entry point ----------

export function parsePaste(text, { doc, today = todayIso() }) {
  let data
  try {
    data = JSON.parse(extractJsonText(text))
  } catch (e) {
    return { kind: 'error', error: `That isn’t valid JSON: ${e.message}` }
  }
  if (Array.isArray(data)) {
    const looksSpend = data.some((x) => x && x.amount !== undefined && x.date !== undefined)
    data = looksSpend ? { transactions: data } : { rules: data }
  } else if (data && !data.rules && !data.transactions && !data.lounges && (data.quota || data.condition)) {
    data = { rules: [data] }
  }
  if (!data || typeof data !== 'object') return { kind: 'error', error: 'No rules or transactions found in that JSON.' }

  if (data.schema === LOUNGES_SCHEMA) return parseLounges(data, doc)
  if (data.schema === TRIPS_SCHEMA || Array.isArray(data.trips)) return parseTrips(data, doc, today)
  if (data.schema === SPEND_SCHEMA || Array.isArray(data.transactions)) return parseSpends(data, doc)
  if (data.schema === RULES_SCHEMA || Array.isArray(data.rules) || Array.isArray(data.lounges)) return parseRules(data, doc, today)
  return { kind: 'error', error: 'No rules or transactions found in that JSON.' }
}

function parseRules(data, doc, today) {
  const source = cleanText(data.source_document)
  const drafts = (data.rules || []).filter((r) => r && typeof r === 'object').map((raw) => {
    const d = normalizeDraftRule(raw, source, today)
    const matched = matchCard(doc.cards, d.card.bank, d.card.name)
    const group = matched ? ruleGroup(matched.card_id, d.rule.network) : null
    const current = group ? doc.rules.find((r) => r.group === group && !r.effective_to) : null
    const named = (data.lounges || []).flatMap((l) => asList(l?.networks ?? l?.network))
    const programmes = [...doc.lounges.flatMap((l) => l.networks || []), ...named]
    if (d.rule.network && !programmes.some((p) => sameProgramme(p, d.rule.network))) {
      d.issues.push(issue('gap', 'network', `No saved lounge lists ${d.rule.network} yet. Import lounges next so this rule has somewhere to match.`))
    }
    return {
      ...d,
      include: true,
      card_id: matched?.card_id || null,
      current: current || null,
      changes: current ? diffRule(current, d.rule) : [],
    }
  })
  const lounges = (data.lounges || [])
    .map(normalizeDraftLounge)
    .filter(Boolean)
    .map((l) => ({
      lounge: l,
      include: !doc.lounges.some((x) => loungeKey(x) === loungeKey(l)),
      duplicate: doc.lounges.some((x) => loungeKey(x) === loungeKey(l)),
    }))
  if (!drafts.length && !lounges.length) return { kind: 'error', error: 'That JSON has no rules or lounges.' }
  return { kind: 'rules', drafts, lounges, source_document: source }
}

const loungeKey = (l) => `${l.airport_code}|${l.name}|${l.terminal}`.toLowerCase()

// Only a web address is kept, because the app renders it as a link.
const cleanUrl = (value) => {
  const s = cleanText(value)
  return s && /^https?:\/\//i.test(s) ? s : ''
}

// A programme with no rule behind it may be a rule's programme worded differently.
// When one name's words contain the other's, suggest treating them as the same.
export function programmeChoices(lounges, rules) {
  const known = [...new Set(rules.map((r) => r.network).filter(Boolean))]
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const seen = new Set()
  const out = []
  for (const name of lounges.flatMap((l) => l.networks || [])) {
    const key = programmeKey(name)
    if (!key || seen.has(key) || known.some((k) => sameProgramme(k, name))) continue
    seen.add(key)
    const mine = words(name)
    const near = known.find((k) => {
      const theirs = words(k)
      return mine.every((w) => theirs.includes(w)) || theirs.every((w) => mine.includes(w))
    })
    out.push({ name, mapTo: near || '', known })
  }
  return out
}

function parseLounges(data, doc) {
  const rows = (data.lounges || []).filter((l) => l && typeof l === 'object').map((raw) => {
    const lounge = normalizeDraftLounge(raw)
    if (!lounge) return null
    lounge.city = cleanText(raw.city) || ''
    lounge.notes = cleanText(raw.notes) || ''
    lounge.source_url = cleanUrl(raw.source_url)
    lounge.verified = false
    const issues = []
    if (!lounge.source_url) issues.push(issue('warn', 'source_url', 'No source link, so check this lounge yourself'))
    if (!lounge.networks.length) issues.push(issue('warn', 'networks', 'No programme listed, so no card can match it'))
    if (!lounge.airport_code) issues.push(issue('warn', 'airport_code', 'No airport code, so trips can’t find it'))
    if (coerceEnum(raw.confidence, ['high', 'medium', 'low']) === 'low') issues.push(issue('warn', 'confidence', 'The AI marked this as low confidence'))
    const duplicate = doc.lounges.some((x) => loungeKey(x) === loungeKey(lounge))
    return { lounge, issues, include: !duplicate, duplicate }
  }).filter(Boolean)
  if (!rows.length) return { kind: 'error', error: 'That JSON has no lounges. If the AI can’t browse the web, try one that can.' }
  return { kind: 'lounges', lounges: rows, programmes: programmeChoices(rows.map((r) => r.lounge), doc.rules) }
}

function parseTrips(data, doc, today) {
  const rows = (data.trips || []).filter((t) => t && typeof t === 'object').map((raw) => {
    const date = coerceDate(raw.date)
    const issues = []
    if (date.error) issues.push(issue('warn', 'date', date.error))
    const code = (cleanText(raw.airport_code) || '').toUpperCase()
    if (!code) issues.push(issue('warn', 'airport_code', 'No airport code'))
    if (date.value && date.value < today) issues.push(issue('note', 'date', 'This date has passed'))
    const trip = {
      ...emptyTrip(),
      name: cleanText(raw.name) || '',
      date: date.value || '',
      airport_code: code,
      flight_number: (cleanText(raw.flight_number) || '').toUpperCase(),
      flight: coerceEnum(raw.flight_type ?? raw.flight, ['international', 'domestic']) || 'unknown',
    }
    const valid = Boolean(date.value && code)
    const duplicate = doc.trips.some((t) => t.date === trip.date && t.airport_code === code)
    return { trip, issues, valid, duplicate, include: valid && !duplicate }
  })
  if (!rows.length) return { kind: 'error', error: 'That JSON has no flights.' }
  return { kind: 'trips', rows }
}

export function applyLoungesImport(doc, preview) {
  const rename = new Map(preview.programmes.filter((p) => p.mapTo).map((p) => [programmeKey(p.name), p.mapTo]))
  const rows = preview.lounges.filter((r) => r.include).map((r) => ({
    ...r.lounge,
    networks: [...new Set(r.lounge.networks.map((n) => rename.get(programmeKey(n)) || n))],
  }))
  return { doc: { ...doc, lounges: [...doc.lounges, ...rows] }, added: rows.length }
}

export function applyTripsImport(doc, preview) {
  const rows = preview.rows.filter((r) => r.include && r.valid).map((r) => r.trip)
  return { doc: { ...doc, trips: [...doc.trips, ...rows] }, added: rows.length }
}

function parseSpends(data, doc) {
  const hint = cleanCardName(data.card)
  const card = data.card ? matchCard(doc.cards, hint.bank, hint.name) : null
  const rows = (data.transactions || []).filter((t) => t && typeof t === 'object').map((t) => {
    const issues = []
    const date = coerceDate(t.date)
    const amount = coerceMoney(t.amount)
    if (date.error) issues.push(issue('warn', 'date', date.error))
    if (amount.error) issues.push(issue('warn', 'amount', amount.error))
    const type = coerceEnum(t.type, TYPE_KEYS) || (amount.value < 0 ? 'refund' : 'retail')
    return {
      issues,
      valid: Boolean(date.value) && amount.value !== null,
      spend: {
        ...emptySpend(),
        date: date.value,
        amount: amount.value,
        merchant: cleanText(t.merchant) || '',
        type,
        holder: coerceEnum(t.holder, ['principal', 'supplementary']) || 'principal',
        overseas: coerceBool(t.overseas) === true,
      },
    }
  })
  if (!rows.length) return { kind: 'error', error: 'That JSON has no transactions.' }
  return { kind: 'spends', card_id: card?.card_id || '', card_hint: data.card || null, rows: markDuplicates(rows, doc, card?.card_id) }
}

// A row already saved for this card (same date + amount) starts unticked.
export function markDuplicates(rows, doc, cardId) {
  const seen = new Set(
    doc.spends.filter((s) => s.card_id === cardId).map((s) => `${s.date}|${Number(s.amount)}`),
  )
  return rows.map((r) => {
    const duplicate = Boolean(cardId) && seen.has(`${r.spend.date}|${Number(r.spend.amount)}`)
    return { ...r, duplicate, include: r.valid && !duplicate }
  })
}

// ---------- comparing a new T&C with the current rule ----------

const RULE_FIELDS = [
  ['quota.principal', 'Principal visits'],
  ['quota.supplementary', 'Supplementary visits'],
  ['quota.unlimited', 'Unlimited visits'],
  ['quota.period', 'Visits reset'],
  ['quota.per_day_limit', 'Daily limit'],
  ['condition.type', 'Condition type'],
  ['condition.amount', 'Minimum spend'],
  ['condition.count', 'Transactions needed'],
  ['condition.overseas_only', 'Overseas only'],
  ['condition.window', 'Spend window'],
  ['condition.days_before', 'Days before'],
  ['condition.days_after', 'Days after'],
  ['condition.sides_combine', 'Before + after add up'],
  ['condition.cumulative', 'Transactions add up'],
  ['condition.boundary_inclusive', 'Last day counts'],
  ['condition.visit_day_counts', 'Visit day counts'],
  ['condition.same_spend_reusable', 'Spend reusable'],
  ['condition.spend_holder', 'Whose spend counts'],
  ['condition.excluded_spend_types', 'Excluded spend'],
  ['flight_scope', 'Flights'],
  ['countries', 'Countries'],
  ['guest.allowed', 'Guests allowed'],
  ['guest.consumes_quota', 'Guests use visits'],
  ['penalty.amount', 'Penalty fee'],
  ['duration_hours', 'Stay limit (hours)'],
]

const read = (o, path) => path.split('.').reduce((x, k) => x?.[k], o)
const show = (v) => (v === null || v === undefined ? 'not stated' : Array.isArray(v) ? v.join(', ') || 'none' : String(v))

export function diffRule(oldRule, newRule) {
  return RULE_FIELDS.flatMap(([path, label]) => {
    const a = show(read(oldRule, path))
    const b = show(read(newRule, path))
    return a === b ? [] : [{ path, label, from: a, to: b }]
  })
}

// ---------- applying a reviewed import ----------

// Pure: returns the next doc. A new version closes the current rule of the group
// the day before it starts, so past visits keep being judged by the old terms.
export function applyRulesImport(doc, preview, { today = todayIso(), newCard } = {}) {
  const cards = [...doc.cards]
  let rules = [...doc.rules]
  let added = 0
  let replaced = 0

  for (const d of preview.drafts) {
    if (!d.include) continue
    let cardId = d.card_id
    if (!cardId) {
      const existing = matchCard(cards, d.card.bank, d.card.name)
      if (existing) cardId = existing.card_id
      else {
        const card = newCard(d.card)
        cards.push(card)
        cardId = card.card_id
      }
    }
    const group = ruleGroup(cardId, d.rule.network)
    const next = { ...d.rule, card_id: cardId, group }
    const start = next.effective_from || today
    const current = rules.find((r) => r.group === group && !r.effective_to)
    if (current && (current.effective_from || '') >= start) {
      // Same or later start: this corrects that version rather than following it.
      rules = rules.map((r) => (r.rule_id === current.rule_id ? { ...next, rule_id: current.rule_id, effective_from: next.effective_from ?? current.effective_from } : r))
      replaced += 1
    } else {
      if (current) {
        rules = rules.map((r) => (r.rule_id === current.rule_id ? { ...r, effective_to: addDays(start, -1) } : r))
        replaced += 1
      }
      rules.push(next)
      added += 1
    }
  }

  const lounges = [...doc.lounges]
  let loungesAdded = 0
  for (const l of preview.lounges || []) {
    if (!l.include) continue
    lounges.push(l.lounge)
    loungesAdded += 1
  }
  return { doc: { ...doc, cards, rules, lounges }, added, replaced, loungesAdded }
}

export function applySpendImport(doc, preview, cardId) {
  const rows = preview.rows.filter((r) => r.include && r.valid).map((r) => ({ ...r.spend, card_id: cardId }))
  return { doc: { ...doc, spends: [...doc.spends, ...rows] }, added: rows.length }
}
