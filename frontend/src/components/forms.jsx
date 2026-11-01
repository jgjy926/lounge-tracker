// Add/edit sheets for visits, spend, cards and lounges.
import { useState } from 'react'
import { AreaField, NumberField, SelectField, Sheet, TextField } from './ui'
import { useStore } from '../store/useStore'
import { SPEND_TYPES, cardLabel, emptyCard, emptyLounge, emptySpend, emptyTrip, emptyVisit, loungeLabel } from '../lib/schema'
import { evaluateCard } from '../lib/engine'
import { isIsoDate, todayIso } from '../lib/dates'
import { askForReminders, remindersSupported, syncReminders } from '../lib/reminders'

const HOLDERS = [
  ['principal', 'Principal'],
  ['supplementary', 'Supplementary'],
]

const cardOptions = (doc) =>
  doc.cards.filter((c) => c.status !== 'closed').map((c) => [c.card_id, cardLabel(c)])

export function VisitForm({ initial, onClose, onSaved }) {
  const doc = useStore((s) => s.doc)
  const upsert = useStore((s) => s.upsert)
  const remove = useStore((s) => s.remove)
  const [v, setV] = useState(() => ({ ...emptyVisit(), date: todayIso(), ...initial }))
  const isEdit = doc.visits.some((x) => x.visit_id === v.visit_id)
  const set = (patch) => setV((x) => ({ ...x, ...patch }))

  const lounge = doc.lounges.find((l) => l.lounge_id === v.lounge_id) || null
  const canSave = v.card_id && v.lounge_id && isIsoDate(v.date)
  const allCards = isEdit ? doc.cards.map((c) => [c.card_id, cardLabel(c)]) : cardOptions(doc)

  function save() {
    // Tie the visit to the rule group it uses, so quota follows new T&C versions.
    const r = evaluateCard(doc, v.card_id, { date: v.date, today: todayIso(), lounge, holder: v.holder, flight: v.flight, guests: v.guests, excludeVisitId: v.visit_id })
    upsert('visits', { ...v, rule_group: r.status === 'not_covered' ? v.rule_group : r.rule?.group || v.rule_group })
    onSaved?.(v)
    onClose()
  }

  return (
    <Sheet
      title={isEdit ? 'Edit visit' : 'Log a visit'}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button className="btn-danger mr-auto" onClick={() => { if (window.confirm('Delete this visit? Its entry goes back to your quota.')) { remove('visits', v.visit_id); onClose() } }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSave} onClick={save}>Save visit</button>
        </>
      }
    >
      <TextField label="Visit date" type="date" value={v.date} onChange={(date) => set({ date })} />
      <SelectField label="Card used" value={v.card_id} onChange={(card_id) => set({ card_id: card_id || '' })} options={allCards} placeholder="Choose a card" />
      <SelectField label="Lounge" value={v.lounge_id} onChange={(lounge_id) => set({ lounge_id: lounge_id || '' })} options={doc.lounges.map((l) => [l.lounge_id, loungeLabel(l)])} placeholder="Choose a lounge" hint={doc.lounges.length ? null : 'Add the lounge in Library first.'} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Cardholder" value={v.holder} onChange={(holder) => set({ holder: holder || 'principal' })} options={HOLDERS} />
        <SelectField label="Flight" value={v.flight} onChange={(flight) => set({ flight: flight || 'unknown' })} options={[['unknown', 'Not sure'], ['international', 'International'], ['domestic', 'Domestic']]} />
      </div>
      <NumberField label="Guests with you" min="0" value={v.guests} onChange={(guests) => set({ guests: guests ?? 0 })} />
      <SelectField
        label="Did you pay for this visit?"
        hint="A paid visit uses no complimentary entry."
        value={v.charged ? 'yes' : 'no'}
        onChange={(paid) => set({ charged: paid === 'yes' })}
        options={[['no', 'No, it was complimentary'], ['yes', 'Yes, I paid']]}
      />
      {v.charged && <NumberField label="Amount paid (RM)" step="0.01" value={v.charged_amount} onChange={(charged_amount) => set({ charged_amount })} />}
      <AreaField label="Note" rows={2} value={v.note} onChange={(note) => set({ note })} />
    </Sheet>
  )
}

