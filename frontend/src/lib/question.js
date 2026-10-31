// Turn a typed question into card + lounge + date + topic, with no AI involved,
// so the Ask screen still answers offline. T&C lookups come from saved text only.
import { addDays, isIsoDate } from './dates'
import { cardLabel } from './schema'
import { evaluateCard, findAccess, money } from './engine'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const pad = (n) => String(n).padStart(2, '0')

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const dayOfWeek = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()

// A date with no year means the next time that date comes round.
const nextOccurrence = (month, day, today) => {
  const y = Number(today.slice(0, 4))
  const d = `${y}-${pad(month)}-${pad(day)}`
  return d >= today ? d : `${y + 1}-${pad(month)}-${pad(day)}`
}

export function parseDate(text, today) {
  const t = text.toLowerCase()
  let m = t.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (m && isIsoDate(m[1])) return m[1]
  m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/)
  if (m && +m[2] <= 12 && +m[1] <= 31) {
    return m[3] ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : nextOccurrence(+m[2], +m[1], today)
  }
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/)
  if (m) return m[3] ? `${m[3]}-${pad(MONTHS[m[2]])}-${pad(m[1])}` : nextOccurrence(MONTHS[m[2]], +m[1], today)
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/)
  if (m) return m[3] ? `${m[3]}-${pad(MONTHS[m[1]])}-${pad(m[2])}` : nextOccurrence(MONTHS[m[1]], +m[2], today)
  if (/\btoday\b|\bnow\b|\btonight\b/.test(t)) return today
  if (/\btomorrow\b/.test(t)) return addDays(today, 1)
  if (/\bnext week\b/.test(t)) return addDays(today, 7)
  m = t.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (m) {
    let gap = (DAYS.indexOf(m[2]) - dayOfWeek(today) + 7) % 7
    if (gap === 0) gap = 7
    if (m[1] && gap < 7 && DAYS.indexOf(m[2]) > dayOfWeek(today)) gap += 7
    return addDays(today, gap)
  }
  return null
}

// Words common to many cards can't identify one on their own.
const GENERIC = new Set(['card', 'credit', 'visa', 'mastercard', 'bank', 'the', 'and'])

export function findCards(doc, text) {
  const q = new Set(words(text))
  const scored = doc.cards.map((card) => {
    const bank = words(card.bank).filter((w) => !GENERIC.has(w))
    const name = words(card.name).filter((w) => !GENERIC.has(w))
    const bankHit = bank.length > 0 && bank.every((w) => q.has(w))
    const nameHits = name.filter((w) => q.has(w)).length
    return { card, score: (bankHit ? 1 : 0) + nameHits, nameHits, bankHit }
  })
  const top = Math.max(0, ...scored.map((s) => s.score))
  return top === 0 ? [] : scored.filter((s) => s.score === top).map((s) => s.card)
}

export function findLounges(doc, text) {
  const q = new Set(words(text))
  const hits = doc.lounges.filter((l) => {
    const code = (l.airport_code || '').toLowerCase()
    if (code && q.has(code)) return true
    const airport = words(l.airport_name).filter((w) => !['airport', 'international', 'the'].includes(w))
    if (airport.length && airport.every((w) => q.has(w))) return true
    const name = words(l.name).filter((w) => !['lounge', 'the'].includes(w))
    return name.length > 0 && name.every((w) => q.has(w))
  })
  if (hits.length) return hits
  // KLIA is how Malaysians say KUL.
  if (q.has('klia') || q.has('klia2')) return doc.lounges.filter((l) => l.airport_code === 'KUL')
  return []
}

const TOPICS = [
  ['guest', /\b(guest|guests|family|spouse|wife|husband|child|children|kid|kids|infant|friend|bring)\b/, (r) => r.guest?.note, 'guest'],
  ['penalty', /\b(fee|fees|charge|charged|charges|penalty|penalties|billed|cost|pay|miss|fail)\b/, (r) => r.penalty?.note || (r.penalty?.amount != null ? `Fee ${money(r.penalty.amount)}.` : null), 'penalty'],
  ['excluded', /\b(exclude|excluded|exclusion|exclusions|count|counts|counted|ipp|fpp|instalment|installment|ewallet|cash advance)\b/, (r) => r.condition?.excluded_spend_text, 'condition'],
  ['entry', /\b(show|bring|document|documents|entry|boarding|physical|present|need at)\b/, (r) => r.entry_requirements, 'entry_requirements'],
  ['duration', /\b(hour|hours|long|stay|duration)\b/, (r) => (r.duration_hours ? `${r.duration_hours} hours per visit.` : null), 'duration_hours'],
  ['flight', /\b(domestic|international|flight|flights|departure|departures)\b/, (r) => (r.flight_scope ? `Applies to ${r.flight_scope} flights.` : null), 'flight_scope'],
]

