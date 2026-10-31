// The eligibility engine: pure functions over the document. Every number the app
// shows about access comes from here, never from an AI.
//
// Where a T&C is silent (a null rule field) the condition is worked out twice:
// a strict reading and a generous one. Met on strict = eligible. Met only on the
// generous reading = unclear, because the answer depends on wording the T&C
// does not settle.
import {
  addDays,
  calendarMonth,
  calendarQuarter,
  calendarYear,
  cardYear,
  diffDays,
  formatDate,
  formatRange,
} from './dates'
import { DAY_WINDOWS, SPEND_TYPE_LABEL, cardLabel, sameProgramme } from './schema'

export const STALE_AFTER_DAYS = 180

export const STATUS = {
  ELIGIBLE: 'eligible',
  NEEDS_SPEND: 'needs_spend',
  UNCLEAR: 'unclear',
  NOT_ELIGIBLE: 'not_eligible',
  NOT_COVERED: 'not_covered',
}

const RANK = { eligible: 0, needs_spend: 1, unclear: 2, not_eligible: 3, not_covered: 4 }
export const rankStatus = (s) => RANK[s] ?? 9

export const money = (n) =>
  `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// ---------- spend windows ----------

// Returns the date ranges that can satisfy the condition, or null if the rule
// doesn't state enough to build them.
export function spendWindows(condition, date, strict) {
  const c = condition
  const inclusive = c.boundary_inclusive ?? !strict
  const visitDay = c.visit_day_counts ?? !strict
  const combine = c.sides_combine ?? !strict
  const edge = inclusive ? 0 : 1

  if (DAY_WINDOWS.includes(c.window)) {
    const needBefore = c.window !== 'after'
    const needAfter = c.window !== 'before'
    if ((needBefore && c.days_before == null) || (needAfter && c.days_after == null)) return null

    const before = needBefore && {
      start: addDays(date, -c.days_before + edge),
      end: visitDay ? date : addDays(date, -1),
    }
    const after = needAfter && {
      start: visitDay ? date : addDays(date, 1),
      end: addDays(date, c.days_after - edge),
    }
    if (before && after) {
      if (combine) return [{ start: before.start, end: after.end, skip: visitDay ? null : date }]
      return [before, after]
    }
    return [before || after]
  }
  if (c.window === 'same_calendar_month') return [calendarMonth(date)]
  if (c.window === 'previous_calendar_month') return [calendarMonth(date, -1)]
  if (c.window === 'previous_calendar_quarter') return [calendarQuarter(date, -1)]
  if (c.window === 'calendar_year') return [{ start: calendarYear(date).start, end: date }]
  return null
}

const inWindow = (w, d) => d >= w.start && d <= w.end && d !== w.skip

// Spends the rule accepts for this cardholder, as a pool that earlier visits
// can draw down when a spend can't be reused.
function qualifyingSpends(doc, rule, holder, strict) {
  const c = rule.condition
  const who = c.spend_holder ?? (strict ? 'same_holder' : 'any')
  const excluded = c.excluded_spend_types || []
  return doc.spends
    .filter((s) => s.card_id === rule.card_id)
    .filter((s) => !excluded.includes(s.type))
    .filter((s) => (who === 'any' ? true : who === 'principal_only' ? s.holder === 'principal' : s.holder === holder))
    .filter((s) => !c.overseas_only || s.overseas)
    .map((s) => ({ ...s, left: Number(s.amount) || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function measure(condition, spends, windows, strict) {
  const isTxn = condition.type === 'min_txn'
  const cumulative = condition.cumulative ?? !strict
  const need = isTxn ? condition.count : condition.amount
  return windows.map((w) => {
    const hits = spends.filter((s) => inWindow(w, s.date) && (isTxn ? s.left > 0 : s.left !== 0))
    const have = isTxn
      ? hits.length
      : cumulative
        ? hits.reduce((sum, s) => sum + s.left, 0)
        : Math.max(0, ...hits.map((s) => s.left))
    return { window: w, have: Math.round(have * 100) / 100, need, hits, met: have >= need }
  })
}

// An earlier visit uses up what it needed, earliest spends first.
function drawDown(condition, measured) {
  const hit = measured.find((m) => m.met)
  if (!hit) return
  let need = condition.type === 'min_txn' ? condition.count : condition.amount
  for (const s of hit.hits) {
    if (need <= 0 || s.left <= 0) continue
    const used = condition.type === 'min_txn' ? 1 : Math.min(s.left, need)
    s.left = condition.type === 'min_txn' ? 0 : s.left - used
    need -= used
  }
}

function assessCondition(doc, rule, { date, holder, excludeVisitId }, strict) {
  const c = rule.condition
  const windows = spendWindows(c, date, strict)
  if (!windows) return null
  const spends = qualifyingSpends(doc, rule, holder, strict)

  const reusable = c.same_spend_reusable ?? !strict
  if (!reusable) {
    const earlier = doc.visits
      .filter((v) => v.rule_group === rule.group && v.holder === holder && !v.charged)
      .filter((v) => v.visit_id !== excludeVisitId && v.date < date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    for (const v of earlier) {
      const w = spendWindows(c, v.date, strict)
      if (w) drawDown(c, measure(c, spends, w, strict))
    }
  }

  const measured = measure(c, spends, windows, strict)
  return measured.reduce((best, m) => (m.have > best.have ? m : best), measured[0])
}

const conditionLabel = (c) => {
  const what = c.type === 'min_txn'
    ? `${c.count} ${c.overseas_only ? 'overseas ' : ''}transaction${c.count === 1 ? '' : 's'}`
    : `${money(c.amount)}${c.overseas_only ? ' overseas' : ''} spend`
  return what
}

const isConditionComplete = (c) => {
  if (c.type === 'none') return true
  if (c.type === 'min_spend') return c.amount != null && c.window != null
  if (c.type === 'min_txn') return c.count != null && c.window != null
  return false
}

// ---------- quota ----------

export function quotaPeriod(rule, card, date) {
  switch (rule.quota.period) {
    case 'calendar_year':
      return calendarYear(date)
    case 'calendar_month':
      return calendarMonth(date)
    case 'calendar_quarter':
      return calendarQuarter(date)
    case 'card_year':
      return /^\d{2}-\d{2}$/.test(card?.anniversary || '') ? cardYear(date, card.anniversary) : null
    case 'lifetime':
      return { start: '0000-01-01', end: '9999-12-31' }
    default:
      return null
  }
}

export function assessQuota(doc, rule, card, { date, holder, guests = 0, excludeVisitId }) {
  const q = rule.quota
  const total = q.unlimited ? Infinity : holder === 'supplementary' ? q.supplementary : q.principal
  const taken = doc.visits.filter(
    (v) => v.rule_group === rule.group && v.holder === holder && !v.charged && v.visit_id !== excludeVisitId,
  )
  const entries = (v) => 1 + (rule.guest.consumes_quota ? Number(v.guests) || 0 : 0)
  const sameDay = taken.filter((v) => v.date === date).length
  const needed = 1 + (rule.guest.consumes_quota ? Number(guests) || 0 : 0)

  if (q.unlimited) {
    return { known: true, total, used: taken.reduce((n, v) => n + entries(v), 0), left: Infinity, needed, sameDay }
  }
  if (total == null) return { known: false, needed, sameDay }
  const period = quotaPeriod(rule, card, date)
  if (!period) return { known: false, needed, sameDay, total }
  const used = taken
    .filter((v) => v.date >= period.start && v.date <= period.end)
    .reduce((n, v) => n + entries(v), 0)
  return { known: true, total, used, left: Math.max(0, total - used), needed, sameDay, period }
}

// ---------- one rule ----------

const check = (state, label, detail, clause) => ({ state, label, detail, clause: clause || null })

// A rule that doesn't cover this date or lounge returns not_covered with the reason.
export function coverage(rule, lounge, date) {
  if (rule.effective_from && date < rule.effective_from) {
    return `This rule starts on ${formatDate(rule.effective_from)}.`
  }
  if (rule.effective_to && date > rule.effective_to) {
    return `This rule ended on ${formatDate(rule.effective_to)}.`
  }
  if (!lounge) return null
  if (rule.lounge_scope === 'specific') {
    return (rule.lounge_ids || []).includes(lounge.lounge_id) ? null : 'This lounge is not on the rule’s lounge list.'
  }
  if (!(lounge.networks || []).some((n) => sameProgramme(n, rule.network))) {
    return `This lounge is not in ${rule.network || 'the rule’s network'}.`
  }
  const countries = rule.countries
  if (countries && !countries.some((c) => sameText(c, 'worldwide') || sameText(c, lounge.country))) {
    return `This rule covers ${countries.join(', ')} only.`
  }
  return null
}

export function evaluateRule(doc, rule, ctx) {
  const { date, today, lounge = null, holder = 'principal', flight = 'unknown', guests = 0, excludeVisitId } = ctx
  const card = doc.cards.find((c) => c.card_id === rule.card_id)
  const base = { rule, card, lounge, date, holder, checks: [], reminders: [], spend: null, quota: null }

  const uncovered = coverage(rule, lounge, date)
  if (uncovered) return { ...base, status: STATUS.NOT_COVERED, headline: uncovered }

  const ev = rule.evidence || {}
  const checks = []
  let blocked = null // a hard "no" that no further spending can fix
  let unclear = null

  if (card?.status === 'closed') {
    blocked = 'This card is marked as closed.'
    checks.push(check('fail', 'Card status', 'Marked as closed'))
  }

  // Flight
  if (rule.flight_scope && rule.flight_scope !== 'any') {
    const penalty = rule.penalty?.note || (rule.penalty?.amount != null ? `Fee ${money(rule.penalty.amount)}` : '')
    if (flight === 'unknown') {
      checks.push(check('warn', 'Flight', `Only for ${rule.flight_scope} departures`, ev.flight_scope))
    } else if (flight === rule.flight_scope) {
      checks.push(check('ok', 'Flight', `${rule.flight_scope} departure`, ev.flight_scope))
    } else {
      blocked = blocked || `Complimentary access is only for ${rule.flight_scope} departures.`
      checks.push(check('fail', 'Flight', `Only for ${rule.flight_scope} departures. ${penalty}`.trim(), ev.flight_scope))
    }
  }

  // Quota
  const quota = assessQuota(doc, rule, card, { date, holder, guests, excludeVisitId })
  if (!quota.known) {
    const why = rule.quota.period === 'card_year' && !card?.anniversary
      ? 'The card’s anniversary date is missing.'
      : 'The T&C entry does not state the number of visits or when it resets.'
    unclear = unclear || why
    checks.push(check('unknown', 'Visits left', why, ev.quota))
  } else if (quota.total === 0) {
    blocked = blocked || `${holder === 'supplementary' ? 'Supplementary' : 'Principal'} cardholders have no complimentary visits on this card.`
    checks.push(check('fail', 'Visits left', 'None for this cardholder', ev.quota))
  } else if (quota.left < quota.needed) {
    blocked = blocked || `Visits used up: ${quota.used} of ${quota.total} this period.`
    checks.push(check('fail', 'Visits left', `${quota.used} of ${quota.total} used`, ev.quota))
  } else if (quota.total === Infinity) {
    checks.push(check('ok', 'Visits left', 'Unlimited', ev.quota))
  } else {
    checks.push(check('ok', 'Visits left', `${quota.left} of ${quota.total} left${quota.period?.start > '0001' ? `, until ${formatDate(quota.period.end)}` : ''}`, ev.quota))
  }

  // Daily limit
  if (rule.quota.per_day_limit != null && quota.sameDay >= rule.quota.per_day_limit) {
    blocked = blocked || `Limited to ${rule.quota.per_day_limit} complimentary visit a day, already used on ${formatDate(date)}.`
    checks.push(check('fail', 'Daily limit', `${rule.quota.per_day_limit} a day, already used`, ev.per_day_limit))
  }

  // Spend or transaction condition
  const c = rule.condition
  let spend = null
  let needsSpend = false
  if (!isConditionComplete(c)) {
    const why = 'The spend condition is not stated in full.'
    unclear = unclear || why
    checks.push(check('unknown', 'Spend condition', why, ev.condition))
  } else if (c.type === 'none') {
    checks.push(check('ok', 'Spend condition', 'No spend needed', ev.condition))
  } else {
    const params = { date, holder, excludeVisitId }
    const strict = assessCondition(doc, rule, params, true)
    const generous = assessCondition(doc, rule, params, false)
    if (!strict || !generous) {
      const why = 'The spend window is not stated in full.'
      unclear = unclear || why
      checks.push(check('unknown', 'Spend condition', why, ev.condition))
    } else {
      const isTxn = c.type === 'min_txn'
      const windows = spendWindows(c, date, true)
      const lastDay = windows.map((w) => w.end).sort().at(-1)
      const open = lastDay >= today
      const fmt = (n) => (isTxn ? `${n} transaction${n === 1 ? '' : 's'}` : money(n))
      spend = {
        have: strict.have,
        need: strict.need,
        shortfall: Math.max(0, Math.round((strict.need - strict.have) * 100) / 100),
        window: strict.window,
        deadline: open ? lastDay : null,
        unit: isTxn ? 'txn' : 'rm',
        met: strict.met,
      }
      const span = formatRange(strict.window.start, strict.window.end)
      if (strict.met) {
        checks.push(check('ok', conditionLabel(c), `${fmt(strict.have)} counted, ${span}`, ev.condition))
      } else if (generous.met) {
        const why = `${fmt(generous.have)} counts only on a generous reading of the T&C, which does not settle how the window or reuse works. Strict count: ${fmt(strict.have)}.`
        unclear = unclear || why
        checks.push(check('unknown', conditionLabel(c), why, ev.condition))
      } else if (open) {
        needsSpend = true
        checks.push(check('warn', conditionLabel(c), `${fmt(strict.have)} counted. ${fmt(spend.shortfall)} more by ${formatDate(lastDay)}`, ev.condition))
      } else {
        blocked = blocked || `Spend window closed with ${fmt(strict.have)} of ${fmt(strict.need)}.`
        checks.push(check('fail', conditionLabel(c), `${fmt(strict.have)} of ${fmt(strict.need)}. Window closed ${formatDate(lastDay)}`, ev.condition))
      }
      if ((c.excluded_spend_types || []).length) {
        const list = c.excluded_spend_types.map((t) => SPEND_TYPE_LABEL[t] || t).join(', ')
        base.reminders.push(`Doesn’t count towards spend: ${list}.`)
      }
      if (c.spend_holder === 'principal_only' && holder === 'principal') {
        base.reminders.push('Supplementary card spending doesn’t count.')
      }
    }
  }

  // Age of the rule
  const age = rule.last_verified ? diffDays(today, rule.last_verified) : Infinity
  const stale = age > STALE_AFTER_DAYS
  if (stale) {
    const when = rule.last_verified ? `Last checked ${formatDate(rule.last_verified)}.` : 'Never checked against the T&C.'
    checks.push(check('unknown', 'T&C check', `${when} Re-verify before relying on this.`))
  }
  if (rule.confidence === 'low') checks.push(check('warn', 'Import confidence', 'Marked low when imported'))
  if (lounge?.verified === false) checks.push(check('warn', 'Lounge details', 'Found by AI and not confirmed yet. Check it accepts this programme'))

  if (rule.entry_requirements) base.reminders.push(`At entry: ${rule.entry_requirements}`)
  if (rule.penalty?.note && !blocked) base.reminders.push(`If conditions aren’t met: ${rule.penalty.note}`)
  if (rule.duration_hours) base.reminders.push(`Stay limit: ${rule.duration_hours} hours.`)

  let status
  let headline
  if (blocked) {
    status = STATUS.NOT_ELIGIBLE
    headline = blocked
  } else if (unclear) {
    status = STATUS.UNCLEAR
    headline = unclear
  } else if (stale) {
    status = STATUS.UNCLEAR
    headline = 'This rule needs re-verifying against the current T&C.'
  } else if (needsSpend) {
    status = STATUS.NEEDS_SPEND
    const fmt = spend.unit === 'txn' ? `${spend.shortfall} more transaction${spend.shortfall === 1 ? '' : 's'}` : `${money(spend.shortfall)} more`
    headline = `${fmt} by ${formatDate(spend.deadline)}`
  } else {
    status = STATUS.ELIGIBLE
    headline = quota.total === Infinity || !quota.known ? 'You can use this lounge.' : `You can use this lounge. ${quota.left} of ${quota.total} visits left.`
  }

  return { ...base, status, headline, checks, spend, quota }
}

// ---------- one card ----------

export function evaluateCard(doc, cardId, ctx) {
  const rules = doc.rules.filter((r) => r.card_id === cardId)
  const results = rules
    .map((r) => evaluateRule(doc, r, ctx))
    .sort((a, b) => rankStatus(a.status) - rankStatus(b.status))
  const card = doc.cards.find((c) => c.card_id === cardId)
  if (!results.length) {
    return {
      status: STATUS.NOT_COVERED,
      headline: 'No lounge rule saved for this card yet.',
      card,
      lounge: ctx.lounge || null,
      date: ctx.date,
      holder: ctx.holder || 'principal',
      rule: null,
      checks: [],
      reminders: [],
      others: [],
    }
  }
  return { ...results[0], others: results.slice(1) }
}

// ---------- finder ----------

// Every card × lounge the filters allow, best answers first.
export function findAccess(doc, filters) {
  const { date, today, bank, cardId, loungeId, airport, network, holder, flight, guests, status } = filters
  const cards = doc.cards
    .filter((c) => c.status !== 'closed')
    .filter((c) => (cardId ? c.card_id === cardId : true))
    .filter((c) => (bank ? sameText(c.bank, bank) : true))
  const lounges = doc.lounges
    .filter((l) => (loungeId ? l.lounge_id === loungeId : true))
    .filter((l) => (airport ? sameText(l.airport_code, airport) : true))
    .filter((l) => (network ? (l.networks || []).some((n) => sameProgramme(n, network)) : true))
  const narrowed = Boolean(loungeId || airport || network)
  const ctx = { date, today, holder, flight, guests }

  const rows = []
  for (const card of cards) {
    if (narrowed) {
      for (const lounge of lounges) rows.push(evaluateCard(doc, card.card_id, { ...ctx, lounge }))
    } else {
      // With no lounge chosen, answer per card: any lounge its rules cover.
      rows.push(evaluateCard(doc, card.card_id, { ...ctx, lounge: null }))
    }
  }
  return rows
    .filter((r) => (status ? r.status === status : true))
    .sort(
      (a, b) =>
        rankStatus(a.status) - rankStatus(b.status) ||
        cardLabel(a.card).localeCompare(cardLabel(b.card)),
    )
}

// ---------- lounge search ----------

// Names people use that no saved field would match.
const AIRPORT_ALIASES = { klia: 'kul', klia2: 'kul', subang: 'szb', changi: 'sin', 'don mueang': 'dmk', suvarnabhumi: 'bkk', haneda: 'hnd', narita: 'nrt' }

// Every word typed must appear somewhere on the lounge. An exact airport code ranks first.
export function searchLounges(lounges, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const words = q.split(/\s+/).map((w) => AIRPORT_ALIASES[w] || w)
  const scored = []
  for (const l of lounges) {
    const code = String(l.airport_code || '').toLowerCase()
    const text = [l.name, l.airport_code, l.airport_name, l.city, l.country, l.terminal, ...(l.networks || [])].join(' ').toLowerCase()
    if (!words.every((w) => text.includes(w))) continue
    scored.push({ l, score: words.includes(code) ? 0 : String(l.name || '').toLowerCase().startsWith(words[0]) ? 1 : 2 })
  }
  return scored
    .sort((a, b) => a.score - b.score || String(a.l.name).localeCompare(String(b.l.name)))
    .map((x) => x.l)
}

// Why a transaction won't count, going by the card's live rules. Null if it counts.
export function spendNote(doc, spend, today) {
  const rules = doc.rules.filter(
    (r) => r.card_id === spend.card_id && r.condition?.type && r.condition.type !== 'none' && (!r.effective_to || r.effective_to >= today),
  )
  if (!rules.length) return null
  if (rules.every((r) => (r.condition.excluded_spend_types || []).includes(spend.type))) {
    return `Doesn’t count towards lounge spend: ${(SPEND_TYPE_LABEL[spend.type] || spend.type).toLowerCase()}`
  }
  if (spend.holder === 'supplementary' && rules.every((r) => r.condition.spend_holder === 'principal_only')) {
    return 'Doesn’t count towards lounge spend: supplementary card'
  }
  if (!spend.overseas && rules.every((r) => r.condition.overseas_only)) {
    return 'Doesn’t count towards lounge spend: not overseas'
  }
  return null
}

// ---------- visits & attention ----------

// How a logged visit stands now. A charged visit is settled by definition.
export function evaluateVisit(doc, visit, today) {
  const lounge = doc.lounges.find((l) => l.lounge_id === visit.lounge_id) || null
  return evaluateCard(doc, visit.card_id, {
    date: visit.date,
    today,
    lounge,
    holder: visit.holder,
    flight: visit.flight,
    guests: visit.guests,
    excludeVisitId: visit.visit_id,
  })
}

export function attentionItems(doc, today) {
  const items = []
  for (const v of doc.visits) {
    if (v.charged) continue
    const r = evaluateVisit(doc, v, today)
    const card = cardLabel(doc.cards.find((c) => c.card_id === v.card_id))
    if (r.status === STATUS.NEEDS_SPEND) {
      items.push({
        kind: 'spend',
        severity: diffDays(r.spend.deadline, today) <= 7 ? 'high' : 'medium',
        sort: r.spend.deadline,
        title: r.headline,
        detail: `${card}, visit on ${formatDate(v.date)}`,
        target: 'visits',
      })
    } else if (r.status === STATUS.NOT_ELIGIBLE && r.spend && !r.spend.met) {
      const fee = r.rule?.penalty?.amount != null ? ` Fee may apply: ${money(r.rule.penalty.amount)}.` : ''
      items.push({
        kind: 'missed',
        severity: 'high',
        sort: v.date,
        title: `Spend condition missed for ${formatDate(v.date)}`,
        detail: `${card}.${fee}`,
        target: 'visits',
      })
    }
  }
  for (const r of doc.rules) {
    if (r.effective_to && r.effective_to < today) continue
    const age = r.last_verified ? diffDays(today, r.last_verified) : Infinity
    if (age > STALE_AFTER_DAYS) {
      items.push({
        kind: 'stale',
        severity: 'medium',
        sort: r.last_verified || '0000',
        title: `Re-check T&C: ${r.title || r.network}`,
        detail: `${cardLabel(doc.cards.find((c) => c.card_id === r.card_id))}. ${r.last_verified ? `Last checked ${formatDate(r.last_verified)}` : 'Never checked'}`,
        target: 'library',
      })
    }
  }
  return items.sort((a, b) => (a.severity === b.severity ? (a.sort < b.sort ? -1 : 1) : a.severity === 'high' ? -1 : 1))
}

// The live rule of a group on a date, used when logging a visit.
export function bestRuleFor(doc, cardId, lounge, date, today) {
  return evaluateCard(doc, cardId, { date, today, lounge }).rule
}
