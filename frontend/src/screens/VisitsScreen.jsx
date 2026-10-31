// Visit log, with how many visits each benefit has left.
import { useMemo, useState } from 'react'
import { Empty, Icon, PageTitle, SelectField, StatusPill, go } from '../components/ui'
import { VisitForm } from '../components/forms'
import { useStore } from '../store/useStore'
import { assessQuota, evaluateVisit } from '../lib/engine'
import { cardLabel, loungeLabel } from '../lib/schema'
import { formatDate, todayIso } from '../lib/dates'

function QuotaRow({ rule, card, doc, today }) {
  const q = assessQuota(doc, rule, card, { date: today, holder: 'principal' })
  if (!q.known || q.total === 0) return null
  const unlimited = q.total === Infinity
  const pct = unlimited ? 0 : Math.min(100, (q.used / q.total) * 100)
  return (
    <div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-slate-800">{card ? `${card.bank} ${card.name}` : rule.title} · {rule.network}</span>
        <span className="shrink-0 font-medium text-night-900">{unlimited ? `${q.used} used` : `${q.left} of ${q.total} left`}</span>
      </div>
      {!unlimited && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full ${q.left === 0 ? 'bg-red-500' : 'bg-brass-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function VisitsScreen() {
  const doc = useStore((s) => s.doc)
  const today = todayIso()
  const [editing, setEditing] = useState(null)
  const [cardId, setCardId] = useState('')
  const [year, setYear] = useState('')

  const years = [...new Set(doc.visits.map((v) => v.date.slice(0, 4)))].sort().reverse()
  const visits = useMemo(
    () =>
      doc.visits
        .filter((v) => (!cardId || v.card_id === cardId) && (!year || v.date.startsWith(year)))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((v) => ({ v, r: evaluateVisit(doc, v, today) })),
    [doc, cardId, year, today],
  )
  const liveRules = doc.rules.filter((r) => (!r.effective_to || r.effective_to >= today) && (!r.effective_from || r.effective_from <= today))

  return (
    <div className="space-y-4">
      <PageTitle title="Visits">
        <button className="btn-primary" disabled={!doc.cards.length} onClick={() => setEditing({})}>
          <Icon name="plus" size={16} /> Log a visit
        </button>
      </PageTitle>

      {liveRules.length > 0 && (
        <section className="card space-y-3 p-3.5" aria-label="Visits left">
          <h2 className="text-sm font-semibold text-night-900">Visits left now</h2>
          {liveRules.map((r) => (
            <QuotaRow key={r.rule_id} rule={r} card={doc.cards.find((c) => c.card_id === r.card_id)} doc={doc} today={today} />
          ))}
        </section>
      )}

      {doc.visits.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Card" value={cardId} onChange={(v) => setCardId(v || '')} options={doc.cards.map((c) => [c.card_id, `${c.bank} ${c.name}`])} placeholder="All cards" />
          <SelectField label="Year" value={year} onChange={(v) => setYear(v || '')} options={years.map((y) => [y, y])} placeholder="All years" />
        </div>
      )}

      {!doc.visits.length && (
        <Empty title="No visits logged yet" action={!doc.cards.length && <button className="btn-accent" onClick={() => go('import')}>Import a T&C first</button>}>
          Log each lounge visit so the app can count your quota and watch any spend you still need.
        </Empty>
      )}

      <ul className="space-y-2">
        {visits.map(({ v, r }) => (
          <li key={v.visit_id}>
            <button className="card block w-full p-3 text-left" onClick={() => setEditing(v)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-night-900">{formatDate(v.date)}</p>
                  <p className="text-sm text-slate-700">{loungeLabel(doc.lounges.find((l) => l.lounge_id === v.lounge_id))}</p>
                  <p className="text-xs text-slate-500">
                    {cardLabel(doc.cards.find((c) => c.card_id === v.card_id))}
                    {v.holder === 'supplementary' ? ' · Supplementary' : ''}
                    {v.guests ? ` · ${v.guests} guest${v.guests === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                {v.charged ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Paid</span>
                ) : (
                  <StatusPill status={r.status} />
                )}
              </div>
              {!v.charged && r.status !== 'eligible' && <p className="mt-1.5 text-sm text-slate-700">{r.headline}</p>}
            </button>
          </li>
        ))}
      </ul>

      {editing && <VisitForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
