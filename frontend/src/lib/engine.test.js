import { describe, expect, test } from 'vitest'
import {
  STATUS,
  assessQuota,
  attentionItems,
  evaluateCard,
  evaluateRule,
  evaluateVisit,
  findAccess,
  spendWindows,
} from './engine'
import { defaultDocument, normalizeRule, ruleGroup } from './schema'

const card = { card_id: 'c1', bank: 'AEON', name: 'Gold', status: 'active', anniversary: '' }
const lounge = {
  lounge_id: 'l1',
  name: 'Plaza Premium',
  networks: ['Plaza Premium'],
  airport_code: 'KUL',
  country: 'Malaysia',
}

// The rule as AEON's August 2026 T&C states it for a Gold card.
const aeonRule = (over = {}) =>
  normalizeRule({
    rule_id: 'r1',
    card_id: 'c1',
    title: 'Plaza Premium',
    network: 'Plaza Premium',
    flight_scope: 'international',
    quota: { principal: 3, supplementary: 0, period: 'calendar_year', per_day_limit: 1 },
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
      excluded_spend_types: ['instalment', 'balance_transfer', 'cash_advance', 'fee'],
    },
    guest: { consumes_quota: false },
    last_verified: '2025-08-01',
    ...over,
  })

const spend = (date, amount, over = {}) => ({
  spend_id: `s${date}${amount}`,
  card_id: 'c1',
  date,
  amount,
  type: 'retail',
  holder: 'principal',
  overseas: false,
  ...over,
})
const visit = (date, over = {}) => ({
  visit_id: `v${date}`,
  card_id: 'c1',
  lounge_id: 'l1',
  rule_group: ruleGroup('c1', 'Plaza Premium'),
  date,
  holder: 'principal',
  flight: 'international',
  guests: 0,
  charged: false,
  ...over,
})

const makeDoc = (spends = [], visits = [], rule = aeonRule()) => ({
  ...defaultDocument(),
  cards: [card],
  lounges: [lounge],
  rules: [rule],
  spends,
  visits,
})

// `today` is well after the window so "needs spend" can't mask a real "no".
const ask = (doc, date, over = {}) =>
  evaluateRule(doc, doc.rules[0], { date, today: '2025-10-15', lounge, holder: 'principal', flight: 'international', ...over })

