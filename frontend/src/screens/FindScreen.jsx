// Home: search a lounge and see which of your cards get you in. With nothing
// searched it answers per card, and it lists anything that needs attention.
import { useMemo, useState } from 'react'
import { Icon, PageTitle, Empty, SelectField, StatusPill, TextField, go } from '../components/ui'
import ResultCard from '../components/ResultCard'
import { LoungeForm, TripForm, VisitForm } from '../components/forms'
import { useStore } from '../store/useStore'
import { findAccess, searchLounges } from '../lib/engine'
import { allAttention } from '../lib/trips'
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

const GROUPS = [
  ['eligible', 'Can enter'],
  ['needs_spend', 'Spend needed'],
  ['unclear', 'Unclear'],
  ['not_eligible', 'Not eligible'],
]

const countLabel = (rows) => {
  const yes = rows.filter((r) => r.status === 'eligible').length
  const spend = rows.filter((r) => r.status === 'needs_spend').length
  const parts = [yes && `${yes} card${yes === 1 ? '' : 's'} can enter`, spend && `${spend} with more spend`].filter(Boolean)
  return parts.join(', ') || 'No card gets you in yet'
}

function LoungeHeader({ lounge, onClear, onPlan }) {
  const upsert = useStore((s) => s.upsert)
  return (
    <section className="card space-y-2 p-3.5" aria-label="Selected lounge">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-night-900">{loungeLabel(lounge)}</h2>
          <p className="text-sm text-slate-600">{[(lounge.networks || []).join(', '), lounge.airport_name, lounge.country].filter(Boolean).join(' · ')}</p>
          {lounge.hours && <p className="text-xs text-slate-500">{lounge.hours}</p>}
        </div>
        <button aria-label="Clear lounge" onClick={onClear} className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
          <Icon name="close" size={18} />
        </button>
      </div>
      {lounge.verified === false && (
        <div className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
          <p><b>Unverified.</b> An AI found this lounge, so check it accepts these programmes.</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {lounge.source_url && <a className="font-medium underline" href={lounge.source_url} target="_blank" rel="noopener noreferrer">Open the source</a>}
            <button className="font-medium underline" onClick={() => upsert('lounges', { ...lounge, verified: true })}>I’ve checked it</button>
          </div>
        </div>
      )}
      <button className="btn-ghost" onClick={onPlan}><Icon name="trips" size={16} /> Plan a trip here</button>
    </section>
  )
}

