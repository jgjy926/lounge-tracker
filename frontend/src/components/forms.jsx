// Add/edit sheets for visits, spend, cards and lounges.
import { useState } from 'react'
import { AreaField, NumberField, SelectField, Sheet, TextField } from './ui'
import { useStore } from '../store/useStore'
import { SPEND_TYPES, cardLabel, emptyCard, emptyLounge, emptySpend, emptyVisit, loungeLabel } from '../lib/schema'
import { evaluateCard } from '../lib/engine'
import { isIsoDate, todayIso } from '../lib/dates'

const HOLDERS = [
  ['principal', 'Principal'],
  ['supplementary', 'Supplementary'],
]

const cardOptions = (doc) =>
  doc.cards.filter((c) => c.status !== 'closed').map((c) => [c.card_id, cardLabel(c)])

export function VisitForm({ initial, onClose }) {
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

export function CardForm({ initial, onClose }) {
  const doc = useStore((st) => st.doc)
  const upsert = useStore((st) => st.upsert)
  const removeCard = useStore((st) => st.removeCard)
  const [c, setC] = useState(() => ({ ...emptyCard(), ...initial }))
  const isEdit = doc.cards.some((x) => x.card_id === c.card_id)
  const set = (patch) => setC((x) => ({ ...x, ...patch }))
  const badLast4 = c.last4 && !/^\d{4}$/.test(c.last4)
  const badAnniv = c.anniversary && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(c.anniversary)

  function del() {
    const rules = doc.rules.filter((r) => r.card_id === c.card_id).length
    const visits = doc.visits.filter((v) => v.card_id === c.card_id).length
    const spends = doc.spends.filter((s) => s.card_id === c.card_id).length
    if (window.confirm(`Delete this card with its ${rules} rules, ${visits} visits and ${spends} spend records? If you only stopped using it, mark it closed instead.`)) {
      removeCard(c.card_id)
      onClose()
    }
  }

  return (
    <Sheet
      title={isEdit ? 'Edit card' : 'Add a card'}
      onClose={onClose}
      footer={
        <>
          {isEdit && <button className="btn-danger mr-auto" onClick={del}>Delete</button>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!c.bank.trim() || !c.name.trim() || badLast4 || badAnniv} onClick={() => { upsert('cards', { ...c, bank: c.bank.trim(), name: c.name.trim() }); onClose() }}>Save card</button>
        </>
      }
    >
      <TextField label="Bank" value={c.bank} onChange={(bank) => set({ bank })} placeholder="AEON" />
      <TextField label="Card name" value={c.name} onChange={(name) => set({ name })} placeholder="Member Plus Gold Visa" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Last 4 digits (optional)" inputMode="numeric" maxLength={4} value={c.last4} onChange={(last4) => set({ last4 })} hint={badLast4 ? 'Use exactly 4 digits.' : 'Never the full number.'} />
        <TextField label="Card anniversary (optional)" placeholder="MM-DD" maxLength={5} value={c.anniversary} onChange={(anniversary) => set({ anniversary })} hint={badAnniv ? 'Use MM-DD, like 06-01.' : 'Needed only for card-year quotas.'} />
      </div>
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
      <TextField label="Airport name" value={l.airport_name} onChange={(airport_name) => set({ airport_name })} placeholder="Kuala Lumpur International Airport" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Terminal" value={l.terminal} onChange={(terminal) => set({ terminal })} placeholder="T1" />
        <SelectField label="Zone" value={l.zone} onChange={(zone) => set({ zone: zone || '' })} options={[['airside', 'Airside'], ['landside', 'Landside']]} placeholder="Not sure" />
      </div>
      <TextField label="Opening hours" value={l.hours} onChange={(hours) => set({ hours })} />
      <AreaField label="Notes" rows={2} value={l.notes} onChange={(notes) => set({ notes })} />
    </Sheet>
  )
}
