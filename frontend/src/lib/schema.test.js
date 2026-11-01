import { describe, expect, test } from 'vitest'
import { evaluateRule, quotaPeriod } from './engine'
import { anniversaryStart } from './dates'
import { defaultDocument, normalizeRule, withoutCard } from './schema'

const rule = (cardId, over = {}) => normalizeRule({ rule_id: `r_${cardId}`, card_id: cardId, network: 'Plaza Premium', ...over })
const lounge = (id, over = {}) => ({ lounge_id: id, name: id, networks: [], ...over })
const docWith = (over = {}) => ({ ...defaultDocument(), cards: [{ card_id: 'c1' }, { card_id: 'c2' }], ...over })
const listed = (cardId, ids) => rule(cardId, { lounge_scope: 'specific', lounge_ids: ids })

describe('card anniversary as month and year', () => {
  const cardYearRule = rule('c1', { quota: { principal: 2, supplementary: 0, unlimited: false, period: 'card_year', per_day_limit: null }, condition: { type: 'none' }, last_verified: '2026-11-01' })
  const withCard = (anniversary) => ({ ...docWith({ rules: [cardYearRule] }), cards: [{ card_id: 'c1', bank: 'AEON', name: 'Gold', status: 'active', anniversary }] })

  test('counts the card year from the 1st of that month', () => {
    expect(quotaPeriod(cardYearRule, { anniversary: '2019-06' }, '2026-11-01')).toEqual({ start: '2026-06-01', end: '2027-05-31' })
    expect(quotaPeriod(cardYearRule, { anniversary: '2019-06' }, '2026-05-31')).toEqual({ start: '2025-06-01', end: '2026-05-31' })
  })

  test('the year makes no difference to the reset', () => {
    expect(quotaPeriod(cardYearRule, { anniversary: '2024-06' }, '2026-11-01')).toEqual(quotaPeriod(cardYearRule, { anniversary: '2019-06' }, '2026-11-01'))
  })

  test('a card saved earlier as month and day still works', () => {
    expect(anniversaryStart('06-15')).toBe('06-15')
    expect(quotaPeriod(cardYearRule, { anniversary: '06-15' }, '2026-11-01').start).toBe('2026-06-15')
  })

  test('nothing usable means the answer is unclear', () => {
    expect(anniversaryStart('')).toBeNull()
    expect(anniversaryStart('2019-13')).toBeNull()
    const r = evaluateRule(withCard(''), cardYearRule, { date: '2026-11-01', today: '2026-11-01' })
    expect(r.status).toBe('unclear')
    expect(r.headline).toMatch(/anniversary month is missing/)
  })

  test('only the anniversary month warns that the exact date may differ', () => {
    const at = (date) => evaluateRule(withCard('2019-06'), cardYearRule, { date, today: '2026-06-01' }).reminders.join(' ')
    expect(at('2026-06-20')).toMatch(/reset this month/)
    expect(at('2026-07-01')).not.toMatch(/reset this month/)
  })
})

describe('removing a card', () => {
  test('takes its rules, visits and spend, and leaves other cards alone', () => {
    const next = withoutCard(docWith({
      rules: [rule('c1'), rule('c2')],
      visits: [{ visit_id: 'v1', card_id: 'c1' }, { visit_id: 'v2', card_id: 'c2' }],
      spends: [{ spend_id: 's1', card_id: 'c1' }, { spend_id: 's2', card_id: 'c2' }],
    }), 'c1')
    expect(next.cards.map((c) => c.card_id)).toEqual(['c2'])
    expect(next.rules.map((r) => r.card_id)).toEqual(['c2'])
    expect(next.visits.map((v) => v.visit_id)).toEqual(['v2'])
    expect(next.spends.map((s) => s.spend_id)).toEqual(['s2'])
  })

  test('a lounge only this card listed goes with it', () => {
    const next = withoutCard(docWith({ rules: [listed('c1', ['a'])], lounges: [lounge('a')] }), 'c1')
    expect(next.lounges).toEqual([])
  })

  test('a lounge another card lists stays', () => {
    const next = withoutCard(docWith({ rules: [listed('c1', ['a']), listed('c2', ['a'])], lounges: [lounge('a')] }), 'c1')
    expect(next.lounges.map((l) => l.lounge_id)).toEqual(['a'])
  })

  test('a lounge another card reaches through its programme stays', () => {
    const next = withoutCard(docWith({ rules: [listed('c1', ['a']), rule('c2')], lounges: [lounge('a', { networks: ['Plaza Premium Lounge'] })] }), 'c1')
    expect(next.lounges).toHaveLength(1)
  })

  test('a lounge a trip or another visit points at stays', () => {
    const rules = [listed('c1', ['a'])]
    const trips = [{ trip_id: 't', lounge_id: 'a', card_id: 'c2' }]
    expect(withoutCard(docWith({ rules, lounges: [lounge('a')], trips }), 'c1').lounges).toHaveLength(1)
    const visits = [{ visit_id: 'v', card_id: 'c2', lounge_id: 'a' }]
    expect(withoutCard(docWith({ rules, lounges: [lounge('a')], visits }), 'c1').lounges).toHaveLength(1)
  })

  test('a lounge saved by hand stays', () => {
    expect(withoutCard(docWith({ rules: [listed('c1', [])], lounges: [lounge('b')] }), 'c1').lounges).toHaveLength(1)
  })

  test('a trip that chose this card goes back to the best card, and saved T&Cs stay', () => {
    const next = withoutCard(docWith({
      trips: [{ trip_id: 't', card_id: 'c1', lounge_id: '' }],
      documents: [{ doc_id: 'd', card_ids: ['c1', 'c2'] }],
    }), 'c1')
    expect(next.trips[0].card_id).toBe('')
    expect(next.documents[0].card_ids).toEqual(['c2'])
  })
})
