import { describe, expect, test } from 'vitest'
import { answerQuestion, askContext, findCards, findLounges, parseDate, searchTnc } from './question'
import { STATUS } from './engine'
import { defaultDocument, normalizeRule } from './schema'

const today = '2026-10-31' // a Saturday

const rule = normalizeRule({
  rule_id: 'r1',
  card_id: 'c1',
  title: 'Plaza Premium',
  network: 'Plaza Premium',
  flight_scope: 'international',
  quota: { principal: 3, supplementary: 0, period: 'calendar_year' },
  condition: {
    type: 'min_spend',
    amount: 500,
    window: 'before_or_after',
    days_before: 30,
    days_after: 30,
    sides_combine: true,
    cumulative: true,
    boundary_inclusive: true,
    visit_day_counts: true,
    same_spend_reusable: true,
    spend_holder: 'principal_only',
    excluded_spend_text: 'Instalment plans and cash advances',
  },
  guest: { note: 'Guests aged 3 and above get 25% off.' },
  penalty: { amount: 134, note: 'RM134 billed within 3 months' },
  entry_requirements: 'Physical card and boarding pass',
  duration_hours: 3,
  last_verified: today,
  evidence: { penalty: 'a fee of RM134.00' },
})

const doc = {
  ...defaultDocument(),
  cards: [
    { card_id: 'c1', bank: 'AEON', name: 'Gold Visa', status: 'active' },
    { card_id: 'c2', bank: 'AmBank', name: 'Visa Signature', status: 'active' },
  ],
  lounges: [
    { lounge_id: 'l1', name: 'Plaza Premium Lounge', networks: ['Plaza Premium'], airport_code: 'KUL', airport_name: 'Kuala Lumpur International Airport', country: 'Malaysia' },
    { lounge_id: 'l2', name: 'Plaza Premium Lounge', networks: ['Plaza Premium'], airport_code: 'SIN', airport_name: 'Changi', country: 'Singapore' },
  ],
  rules: [rule],
  spends: [{ spend_id: 's', card_id: 'c1', date: '2026-10-25', amount: 320, type: 'retail', holder: 'principal' }],
  documents: [{ doc_id: 'd', title: 'AEON T&C', card_ids: ['c1'], text: '9. Cardholders are entitled to access ONE time per day.\n10. Each visit is three hours.' }],
}

describe('dates in a question', () => {
  test.each([
    ['on 2026-11-20', '2026-11-20'],
    ['on 20/11', '2026-11-20'],
    ['on 20/11/2027', '2027-11-20'],
    ['on 20 Nov', '2026-11-20'],
    ['November 20th', '2026-11-20'],
    ['on 5 Jan', '2027-01-05'],
    ['today', '2026-10-31'],
    ['tomorrow', '2026-11-01'],
    ['next week', '2026-11-07'],
    ['on friday', '2026-11-06'],
    ['saturday', '2026-11-07'],
  ])('%s', (text, expected) => {
    expect(parseDate(text, today)).toBe(expected)
  })
  test('no date', () => {
    expect(parseDate('can I use the lounge', today)).toBeNull()
  })
})

describe('finding what the question is about', () => {
  test('cards by bank or product, ignoring common words', () => {
    expect(findCards(doc, 'my aeon card').map((c) => c.card_id)).toEqual(['c1'])
    expect(findCards(doc, 'the signature').map((c) => c.card_id)).toEqual(['c2'])
    expect(findCards(doc, 'my visa card')).toEqual([])
  })
  test('lounges by code, airport, or KLIA', () => {
    expect(findLounges(doc, 'at SIN').map((l) => l.lounge_id)).toEqual(['l2'])
    expect(findLounges(doc, 'at changi').map((l) => l.lounge_id)).toEqual(['l2'])
    expect(findLounges(doc, 'at klia').map((l) => l.lounge_id)).toEqual(['l1'])
  })
})

describe('answers', () => {
  test('card, lounge and date give the engine’s result', () => {
    const a = answerQuestion(doc, 'Can I use my AEON card at KLIA on 20 Nov?', today)
    expect(a.date).toBe('2026-11-20')
    expect(a.results).toHaveLength(1)
    expect(a.results[0].status).toBe(STATUS.NEEDS_SPEND)
    expect(a.results[0].headline).toBe('RM180 more by 20 Dec 2026')
  })

  test('no date means today, and says so', () => {
    const a = answerQuestion(doc, 'aeon at klia', today)
    expect(a.date).toBe(today)
    expect(a.dateStated).toBe(false)
  })

  test('a lounge alone compares all cards', () => {
    const a = answerQuestion(doc, 'what can I use at KLIA tomorrow', today)
    expect(a.results.map((r) => r.card.card_id).sort()).toEqual(['c1', 'c2'])
  })

  test('a terms question returns the clause and its quote', () => {
    const a = answerQuestion(doc, 'what is the fee on my aeon card if I miss the spend', today)
    const fee = a.clauses.find((c) => c.topic === 'penalty')
    expect(fee.text).toMatch(/RM134/)
    expect(fee.quote).toBe('a fee of RM134.00')
  })

  test('supplementary and flight words are understood', () => {
    const a = answerQuestion(doc, 'can a supplementary holder use aeon at klia on a domestic flight', today)
    expect(a.holder).toBe('supplementary')
    expect(a.flight).toBe('domestic')
    expect(a.results[0].status).toBe(STATUS.NOT_ELIGIBLE)
  })

  test('saved T&C text is searched', () => {
    expect(searchTnc(doc, 'how many times per day', ['c1'])[0].text).toMatch(/per day/)
    expect(searchTnc(doc, 'per day', ['c2'])).toEqual([])
  })

  test('the AI context carries the engine’s result and no spend ledger', () => {
    const a = answerQuestion(doc, 'aeon at klia on 20 Nov', today)
    const ctx = askContext(a, today)
    expect(ctx.engine_results[0].summary).toBe('RM180 more by 20 Dec 2026')
    expect(JSON.stringify(ctx)).not.toContain('spend_id')
  })
})