export function SpendForm({ initial, onClose }) {
  const doc = useStore((s) => s.doc)
  const upsert = useStore((s) => s.upsert)
  const remove = useStore((s) => s.remove)
  const [s, setS] = useState(() => ({ ...emptySpend(), date: todayIso(), ...initial }))
  const isEdit = doc.spends.some((x) => x.spend_id === s.spend_id)
  const set = (patch) => setS((x) => ({ ...x, ...patch }))
  const canSave = s.card_id && isIsoDate(s.date) && s.amount !== null && s.amount !== 0

  return (
    <Sheet
      title={isEdit ? 'Edit spend' : 'Add spend'}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button className="btn-danger mr-auto" onClick={() => { remove('spends', s.spend_id); onClose() }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSave} onClick={() => { upsert('spends', s); onClose() }}>Save spend</button>
        </>
      }
    >
      <SelectField label="Card" value={s.card_id} onChange={(card_id) => set({ card_id: card_id || '' })} options={isEdit ? doc.cards.map((c) => [c.card_id, cardLabel(c)]) : cardOptions(doc)} placeholder="Choose a card" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Date" type="date" value={s.date} onChange={(date) => set({ date })} />
        <NumberField label="Amount (RM)" step="0.01" value={s.amount} onChange={(amount) => set({ amount })} hint="Negative for a refund." />
      </div>
      <TextField label="Merchant" value={s.merchant} onChange={(merchant) => set({ merchant })} />
      <SelectField label="Type" value={s.type} onChange={(type) => set({ type: type || 'retail' })} options={SPEND_TYPES} hint="Banks often exclude instalments, cash advances and fees." />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Spent by" value={s.holder} onChange={(holder) => set({ holder: holder || 'principal' })} options={HOLDERS} />
        <SelectField label="Where" value={s.overseas ? 'overseas' : 'local'} onChange={(w) => set({ overseas: w === 'overseas' })} options={[['local', 'Local'], ['overseas', 'Overseas']]} />
      </div>
    </Sheet>
  )
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad2 = (n) => String(n).padStart(2, '0')

// Month and year pickers, so there's no date format to get wrong. Both or neither.
// A card saved earlier as 'MM-DD' opens with its month and no year, and stays as it
// was unless changed.
function AnniversaryField({ value, onChange }) {
  const saved = String(value || '')
  const [month, setMonth] = useState(() => (/^\d{4}-\d{2}$/.test(saved) ? saved.slice(5) : /^\d{2}-\d{2}$/.test(saved) ? saved.slice(0, 2) : ''))
  const [year, setYear] = useState(() => (/^\d{4}-\d{2}$/.test(saved) ? saved.slice(0, 4) : ''))
  const thisYear = Number(todayIso().slice(0, 4))
  const years = Array.from({ length: 41 }, (_, i) => String(thisYear - i))

  function update(m, y) {
    setMonth(m)
    setYear(y)
    onChange(m && y ? `${y}-${m}` : '')
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Anniversary month (optional)" value={month} onChange={(m) => update(m || '', year)} options={MONTH_NAMES.map((name, i) => [pad2(i + 1), name])} placeholder="Not set" />
        <SelectField label="Anniversary year" value={year} onChange={(y) => update(month, y || '')} options={years.map((y) => [y, y])} placeholder="Not set" />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {Boolean(month) !== Boolean(year) ? 'Choose both a month and a year, or set both back to Not set.' : 'When you got the card, not its expiry date. Needed only if visits reset on your card’s anniversary.'}
      </p>
    </div>
  )
}

// Shared by the card's page and its edit form, so removing always warns the same way.
export function useRemoveCard() {
  const doc = useStore((st) => st.doc)
  const removeCard = useStore((st) => st.removeCard)
  const showToast = useStore((st) => st.showToast)
  return (card) => {
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    const rules = doc.rules.filter((r) => r.card_id === card.card_id).length
    const visits = doc.visits.filter((v) => v.card_id === card.card_id).length
    const spends = doc.spends.filter((s) => s.card_id === card.card_id).length
    const ok = window.confirm(`Remove ${card.bank} ${card.name}? This also removes its ${count(rules, 'rule')}, ${count(visits, 'visit')} and ${count(spends, 'spend record')}. If you only stopped using the card, mark it Closed in Edit card instead.`)
    if (ok) {
      removeCard(card.card_id)
      showToast('Card removed')
    }
    return ok
  }
}

