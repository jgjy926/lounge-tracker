import { describe, expect, test } from 'vitest'
import { defaultDocument, normalizeRule, withoutCard } from './schema'

const rule = (cardId, over = {}) => normalizeRule({ rule_id: `r_${cardId}`, card_id: cardId, network: 'Plaza Premium', ...over })
const lounge = (id, over = {}) => ({ lounge_id: id, name: id, networks: [], ...over })
const docWith = (over = {}) => ({ ...defaultDocument(), cards: [{ card_id: 'c1' }, { card_id: 'c2' }], ...over })
const listed = (cardId, ids) => rule(cardId, { lounge_scope: 'specific', lounge_ids: ids })

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
