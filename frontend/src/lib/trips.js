// Upcoming flights: which card to use, what spend is left, and when to do it.
// Pure functions over the document, so every date here is covered by tests.
//
// Trips are planned in date order, and each one's chosen card counts as a visit
// for the trips after it, so two trips can't both rely on the last visit left.
import { addDays, diffDays, formatDate } from './dates'
import { STATUS, attentionItems, evaluateCard, money, rankStatus, spendWindows } from './engine'
import { cardLabel } from './schema'

const sameCode = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

const better = (a, b) =>
  rankStatus(a.status) - rankStatus(b.status) ||
  (a.spend?.shortfall ?? 0) - (b.spend?.shortfall ?? 0) ||
  (b.quota?.left ?? 0) - (a.quota?.left ?? 0) ||
  cardLabel(a.card).localeCompare(cardLabel(b.card))

// When to spend. opensOn: earlier spend won't count. safeBy: the last day that
// settles it before the flight. lastDay: the last day the T&C allows at all.
export function spendPlan(result, today) {
  const { spend, rule, date } = result
  if (!spend || spend.met || !rule) return null
  const windows = spendWindows(rule.condition, date, true)
  if (!windows) return null
  const opensOn = windows.map((w) => w.start).sort()[0]
  const beforeFlight = addDays(date, -1)
  const safe = windows
    .map((w) => ({ start: w.start, day: w.end < beforeFlight ? w.end : beforeFlight }))
    .filter((w) => w.day >= w.start && w.day >= today)
    .map((w) => w.day)
    .sort()
    .at(-1)
  return {
    opensOn,
    opensLater: opensOn > today,
    safeBy: safe || null,
    lastDay: spend.deadline,
    shortfall: spend.shortfall,
    unit: spend.unit,
    penalty: rule.penalty || null,
  }
}

export const shortfallLabel = (plan) =>
  plan.unit === 'txn'
    ? `${plan.shortfall} more transaction${plan.shortfall === 1 ? '' : 's'}`
    : `${money(plan.shortfall)} more`

export function loungesForTrip(doc, trip) {
  const chosen = doc.lounges.find((l) => l.lounge_id === trip.lounge_id)
  if (chosen) return [chosen]
  return doc.lounges.filter((l) => sameCode(l.airport_code, trip.airport_code))
}

export function planTrip(doc, trip, today) {
  const lounges = loungesForTrip(doc, trip)
  const cards = doc.cards.filter((c) => (trip.card_id ? c.card_id === trip.card_id : c.status !== 'closed'))
  const ctx = { date: trip.date, today, holder: trip.holder, flight: trip.flight }
  const options = cards
    .map((card) => lounges.map((lounge) => evaluateCard(doc, card.card_id, { ...ctx, lounge })).sort(better)[0])
    .filter(Boolean)
    .sort(better)
  const best = options[0]?.status && options[0].status !== STATUS.NOT_COVERED ? options[0] : null
  return { trip, lounges, options, best, plan: best ? spendPlan(best, today) : null }
}

export const upcomingTrips = (doc, today) =>
  (doc.trips || [])
    .filter((t) => !t.visit_id && t.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

export function planTrips(doc, today) {
  const planned = []
  return upcomingTrips(doc, today).map((trip) => {
    const plan = planTrip({ ...doc, visits: [...doc.visits, ...planned] }, trip, today)
    const b = plan.best
    if (b?.rule && b.status !== STATUS.NOT_ELIGIBLE) {
      planned.push({
        visit_id: `planned_${trip.trip_id}`,
        card_id: b.card.card_id,
        lounge_id: b.lounge?.lounge_id || '',
        rule_group: b.rule.group,
        date: trip.date,
        holder: trip.holder,
        flight: trip.flight,
        guests: 0,
        charged: false,
      })
    }
    return plan
  })
}

const tripName = (trip) => trip.name || `${trip.airport_code} flight`

// One entry per reminder, for phone notifications and the calendar file. A trip
// whose requirement is met has none, so its reminders stop by themselves.
export function buildReminders(doc, today) {
  const out = []
  for (const { trip, best, plan } of planTrips(doc, today)) {
    if (best?.status !== STATUS.NEEDS_SPEND || !plan) continue
    const card = cardLabel(best.card)
    const add = (kind, date, title, body) => {
      if (date >= today) out.push({ key: `${trip.trip_id}|${kind}`, kind, trip_id: trip.trip_id, date, title, body })
    }
    const target = plan.safeBy || plan.lastDay
    const need = shortfallLabel(plan)
    if (plan.opensLater) {
      add('opens', plan.opensOn, `Start spending for ${tripName(trip)}`, `${card}: spend from today counts. ${need} needed by ${formatDate(target)}.`)
    }
    add('week', addDays(target, -7), `A week left to spend for ${tripName(trip)}`, `${card}: ${need} by ${formatDate(target)}.`)
    add('day', addDays(target, -1), `Spend by tomorrow for ${tripName(trip)}`, `${card}: ${need} by ${formatDate(target)}.`)
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}

// Trip items for the home screen's attention list.
export function tripAttention(doc, today) {
  const items = []
  for (const { trip, best, plan, lounges } of planTrips(doc, today)) {
    const when = `${tripName(trip)}, ${formatDate(trip.date)}`
    const daysAway = diffDays(trip.date, today)
    if (best?.status === STATUS.NEEDS_SPEND && plan) {
      const target = plan.safeBy || plan.lastDay
      items.push({
        kind: 'trip_spend',
        severity: diffDays(target, today) <= 7 && !plan.opensLater ? 'high' : 'medium',
        sort: target,
        title: `${shortfallLabel(plan)} by ${formatDate(target)}`,
        detail: `${cardLabel(best.card)}, ${when}`,
        target: 'trips',
      })
    } else if (!lounges.length) {
      items.push({ kind: 'trip_lounge', severity: 'medium', sort: trip.date, title: `No lounges saved at ${trip.airport_code}`, detail: when, target: 'trips' })
    } else if (daysAway <= 30 && (!best || best.status === STATUS.NOT_ELIGIBLE)) {
      items.push({ kind: 'trip_none', severity: daysAway <= 7 ? 'high' : 'medium', sort: trip.date, title: 'No card gets you in', detail: when, target: 'trips' })
    }
  }
  return items
}

export function allAttention(doc, today) {
  const rank = { high: 0, medium: 1 }
  return [...attentionItems(doc, today), ...tripAttention(doc, today)].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.sort < b.sort ? -1 : 1),
  )
}

// A calendar file for devices that can't get phone notifications. All-day events
// with an alert at 9am on the day.
export function buildIcs(reminders, stamp) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const day = (iso) => iso.replace(/-/g, '')
  const fold = (line) => line.replace(/(.{74})(?=.)/g, '$1\r\n ')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lounge Tracker//EN', 'CALSCALE:GREGORIAN']
  for (const r of reminders) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.key.replace(/\|/g, '-')}@lounge-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(r.date)}`,
      `DTEND;VALUE=DATE:${day(addDays(r.date, 1))}`,
      `SUMMARY:${esc(r.title)}`,
      `DESCRIPTION:${esc(r.body)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(r.title)}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