describe('AEON T&C worked examples (August 2026 version, clause 7 table)', () => {
  test('RM500 on 26 Jul qualifies a 1 Aug visit (before)', () => {
    expect(ask(makeDoc([spend('2025-07-26', 500)]), '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })

  test('RM500 on 28 Aug qualifies a 1 Aug visit (after)', () => {
    expect(ask(makeDoc([spend('2025-08-28', 500)]), '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })

  test('15 Jul + 21 Jul + 31 Aug add up across both sides; day 30 counts', () => {
    const doc = makeDoc([spend('2025-07-15', 200), spend('2025-07-21', 100), spend('2025-08-31', 400)])
    const r = ask(doc, '2025-08-01')
    expect(r.status).toBe(STATUS.ELIGIBLE)
    expect(r.spend.have).toBe(700)
  })

  test('the same spend with 1 Sep instead of 31 Aug fails: day 31 is out', () => {
    const doc = makeDoc([spend('2025-07-15', 200), spend('2025-07-21', 100), spend('2025-09-01', 400)])
    const r = ask(doc, '2025-08-01')
    expect(r.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(r.spend.have).toBe(300)
  })

  test('one spend can qualify two visits (1 and 10 Aug, RM200 + RM300)', () => {
    const spends = [spend('2025-07-15', 200), spend('2025-08-21', 300)]
    const doc = makeDoc(spends, [visit('2025-08-01')])
    expect(ask(doc, '2025-08-10').status).toBe(STATUS.ELIGIBLE)
    const docB = makeDoc(spends, [visit('2025-08-10')])
    expect(ask(docB, '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })

  test('supplementary spend does not count for a principal-only rule', () => {
    const doc = makeDoc([spend('2025-08-02', 500, { holder: 'supplementary' })])
    expect(ask(doc, '2025-08-01').status).toBe(STATUS.NOT_ELIGIBLE)
  })

  test('supplementary cardholder of a card with no entitlement is refused', () => {
    const doc = makeDoc([spend('2025-08-02', 500, { holder: 'supplementary' })])
    const r = ask(doc, '2025-08-01', { holder: 'supplementary' })
    expect(r.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(r.headline).toMatch(/no complimentary visits/i)
  })

  test('excluded spend types do not count (clause 6)', () => {
    const doc = makeDoc([
      spend('2025-07-26', 400, { type: 'instalment' }),
      spend('2025-07-27', 400, { type: 'cash_advance' }),
      spend('2025-07-28', 100),
    ])
    expect(ask(doc, '2025-08-01').spend.have).toBe(100)
  })

  test('a domestic flight is refused and shows the fee', () => {
    const rule = aeonRule({ penalty: { amount: 134, note: 'RM134 billed within 3 months' } })
    const doc = makeDoc([spend('2025-07-26', 500)], [], rule)
    const r = ask(doc, '2025-08-01', { flight: 'domestic' })
    expect(r.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(r.checks.find((c) => c.label === 'Flight').detail).toMatch(/RM134/)
  })

  test('one complimentary visit a day (clause 9)', () => {
    const doc = makeDoc([spend('2025-07-26', 500)], [visit('2025-08-01')])
    const r = ask(doc, '2025-08-01')
    expect(r.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(r.headline).toMatch(/a day/)
  })
})

describe('asking before the window closes', () => {
  test('a future visit reports the shortfall and the last day to spend', () => {
    const doc = makeDoc([spend('2026-10-25', 320)], [], aeonRule({ last_verified: '2026-10-31' }))
    const r = evaluateRule(doc, doc.rules[0], { date: '2026-11-20', today: '2026-10-31', lounge })
    expect(r.status).toBe(STATUS.NEEDS_SPEND)
    expect(r.spend.shortfall).toBe(180)
    expect(r.spend.deadline).toBe('2026-12-20')
    expect(r.headline).toBe('RM180 more by 20 Dec 2026')
  })

  test('a past visit stays open until the after-window ends', () => {
    const doc = makeDoc([], [], aeonRule({ last_verified: '2026-10-31' }))
    const open = evaluateRule(doc, doc.rules[0], { date: '2026-10-10', today: '2026-11-09', lounge })
    expect(open.status).toBe(STATUS.NEEDS_SPEND)
    const closed = evaluateRule(doc, doc.rules[0], { date: '2026-10-10', today: '2026-11-10', lounge })
    expect(closed.status).toBe(STATUS.NOT_ELIGIBLE)
  })

  test('your example: RM500 only in the 30 days before; the visit day is the limit', () => {
    const rule = aeonRule({
      last_verified: '2026-10-31',
      condition: { ...aeonRule().condition, window: 'before', days_after: null },
    })
    const doc = makeDoc([spend('2026-11-21', 500)], [], rule)
    const r = evaluateRule(doc, doc.rules[0], { date: '2026-11-20', today: '2026-11-01', lounge })
    expect(r.status).toBe(STATUS.NEEDS_SPEND)
    expect(r.spend.deadline).toBe('2026-11-20')
  })
})

describe('where the T&C is silent', () => {
  const silent = (over) => aeonRule({ last_verified: '2025-08-01', condition: { ...aeonRule().condition, ...over } })

  test('a spend on the unstated boundary day makes it unclear, not yes', () => {
    const doc = makeDoc([spend('2025-07-02', 500)], [], silent({ boundary_inclusive: null }))
    const r = ask(doc, '2025-08-01')
    expect(r.status).toBe(STATUS.UNCLEAR)
    expect(r.headline).toMatch(/generous reading/)
  })

  test('spend clearly inside the window is still eligible on the strict reading', () => {
    const doc = makeDoc([spend('2025-07-20', 500)], [], silent({ boundary_inclusive: null, visit_day_counts: null }))
    expect(ask(doc, '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })

  test('unstated combining: split spend is unclear, one side alone is eligible', () => {
    const splitDoc = makeDoc([spend('2025-07-20', 300), spend('2025-08-10', 300)], [], silent({ sides_combine: null }))
    expect(ask(splitDoc, '2025-08-01').status).toBe(STATUS.UNCLEAR)
    const oneSide = makeDoc([spend('2025-08-10', 600)], [], silent({ sides_combine: null }))
    expect(ask(oneSide, '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })

  test('explicit "not reusable": an earlier visit uses up the spend', () => {
    const rule = silent({ same_spend_reusable: false })
    const doc = makeDoc([spend('2025-07-20', 500)], [visit('2025-07-25')], rule)
    const r = ask(doc, '2025-08-01')
    expect(r.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(r.spend.have).toBe(0)
  })

  test('unstated reuse: unclear when only reuse would satisfy it', () => {
    const rule = silent({ same_spend_reusable: null })
    const doc = makeDoc([spend('2025-07-20', 500)], [visit('2025-07-25')], rule)
    expect(ask(doc, '2025-08-01').status).toBe(STATUS.UNCLEAR)
  })

  test('single-transaction rule: two small spends do not add up', () => {
    const rule = silent({ cumulative: false })
    const doc = makeDoc([spend('2025-07-20', 300), spend('2025-07-21', 300)], [], rule)
    expect(ask(doc, '2025-08-01').status).toBe(STATUS.NOT_ELIGIBLE)
  })

  test('no stated visit count or spend condition is unclear', () => {
    const noQuota = aeonRule({ quota: { principal: null, period: null } })
    expect(ask(makeDoc([spend('2025-07-20', 500)], [], noQuota), '2025-08-01').status).toBe(STATUS.UNCLEAR)
    const noCond = aeonRule({ condition: { type: null } })
    expect(ask(makeDoc([], [], noCond), '2025-08-01').status).toBe(STATUS.UNCLEAR)
  })

  test('a rule not verified in 180 days is unclear even when conditions pass', () => {
    const doc = makeDoc([spend('2025-07-26', 500)], [], aeonRule({ last_verified: '2025-01-01' }))
    expect(ask(doc, '2025-08-01').status).toBe(STATUS.UNCLEAR)
  })

  test('a stated "no" is not softened by a stale rule', () => {
    const doc = makeDoc([], [], aeonRule({ last_verified: '2025-01-01' }))
    expect(ask(doc, '2025-08-01').status).toBe(STATUS.NOT_ELIGIBLE)
  })
})

describe('other condition shapes', () => {
  test('N overseas transactions (Hong Leong style)', () => {
    const rule = aeonRule({
      condition: {
        type: 'min_txn',
        count: 3,
        overseas_only: true,
        window: 'before_or_after',
        days_before: 30,
        days_after: 30,
        sides_combine: true,
        boundary_inclusive: true,
        visit_day_counts: true,
        same_spend_reusable: true,
        spend_holder: 'any',
      },
    })
    const o = { overseas: true }
    const two = makeDoc([spend('2025-07-20', 10, o), spend('2025-07-21', 10, o), spend('2025-07-22', 10)], [], rule)
    expect(ask(two, '2025-08-01').status).toBe(STATUS.NOT_ELIGIBLE)
    const three = makeDoc([spend('2025-07-20', 10, o), spend('2025-07-21', 10, o), spend('2025-07-22', 10, o)], [], rule)
    expect(ask(three, '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })

  test('previous calendar month window', () => {
    const w = spendWindows({ window: 'previous_calendar_month' }, '2026-03-15', true)
    expect(w).toEqual([{ start: '2026-02-01', end: '2026-02-28' }])
  })

  test('no condition at all', () => {
    const rule = aeonRule({ condition: { type: 'none' } })
    expect(ask(makeDoc([], [], rule), '2025-08-01').status).toBe(STATUS.ELIGIBLE)
  })
})

describe('quota', () => {
  const full = [visit('2025-02-01'), visit('2025-03-01'), visit('2025-04-01')]

  test('three visits used in the year blocks the fourth', () => {
    const doc = makeDoc([spend('2025-07-26', 500)], full)
    const r = ask(doc, '2025-08-01')
    expect(r.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(r.headline).toMatch(/used up/)
  })

  test('resets in the new calendar year', () => {
    const doc = makeDoc([spend('2026-01-20', 500)], full, aeonRule({ last_verified: '2026-01-01' }))
    const r = evaluateRule(doc, doc.rules[0], { date: '2026-02-01', today: '2026-02-02', lounge })
    expect(r.status).toBe(STATUS.ELIGIBLE)
    expect(r.quota.left).toBe(3)
  })

  test('a visit you paid for uses no entry', () => {
    const doc = makeDoc([], [visit('2025-02-01', { charged: true })])
    expect(assessQuota(doc, doc.rules[0], card, { date: '2025-08-01', holder: 'principal' }).used).toBe(0)
  })

  test('guests use entries only when the rule says so', () => {
    const consumes = aeonRule({ guest: { consumes_quota: true } })
    const doc = makeDoc([], [visit('2025-02-01', { guests: 1 })], consumes)
    expect(assessQuota(doc, consumes, card, { date: '2025-08-01', holder: 'principal' }).used).toBe(2)
    const none = makeDoc([], [visit('2025-02-01', { guests: 1 })])
    expect(assessQuota(none, none.rules[0], card, { date: '2025-08-01', holder: 'principal' }).used).toBe(1)
  })

  test('a new T&C version continues the same count', () => {
    const oldV = aeonRule({ rule_id: 'old', effective_to: '2025-07-31' })
    const newV = aeonRule({ rule_id: 'new', effective_from: '2025-08-01' })
    const doc = { ...makeDoc([], [visit('2025-02-01')]), rules: [oldV, newV] }
    expect(assessQuota(doc, newV, card, { date: '2025-09-01', holder: 'principal' }).used).toBe(1)
  })

  test('card-year quota resets on the anniversary and needs the date', () => {
    const rule = aeonRule({ quota: { principal: 2, period: 'card_year' } })
    const doc = { ...makeDoc([], [visit('2025-05-31'), visit('2025-06-02')], rule), cards: [{ ...card, anniversary: '06-01' }] }
    const q = assessQuota(doc, rule, doc.cards[0], { date: '2025-07-01', holder: 'principal' })
    expect(q.used).toBe(1)
    expect(q.period).toEqual({ start: '2025-06-01', end: '2026-05-31' })
    const missing = assessQuota(doc, rule, card, { date: '2025-07-01', holder: 'principal' })
    expect(missing.known).toBe(false)
  })
})

describe('coverage and choosing between rules', () => {
  test('rule versions apply by visit date', () => {
    const oldV = aeonRule({ rule_id: 'old', effective_to: '2025-07-31', condition: { ...aeonRule().condition, amount: 300 } })
    const newV = aeonRule({ rule_id: 'new', effective_from: '2025-08-01' })
    const doc = { ...makeDoc([spend('2025-07-05', 400)]), rules: [oldV, newV] }
    const ctx = { today: '2025-10-15', lounge }
    expect(evaluateCard(doc, 'c1', { ...ctx, date: '2025-07-10' }).rule.rule_id).toBe('old')
    expect(evaluateCard(doc, 'c1', { ...ctx, date: '2025-07-10' }).status).toBe(STATUS.ELIGIBLE)
    expect(evaluateCard(doc, 'c1', { ...ctx, date: '2025-08-01' }).rule.rule_id).toBe('new')
    expect(evaluateCard(doc, 'c1', { ...ctx, date: '2025-08-01' }).status).toBe(STATUS.NOT_ELIGIBLE)
  })

  test('a lounge outside the network or the countries is not covered', () => {
    const other = { ...lounge, lounge_id: 'l2', networks: ['Priority Pass'] }
    expect(ask(makeDoc(), '2025-08-01', { lounge: other }).status).toBe(STATUS.NOT_COVERED)
    const rule = aeonRule({ countries: ['Malaysia'] })
    const sin = { ...lounge, country: 'Singapore' }
    expect(ask(makeDoc([], [], rule), '2025-08-01', { lounge: sin }).status).toBe(STATUS.NOT_COVERED)
  })

  test('the best of several rules wins', () => {
    const noSpendPass = normalizeRule({
      rule_id: 'pp',
      card_id: 'c1',
      network: 'Plaza Premium',
      group: 'c1:other',
      quota: { principal: 1, period: 'calendar_year' },
      condition: { type: 'none' },
      last_verified: '2025-08-01',
    })
    const doc = { ...makeDoc(), rules: [aeonRule(), noSpendPass] }
    const r = evaluateCard(doc, 'c1', { date: '2025-08-01', today: '2025-10-15', lounge })
    expect(r.rule.rule_id).toBe('pp')
    expect(r.others).toHaveLength(1)
  })

  test('a card with no rule says so', () => {
    const doc = { ...makeDoc(), rules: [] }
    expect(evaluateCard(doc, 'c1', { date: '2025-08-01', today: '2025-10-15' }).status).toBe(STATUS.NOT_COVERED)
  })
})

describe('finder filters', () => {
  const second = { card_id: 'c2', bank: 'AmBank', name: 'Signature', status: 'active' }
  const closed = { card_id: 'c3', bank: 'AEON', name: 'Old', status: 'closed' }
  const doc = {
    ...makeDoc([spend('2025-07-26', 500)]),
    cards: [card, second, closed],
    lounges: [lounge, { ...lounge, lounge_id: 'l2', name: 'Other', airport_code: 'PEN' }],
  }
  const base = { date: '2025-08-01', today: '2025-10-15' }

  test('one row per open card with no lounge chosen', () => {
    const rows = findAccess(doc, base)
    expect(rows.map((r) => r.card.card_id)).toEqual(['c1', 'c2'])
    expect(rows[0].status).toBe(STATUS.ELIGIBLE)
  })

  test('filters by bank, airport and status', () => {
    expect(findAccess(doc, { ...base, bank: 'ambank' })).toHaveLength(1)
    const pen = findAccess(doc, { ...base, airport: 'PEN', cardId: 'c1' })
    expect(pen).toHaveLength(1)
    expect(pen[0].lounge.lounge_id).toBe('l2')
    expect(findAccess(doc, { ...base, status: STATUS.ELIGIBLE })).toHaveLength(1)
  })
})

describe('attention list', () => {
  const rule = aeonRule({ last_verified: '2026-10-01', penalty: { amount: 134 } })

  test('a visit still short of spend appears with its deadline', () => {
    const doc = makeDoc([], [visit('2026-10-20')], rule)
    const [item] = attentionItems(doc, '2026-10-31')
    expect(item.kind).toBe('spend')
    expect(item.title).toBe('RM500 more by 19 Nov 2026')
  })

  test('a missed condition shows the fee; a qualified visit shows nothing', () => {
    const missed = makeDoc([], [visit('2026-08-20')], rule)
    expect(attentionItems(missed, '2026-10-31')[0].detail).toMatch(/RM134/)
    const fine = makeDoc([spend('2026-10-15', 500)], [visit('2026-10-20')], rule)
    expect(attentionItems(fine, '2026-10-31')).toEqual([])
    expect(evaluateVisit(fine, fine.visits[0], '2026-10-31').status).toBe(STATUS.ELIGIBLE)
  })

  test('stale rules ask to be re-checked; ended ones do not', () => {
    const stale = makeDoc([], [], aeonRule({ last_verified: '2026-01-01' }))
    expect(attentionItems(stale, '2026-10-31')[0].kind).toBe('stale')
    const ended = makeDoc([], [], aeonRule({ last_verified: '2026-01-01', effective_to: '2026-07-31' }))
    expect(attentionItems(ended, '2026-10-31')).toEqual([])
  })
})