export default function FindScreen() {
  const doc = useStore((s) => s.doc)
  const today = todayIso()
  const [date, setDate] = useState(today)
  const [query, setQuery] = useState('')
  const [f, setF] = useState(() => ({
    bank: '', cardId: '', network: '', loungeId: '', status: '', holder: 'principal', flight: 'unknown',
    ...loadFilters(),
  }))
  const [more, setMore] = useState(false)
  const [logging, setLogging] = useState(null)
  const [adding, setAdding] = useState(null)
  const [planning, setPlanning] = useState(null)

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
  const cards = doc.cards.filter((c) => c.status !== 'closed' && (!f.bank || c.bank === f.bank))
  // A filter left over from a deleted card or lounge must not hide everything.
  const lounge = doc.lounges.find((l) => l.lounge_id === f.loungeId) || null
  const filters = {
    date: date || today,
    today,
    bank: f.bank,
    cardId: doc.cards.some((c) => c.card_id === f.cardId) ? f.cardId : '',
    network: f.network,
    status: f.status,
    holder: f.holder,
    flight: f.flight,
  }

  const searching = Boolean(query.trim()) && !lounge
  const matches = useMemo(() => (searching ? searchLounges(doc.lounges, query) : []), [doc.lounges, query, searching])
  const matchRows = useMemo(
    () => matches.slice(0, 20).map((l) => ({ lounge: l, rows: findAccess(doc, { ...filters, status: '', loungeId: l.lounge_id }) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, doc, date, f],
  )
  const rows = useMemo(
    () => (searching ? [] : findAccess(doc, { ...filters, loungeId: lounge?.lounge_id || '' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, date, today, f, lounge, searching],
  )
  const attention = useMemo(() => allAttention(doc, today), [doc, today])
  const active = [f.bank, f.cardId, f.network, f.status].filter(Boolean).length

  const pick = (l) => {
    set({ loungeId: l.lounge_id })
    setQuery('')
  }
  const onLog = (res) => setLogging({ card_id: res.card.card_id, lounge_id: res.lounge.lounge_id, date: date || today, holder: f.holder, flight: f.flight })
  const importTarget = query.trim() ? `import/lounges/${encodeURIComponent(query.trim())}` : 'import/lounges'

  if (!doc.cards.length) {
    return (
      <div className="space-y-4">
        <PageTitle title="Find a lounge" />
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
      <PageTitle title="Find a lounge">
        <button className="btn-ghost" onClick={() => go('ask')}><Icon name="ask" size={16} /> Ask</button>
      </PageTitle>

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

      <section className="card space-y-3 p-3.5" aria-label="Search">
        <div className="relative">
          <Icon name="find" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-9"
            aria-label="Search lounges"
            placeholder="Lounge, airport or programme"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (f.loungeId) set({ loungeId: '' })
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Visit date" type="date" value={date} onChange={setDate} />
          <SelectField label="Flight" value={f.flight} onChange={(flight) => set({ flight: flight || 'unknown' })} options={[['unknown', 'Not sure'], ['international', 'International'], ['domestic', 'Domestic']]} />
        </div>
        {more && (
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Bank" value={f.bank} onChange={(bank) => set({ bank: bank || '', cardId: '' })} options={pairs(banks)} placeholder="All banks" />
            <SelectField label="Card" value={f.cardId} onChange={(cardId) => set({ cardId: cardId || '' })} options={cards.map((c) => [c.card_id, `${c.bank} ${c.name}`])} placeholder="All cards" />
            <SelectField label="Programme" value={f.network} onChange={(network) => set({ network: network || '' })} options={pairs(networks)} placeholder="All programmes" />
            <SelectField label="Answer" value={f.status} onChange={(status) => set({ status: status || '' })} options={[['eligible', 'Eligible'], ['needs_spend', 'Eligible if you spend'], ['unclear', 'Unclear'], ['not_eligible', 'Not eligible'], ['not_covered', 'Not covered']]} placeholder="All answers" />
            <SelectField label="Cardholder" value={f.holder} onChange={(holder) => set({ holder: holder || 'principal' })} options={[['principal', 'Principal'], ['supplementary', 'Supplementary']]} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <button className="text-sm font-medium text-night-700" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'Fewer filters' : 'More filters'}
          </button>
          {active > 0 && (
            <button className="text-sm text-slate-600 underline" onClick={() => set({ bank: '', cardId: '', network: '', status: '' })}>
              Clear {active}
            </button>
          )}
        </div>
      </section>

      {searching && (
        <section aria-label="Lounges found" className="space-y-2">
          {matchRows.length === 0 && (
            <Empty
              title={`No saved lounge matches “${query.trim()}”`}
              action={
                <>
                  <button className="btn-accent" onClick={() => go(importTarget)}><Icon name="import" size={16} /> Find it with AI</button>
                  <button className="btn-ghost" onClick={() => setAdding({ name: query.trim() })}>Add by hand</button>
                </>
              }
            >
              Copy a prompt into an AI chat with web search, then paste the answer back to add this airport’s lounges.
            </Empty>
          )}
          {matchRows.map(({ lounge: l, rows: r }) => (
            <button key={l.lounge_id} className="card block w-full p-3 text-left" onClick={() => pick(l)}>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-semibold text-night-900">{loungeLabel(l)}</span>
                  <span className="block text-xs text-slate-500">{[(l.networks || []).join(', '), l.verified === false ? 'Unverified' : ''].filter(Boolean).join(' · ')}</span>
                </span>
                {r[0] && <StatusPill status={r[0].status} />}
              </span>
              <span className="mt-1 block text-sm text-slate-700">{countLabel(r)}</span>
            </button>
          ))}
          {matches.length > matchRows.length && <p className="text-center text-xs text-slate-500">Showing the first {matchRows.length}. Type more to narrow it down.</p>}
        </section>
      )}

      {lounge && (
        <LoungeHeader lounge={lounge} onClear={() => set({ loungeId: '' })} onPlan={() => setPlanning({ airport_code: lounge.airport_code, lounge_id: lounge.lounge_id, flight: f.flight })} />
      )}

      {lounge && (
        <div className="space-y-4">
          {GROUPS.map(([status, title]) => {
            const list = rows.filter((r) => r.status === status)
            if (!list.length) return null
            return (
              <section key={status} aria-label={title} className="space-y-2">
                <h3 className="px-1 text-sm font-semibold text-night-900">{title} ({list.length})</h3>
                <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
                  {list.map((r) => <ResultCard key={r.card.card_id} result={r} onLog={onLog} hideLounge />)}
                </div>
              </section>
            )
          })}
          {rows.some((r) => r.status === 'not_covered') && (
            <details className="card p-3 text-sm">
              <summary className="cursor-pointer font-medium text-night-700">
                {rows.filter((r) => r.status === 'not_covered').length} other cards don’t cover this lounge
              </summary>
              <ul className="mt-2 space-y-2">
                {rows.filter((r) => r.status === 'not_covered').map((r) => (
                  <li key={r.card.card_id}>
                    <p className="font-medium text-slate-800">{r.card.bank} {r.card.name}</p>
                    <p className="text-xs text-slate-600">{r.headline}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!rows.length && <Empty title="Nothing matches these filters">Clear a filter to see your other cards.</Empty>}
        </div>
      )}

      {!searching && !lounge && (
        <section aria-label="Your cards" className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-night-900">Your cards</h2>
          {rows.length === 0 && <Empty title="Nothing matches these filters">Clear a filter, or search for a lounge above.</Empty>}
          <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
            {rows.map((r) => (
              <ResultCard key={`${r.card?.card_id}|${r.lounge?.lounge_id || ''}`} result={r} onLog={onLog} />
            ))}
          </div>
          {!doc.lounges.length && (
            <button className="btn-ghost w-full sm:w-auto" onClick={() => go('import/lounges')}><Icon name="import" size={16} /> Add lounges with AI</button>
          )}
        </section>
      )}

      {logging && <VisitForm initial={logging} onClose={() => setLogging(null)} />}
      {adding && <LoungeForm initial={adding} onClose={() => setAdding(null)} />}
      {planning && <TripForm initial={planning} onClose={() => setPlanning(null)} />}
    </div>
  )
}