export function CardForm({ initial, onClose }) {
  const doc = useStore((st) => st.doc)
  const upsert = useStore((st) => st.upsert)
  const removeWithWarning = useRemoveCard()
  const [c, setC] = useState(() => ({ ...emptyCard(), ...initial }))
  const isEdit = doc.cards.some((x) => x.card_id === c.card_id)
  const set = (patch) => setC((x) => ({ ...x, ...patch }))
  const badLast4 = c.last4 && !/^\d{4}$/.test(c.last4)

  return (
    <Sheet
      title={isEdit ? 'Edit card' : 'Add a card'}
      onClose={onClose}
      footer={
        <>
          {isEdit && <button className="btn-danger mr-auto" onClick={() => { if (removeWithWarning(c)) onClose() }}>Remove card</button>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!c.bank.trim() || !c.name.trim() || badLast4} onClick={() => { upsert('cards', { ...c, bank: c.bank.trim(), name: c.name.trim() }); onClose() }}>Save card</button>
        </>
      }
    >
      <TextField label="Bank" value={c.bank} onChange={(bank) => set({ bank })} placeholder="AEON" />
      <TextField label="Card name" value={c.name} onChange={(name) => set({ name })} placeholder="Member Plus Gold Visa" />
      <TextField label="Last 4 digits (optional)" inputMode="numeric" maxLength={4} value={c.last4} onChange={(last4) => set({ last4 })} hint={badLast4 ? 'Use exactly 4 digits.' : 'Never the full number.'} />
      <AnniversaryField value={c.anniversary} onChange={(anniversary) => set({ anniversary })} />
      <SelectField label="Status" value={c.status} onChange={(status) => set({ status: status || 'active' })} options={[['active', 'Active'], ['closed', 'Closed']]} />
      <AreaField label="Notes" rows={2} value={c.notes} onChange={(notes) => set({ notes })} />
    </Sheet>
  )
}

export function LoungeForm({ initial, onClose }) {
  const doc = useStore((st) => st.doc)
  const upsert = useStore((st) => st.upsert)
  const remove = useStore((st) => st.remove)
  const [l, setL] = useState(() => ({ ...emptyLounge(), ...initial }))
  const isEdit = doc.lounges.some((x) => x.lounge_id === l.lounge_id)
  const set = (patch) => setL((x) => ({ ...x, ...patch }))
  const networksText = (l.networks || []).join(', ')
  const [networks, setNetworks] = useState(networksText)

  function save() {
    upsert('lounges', {
      ...l,
      name: l.name.trim(),
      airport_code: l.airport_code.trim().toUpperCase(),
      country: l.country.trim(),
      networks: networks.split(',').map((n) => n.trim()).filter(Boolean),
    })
    onClose()
  }

  return (
    <Sheet
      title={isEdit ? 'Edit lounge' : 'Add a lounge'}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button className="btn-danger mr-auto" onClick={() => { if (window.confirm('Delete this lounge? Logged visits stay, shown as "Unknown lounge".')) { remove('lounges', l.lounge_id); onClose() } }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!l.name.trim()} onClick={save}>Save lounge</button>
        </>
      }
    >
      <TextField label="Lounge name" value={l.name} onChange={(name) => set({ name })} placeholder="Plaza Premium Lounge" />
      <TextField label="Programmes it accepts" value={networks} onChange={setNetworks} placeholder="Plaza Premium, Priority Pass" hint="Must match the programme named in your rules. Separate with commas." />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Airport code" maxLength={4} value={l.airport_code} onChange={(airport_code) => set({ airport_code })} placeholder="KUL" />
        <TextField label="Country" value={l.country} onChange={(country) => set({ country })} placeholder="Malaysia" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Airport name" value={l.airport_name} onChange={(airport_name) => set({ airport_name })} placeholder="KLIA" />
        <TextField label="City" value={l.city} onChange={(city) => set({ city })} placeholder="Kuala Lumpur" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Terminal" value={l.terminal} onChange={(terminal) => set({ terminal })} placeholder="T1" />
        <SelectField label="Zone" value={l.zone} onChange={(zone) => set({ zone: zone || '' })} options={[['airside', 'Airside'], ['landside', 'Landside']]} placeholder="Not sure" />
      </div>
      <TextField label="Opening hours" value={l.hours} onChange={(hours) => set({ hours })} />
      <AreaField label="Notes" rows={2} value={l.notes} onChange={(notes) => set({ notes })} />
      {l.source_url && (
        <p className="text-sm">
          <a className="font-medium text-night-700 underline" href={l.source_url} target="_blank" rel="noopener noreferrer">Open the source page</a>
        </p>
      )}
      <SelectField
        label="Confirmed?"
        hint="An unconfirmed lounge came from an AI, so its programmes may be wrong."
        value={l.verified === false ? 'no' : 'yes'}
        onChange={(v) => set({ verified: v !== 'no' })}
        options={[['yes', 'Yes, I’ve checked it'], ['no', 'Not yet']]}
      />
    </Sheet>
  )
}

