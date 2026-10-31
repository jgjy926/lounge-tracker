import { describe, expect, test } from 'vitest'
import { STATUS, coverage, loungesForCard, searchLounges, spendNote } from './engine'
import { applyLoungesImport, applyRulesImport, applyTripsImport, missingFromImport, parsePaste } from './importer'
import { allAttention, buildIcs, buildReminders, planTrips } from './trips'
import { buildLoungesPrompt, buildRulesPrompt, buildTripPrompt } from './prompts'
import { defaultDocument, emptyLounge, emptyTrip, normalizeDoc, normalizeRule, ruleGroup, sameProgramme } from './schema'

const today = '2026-11-01'
const card = (id, bank = 'AEON') => ({ card_id: id, bank, name: `Gold ${id}`, status: 'active', anniversary: '', last4: '' })
const lounge = (over = {}) => ({ ...emptyLounge(), lounge_id: 'kul1', name: 'Plaza Premium Lounge', airport_code: 'KUL', airport_name: 'Kuala Lumpur International', country: 'Malaysia', networks: ['Plaza Premium'], ...over })
const rule = (cardId, over = {}) => {
  const base = {
    rule_id: `r_${cardId}`,
    card_id: cardId,
    title: 'Plaza Premium',
    network: 'Plaza Premium',
    countries: ['worldwide'],
    flight_scope: 'any',
    last_verified: today,
    quota: { principal: 2, supplementary: 0, unlimited: false, period: 'calendar_year', per_day_limit: null },
    condition: {
      type: 'min_spend', amount: 500, window: 'before_or_after', days_before: 30, days_after: 30, sides_combine: true,
      cumulative: true, boundary_inclusive: true, visit_day_counts: true, same_spend_reusable: true, spend_holder: 'principal_only', overseas_only: false, excluded_spend_types: ['ewallet'],
    },
    penalty: { amount: 134, note: 'RM134 charged' },
    ...over,
  }
  return normalizeRule({ ...base, group: ruleGroup(cardId, base.network) })
}
const trip = (over = {}) => ({ ...emptyTrip(), trip_id: 't1', name: 'Tokyo', date: '2027-03-12', airport_code: 'KUL', flight: 'international', ...over })
const spend = (cardId, date, amount, over = {}) => ({ spend_id: `${cardId}${date}${amount}`, card_id: cardId, date, amount, merchant: '', type: 'retail', holder: 'principal', overseas: false, ...over })
const docWith = (over = {}) => ({ ...defaultDocument(), cards: [card('c1')], lounges: [lounge()], rules: [rule('c1')], ...over })

describe('programme names', () => {
  test('wording differences still match', () => {
    expect(sameProgramme('Plaza Premium Lounge', 'plaza premium')).toBe(true)
    expect(sameProgramme('PriorityPass', 'Priority Pass')).toBe(true)
    expect(sameProgramme('Plaza Premium', 'Priority Pass')).toBe(false)
    expect(sameProgramme('Lounge', 'Lounges')).toBe(false)
  })

  test('a differently worded lounge is covered, and keeps the same rule group', () => {
    const doc = docWith({ lounges: [lounge({ networks: ['Plaza Premium Lounges'] })] })
    expect(planTrips(doc, today)).toEqual([])
    const [p] = planTrips({ ...doc, trips: [trip()] }, today)
    expect(p.best.status).toBe(STATUS.NEEDS_SPEND)
    expect(ruleGroup('c1', 'Plaza Premium Lounge')).toBe(ruleGroup('c1', 'Plaza Premium'))
    expect(ruleGroup('c1', 'Plaza Premium')).toBe('c1:plaza-premium')
  })
})

