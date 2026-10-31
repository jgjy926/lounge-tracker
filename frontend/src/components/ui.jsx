// Shared building blocks. Icons are inline so the app has no icon dependency.
import { useEffect, useId } from 'react'
import { pushBack } from '../lib/platform'

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  ask: 'M4 5h16v11H9l-5 4V5z',
  visits: 'M4 16.5V11a3 3 0 013-3h10a3 3 0 013 3v5.5M6 8V6.5A2.5 2.5 0 018.5 4h7A2.5 2.5 0 0118 6.5V8M3 13.5h3v3h12v-3h3v4H3v-4zM7 17.5V20M17 17.5V20',
  spend: 'M3 6.5h18v11H3v-11zM3 10.5h18M7 14.5h4',
  library: 'M5 4h4v16H5V4zM11 4h4v16h-4V4zM17 5l3 .6-2.5 14.4-3-.6',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.2V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.2-2.7H3a2 2 0 010-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.3a2.6 2.6 0 015 .7c0 1.7-2.5 2.2-2.5 3.8M12 17h.01',
  import: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M4 20h16',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M6 9l6 6 6-6',
  x: 'M7 7l10 10M17 7L7 17',
  question: 'M9.5 9.3a2.6 2.6 0 015 .7c0 1.7-2.5 2.2-2.5 3.8M12 17h.01',
  dash: 'M6 12h12',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M9 9h11v11H9V9zM5 15H4V4h11v1',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
  refresh: 'M20 11a8 8 0 00-14.3-4M4 4v4h4M4 13a8 8 0 0014.3 4M20 20v-4h-4',
}

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export const STATUS_UI = {
  eligible: { label: 'Eligible', icon: 'check', pill: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500', border: 'border-l-emerald-500' },
  needs_spend: { label: 'Eligible if you spend', icon: 'clock', pill: 'bg-amber-100 text-amber-900', bar: 'bg-amber-500', border: 'border-l-amber-500' },
  unclear: { label: 'Unclear', icon: 'question', pill: 'bg-indigo-100 text-indigo-800', bar: 'bg-indigo-400', border: 'border-l-indigo-400' },
  not_eligible: { label: 'Not eligible', icon: 'x', pill: 'bg-red-100 text-red-800', bar: 'bg-red-500', border: 'border-l-red-500' },
  not_covered: { label: 'Not covered', icon: 'dash', pill: 'bg-slate-200 text-slate-700', bar: 'bg-slate-400', border: 'border-l-slate-300' },
}

export function StatusPill({ status }) {
  const ui = STATUS_UI[status] || STATUS_UI.not_covered
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ui.pill}`}>
      <Icon name={ui.icon} size={13} />
      {ui.label}
    </span>
  )
}

export function Field({ label, hint, children, className = '' }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function TextField({ label, hint, value, onChange, className, ...rest }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => <input id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </Field>
  )
}

export function AreaField({ label, hint, value, onChange, className, rows = 3, ...rest }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => <textarea id={id} rows={rows} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </Field>
  )
}

export function NumberField({ label, hint, value, onChange, className, ...rest }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <input
          id={id}
          className="input"
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          {...rest}
        />
      )}
    </Field>
  )
}

export function SelectField({ label, hint, value, onChange, options, placeholder, className }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

// Yes / No / Not stated. A rule's null is a real answer, so it needs its own button.
export function TriState({ label, hint, value, onChange }) {
  const opts = [
    [true, 'Yes'],
    [false, 'No'],
    [null, 'Not stated'],
  ]
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label={label}>
        {opts.map(([v, l]) => (
          <button
            key={l}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`min-h-[36px] border-r border-slate-300 px-3 text-sm last:border-r-0 ${value === v ? 'bg-night-900 text-white' : 'bg-white text-slate-700'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-200 p-1" role="tablist" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`min-h-[36px] flex-1 rounded-md px-2 text-sm font-medium ${value === v ? 'bg-white text-night-900 shadow-sm' : 'text-slate-600'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

// Bottom sheet on a phone, centred dialog on a desktop. Back and Esc close it.
export function Sheet({ title, onClose, children, footer, wide = false }) {
  useEffect(() => pushBack(onClose), [onClose])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-night-950/50 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`pad-safe-bottom flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-night-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="card px-5 py-8 text-center">
      <p className="font-semibold text-night-900">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function PageTitle({ title, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-bold text-night-900">{title}</h1>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

export const go = (route) => {
  window.location.hash = `#/${route}`
}
