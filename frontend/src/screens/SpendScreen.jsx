// Card spend, which is what the engine checks a visit's spend condition against.
import { useMemo, useState } from 'react'
import { Empty, Icon, PageTitle, SelectField, go } from '../components/ui'
import { SpendForm } from '../components/forms'
import { useStore } from '../store/useStore'
import { SPEND_TYPE_LABEL, cardLabel } from '../lib/schema'
import { formatDate, todayIso } from '../lib/dates'
import { money } from '../lib/engine'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

export default function SpendScreen() {
  const doc = useStore((s) => s.doc)
  const [editing, setEditing] = useState(null)
  const [cardId, setCardId] = useState('')
  const [month, setMonth] = useState('')

  const months = [...new Set(doc.spends.map((s) => s.date.slice(0, 7)))].sort().reverse()
  const groups = useMemo(() => {
    const rows = doc.spends
      .filter((s) => (!cardId || s.card_id === cardId) && (!month || s.date.startsWith(month)))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    const map = new Map()
    for (const s of rows) {
      const k = s.date.slice(0, 7)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(s)
    }
    return [...map.entries()]
  }, [doc.spends, cardId, month])

  return (
    <div className="space-y-4">
      <PageTitle title="Spend">
        <button className="btn-ghost" onClick={() => go('import/spend')}>
          <Icon name="import" size={16} /> Import
        </button>
        <button className="btn-primary" disabled={!doc.cards.length} onClick={() => setEditing({ date: todayIso(), card_id: cardId })}>
          <Icon name="plus" size={16} /> Add
        </button>
      </PageTitle>

      {doc.spends.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Card" value={cardId} onChange={(v) => setCardId(v || '')} options={doc.cards.map((c) => [c.card_id, `${c.bank} ${c.name}`])} placeholder="All cards" />
          <SelectField label="Month" value={month} onChange={(v) => setMonth(v || '')} options={months.map((m) => [m, monthLabel(m)])} placeholder="All months" />
        </div>
      )}

      {!doc.spends.length && (
        <Empty
          title="No spend recorded yet"
          action={doc.cards.length ? <button className="btn-accent" onClick={() => go('import/spend')}>Import from a statement</button> : <button className="btn-accent" onClick={() => go('import')}>Import a T&C first</button>}
        >
          Add spend so the app can check conditions like RM500 in the 30 days around a visit. Only cards with a spend condition need this.
        </Empty>
      )}

      {groups.map(([ym, rows]) => (
        <section key={ym} aria-label={monthLabel(ym)}>
          <div className="mb-1.5 flex justify-between px-1 text-sm">
            <h2 className="font-semibold text-night-900">{monthLabel(ym)}</h2>
            <span className="text-slate-600">{money(rows.reduce((n, s) => n + Number(s.amount || 0), 0))}</span>
          </div>
          <ul className="card divide-y divide-slate-100">
            {rows.map((s) => (
              <li key={s.spend_id}>
                <button className="flex w-full items-start justify-between gap-3 p-3 text-left" onClick={() => setEditing(s)}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{s.merchant || SPEND_TYPE_LABEL[s.type]}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDate(s.date, { year: false })} · {cardLabel(doc.cards.find((c) => c.card_id === s.card_id))}
                      {s.type !== 'retail' ? ` · ${SPEND_TYPE_LABEL[s.type] || s.type}` : ''}
                      {s.holder === 'supplementary' ? ' · Supp' : ''}
                      {s.overseas ? ' · Overseas' : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold ${s.amount < 0 ? 'text-emerald-700' : 'text-night-900'}`}>{money(s.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && <SpendForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
