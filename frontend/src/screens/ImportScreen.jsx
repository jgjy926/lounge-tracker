// Copy prompt > any AI > paste the JSON back > review > register.
// Nothing touches the document before the final button.
import { useEffect, useMemo, useState } from 'react'
import { Field, Icon, PageTitle, Segmented, SelectField, go } from '../components/ui'
import { useStore } from '../store/useStore'
import { applyRulesImport, applySpendImport, markDuplicates, parsePaste } from '../lib/importer'
import { buildRulesPrompt, buildSpendPrompt } from '../lib/prompts'
import { QUOTA_PERIODS, SPEND_TYPE_LABEL, cardLabel, emptyCard, loungeLabel } from '../lib/schema'
import { formatDate, todayIso } from '../lib/dates'
import { money } from '../lib/engine'
import { copyText } from '../lib/platform'

const ISSUE_UI = {
  gap: 'text-amber-800',
  warn: 'text-red-700',
  soft: 'text-slate-600',
  note: 'text-slate-500',
}

function ruleSummary(r) {
  const q = r.quota
  const c = r.condition
  const period = QUOTA_PERIODS.find(([k]) => k === q.period)?.[1]?.toLowerCase()
  const visits = q.unlimited ? 'Unlimited visits' : q.principal != null ? `${q.principal} visits${period ? ` per ${period}` : ''}` : 'Visits not stated'
  const days = [c.days_before != null && `${c.days_before} days before`, c.days_after != null && `${c.days_after} days after`].filter(Boolean).join(' / ')
  const cond =
    c.type === 'none' ? 'no spend needed'
      : c.type === 'min_spend' ? `${c.amount != null ? money(c.amount) : 'an unstated amount'}${days ? `, ${days}` : ''}`
        : c.type === 'min_txn' ? `${c.count ?? '?'} transactions${days ? `, ${days}` : ''}`
          : 'condition not stated'
  return `${visits}, ${cond}`
}

