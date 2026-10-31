import { describe, expect, test } from 'vitest'
import aeon from './fixtures/aeon-aug-2026.json'
import {
  applyRulesImport,
  applySpendImport,
  coerceDate,
  coerceMoney,
  extractJsonText,
  matchCard,
  parsePaste,
} from './importer'
import { buildRulesPrompt, buildSpendPrompt } from './prompts'
import { STATUS, evaluateRule } from './engine'
import { defaultDocument, emptyCard, normalizeRule, ruleGroup } from './schema'

const card = { ...emptyCard(), card_id: 'c1', bank: 'AEON', name: 'Member Plus Gold' }
const docWith = (over = {}) => ({ ...defaultDocument(), cards: [card], ...over })
const newCard = (c) => ({ ...emptyCard(), ...c })
const today = '2026-10-31'

describe('reading messy pastes', () => {
  test('fences, prose and trailing commentary', () => {
    expect(extractJsonText('Here you go:\n```json\n{"a":1}\n```\nHope that helps')).toBe('{"a":1}')
    expect(extractJsonText('Sure! {"a":1} done')).toBe('{"a":1}')
  })

  test('bad JSON gives a readable error, not a crash', () => {
    const r = parsePaste('not json at all', { doc: docWith() })
    expect(r.kind).toBe('error')
  })

  test('a bare rule object and a bare array both work', () => {
    const rule = { card: { bank: 'AEON', name: 'Gold' }, network: 'X', quota: { principal: 1 } }
    expect(parsePaste(JSON.stringify(rule), { doc: docWith() }).drafts).toHaveLength(1)
    expect(parsePaste(JSON.stringify([rule]), { doc: docWith() }).drafts).toHaveLength(1)
  })

  test('dates', () => {
    expect(coerceDate('2026-08-01').value).toBe('2026-08-01')
    expect(coerceDate('31/12/2026').value).toBe('2026-12-31')
    expect(coerceDate('1 Aug 2026').value).toBe('2026-08-01')
    expect(coerceDate('Aug 1, 2026').value).toBe('2026-08-01')
    expect(coerceDate('August 2026').value).toBe('2026-08-01')
    expect(coerceDate('31/02/2026').error).toBeTruthy()
    expect(coerceDate('soon').error).toBeTruthy()
    expect(coerceDate(null).value).toBeNull()
  })

  test('amounts', () => {
    expect(coerceMoney('RM 1,000').value).toBe(1000)
    expect(coerceMoney('- RM 1,122.00').value).toBe(-1122)
    expect(coerceMoney(500).value).toBe(500)
    expect(coerceMoney('abc').error).toBeTruthy()
  })
})

describe('the real AEON T&C, extracted per the shipped prompt', () => {
  const preview = parsePaste(JSON.stringify(aeon), { doc: docWith(), today })

  test('matches the card and keeps the stated values', () => {
    const d = preview.drafts[0]
    expect(preview.kind).toBe('rules')
    expect(d.card_id).toBe('c1')
    expect(d.rule.quota.principal).toBe(3)
    expect(d.rule.quota.supplementary).toBe(0)
    expect(d.rule.condition.amount).toBe(500)
    expect(d.rule.condition.excluded_spend_types).toContain('instalment')
    expect(d.rule.penalty.amount).toBe(134)
    expect(d.rule.effective_from).toBe('2026-08-01')
    expect(d.rule.last_verified).toBe(today)
    expect(d.rule.evidence.per_day_limit).toMatch(/ONE \(1\) time per day/)
  })

  test('reports what the T&C leaves open', () => {
    const fields = preview.drafts[0].issues.map((i) => i.field)
    expect(fields).toContain('condition.visit_day_counts')
    expect(fields).not.toContain('condition.boundary_inclusive')
    expect(fields).not.toContain('quota.principal')
  })

  test('once registered, it answers the worked example', () => {
    const { doc } = applyRulesImport(docWith(), preview, { today, newCard })
    const spends = [
      { spend_id: 'a', card_id: 'c1', date: '2026-08-15', amount: 200, type: 'retail', holder: 'principal' },
      { spend_id: 'b', card_id: 'c1', date: '2026-08-21', amount: 100, type: 'retail', holder: 'principal' },
      { spend_id: 'c', card_id: 'c1', date: '2026-09-30', amount: 400, type: 'retail', holder: 'principal' },
    ]
    const r = evaluateRule({ ...doc, spends }, doc.rules[0], { date: '2026-09-01', today, flight: 'international' })
    expect(r.status).toBe(STATUS.ELIGIBLE)
    expect(r.spend.have).toBe(700)
  })
})