describe('lounge search', () => {
  const lounges = [
    lounge(),
    lounge({ lounge_id: 'sin', name: 'SATS Premier', airport_code: 'SIN', airport_name: 'Changi', country: 'Singapore', networks: ['Priority Pass'] }),
    lounge({ lounge_id: 'pen', name: 'Plaza Premium Lounge', airport_code: 'PEN', airport_name: 'Penang', networks: ['Plaza Premium'] }),
  ]
  const ids = (q) => searchLounges(lounges, q).map((l) => l.lounge_id)

  test('finds by name, code, airport, country and programme', () => {
    expect(ids('kul')).toEqual(['kul1'])
    expect(ids('changi')).toEqual(['sin'])
    expect(ids('singapore')).toEqual(['sin'])
    expect(ids('priority pass')).toEqual(['sin'])
    expect(ids('plaza')).toHaveLength(2)
  })

  test('every word must match, and common airport names work', () => {
    expect(ids('plaza penang')).toEqual(['pen'])
    expect(ids('klia')).toEqual(['kul1'])
    expect(ids('nothing here')).toEqual([])
    expect(ids('  ')).toEqual([])
  })

  test('an exact airport code comes first', () => {
    const list = [lounge({ lounge_id: 'a', name: 'Kulim lounge', airport_code: 'XXX' }), lounge({ lounge_id: 'b', name: 'Zed', airport_code: 'KUL' })]
    expect(searchLounges(list, 'kul').map((l) => l.lounge_id)).toEqual(['b', 'a'])
  })
})

describe('planning a trip', () => {
  test('what is left, and when to do it', () => {
    const doc = docWith({ trips: [trip()], spends: [spend('c1', '2027-02-20', 320)] })
    const [p] = planTrips(doc, today)
    expect(p.best.status).toBe(STATUS.NEEDS_SPEND)
    expect(p.plan).toMatchObject({ opensOn: '2027-02-10', opensLater: true, safeBy: '2027-03-11', lastDay: '2027-04-11', shortfall: 180 })
  })

  test('spending before the window opens is not counted', () => {
    const doc = docWith({ trips: [trip()], spends: [spend('c1', '2027-02-09', 500)] })
    expect(planTrips(doc, today)[0].plan.shortfall).toBe(500)
  })

  test('once the requirement is met there is no plan and no reminder', () => {
    const doc = docWith({ trips: [trip()], spends: [spend('c1', '2027-03-01', 500)] })
    const [p] = planTrips(doc, today)
    expect(p.best.status).toBe(STATUS.ELIGIBLE)
    expect(p.plan).toBeNull()
    expect(buildReminders(doc, today)).toEqual([])
  })

  test('a window that ends before the flight sets the safe date, and one after it has none', () => {
    const c = rule('c1').condition
    const month = docWith({ rules: [rule('c1', { condition: { ...c, window: 'previous_calendar_month' } })], trips: [trip()] })
    expect(planTrips(month, today)[0].plan).toMatchObject({ safeBy: '2027-02-28', lastDay: '2027-02-28' })
    const after = docWith({ rules: [rule('c1', { condition: { ...c, window: 'after' } })], trips: [trip()] })
    expect(planTrips(after, today)[0].plan).toMatchObject({ opensOn: '2027-03-12', safeBy: null, lastDay: '2027-04-11' })
  })

  test('after the flight, only the last day remains', () => {
    const doc = docWith({ trips: [trip({ date: '2026-11-01' })] })
    const [p] = planTrips(doc, '2026-11-01')
    expect(p.plan.safeBy).toBeNull()
    expect(p.plan.lastDay).toBe('2026-12-01')
  })

  test('picks the card closest to qualifying', () => {
    const doc = docWith({
      cards: [card('c1'), card('c2', 'AmBank')],
      rules: [rule('c1'), rule('c2')],
      trips: [trip()],
      spends: [spend('c2', '2027-03-01', 400)],
    })
    const [p] = planTrips(doc, today)
    expect(p.best.card.card_id).toBe('c2')
    expect(p.options).toHaveLength(2)
  })

  test('a chosen card is respected', () => {
    const doc = docWith({
      cards: [card('c1'), card('c2', 'AmBank')],
      rules: [rule('c1'), rule('c2')],
      trips: [trip({ card_id: 'c1' })],
      spends: [spend('c2', '2027-03-01', 500)],
    })
    expect(planTrips(doc, today)[0].best.card.card_id).toBe('c1')
  })

  test('two trips cannot both rely on the last visit', () => {
    const r = rule('c1', { quota: { principal: 1, supplementary: 0, unlimited: false, period: 'calendar_year', per_day_limit: null }, condition: { ...rule('c1').condition, type: 'none' } })
    const doc = docWith({ rules: [r], trips: [trip({ trip_id: 'a', date: '2027-03-12' }), trip({ trip_id: 'b', date: '2027-05-12' })] })
    const [first, second] = planTrips(doc, today)
    expect(first.best.status).toBe(STATUS.ELIGIBLE)
    expect(second.best.status).toBe(STATUS.NOT_ELIGIBLE)
    expect(doc.visits).toEqual([])
  })

  test('a new year gives the later trip its own quota', () => {
    const r = rule('c1', { quota: { principal: 1, supplementary: 0, unlimited: false, period: 'calendar_year', per_day_limit: null }, condition: { ...rule('c1').condition, type: 'none' } })
    const doc = docWith({ rules: [r], trips: [trip({ trip_id: 'a', date: '2026-12-12' }), trip({ trip_id: 'b', date: '2027-01-12' })] })
    expect(planTrips(doc, today).map((p) => p.best.status)).toEqual([STATUS.ELIGIBLE, STATUS.ELIGIBLE])
  })

  test('no lounges at the airport says so instead of guessing', () => {
    const doc = docWith({ trips: [trip({ airport_code: 'NRT' })] })
    const [p] = planTrips(doc, today)
    expect(p.lounges).toEqual([])
    expect(p.best).toBeNull()
    expect(allAttention(doc, today)[0].kind).toBe('trip_lounge')
  })

  test('a rule ending before the trip is not relied on', () => {
    const doc = docWith({ rules: [rule('c1', { effective_to: '2027-01-01' })], trips: [trip()] })
    const [p] = planTrips(doc, today)
    expect(p.best).toBeNull()
    expect(p.options[0].headline).toMatch(/ended/)
  })

  test('past and already logged trips are left out', () => {
    const doc = docWith({ trips: [trip({ trip_id: 'old', date: '2026-10-01' }), trip({ trip_id: 'done', visit_id: 'v1' })] })
    expect(planTrips(doc, today)).toEqual([])
  })

  test('old documents gain a trip list', () => {
    expect(normalizeDoc({ cards: [] }).trips).toEqual([])
  })
})

