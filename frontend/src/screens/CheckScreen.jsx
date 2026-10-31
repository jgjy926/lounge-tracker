// Home: "can I use this lounge?", plus anything that needs attention.
import { useMemo, useState } from 'react'
import { Icon, PageTitle, Empty, SelectField, TextField, go } from '../components/ui'
import ResultCard from '../components/ResultCard'
import { VisitForm } from '../components/forms'
import { useStore } from '../store/useStore'
import { attentionItems, findAccess } from '../lib/engine'
import { loungeLabel } from '../lib/schema'
import { todayIso } from '../lib/dates'

const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b))
const pairs = (list) => list.map((x) => [x, x])

const FILTER_KEY = 'lounge-tracker.check-filters'
const loadFilters = () => {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')
  } catch {
    return {}
  }
}

export default function CheckScreen() {
  const doc = useStore((s) => s.doc)
  const today = todayIso()
  const [date, setDate] = useState(today)
  const [f, setF] = useState(() => ({
    bank: '', cardId: '', network: '', airport: '', loungeId: '', status: '', holder: 'principal', flight: 'unknown',
    ...loadFilters(),
  }))
  const [more, setMore] = useState(false)
  const [logging, setLogging] = useState(null)

  const set = (patch) =>
    setF((x) => {
      const next = { ...x, ...patch }
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next))
      } catch {
        // A remembered filter is only a convenience.
      }
      return next
    })

  const banks = uniq(doc.cards.map((c) => c.bank))
  const networks = uniq(doc.lounges.flatMap((l) => l.networks || []))
  const airports = uniq(doc.lounges.map((l) => l.airport_code))
  const cards = doc.cards.filter((c) => c.status !== 'closed' && (!f.bank || c.bank === f.bank))
  const lounges = doc.lounges.filter((l) => (!f.airport || l.airport_code === f.airport) && (!f.network || (l.networks || []).includes(f.network)))

  const rows = useMemo(
    () =>
      findAccess(doc, {
        date: date || today,
        today,
        bank: f.bank,
        // A filter left over from a deleted card or lounge must not hide everything.
        cardId: doc.cards.some((c) => c.card_id === f.cardId) ? f.cardId : '',
        network: f.network,
        airport: f.airport,
        loungeId: doc.lounges.some((l) => l.lounge_id === f.loungeId) ? f.loungeId : '',
        status: f.status,
        holder: f.holder,
        flight: f.flight,
      }),
    [doc, date, today, f],
  )
  const attention = useMemo(() => attentionItems(doc, today), [doc, today])
  const active = [f.bank, f.cardId, f.network, f.airport, f.loungeId, f.status].filter(Boolean).length

  if (!doc.cards.length) {
    return (
      <div className="space-y-4">
        <PageTitle title="Lounge access" />
        <Empty
          title="Add your first card"
          action={
            <>
              <button className="btn-accent" onClick={() => go('import')}><Icon name="import" size={16} /> Import a T&C</button>
              <button className="btn-ghost" onClick={() => go('help')}>What do I need?</button>
            </>
          }
        >
          Paste your bank’s lounge T&C into any AI chat with the prompt here, then paste the answer back. The card and its rules are set up for you.
        </Empty>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageTitle title="Lounge access" />

      {attention.length > 0 && (
        <section aria-label="Needs attention" className="card divide-y divide-slate-100">
          {attention.slice(0, 4).map((a, i) => (
            <button key={i} className="flex w-full items-start gap-2.5 p-3 text-left" onClick={() => go(a.target)}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === 'high' ? 'bg-red-500' : 'bg-amber-500'}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-night-900">{a.title}</span>
                <span className="block text-xs text-slate-600">{a.detail}</span>
              </span>
            </button>
          ))}
          {attention.length > 4 && <p className="p-2.5 text-center text-xs text-slate-500">and {attention.length - 4} more</p>}
        </section>
      )}

      <section className="card space-y-3 p-3.5" aria-label="Filters">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Visit date" type="date" value={date} onChange={setDate} />
          <SelectField label="Airport" value={f.airport} onChange={(airport) => set({ airport: airport || '', loungeId: '' })} options={pairs(airports)} placeholder="Any airport" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Card" value={f.cardId} onChange={(cardId) => set({ cardId: cardId || '' })} options={cards.map((c) => [c.card_id, `${c.bank} ${c.name}`])} placeholder="All cards" />
          <SelectField label="Lounge" value={f.loungeId} onChange={(loungeId) => set({ loungeId: loungeId || '' })} options={lounges.map((l) => [l.lounge_id, loungeLabel(l)])} placeholder="Any lounge" />
        </div>
        {more && (
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Bank" value={f.bank} onChange={(bank) => set({ bank: bank || '', cardId: '' })} options={pairs(banks)} placeholder="All banks" />
            <SelectField label="Programme" value={f.network} onChange={(network) => set({ network: network || '', loungeId: '' })} options={pairs(networks)} placeholder="All programmes" />
            <SelectField label="Answer" value={f.status} onChange={(status) => set({ status: status || '' })} options={[['eligible', 'Eligible'], ['needs_spend', 'Eligible if you spend'], ['unclear', 'Unclear'], ['not_eligible', 'Not eligible'], ['not_covered', 'Not covered']]} placeholder="All answers" />
            <SelectField label="Cardholder" value={f.holder} onChange={(holder) => set({ holder: holder || 'principal' })} options={[['principal', 'Principal'], ['supplementary', 'Supplementary']]} />
            <SelectField label="Flight" value={f.flight} onChange={(flight) => set({ flight: flight || 'unknown' })} options={[['unknown', 'Not sure'], ['international', 'International'], ['domestic', 'Domestic']]} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <button className="text-sm font-medium text-night-700" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'Fewer filters' : 'More filters'}
          </button>
          {active > 0 && (
            <button className="text-sm text-slate-600 underline" onClick={() => set({ bank: '', cardId: '', network: '', airport: '', loungeId: '', status: '' })}>
              Clear {active}
            </button>
          )}
        </div>
      </section>

      <section aria-label="Results" className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {rows.length === 0 && (
          <div className="lg:col-span-2">
            <Empty title="Nothing matches these filters">Clear a filter, or add the lounge in Library.</Empty>
          </div>
        )}
        {rows.map((r) => (
          <ResultCard
            key={`${r.card?.card_id}|${r.lounge?.lounge_id || ''}`}
            result={r}
            onLog={(res) => setLogging({ card_id: res.card.card_id, lounge_id: res.lounge.lounge_id, date: date || today, holder: f.holder, flight: f.flight })}
          />
        ))}
      </section>

      {logging && <VisitForm initial={logging} onClose={() => setLogging(null)} />}
    </div>
  )
}
