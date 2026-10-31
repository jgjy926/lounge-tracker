// Upcoming flights: the best card for each one, and what to do by when.
import { useEffect, useMemo, useState } from 'react'
import { Empty, Icon, PageTitle, StatusPill, go } from '../components/ui'
import ResultCard from '../components/ResultCard'
import { TripForm, VisitForm } from '../components/forms'
import { useStore } from '../store/useStore'
import { cardLabel, emptyVisit, loungeLabel } from '../lib/schema'
import { diffDays, formatDate, todayIso } from '../lib/dates'
import { money } from '../lib/engine'
import { buildIcs, buildReminders, planTrips, shortfallLabel } from '../lib/trips'
import { downloadBlob } from '../lib/platform'
import { askForReminders, remindersOn, remindersSupported, sendTestReminder, syncReminders } from '../lib/reminders'

const FLIGHT = { international: 'International', domestic: 'Domestic', unknown: 'Flight type not set' }
const away = (n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`)

function SpendSteps({ plan }) {
  const fee = plan.penalty?.amount != null ? ` Missing it can cost ${money(plan.penalty.amount)}.` : ''
  return (
    <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
      <li className="font-semibold">{shortfallLabel(plan)} needed</li>
      {plan.opensLater && <li>Spend from {formatDate(plan.opensOn)}. Earlier spending won’t count.</li>}
      {plan.safeBy ? (
        <li>Safest: finish by {formatDate(plan.safeBy)}, before you fly.</li>
      ) : (
        <li>It can’t be finished before you fly.</li>
      )}
      {plan.lastDay && plan.lastDay !== plan.safeBy && <li>Last day allowed: {formatDate(plan.lastDay)}.{fee}</li>}
    </ul>
  )
}

function TripCard({ item, today, onEdit }) {
  const { trip, best, plan, lounges, options } = item
  const days = diffDays(trip.date, today)
  return (
    <article className="card space-y-3 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-night-900">{trip.name || `${trip.airport_code} flight`}</h3>
          <p className="text-sm text-slate-600">{formatDate(trip.date)} · {away(days)}</p>
          <p className="text-xs text-slate-500">{[trip.airport_code, trip.flight_number, FLIGHT[trip.flight]].filter(Boolean).join(' · ')}</p>
        </div>
        <button aria-label={`Edit ${trip.name || 'trip'}`} onClick={onEdit} className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
          <Icon name="edit" size={18} />
        </button>
      </div>

      {!lounges.length ? (
        <div className="space-y-2 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
          <p>No lounges saved at {trip.airport_code}, so the app can’t tell which card gets you in.</p>
          <button className="btn-ghost" onClick={() => go('import/lounges')}><Icon name="import" size={16} /> Import a bank’s lounge list</button>
        </div>
      ) : !best ? (
        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">None of your cards cover {lounges.length === 1 ? loungeLabel(lounges[0]) : `the lounges at ${trip.airport_code}`}.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">{trip.card_id ? 'Card' : 'Best card'}</p>
              <p className="font-semibold text-night-900">{cardLabel(best.card)}</p>
              {best.lounge && <p className="text-sm text-slate-600">{loungeLabel(best.lounge)}{best.lounge.verified === false ? ' · Unverified' : ''}</p>}
            </div>
            <StatusPill status={best.status} />
          </div>
          {plan && best.status === 'needs_spend' ? <SpendSteps plan={plan} /> : <p className="text-sm text-slate-800">{best.headline}</p>}
        </div>
      )}

      {options.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-night-700">All your cards for this flight ({options.length})</summary>
          <div className="mt-2 space-y-2">
            {options.map((r) => <ResultCard key={r.card.card_id} result={r} />)}
          </div>
        </details>
      )}
      {best && days > 30 && <p className="text-xs text-slate-500">Based on today’s T&C and spend. The bank may change its terms before you travel.</p>}
    </article>
  )
}

function ReminderBar({ reminders }) {
  const showToast = useStore((s) => s.showToast)
  const doc = useStore((s) => s.doc)
  const [on, setOn] = useState(null)

  useEffect(() => {
    if (remindersSupported()) remindersOn().then(setOn)
  }, [])

  if (remindersSupported()) {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm" aria-label="Reminders">
        <p className="text-slate-700">
          {on === false ? 'Phone reminders are off.' : `${reminders.length} reminder${reminders.length === 1 ? '' : 's'} scheduled, at 9am on the day.`}
        </p>
        {on === false ? (
          <button className="btn-primary" onClick={async () => { const ok = await askForReminders(); setOn(ok); if (ok) syncReminders(doc); else showToast('Allow notifications for Lounge Tracker in your phone’s settings') }}>Turn on</button>
        ) : (
          <button className="btn-ghost" onClick={async () => { await sendTestReminder(); showToast('A test reminder arrives in a few seconds') }}>Send a test</button>
        )}
      </section>
    )
  }
  if (!reminders.length) return null
  const save = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
    downloadBlob('lounge-trip-reminders.ics', new Blob([buildIcs(reminders, stamp)], { type: 'text/calendar' }))
  }
  return (
    <section className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm" aria-label="Reminders">
      <p className="text-slate-700">A web page can’t remind you. Add {reminders.length} reminder{reminders.length === 1 ? '' : 's'} to your calendar instead.</p>
      <button className="btn-ghost" onClick={save}>Add to calendar</button>
    </section>
  )
}

export default function TripsScreen() {
  const doc = useStore((s) => s.doc)
  const upsert = useStore((s) => s.upsert)
  const today = todayIso()
  const [editing, setEditing] = useState(null)
  const [logging, setLogging] = useState(null)

  const plans = useMemo(() => planTrips(doc, today), [doc, today])
  const reminders = useMemo(() => buildReminders(doc, today), [doc, today])
  const past = doc.trips.filter((t) => !t.visit_id && t.date < today).sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div className="space-y-4">
      <PageTitle title="Trips">
        <button className="btn-ghost" onClick={() => go('import/trips')}><Icon name="import" size={16} /> Import</button>
        <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add</button>
      </PageTitle>

      {!doc.trips.length && (
        <Empty
          title="No trips planned"
          action={
            <>
              <button className="btn-accent" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add a flight</button>
              <button className="btn-ghost" onClick={() => go('import/trips')}>Import an e-ticket</button>
            </>
          }
        >
          Add a flight to see which card gets you into a lounge, what you still need to spend, and by when.
        </Empty>
      )}

      {plans.length > 0 && <ReminderBar reminders={reminders} />}

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {plans.map((item) => (
          <TripCard key={item.trip.trip_id} item={item} today={today} onEdit={() => setEditing(item.trip)} />
        ))}
      </div>

      {past.length > 0 && (
        <section aria-label="Past flights" className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-night-900">Did you use a lounge?</h2>
          <ul className="card divide-y divide-slate-100">
            {past.map((t) => (
              <li key={t.trip_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-slate-800">{t.name || `${t.airport_code} flight`}</span>
                  <span className="block text-xs text-slate-500">{formatDate(t.date)} · {t.airport_code}</span>
                </span>
                <span className="flex gap-2">
                  <button className="btn-ghost" onClick={() => upsert('trips', { ...t, visit_id: 'none' })}>No</button>
                  <button className="btn-primary" onClick={() => setLogging(t)}>Log visit</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && <TripForm initial={editing} onClose={() => setEditing(null)} />}
      {logging && (
        <VisitForm
          initial={{ ...emptyVisit(), date: logging.date, card_id: logging.card_id, lounge_id: logging.lounge_id, holder: logging.holder, flight: logging.flight }}
          onSaved={(visit) => upsert('trips', { ...logging, visit_id: visit.visit_id })}
          onClose={() => setLogging(null)}
        />
      )}
    </div>
  )
}
