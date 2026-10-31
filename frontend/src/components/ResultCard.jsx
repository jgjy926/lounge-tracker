// One eligibility answer: the verdict up front, the working and T&C quotes below.
import { useState } from 'react'
import { Icon, STATUS_UI, StatusPill } from './ui'
import { cardLabel, loungeLabel } from '../lib/schema'
import { formatDate, formatRange } from '../lib/dates'
import { money } from '../lib/engine'

const CHECK_UI = {
  ok: ['check', 'text-emerald-600'],
  warn: ['clock', 'text-amber-600'],
  fail: ['x', 'text-red-600'],
  unknown: ['question', 'text-indigo-600'],
}

function SpendMeter({ spend }) {
  const pct = Math.min(100, Math.round((Math.max(0, spend.have) / spend.need) * 100))
  const fmt = (n) => (spend.unit === 'txn' ? String(n) : money(n))
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs text-slate-600">
        <span>
          {fmt(spend.have)} of {fmt(spend.need)}
          {spend.unit === 'txn' ? ' transactions' : ''}
        </span>
        <span>{formatRange(spend.window.start, spend.window.end)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${spend.met ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function ResultDetail({ result }) {
  const { checks = [], reminders = [], spend, rule, others = [] } = result
  return (
    <div className="space-y-3">
      {spend && <SpendMeter spend={spend} />}
      {checks.length > 0 && (
        <ul className="space-y-2">
          {checks.map((c, i) => {
            const [icon, cls] = CHECK_UI[c.state]
            return (
              <li key={i} className="flex gap-2 text-sm">
                <Icon name={icon} size={18} className={`mt-0.5 shrink-0 ${cls}`} />
                <div className="min-w-0">
                  <p>
                    <span className="font-medium text-slate-800">{c.label}:</span> <span className="text-slate-700">{c.detail}</span>
                  </p>
                  {c.clause && <p className="mt-0.5 border-l-2 border-brass-400 pl-2 text-xs italic text-slate-500">“{c.clause}”</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {reminders.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-brass-100 p-3 text-sm text-slate-800">
          {reminders.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {rule && (
        <p className="text-xs text-slate-500">
          {rule.title}
          {rule.source_document ? `. Source: ${rule.source_document}` : ''}
          {rule.last_verified ? `. Checked ${formatDate(rule.last_verified)}.` : '.'}
        </p>
      )}
      {others.filter((o) => o.status !== 'not_covered').map((o) => (
        <p key={o.rule.rule_id} className="text-xs text-slate-500">
          Also on this card: {o.rule.title}: {STATUS_UI[o.status].label.toLowerCase()}.
        </p>
      ))}
    </div>
  )
}

export default function ResultCard({ result, onLog, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const ui = STATUS_UI[result.status] || STATUS_UI.not_covered
  const hasDetail = result.rule
  return (
    <article className={`card border-l-4 ${ui.border}`}>
      <button
        className="block w-full p-3.5 text-left disabled:cursor-default"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasDetail}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-night-900">{cardLabel(result.card)}</h3>
            {result.lounge && <p className="text-sm text-slate-600">{loungeLabel(result.lounge)}</p>}
          </div>
          <StatusPill status={result.status} />
        </div>
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <p className="text-sm text-slate-800">{result.headline}</p>
          {hasDetail && <Icon name="chevron" size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
        </div>
      </button>
      {open && hasDetail && (
        <div className="space-y-3 border-t border-slate-100 p-3.5">
          <ResultDetail result={result} />
          {onLog && result.lounge && (
            <button className="btn-ghost w-full sm:w-auto" onClick={() => onLog(result)}>
              <Icon name="plus" size={16} /> Log this visit
            </button>
          )}
        </div>
      )}
    </article>
  )
}