function RuleDraft({ draft, doc, onChange }) {
  const { rule, card, issues, changes, current } = draft
  const shown = issues.filter((i) => i.level !== 'soft')
  const soft = issues.filter((i) => i.level === 'soft')
  return (
    <article className={`card p-3.5 ${draft.include ? '' : 'opacity-60'}`}>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={draft.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <span className="min-w-0">
          <span className="block font-semibold text-night-900">{rule.title}</span>
          <span className="block text-sm text-slate-700">{ruleSummary(rule)}</span>
        </span>
      </label>

      <div className="mt-3">
        <SelectField
          label={`Card (T&C says: ${[card.bank, card.name].filter(Boolean).join(' ') || 'not stated'})`}
          value={draft.card_id || ''}
          onChange={(card_id) => onChange({ card_id: card_id || null })}
          options={doc.cards.map((c) => [c.card_id, cardLabel(c)])}
          placeholder={card.bank || card.name ? 'Create a new card from the T&C' : 'Create a new card'}
        />
      </div>

      {current && (
        <div className="mt-3 rounded-lg bg-brass-100 p-3 text-sm">
          <p className="font-medium text-night-900">
            {changes.length ? `Replaces the current rule. ${changes.length} change${changes.length === 1 ? '' : 's'}:` : 'Same terms as the current rule. Registering updates its checked date.'}
          </p>
          {changes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {changes.map((c) => (
                <li key={c.path}>
                  {c.label}: <s className="text-slate-500">{c.from}</s> → <b>{c.to}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {shown.map((i, n) => (
            <li key={n} className={ISSUE_UI[i.level]}>{i.message}</li>
          ))}
        </ul>
      )}
      {soft.length > 0 && (
        <details className="mt-2 text-sm text-slate-600">
          <summary className="cursor-pointer">{soft.length} more not stated in the T&C</summary>
          <ul className="mt-1 space-y-1">
            {soft.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </details>
      )}
      {Object.keys(rule.evidence).length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-night-700">T&C quotes behind these values</summary>
          <ul className="mt-1 space-y-1.5">
            {Object.entries(rule.evidence).map(([k, v]) => (
              <li key={k} className="border-l-2 border-brass-400 pl-2 italic text-slate-700">“{String(v)}”</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

function RulesPreview({ preview, setPreview, onDone }) {
  const doc = useStore((s) => s.doc)
  const replaceDoc = useStore((s) => s.replaceDoc)
  const showToast = useStore((s) => s.showToast)
  const patch = (i, p) => setPreview((x) => ({ ...x, drafts: x.drafts.map((d, n) => (n === i ? { ...d, ...p } : d)) }))
  const patchLounge = (i, p) => setPreview((x) => ({ ...x, lounges: x.lounges.map((l, n) => (n === i ? { ...l, ...p } : l)) }))
  const count = preview.drafts.filter((d) => d.include).length + preview.lounges.filter((l) => l.include).length

  function register() {
    const { doc: next, added, replaced, loungesAdded } = applyRulesImport(doc, preview, {
      today: todayIso(),
      newCard: (c) => ({ ...emptyCard(), bank: c.bank || 'Unknown bank', name: c.name || 'Unknown card' }),
    })
    replaceDoc(next)
    const parts = [
      added && `${added} rule${added === 1 ? '' : 's'} added`,
      replaced && `${replaced} updated`,
      loungesAdded && `${loungesAdded} lounge${loungesAdded === 1 ? '' : 's'} added`,
    ].filter(Boolean)
    showToast(parts.join(', ') || 'Nothing to register')
    onDone()
  }

  return (
    <section className="space-y-3" aria-label="Review the import">
      <h2 className="font-semibold text-night-900">3. Review, then register</h2>
      {preview.source_document && <p className="text-sm text-slate-600">Source: {preview.source_document}</p>}
      {preview.drafts.map((d, i) => (
        <RuleDraft key={d.rule.rule_id} draft={d} doc={doc} onChange={(p) => patch(i, p)} />
      ))}
      {preview.lounges.length > 0 && (
        <div className="card divide-y divide-slate-100">
          {preview.lounges.map((l, i) => (
            <label key={l.lounge.lounge_id} className="flex items-start gap-2.5 p-3">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={l.include} onChange={(e) => patchLounge(i, { include: e.target.checked })} />
              <span>
                <span className="block text-sm font-medium text-slate-800">{loungeLabel(l.lounge)}</span>
                <span className="block text-xs text-slate-500">
                  {(l.lounge.networks || []).join(', ')}
                  {l.duplicate ? ' · Already saved' : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      <button className="btn-accent w-full sm:w-auto" disabled={!count} onClick={register}>
        Register {count} item{count === 1 ? '' : 's'}
      </button>
    </section>
  )
}

function SpendPreview({ preview, setPreview, onDone }) {
  const doc = useStore((s) => s.doc)
  const replaceDoc = useStore((s) => s.replaceDoc)
  const showToast = useStore((s) => s.showToast)
  const patch = (i, include) => setPreview((x) => ({ ...x, rows: x.rows.map((r, n) => (n === i ? { ...r, include } : r)) }))
  const selected = preview.rows.filter((r) => r.include && r.valid)
  const total = selected.reduce((n, r) => n + Number(r.spend.amount), 0)

  function chooseCard(card_id) {
    setPreview((x) => ({ ...x, card_id: card_id || '', rows: markDuplicates(x.rows, doc, card_id) }))
  }

  function commit() {
    const { doc: next, added } = applySpendImport(doc, preview, preview.card_id)
    replaceDoc(next)
    showToast(`${added} transaction${added === 1 ? '' : 's'} added`)
    onDone()
  }

  return (
    <section className="space-y-3" aria-label="Review the transactions">
      <h2 className="font-semibold text-night-900">3. Review, then add</h2>
      <SelectField label="Add to card" value={preview.card_id} onChange={chooseCard} options={doc.cards.map((c) => [c.card_id, cardLabel(c)])} placeholder="Choose a card" />
      <ul className="card divide-y divide-slate-100">
        {preview.rows.map((r, i) => (
          <li key={r.spend.spend_id}>
            <label className={`flex items-start gap-2.5 p-3 ${r.valid ? '' : 'opacity-60'}`}>
              <input type="checkbox" className="mt-1 h-5 w-5" disabled={!r.valid} checked={r.include} onChange={(e) => patch(i, e.target.checked)} />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-slate-800">{r.spend.merchant || 'No merchant'}</span>
                  <span className="shrink-0 font-semibold">{r.spend.amount != null ? money(r.spend.amount) : '?'}</span>
                </span>
                <span className="block text-xs text-slate-500">
                  {r.spend.date ? formatDate(r.spend.date) : 'No date'}
                  {r.spend.type !== 'retail' ? ` · ${SPEND_TYPE_LABEL[r.spend.type]}` : ''}
                  {r.spend.overseas ? ' · Overseas' : ''}
                  {r.duplicate ? ' · Already saved' : ''}
                </span>
                {r.issues.map((x, n) => (
                  <span key={n} className="block text-xs text-red-700">{x.message}</span>
                ))}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button className="btn-accent w-full sm:w-auto" disabled={!selected.length || !preview.card_id} onClick={commit}>
        Add {selected.length} transaction{selected.length === 1 ? '' : 's'} ({money(total)})
      </button>
    </section>
  )
}

export default function ImportScreen({ arg }) {
  const doc = useStore((s) => s.doc)
  const [kindArg, docArg] = (arg || '').split('/')
  const [kind, setKind] = useState(kindArg === 'spend' ? 'spend' : 'rules')
  const [docId, setDocId] = useState(docArg || '')
  const [cardId, setCardId] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setKind(kindArg === 'spend' ? 'spend' : 'rules')
    if (docArg) setDocId(docArg)
  }, [kindArg, docArg])

  const prompt = useMemo(() => {
    if (kind === 'spend') return buildSpendPrompt(doc.cards.find((c) => c.card_id === cardId))
    const tnc = doc.documents.find((d) => d.doc_id === docId)?.text || ''
    return buildRulesPrompt(doc.cards.filter((c) => c.status !== 'closed'), tnc)
  }, [kind, doc.cards, doc.documents, docId, cardId])

  async function copy() {
    const ok = await copyText(prompt)
    setCopied(ok)
    setTimeout(() => setCopied(false), 2500)
  }

  function read() {
    setError('')
    const result = parsePaste(text, { doc, today: todayIso() })
    if (result.kind === 'error') {
      setError(result.error)
      setPreview(null)
      return
    }
    // The paste decides what it is, whichever tab it landed in.
    setKind(result.kind === 'spends' ? 'spend' : 'rules')
    if (result.kind === 'spends' && !result.card_id && cardId) {
      setPreview({ ...result, card_id: cardId, rows: markDuplicates(result.rows, doc, cardId) })
    } else {
      setPreview(result)
    }
  }

  async function pickFile(e) {
    const file = e.target.files?.[0]
    if (file) setText(await file.text())
  }

  function done() {
    setPreview(null)
    setText('')
    go(kind === 'spend' ? 'spend' : 'library')
  }

  return (
    <div className="space-y-4">
      <PageTitle title="Import with AI" />
      <Segmented
        label="What to import"
        value={kind}
        onChange={(k) => { setKind(k); setPreview(null); setError('') }}
        options={[['rules', 'Bank T&C'], ['spend', 'Statement']]}
      />

      <section className="card space-y-3 p-3.5" aria-label="Copy the prompt">
        <h2 className="font-semibold text-night-900">1. Copy the prompt</h2>
        {kind === 'rules' ? (
          <>
            {doc.documents.length > 0 && (
              <SelectField label="Include a saved T&C" value={docId} onChange={(v) => setDocId(v || '')} options={doc.documents.map((d) => [d.doc_id, d.title])} placeholder="No, I’ll attach or paste it in the AI chat" />
            )}
            <p className="text-sm text-slate-600">Paste this into Claude, ChatGPT or Gemini{docId ? '' : ' and attach the bank’s T&C PDF'}. Use the bank’s own T&C rather than a blog.</p>
          </>
        ) : (
          <>
            <SelectField label="Card" value={cardId} onChange={(v) => setCardId(v || '')} options={doc.cards.map((c) => [c.card_id, cardLabel(c)])} placeholder="Choose a card" />
            <p className="text-sm text-slate-600">Paste this into any AI chat and attach the statement or a screenshot of your banking app.</p>
          </>
        )}
        <button className="btn-primary" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </section>

      <section className="card space-y-3 p-3.5" aria-label="Paste the answer">
        <h2 className="font-semibold text-night-900">2. Paste the AI’s answer</h2>
        <Field label="JSON from the AI">
          {(id) => (
            <textarea
              id={id}
              rows={7}
              className="input font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'```json\n{ "schema": "lounge-rules-import/v1", ...'}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!text.trim()} onClick={read}>Read it</button>
          <label className="cursor-pointer text-sm font-medium text-night-700 underline">
            or choose a .json file
            <input type="file" accept=".json,.txt,application/json" className="sr-only" onChange={pickFile} />
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>

      {preview?.kind === 'rules' && <RulesPreview preview={preview} setPreview={setPreview} onDone={done} />}
      {preview?.kind === 'spends' && <SpendPreview preview={preview} setPreview={setPreview} onDone={done} />}
    </div>
  )
}