describe('reminders', () => {
  test('window opening, a week before and a day before', () => {
    const doc = docWith({ trips: [trip()], spends: [spend('c1', '2027-02-20', 320)] })
    expect(buildReminders(doc, today).map((r) => [r.kind, r.date])).toEqual([
      ['opens', '2027-02-10'],
      ['week', '2027-03-04'],
      ['day', '2027-03-10'],
    ])
  })

  test('dates already gone are dropped, and the last day is used after the flight', () => {
    const doc = docWith({ trips: [trip({ date: '2026-11-01' })] })
    expect(buildReminders(doc, '2026-11-01').map((r) => [r.kind, r.date])).toEqual([
      ['week', '2026-11-24'],
      ['day', '2026-11-30'],
    ])
  })

  test('attention gets urgent inside a week of the deadline', () => {
    const doc = docWith({ trips: [trip()] })
    expect(allAttention(doc, today)[0]).toMatchObject({ kind: 'trip_spend', severity: 'medium' })
    expect(allAttention(doc, '2027-03-08')[0]).toMatchObject({ kind: 'trip_spend', severity: 'high' })
  })

  test('calendar file', () => {
    const ics = buildIcs([{ key: 't1|day', date: '2027-03-10', title: 'Spend, by tomorrow', body: 'RM180; AEON' }], '20261101T000000Z')
    expect(ics).toContain('DTSTART;VALUE=DATE:20270310')
    expect(ics).toContain('DTEND;VALUE=DATE:20270311')
    expect(ics).toContain('SUMMARY:Spend\\, by tomorrow')
    expect(ics).toContain('UID:t1-day@lounge-tracker')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})

describe('spend that will not count', () => {
  const doc = docWith()
  test('excluded type, supplementary spend, and normal spend', () => {
    expect(spendNote(doc, spend('c1', today, 50, { type: 'ewallet' }), today)).toMatch(/e-wallet/i)
    expect(spendNote(doc, spend('c1', today, 50, { holder: 'supplementary' }), today)).toMatch(/supplementary/)
    expect(spendNote(doc, spend('c1', today, 50), today)).toBeNull()
  })
  test('a card with no spend condition has nothing to say', () => {
    const none = docWith({ rules: [rule('c1', { condition: { ...rule('c1').condition, type: 'none' } })] })
    expect(spendNote(none, spend('c1', today, 50, { type: 'ewallet' }), today)).toBeNull()
  })
})

describe('lounges from a bank T&C', () => {
  const paste = (lounges, over = {}) => JSON.stringify({ schema: 'lounge-directory-import/v1', card: { bank: 'AEON', name: 'Gold c1' }, lounge_coverage: 'listed_only', lounges, ...over })
  const raw = { name: 'Golden Lounge', airport_code: 'kul', country: 'Malaysia', terminal: 'T1', _source: 'Golden Lounge, KLIA T1' }
  const read = (doc, text) => parsePaste(text, { doc, today })

  test('the prompt reads the document and never the web', () => {
    const text = buildLoungesPrompt({ bank: 'AEON', name: 'Gold' }, 'THE T&C TEXT')
    expect(text).toContain('Use this document only')
    expect(text).toContain('Don’t search the web'.replace('’', "'"))
    expect(text).toContain('AEON Gold')
    expect(text).toContain('THE T&C TEXT')
    expect(buildRulesPrompt()).toContain('come from this document only')
    expect(text).not.toMatch(/source_url/)
  })

  test('finds the card and its rule, and attaches the lounges to that rule', () => {
    const doc = docWith({ lounges: [] })
    const p = read(doc, paste([raw]))
    expect(p).toMatchObject({ kind: 'lounges', card_id: 'c1', rule_id: 'r_c1', scope: 'specific' })
    const { doc: next, added, linked } = applyLoungesImport(doc, p)
    expect([added, linked]).toEqual([1, 1])
    const lounge = next.lounges[0]
    expect(next.rules[0].lounge_ids).toEqual([lounge.lounge_id])
    expect(next.rules[0].lounge_scope).toBe('specific')
    expect(lounge.networks).toEqual(['Plaza Premium'])
    expect(lounge.verified).toBe(true)
  })

  test('each card has its own list, and one lounge can be on several', () => {
    const doc = docWith({ cards: [card('c1'), card('c2', 'AmBank')], rules: [rule('c1'), rule('c2')], lounges: [] })
    const first = applyLoungesImport(doc, read(doc, paste([raw]))).doc
    const p = read(first, paste([raw, { ...raw, name: 'Sama-Sama', _source: 'Sama-Sama' }], { card: { bank: 'AmBank', name: 'Gold c2' } }))
    expect(p.lounges[0].existing_id).toBe(first.lounges[0].lounge_id)
    const second = applyLoungesImport(first, p).doc
    expect(second.lounges).toHaveLength(2)
    expect(loungesForCard(second, 'c1', today).map((l) => l.name)).toEqual(['Golden Lounge'])
    expect(loungesForCard(second, 'c2', today).map((l) => l.name)).toEqual(['Golden Lounge', 'Sama-Sama'])
  })

  test('a listed-only card does not cover other lounges in the same programme', () => {
    const doc = docWith({ lounges: [lounge()] })
    const next = applyLoungesImport(doc, read(doc, paste([raw]))).doc
    const r = next.rules[0]
    expect(coverage(r, next.lounges.find((l) => l.name === 'Golden Lounge'), today)).toBeNull()
    expect(coverage(r, lounge(), today)).toMatch(/isn’t on this card’s lounge list/)
  })

  test('one bank’s list doesn’t put a lounge in reach of another bank’s programme', () => {
    const doc = docWith({ cards: [card('c1'), card('c2', 'AmBank')], rules: [rule('c1'), rule('c2', { network: 'Priority Pass', title: 'PP' })], lounges: [lounge()] })
    const shared = { name: 'Plaza Premium Lounge', airport_code: 'KUL', _source: 'x' }
    const listed = applyLoungesImport(doc, read(doc, paste([shared], { card: { bank: 'AmBank', name: 'Gold c2' } }))).doc
    expect(listed.lounges[0].networks).toEqual(['Plaza Premium'])
    expect(loungesForCard(listed, 'c2', today)).toHaveLength(1)
    const wide = applyLoungesImport(doc, read(doc, paste([shared], { card: { bank: 'AmBank', name: 'Gold c2' }, lounge_coverage: 'whole_programme' }))).doc
    expect(wide.lounges[0].networks).toEqual(['Plaza Premium', 'Priority Pass'])
  })

  test('a whole-programme T&C still covers other lounges in the programme', () => {
    const doc = docWith({ lounges: [lounge()] })
    const next = applyLoungesImport(doc, read(doc, paste([raw], { lounge_coverage: 'whole_programme' }))).doc
    expect(next.rules[0].lounge_scope).toBe('network')
    expect(loungesForCard(next, 'c1', today)).toHaveLength(2)
  })

  test('a lounge the document drops can be removed from the list', () => {
    const doc = docWith({ lounges: [] })
    const first = applyLoungesImport(doc, read(doc, paste([raw, { ...raw, name: 'Old Lounge' }]))).doc
    const p = read(first, paste([raw]))
    expect(missingFromImport(first, p).map((l) => l.name)).toEqual(['Old Lounge'])
    expect(applyLoungesImport(first, p).doc.rules[0].lounge_ids).toHaveLength(2)
    expect(applyLoungesImport(first, { ...p, remove_missing: true }).doc.rules[0].lounge_ids).toHaveLength(1)
  })

  test('gaps are flagged, repeats collapse, and an empty list explains itself', () => {
    const doc = docWith({ lounges: [] })
    const p = read(doc, paste([{ name: 'X' }, { name: 'X' }]))
    expect(p.lounges).toHaveLength(1)
    expect(p.lounges[0].issues.map((i) => i.field)).toEqual(['airport_code', '_source'])
    expect(read(doc, paste([])).kind).toBe('error')
    expect(read(doc, paste([])).error).toMatch(/names no lounges/)
  })

  test('a card with no rule has nothing to attach to', () => {
    const doc = docWith({ rules: [], lounges: [] })
    const p = read(doc, paste([raw]))
    expect(p.rule_id).toBe('')
    expect(applyLoungesImport(doc, p).doc).toBe(doc)
  })

  describe('inside the T&C import', () => {
    const tnc = (over = {}) => JSON.stringify({ rules: [{ card: { bank: 'AEON', name: 'Gold c1' }, network: 'Plaza Premium', quota: {}, lounge_coverage: 'listed_only', lounges: [raw], ...over }] })
    const opts = { today, newCard: (c) => ({ ...card('new'), ...c }) }

    test('lounges named for a card go on that card’s rule', () => {
      const doc = docWith({ rules: [], lounges: [] })
      const { doc: next, loungesAdded } = applyRulesImport(doc, parsePaste(tnc(), { doc, today }), opts)
      expect(loungesAdded).toBe(1)
      expect(next.rules[0]).toMatchObject({ lounge_scope: 'specific', lounge_ids: [next.lounges[0].lounge_id] })
      expect(loungesForCard(next, 'c1', today)).toHaveLength(1)
    })

    test('an already saved lounge is linked, not repeated', () => {
      const doc = docWith({ rules: [], lounges: [lounge({ name: 'Golden Lounge', terminal: 'T1' })] })
      const { doc: next } = applyRulesImport(doc, parsePaste(tnc(), { doc, today }), opts)
      expect(next.lounges).toHaveLength(1)
      expect(next.rules[0].lounge_ids).toEqual(['kul1'])
    })

    test('a new T&C naming no lounges keeps the card’s list', () => {
      const doc = docWith({ rules: [], lounges: [] })
      const first = applyRulesImport(doc, parsePaste(tnc(), { doc, today }), opts).doc
      const again = parsePaste(tnc({ lounges: [], lounge_coverage: null, effective_from: '2027-01-01' }), { doc: first, today })
      const next = applyRulesImport(first, again, opts).doc
      const live = next.rules.find((r) => !r.effective_to)
      expect(live.lounge_scope).toBe('specific')
      expect(live.lounge_ids).toEqual(first.rules[0].lounge_ids)
    })

    test('a saved T&C is tied to the card it was imported for', () => {
      const doc = docWith({ rules: [], lounges: [], documents: [{ doc_id: 'd1', title: 'AEON T&C', card_ids: [], text: 'x' }] })
      const { doc: next } = applyRulesImport(doc, parsePaste(tnc(), { doc, today }), { ...opts, documentId: 'd1' })
      expect(next.documents[0].card_ids).toEqual(['c1'])
      expect(next.rules[0].document_id).toBe('d1')
    })

    test('a T&C naming no lounges says what to do next', () => {
      const doc = docWith({ rules: [], lounges: [] })
      const p = parsePaste(tnc({ lounges: [], lounge_coverage: 'whole_programme' }), { doc, today })
      expect(p.drafts[0].issues.some((i) => /names no lounges/.test(i.message))).toBe(true)
      const limited = parsePaste(tnc({ lounges: [] }), { doc, today })
      expect(limited.drafts[0].issues.some((i) => /none are listed/.test(i.message))).toBe(true)
    })
  })
})

describe('importing trips', () => {
  const paste = (trips) => JSON.stringify({ schema: 'lounge-trip-import/v1', trips })

  test('outbound and return become two trips', () => {
    const p = parsePaste(paste([
      { name: 'Tokyo', date: '12/03/2027', airport_code: 'kul', flight_number: 'mh88', flight_type: 'international' },
      { name: 'Tokyo return', date: '2027-03-20', airport_code: 'NRT', flight_type: 'international' },
    ]), { doc: docWith(), today })
    expect(p.kind).toBe('trips')
    expect(p.rows[0].trip).toMatchObject({ date: '2027-03-12', airport_code: 'KUL', flight_number: 'MH88', flight: 'international' })
    expect(applyTripsImport(docWith(), p).doc.trips).toHaveLength(2)
  })

  test('unusable rows and repeats start unticked', () => {
    const doc = docWith({ trips: [trip()] })
    const p = parsePaste(paste([{ date: 'soon', airport_code: 'KUL' }, { date: '2027-03-12', airport_code: 'KUL' }]), { doc, today })
    expect(p.rows.map((r) => r.include)).toEqual([false, false])
    expect(p.rows[1].duplicate).toBe(true)
  })

  test('an unknown flight type stays unknown', () => {
    const p = parsePaste(paste([{ date: '2027-03-12', airport_code: 'KUL', flight_type: null }]), { doc: docWith(), today })
    expect(p.rows[0].trip.flight).toBe('unknown')
  })
})

describe('prompts', () => {
  test('the trip prompt asks for no personal details', () => {
    expect(buildTripPrompt()).toMatch(/Leave out names, booking references/)
  })
})