describe('gaps', () => {
  test('a null stays null and is listed, never defaulted', () => {
    const r = parsePaste(JSON.stringify({ rules: [{ card: { bank: 'AEON', name: 'Gold' }, network: 'X' }] }), { doc: docWith(), today })
    const d = r.drafts[0]
    expect(d.rule.quota.principal).toBeNull()
    expect(d.rule.condition.type).toBeNull()
    expect(d.issues.filter((i) => i.level === 'gap').map((i) => i.field)).toEqual(
      expect.arrayContaining(['quota.principal', 'quota.period', 'condition.type']),
    )
  })

  test('a window not in the list becomes a gap instead of a guess', () => {
    const r = parsePaste(JSON.stringify({ rules: [{ card: {}, network: 'X', condition: { type: 'min_spend', amount: 500, window: 'around the visit' } }] }), { doc: docWith(), today })
    expect(r.drafts[0].rule.condition.window).toBeNull()
    expect(r.drafts[0].issues.map((i) => i.field)).toContain('condition.window')
  })

  test('unknown exclusion words are dropped, the wording stays in the text', () => {
    const r = parsePaste(JSON.stringify({ rules: [{ card: {}, network: 'X', condition: { excluded_spend_types: ['fee', 'jewellery'], excluded_spend_text: 'fees and jewellery' } }] }), { doc: docWith(), today })
    expect(r.drafts[0].rule.condition.excluded_spend_types).toEqual(['fee'])
    expect(r.drafts[0].rule.condition.excluded_spend_text).toBe('fees and jewellery')
  })
})

describe('card matching', () => {
  const cards = [
    { card_id: 'a', bank: 'AEON', name: 'Gold Visa' },
    { card_id: 'b', bank: 'AEON', name: 'Platinum Visa' },
    { card_id: 'c', bank: 'AmBank', name: 'Gold Visa' },
  ]
  test('bank must match and the closest product wins', () => {
    expect(matchCard(cards, 'AEON', 'Gold Visa').card_id).toBe('a')
    expect(matchCard(cards, 'aeon', 'platinum visa').card_id).toBe('b')
    expect(matchCard(cards, 'AmBank', 'Gold Visa').card_id).toBe('c')
    expect(matchCard(cards, 'HSBC', 'Gold Visa')).toBeNull()
    expect(matchCard(cards, 'AEON', 'Biker Infinite')).toBeNull()
  })
})