export function TripForm({ initial, onClose }) {
  const doc = useStore((st) => st.doc)
  const upsert = useStore((st) => st.upsert)
  const remove = useStore((st) => st.remove)
  const [t, setT] = useState(() => ({ ...emptyTrip(), ...initial }))
  const isEdit = doc.trips.some((x) => x.trip_id === t.trip_id)
  const set = (patch) => setT((x) => ({ ...x, ...patch }))
  const code = t.airport_code.trim().toUpperCase()
  const codes = [...new Set(doc.lounges.map((l) => l.airport_code).filter(Boolean))].sort()
  const atAirport = doc.lounges.filter((l) => l.airport_code === code)
  const canSave = isIsoDate(t.date) && code.length >= 3

  async function save() {
    const first = !doc.trips.length
    upsert('trips', { ...t, name: t.name.trim(), airport_code: code, flight_number: t.flight_number.trim().toUpperCase() })
    onClose()
    if (first && remindersSupported() && (await askForReminders())) syncReminders(useStore.getState().doc)
  }

  return (
    <Sheet
      title={isEdit ? 'Edit trip' : 'Add a flight'}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button className="btn-danger mr-auto" onClick={() => { if (window.confirm('Delete this trip? Its reminders go too.')) { remove('trips', t.trip_id); onClose() } }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSave} onClick={save}>Save trip</button>
        </>
      }
    >
      <TextField label="Trip name" value={t.name} onChange={(name) => set({ name })} placeholder="Tokyo" hint="A return flight is its own trip, since it leaves another airport." />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Departure date" type="date" value={t.date} onChange={(date) => set({ date })} />
        <TextField label="Departing from" list="trip-airports" maxLength={4} value={t.airport_code} onChange={(airport_code) => set({ airport_code, lounge_id: '' })} placeholder="KUL" />
        <datalist id="trip-airports">
          {codes.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Flight" value={t.flight} onChange={(flight) => set({ flight: flight || 'unknown' })} options={[['unknown', 'Not sure'], ['international', 'International'], ['domestic', 'Domestic']]} hint="Some cards cover international flights only." />
        <TextField label="Flight number (optional)" value={t.flight_number} onChange={(flight_number) => set({ flight_number })} placeholder="MH88" />
      </div>
      <SelectField label="Lounge" value={t.lounge_id} onChange={(lounge_id) => set({ lounge_id: lounge_id || '' })} options={atAirport.map((l) => [l.lounge_id, loungeLabel(l)])} placeholder={code ? `Any lounge at ${code}` : 'Any lounge at the airport'} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Card" value={t.card_id} onChange={(card_id) => set({ card_id: card_id || '' })} options={cardOptions(doc)} placeholder="Best card" />
        <SelectField label="Cardholder" value={t.holder} onChange={(holder) => set({ holder: holder || 'principal' })} options={HOLDERS} />
      </div>
      <AreaField label="Note" rows={2} value={t.note} onChange={(note) => set({ note })} />
    </Sheet>
  )
}