export function findTopics(text) {
  const t = text.toLowerCase()
  return TOPICS.filter(([, re]) => re.test(t))
}

const STOP = new Set(['the', 'and', 'can', 'for', 'with', 'what', 'when', 'how', 'does', 'will', 'may', 'use', 'lounge', 'card', 'access', 'there', 'this', 'that', 'have', 'from', 'into', 'are'])

// The saved T&C paragraphs that best match the question.
export function searchTnc(doc, text, cardIds = null, limit = 3) {
  const q = words(text).filter((w) => w.length > 2 && !STOP.has(w))
  if (!q.length) return []
  const out = []
  for (const d of doc.documents) {
    if (cardIds && d.card_ids?.length && !d.card_ids.some((id) => cardIds.includes(id))) continue
    const paragraphs = String(d.text || '').split(/\n{1,}|(?<=\.)\s+(?=\d+\.\s)/)
    for (const p of paragraphs) {
      const low = p.toLowerCase()
      const score = q.filter((w) => low.includes(w)).length
      if (score > 0 && p.trim().length > 20) out.push({ doc: d.title, text: p.trim().slice(0, 500), score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

// The complete offline answer. AI wording, when available, is added on top.
export function answerQuestion(doc, text, today) {
  const cards = findCards(doc, text)
  const lounges = findLounges(doc, text)
  const statedDate = parseDate(text, today)
  const date = statedDate || today
  const topics = findTopics(text)
  const lower = text.toLowerCase()
  const holder = /\bsupplementary\b|\bsupp\b/.test(lower) ? 'supplementary' : 'principal'
  const flight = /\bdomestic\b/.test(lower) ? 'domestic' : /\binternational\b/.test(lower) ? 'international' : 'unknown'
  const ctx = { date, today, holder, flight }

  let results = []
  if (cards.length) {
    for (const card of cards) {
      if (lounges.length) for (const lounge of lounges) results.push(evaluateCard(doc, card.card_id, { ...ctx, lounge }))
      else results.push(evaluateCard(doc, card.card_id, { ...ctx, lounge: null }))
    }
  } else if (lounges.length) {
    for (const lounge of lounges) results.push(...findAccess(doc, { ...ctx, loungeId: lounge.lounge_id }))
  } else if (!topics.length) {
    results = findAccess(doc, ctx)
  }

  const scopeCards = cards.length ? cards : doc.cards
  const clauses = []
  for (const [topic, , getText, evidenceKey] of topics) {
    for (const rule of doc.rules) {
      if (rule.effective_to && rule.effective_to < today) continue
      if (!scopeCards.some((c) => c.card_id === rule.card_id)) continue
      const value = getText(rule)
      if (!value) continue
      clauses.push({
        topic,
        card: cardLabel(doc.cards.find((c) => c.card_id === rule.card_id)),
        rule: rule.title,
        text: value,
        quote: rule.evidence?.[evidenceKey] || null,
      })
    }
  }

  return {
    cards,
    lounges,
    date,
    dateStated: Boolean(statedDate),
    holder,
    flight,
    results,
    clauses,
    excerpts: searchTnc(doc, text, cards.length ? cards.map((c) => c.card_id) : null),
  }
}

// What the Worker's model is allowed to see.
export function askContext(answer, today) {
  return {
    today,
    visit_date: answer.date,
    engine_results: answer.results.slice(0, 8).map((r) => ({
      card: cardLabel(r.card),
      lounge: r.lounge ? `${r.lounge.airport_code} ${r.lounge.name}`.trim() : null,
      status: r.status,
      summary: r.headline,
      checks: (r.checks || []).map((c) => `${c.label}: ${c.detail}`),
      reminders: r.reminders || [],
    })),
    // `summary` is the app's wording; only `tnc_quote` is the bank's own.
    clauses: answer.clauses.slice(0, 8).map((c) => ({ card: c.card, rule: c.rule, summary: c.text, tnc_quote: c.quote })),
    tnc_excerpts: answer.excerpts,
  }
}
