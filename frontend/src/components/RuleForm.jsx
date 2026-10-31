// The full rule editor. Anything left blank stays "not stated", and the engine
// treats that differently from a value, so nothing here defaults to a guess.
import { useState } from 'react'
import { AreaField, NumberField, SelectField, Sheet, TextField, TriState } from './ui'
import { useStore } from '../store/useStore'
import { DAY_WINDOWS, QUOTA_PERIODS, SPEND_TYPES, WINDOWS, cardLabel, emptyRule, normalizeRule } from '../lib/schema'
import { todayIso } from '../lib/dates'

const Section = ({ title, children }) => (
  <section className="space-y-3 rounded-xl border border-slate-200 p-3">
    <h3 className="text-sm font-semibold text-night-900">{title}</h3>
    {children}
  </section>
)

export default function RuleForm({ initial, onClose }) {
  const doc = useStore((s) => s.doc)
  const upsertRule = useStore((s) => s.upsertRule)
  const remove = useStore((s) => s.remove)
  const [r, setR] = useState(() => normalizeRule({ ...emptyRule(doc.cards[0]?.card_id || ''), last_verified: todayIso(), ...initial, group: initial?.group || 'pending' }))
  const isEdit = doc.rules.some((x) => x.rule_id === r.rule_id)
  const set = (patch) => setR((x) => ({ ...x, ...patch }))
  const setQuota = (patch) => setR((x) => ({ ...x, quota: { ...x.quota, ...patch } }))
  const setCond = (patch) => setR((x) => ({ ...x, condition: { ...x.condition, ...patch } }))
  const setGuest = (patch) => setR((x) => ({ ...x, guest: { ...x.guest, ...patch } }))
  const setPenalty = (patch) => setR((x) => ({ ...x, penalty: { ...x.penalty, ...patch } }))
  const c = r.condition
  const [countries, setCountries] = useState((r.countries || []).join(', '))

  const hasCondition = c.type === 'min_spend' || c.type === 'min_txn'
  const dayWindow = DAY_WINDOWS.includes(c.window)
  const canSave = r.card_id && r.network.trim()

  function save() {
    const list = countries.split(',').map((x) => x.trim()).filter(Boolean)
    upsertRule({ ...r, title: r.title.trim() || r.network.trim(), network: r.network.trim(), countries: list.length ? list : null })
    onClose()
  }

  function toggleExcluded(type) {
    const list = c.excluded_spend_types || []
    setCond({ excluded_spend_types: list.includes(type) ? list.filter((t) => t !== type) : [...list, type] })
  }

  return (
    <Sheet
      wide
      title={isEdit ? 'Edit rule' : 'Add a rule'}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button className="btn-danger mr-auto" onClick={() => { if (window.confirm('Delete this rule? To record a change of terms, import the new T&C instead, which keeps the old version for past visits.')) { remove('rules', r.rule_id); onClose() } }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSave} onClick={save}>Save rule</button>
        </>
      }
    >
      <Section title="What it covers">
        <SelectField label="Card" value={r.card_id} onChange={(card_id) => set({ card_id: card_id || '' })} options={doc.cards.map((x) => [x.card_id, cardLabel(x)])} placeholder="Choose a card" />
        <TextField label="Lounge programme" value={r.network} onChange={(network) => set({ network })} placeholder="Plaza Premium" hint="Lounges match when they list the same programme." />
        <TextField label="Short title" value={r.title} onChange={(title) => set({ title })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Countries" value={countries} onChange={setCountries} placeholder="Malaysia, or worldwide" hint="Blank means not stated." />
          <SelectField label="Flights" value={r.flight_scope} onChange={(flight_scope) => set({ flight_scope })} options={[['any', 'Any flight'], ['international', 'International only'], ['domestic', 'Domestic only']]} placeholder="Not stated" />
        </div>
      </Section>

      <Section title="Visits allowed">
        <SelectField label="How many" value={r.quota.unlimited ? 'unlimited' : 'limited'} onChange={(v) => setQuota({ unlimited: v === 'unlimited' })} options={[['limited', 'A set number of visits'], ['unlimited', 'Unlimited']]} />
        {!r.quota.unlimited && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Principal visits" min="0" value={r.quota.principal} onChange={(principal) => setQuota({ principal })} hint="Blank = not stated." />
              <NumberField label="Supplementary visits" min="0" value={r.quota.supplementary} onChange={(supplementary) => setQuota({ supplementary })} hint="0 = none." />
            </div>
            <SelectField label="Visits reset" value={r.quota.period} onChange={(period) => setQuota({ period })} options={QUOTA_PERIODS} placeholder="Not stated" />
          </>
        )}
        <NumberField label="Limit per day" min="0" value={r.quota.per_day_limit} onChange={(per_day_limit) => setQuota({ per_day_limit })} />
      </Section>

      <Section title="Spend condition">
        <SelectField label="Condition" value={c.type} onChange={(type) => setCond({ type })} options={[['none', 'None, access is free'], ['min_spend', 'Minimum spend'], ['min_txn', 'Number of transactions']]} placeholder="Not stated" />
        {c.type === 'min_spend' && <NumberField label="Minimum spend (RM)" min="0" value={c.amount} onChange={(amount) => setCond({ amount })} />}
        {c.type === 'min_txn' && <NumberField label="Transactions needed" min="1" value={c.count} onChange={(count) => setCond({ count })} />}
        {hasCondition && (
          <>
            <SelectField label="Spend window" value={c.window} onChange={(window) => setCond({ window })} options={WINDOWS} placeholder="Not stated" />
            {dayWindow && (
              <div className="grid grid-cols-2 gap-3">
                {c.window !== 'after' && <NumberField label="Days before" min="0" value={c.days_before} onChange={(days_before) => setCond({ days_before })} />}
                {c.window !== 'before' && <NumberField label="Days after" min="0" value={c.days_after} onChange={(days_after) => setCond({ days_after })} />}
              </div>
            )}
            <p className="text-xs text-slate-500">Leave these as “Not stated” unless the T&C settles them. The app then reads them strictly and shows Unclear if the answer depends on them.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {c.window === 'before_or_after' && <TriState label="Spend before + after adds up?" value={c.sides_combine} onChange={(sides_combine) => setCond({ sides_combine })} />}
              <TriState label="Several transactions add up?" value={c.cumulative} onChange={(cumulative) => setCond({ cumulative })} />
              {dayWindow && <TriState label="Last day of the window counts?" value={c.boundary_inclusive} onChange={(boundary_inclusive) => setCond({ boundary_inclusive })} />}
              {dayWindow && <TriState label="Visit day counts?" value={c.visit_day_counts} onChange={(visit_day_counts) => setCond({ visit_day_counts })} />}
              <TriState label="One spend can qualify several visits?" value={c.same_spend_reusable} onChange={(same_spend_reusable) => setCond({ same_spend_reusable })} />
              <TriState label="Overseas spend only?" value={c.overseas_only} onChange={(overseas_only) => setCond({ overseas_only })} />
            </div>
            <SelectField label="Whose spend counts" value={c.spend_holder} onChange={(spend_holder) => setCond({ spend_holder })} options={[['principal_only', 'Principal only'], ['same_holder', 'Each cardholder’s own'], ['any', 'Anyone on the account']]} placeholder="Not stated" />
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Spend that doesn’t count</p>
              <div className="flex flex-wrap gap-2">
                {SPEND_TYPES.filter(([k]) => !['retail', 'refund'].includes(k)).map(([k, label]) => {
                  const on = (c.excluded_spend_types || []).includes(k)
                  return (
                    <button key={k} type="button" aria-pressed={on} onClick={() => toggleExcluded(k)} className={`min-h-[36px] rounded-full border px-3 text-sm ${on ? 'border-night-900 bg-night-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
            <AreaField label="Exclusions in the T&C’s words" rows={2} value={c.excluded_spend_text} onChange={(excluded_spend_text) => setCond({ excluded_spend_text: excluded_spend_text || null })} />
          </>
        )}
      </Section>

      <Section title="Guests, fees and entry">
        <div className="grid gap-3 sm:grid-cols-2">
          <TriState label="Guests allowed?" value={r.guest.allowed} onChange={(allowed) => setGuest({ allowed })} />
          <TriState label="A guest uses one of your visits?" value={r.guest.consumes_quota} onChange={(consumes_quota) => setGuest({ consumes_quota })} />
        </div>
        <AreaField label="Guest and family rules" rows={2} value={r.guest.note} onChange={(note) => setGuest({ note: note || null })} />
        <NumberField label="Fee if conditions aren’t met (RM)" min="0" step="0.01" value={r.penalty.amount} onChange={(amount) => setPenalty({ amount })} />
        <AreaField label="Fee details" rows={2} value={r.penalty.note} onChange={(note) => setPenalty({ note: note || null })} />
        <AreaField label="What to show at entry" rows={2} value={r.entry_requirements} onChange={(entry_requirements) => set({ entry_requirements: entry_requirements || null })} />
        <NumberField label="Stay limit (hours)" min="0" value={r.duration_hours} onChange={(duration_hours) => set({ duration_hours })} />
        <AreaField label="Other notes" rows={2} value={r.notes} onChange={(notes) => set({ notes: notes || null })} />
      </Section>

      <Section title="Source and dates">
        <TextField label="T&C document" value={r.source_document} onChange={(source_document) => set({ source_document: source_document || null })} placeholder="Version: August 2026" />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Starts" type="date" value={r.effective_from} onChange={(effective_from) => set({ effective_from: effective_from || null })} />
          <TextField label="Ends" type="date" value={r.effective_to} onChange={(effective_to) => set({ effective_to: effective_to || null })} />
          <TextField label="Last checked" type="date" value={r.last_verified} onChange={(last_verified) => set({ last_verified: last_verified || null })} hint="Over 180 days ago shows Unclear." />
        </div>
      </Section>
    </Sheet>
  )
}