describe('registering and new T&C versions', () => {
  const v1 = normalizeRule({
    rule_id: 'old',
    card_id: 'c1',
    network: 'Plaza Premium',
    group: ruleGroup('c1', 'Plaza Premium'),
    effective_from: '2026-01-01',
    quota: { principal: 3, period: 'calendar_year' },
    condition: { type: 'min_spend', amount: 300, window: 'before', days_before: 30 },
  })
  const paste = (over) =>
    JSON.stringify({
      rules: [{ card: { bank: 'AEON', name: 'AEON Member Plus Gold' }, network: 'Plaza Premium', effective_from: '2026-08-01', quota: { principal: 3, period: 'calendar_year' }, condition: { type: 'min_spend', amount: 500, window: 'before', days_before: 30 }, ...over }],
    })

  test('shows what changed against the current rule', () => {
    const r = parsePaste(paste(), { doc: docWith({ rules: [v1] }), today })
    expect(r.drafts[0].current.rule_id).toBe('old')
    expect(r.drafts[0].changes).toContainEqual({ path: 'condition.amount', label: 'Minimum spend', from: '300', to: '500' })
  })

  test('a newer version closes the old one the day before', () => {
    const doc = docWith({ rules: [v1] })
    const r = applyRulesImport(doc, parsePaste(paste(), { doc, today }), { today, newCard })
    const old = r.doc.rules.find((x) => x.rule_id === 'old')
    expect(old.effective_to).toBe('2026-07-31')
    expect(r.doc.rules).toHaveLength(2)
    expect(r.doc.rules[1].group).toBe(v1.group)
  })

  test('re-importing the same start date corrects it instead of duplicating', () => {
    const doc = docWith({ rules: [v1] })
    const r = applyRulesImport(doc, parsePaste(paste({ effective_from: '2026-01-01' }), { doc, today }), { today, newCard })
    expect(r.doc.rules).toHaveLength(1)
    expect(r.doc.rules[0].rule_id).toBe('old')
    expect(r.doc.rules[0].condition.amount).toBe(500)
    expect(r.replaced).toBe(1)
  })

  test('an unticked draft changes nothing', () => {
    const doc = docWith({ rules: [v1] })
    const p = parsePaste(paste(), { doc, today })
    p.drafts[0].include = false
    expect(applyRulesImport(doc, p, { today, newCard }).doc.rules).toEqual([v1])
  })

  test('an unknown card is created from the T&C wording', () => {
    const doc = defaultDocument()
    const r = applyRulesImport(doc, parsePaste(paste(), { doc, today }), { today, newCard })
    expect(r.doc.cards[0].bank).toBe('AEON')
    expect(r.doc.cards[0].name).toBe('Member Plus Gold')
    expect(r.doc.rules[0].card_id).toBe(r.doc.cards[0].card_id)
  })

  test('lounges already saved start unticked', () => {
    const lounge = { name: 'Plaza Premium', networks: ['Plaza Premium'], airport_code: 'kul', terminal: 'T1' }
    const first = defaultDocument()
    const r = applyRulesImport(first, parsePaste(JSON.stringify({ lounges: [lounge] }), { doc: first, today }), { today, newCard })
    expect(r.doc.lounges[0].airport_code).toBe('KUL')
    const again = parsePaste(JSON.stringify({ lounges: [lounge] }), { doc: r.doc, today })
    expect(again.lounges[0].include).toBe(false)
    expect(again.lounges[0].duplicate).toBe(true)
  })
})

describe('spend import', () => {
  const paste = {
    schema: 'lounge-spend-import/v1',
    card: { bank: 'AEON', name: 'AEON Member Plus Gold' },
    transactions: [
      { date: '15/10/2026', amount: 'RM 1,200.50', merchant: 'SHOP', type: 'retail', overseas: false },
      { date: '2026-10-16', amount: -50, merchant: 'REFUND' },
      { date: 'garbage', amount: 10, merchant: 'BAD' },
      { date: '2026-10-20', amount: 80, merchant: 'SAVED' },
    ],
  }
  const doc = docWith({ spends: [{ spend_id: 'x', card_id: 'c1', date: '2026-10-20', amount: 80 }] })

  test('coerces rows, flags duplicates and leaves out what it can’t read', () => {
    const r = parsePaste(JSON.stringify(paste), { doc })
    expect(r.kind).toBe('spends')
    expect(r.card_id).toBe('c1')
    expect(r.rows[0].spend).toMatchObject({ date: '2026-10-15', amount: 1200.5, type: 'retail' })
    expect(r.rows[1].spend.type).toBe('refund')
    expect(r.rows[2].include).toBe(false)
    expect(r.rows[3].duplicate).toBe(true)
    expect(r.rows[3].include).toBe(false)
  })

  test('commit adds only ticked rows', () => {
    const r = parsePaste(JSON.stringify(paste), { doc })
    const out = applySpendImport(doc, r, 'c1')
    expect(out.added).toBe(2)
    expect(out.doc.spends).toHaveLength(3)
    expect(out.doc.spends.at(-1).card_id).toBe('c1')
  })
})

describe('prompts', () => {
  test('rules prompt lists my cards and inserts T&C text', () => {
    const p = buildRulesPrompt([card], 'CLAUSE ONE')
    expect(p).toContain('- AEON Member Plus Gold')
    expect(p).toContain('CLAUSE ONE')
    expect(p).not.toContain('PASTE THE FULL')
  })
  test('without text it asks for it', () => {
    expect(buildRulesPrompt()).toContain('PASTE THE FULL')
    expect(buildSpendPrompt(card)).toContain('AEON Member Plus Gold')
  })
})
