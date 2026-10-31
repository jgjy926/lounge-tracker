import { describe, expect, test } from 'vitest'
import { STATUS, searchLounges, spendNote } from './engine'
import { applyLoungesImport, applyTripsImport, parsePaste, programmeChoices } from './importer'
import { allAttention, buildIcs, buildReminders, planTrips } from './trips'
import { buildLoungesPrompt, buildTripPrompt } from './prompts'
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

describe('importing lounges', () => {
  const paste = (lounges) => JSON.stringify({ schema: 'lounge-directory-import/v1', lounges })
  const raw = { name: 'Golden Lounge', networks: ['Priority Pass'], airport_code: 'kul', country: 'Malaysia', source_url: 'https://example.com/x', confidence: 'high' }

  test('arrives unverified, with the airport code tidied', () => {
    const p = parsePaste(paste([raw]), { doc: docWith(), today })
    expect(p.kind).toBe('lounges')
    expect(p.lounges[0].lounge).toMatchObject({ airport_code: 'KUL', verified: false, source_url: 'https://example.com/x' })
    expect(p.lounges[0].issues).toEqual([])
    expect(applyLoungesImport(docWith(), p).added).toBe(1)
  })

  test('gaps are flagged, and a non-web link is dropped', () => {
    const p = parsePaste(paste([{ name: 'X', source_url: 'javascript:alert(1)' }]), { doc: docWith(), today })
    expect(p.lounges[0].lounge.source_url).toBe('')
    expect(p.lounges[0].issues.map((i) => i.field)).toEqual(['source_url', 'networks', 'airport_code'])
  })

  test('already saved lounges start unticked', () => {
    const p = parsePaste(paste([{ name: 'Plaza Premium Lounge', airport_code: 'KUL', networks: ['Plaza Premium'], terminal: '' }]), { doc: docWith(), today })
    expect(p.lounges[0]).toMatchObject({ duplicate: true, include: false })
  })

  test('an empty answer explains itself', () => {
    expect(parsePaste(paste([]), { doc: docWith(), today }).kind).toBe('error')
  })

  test('a near-match programme is offered as the rule’s programme', () => {
    const rules = [rule('c1', { network: 'Plaza Premium Lounge Malaysia' })]
    const [choice] = programmeChoices([{ networks: ['Plaza Premium'] }], rules)
    expect(choice.mapTo).toBe('Plaza Premium Lounge Malaysia')
    const p = { lounges: [{ include: true, lounge: lounge({ networks: ['Plaza Premium'] }) }], programmes: [choice] }
    expect(applyLoungesImport(docWith(), p).doc.lounges.at(-1).networks).toEqual(['Plaza Premium Lounge Malaysia'])
  })

  test('a programme that already matches needs no choice', () => {
    expect(programmeChoices([{ networks: ['Plaza Premium Lounge'] }], [rule('c1')])).toEqual([])
  })

  test('a rule with no matching lounge gets a warning', () => {
    const p = parsePaste(JSON.stringify({ rules: [{ card: { bank: 'AEON', name: 'Gold c1' }, network: 'DragonPass', quota: {} }] }), { doc: docWith(), today })
    expect(p.drafts[0].issues.some((i) => /No saved lounge lists DragonPass/.test(i.message))).toBe(true)
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
  test('the lounge prompt carries the target and my programmes', () => {
    const text = buildLoungesPrompt('KUL', ['Plaza Premium'])
    expect(text).toContain('Find the lounges for: KUL')
    expect(text).toContain('Plaza Premium')
    expect(text).toContain('lounge-directory-import/v1')
  })
  test('the trip prompt asks for no personal details', () => {
    expect(buildTripPrompt()).toMatch(/Leave out names, booking references/)
  })
})
