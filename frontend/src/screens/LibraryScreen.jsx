// Maintenance: cards, lounges, rules with their version history, and saved T&Cs.
import { useState } from 'react'
import { AreaField, Empty, Icon, PageTitle, Segmented, SelectField, Sheet, TextField, go } from '../components/ui'
import { CardForm, LoungeForm } from '../components/forms'
import RuleForm from '../components/RuleForm'
import { useStore } from '../store/useStore'
import { STALE_AFTER_DAYS, money } from '../lib/engine'
import { QUOTA_PERIODS, SPEND_TYPE_LABEL, WINDOWS, cardLabel, loungeLabel, uid } from '../lib/schema'
import { diffDays, formatDate, formatRange, todayIso } from '../lib/dates'
import { cloudEnabled, fetchFile, uploadFile } from '../lib/api'
import { downloadBlob, isNative } from '../lib/platform'
import { extractPdfText } from '../lib/pdf'

const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b))
const NOT_STATED = 'Not stated'
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : NOT_STATED)
const label = (pairs, v) => pairs.find(([k]) => k === v)?.[1] || NOT_STATED

// ---------- cards ----------

function CardsTab() {
  const doc = useStore((s) => s.doc)
  const [editing, setEditing] = useState(null)
  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add card</button>
      </div>
      {!doc.cards.length && <Empty title="No cards yet">Importing a T&C creates the card for you, or add one here.</Empty>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {doc.cards.map((c) => (
          <li key={c.card_id}>
            <button className="card block w-full p-3 text-left" onClick={() => setEditing(c)}>
              <p className="font-semibold text-night-900">{cardLabel(c)}</p>
              <p className="text-xs text-slate-500">
                {doc.rules.filter((r) => r.card_id === c.card_id && !r.effective_to).length} live rules
                {c.status === 'closed' ? ' · Closed' : ''}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {editing && <CardForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------- lounges ----------

function LoungesTab() {
  const doc = useStore((s) => s.doc)
  const [editing, setEditing] = useState(null)
  const [country, setCountry] = useState('')
  const [network, setNetwork] = useState('')
  const countries = uniq(doc.lounges.map((l) => l.country))
  const networks = uniq(doc.lounges.flatMap((l) => l.networks || []))
  const rows = doc.lounges
    .filter((l) => (!country || l.country === country) && (!network || (l.networks || []).includes(network)))
    .sort((a, b) => `${a.airport_code}${a.name}`.localeCompare(`${b.airport_code}${b.name}`))
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-ghost" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add lounge</button>
      </div>
      {doc.lounges.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Country" value={country} onChange={(v) => setCountry(v || '')} options={countries.map((x) => [x, x])} placeholder="All countries" />
          <SelectField label="Programme" value={network} onChange={(v) => setNetwork(v || '')} options={networks.map((x) => [x, x])} placeholder="All programmes" />
        </div>
      )}
      {!doc.lounges.length && <Empty title="No lounges yet">Add the lounges you actually use. There’s no need for a full directory.</Empty>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((l) => (
          <li key={l.lounge_id}>
            <button className="card block w-full p-3 text-left" onClick={() => setEditing(l)}>
              <p className="font-semibold text-night-900">{loungeLabel(l)}</p>
              <p className="text-xs text-slate-500">{[(l.networks || []).join(', '), l.airport_name, l.country].filter(Boolean).join(' · ')}</p>
            </button>
          </li>
        ))}
      </ul>
      {editing && <LoungeForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------- rules ----------

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-slate-600">{k}</dt>
      <dd className={`text-right ${v === NOT_STATED ? 'text-indigo-700' : 'font-medium text-slate-800'}`}>{v}</dd>
    </div>
  )
}

function RuleDetail({ rule, onEdit, onClose }) {
  const doc = useStore((s) => s.doc)
  const upsertRule = useStore((s) => s.upsertRule)
  const c = rule.condition
  const q = rule.quota
  const today = todayIso()
  const versions = doc.rules.filter((r) => r.group === rule.group && r.rule_id !== rule.rule_id)
  const evidence = Object.entries(rule.evidence || {})
  const condText = c.type === 'none' ? 'None' : c.type === 'min_spend' ? money(c.amount) : c.type === 'min_txn' ? `${c.count} transactions` : NOT_STATED

  return (
    <Sheet
      title={rule.title || rule.network}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={() => { upsertRule({ ...rule, last_verified: today }); onClose() }}>Checked today</button>
          <button className="btn-primary" onClick={onEdit}><Icon name="edit" size={16} /> Edit</button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{cardLabel(doc.cards.find((x) => x.card_id === rule.card_id))} · {rule.network}</p>
      <dl className="divide-y divide-slate-100">
        <Row k="Principal visits" v={q.unlimited ? 'Unlimited' : (q.principal ?? NOT_STATED)} />
        <Row k="Supplementary visits" v={q.unlimited ? 'Unlimited' : (q.supplementary ?? NOT_STATED)} />
        <Row k="Visits reset" v={label(QUOTA_PERIODS, q.period)} />
        <Row k="Limit per day" v={q.per_day_limit ?? NOT_STATED} />
        <Row k="Condition" v={condText} />
        {c.type && c.type !== 'none' && (
          <>
            <Row k="Spend window" v={label(WINDOWS, c.window)} />
            {c.days_before != null && <Row k="Days before" v={c.days_before} />}
            {c.days_after != null && <Row k="Days after" v={c.days_after} />}
            <Row k="Before + after adds up" v={yn(c.sides_combine)} />
            <Row k="Transactions add up" v={yn(c.cumulative)} />
            <Row k="Last day counts" v={yn(c.boundary_inclusive)} />
            <Row k="Visit day counts" v={yn(c.visit_day_counts)} />
            <Row k="One spend, several visits" v={yn(c.same_spend_reusable)} />
            <Row k="Whose spend counts" v={label([['principal_only', 'Principal only'], ['same_holder', 'Each cardholder’s own'], ['any', 'Anyone on the account']], c.spend_holder)} />
            <Row k="Doesn’t count" v={(c.excluded_spend_types || []).map((t) => SPEND_TYPE_LABEL[t] || t).join(', ') || NOT_STATED} />
          </>
        )}
        <Row k="Flights" v={rule.flight_scope || NOT_STATED} />
        <Row k="Countries" v={(rule.countries || []).join(', ') || NOT_STATED} />
        <Row k="Guests use visits" v={yn(rule.guest.consumes_quota)} />
        {rule.penalty.amount != null && <Row k="Fee if not met" v={money(rule.penalty.amount)} />}
        {rule.duration_hours != null && <Row k="Stay limit" v={`${rule.duration_hours} hours`} />}
        <Row k="In force" v={`${rule.effective_from ? formatDate(rule.effective_from) : 'No start date'} to ${rule.effective_to ? formatDate(rule.effective_to) : 'now'}`} />
        <Row k="Last checked" v={rule.last_verified ? formatDate(rule.last_verified) : 'Never'} />
      </dl>
      {[['Exclusions', c.excluded_spend_text], ['Guests', rule.guest.note], ['Fee', rule.penalty.note], ['At entry', rule.entry_requirements], ['Notes', rule.notes], ['Source', rule.source_document]]
        .filter(([, t]) => t)
        .map(([h, t]) => (
          <div key={h}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</h3>
            <p className="text-sm text-slate-800">{t}</p>
          </div>
        ))}
      {evidence.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">From the T&C</h3>
          <ul className="space-y-2">
            {evidence.map(([k, quote]) => (
              <li key={k} className="border-l-2 border-brass-400 pl-2 text-sm italic text-slate-700">
                “{String(quote)}”
              </li>
            ))}
          </ul>
        </div>
      )}
      {versions.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Other versions</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {versions.map((v) => (
              <li key={v.rule_id}>
                {v.effective_from && v.effective_to ? formatRange(v.effective_from, v.effective_to) : v.effective_to ? `Until ${formatDate(v.effective_to)}` : `From ${formatDate(v.effective_from)}`}
                {v.condition.amount != null ? `: ${money(v.condition.amount)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}

function RulesTab() {
  const doc = useStore((s) => s.doc)
  const [cardId, setCardId] = useState('')
  const [bank, setBank] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null)
  const today = todayIso()
  const banks = uniq(doc.cards.map((c) => c.bank))
  const bankCards = doc.cards.filter((c) => !bank || c.bank === bank)
  const rows = doc.rules
    .filter((r) => (cardId ? r.card_id === cardId : bankCards.some((c) => c.card_id === r.card_id)))
    .filter((r) => showOld || !r.effective_to || r.effective_to >= today)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-accent" onClick={() => go('import')}><Icon name="import" size={16} /> Import T&C</button>
        <button className="btn-ghost" disabled={!doc.cards.length} onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add by hand</button>
      </div>
      {doc.rules.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Bank" value={bank} onChange={(v) => { setBank(v || ''); setCardId('') }} options={banks.map((b) => [b, b])} placeholder="All banks" />
          <SelectField label="Card" value={cardId} onChange={(v) => setCardId(v || '')} options={bankCards.map((c) => [c.card_id, `${c.bank} ${c.name}`])} placeholder="All cards" />
        </div>
      )}
      {!doc.rules.length && <Empty title="No rules yet">A rule holds a card’s lounge terms: visits, spend condition and exclusions.</Empty>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const stale = !r.last_verified || diffDays(today, r.last_verified) > STALE_AFTER_DAYS
          const ended = r.effective_to && r.effective_to < today
          return (
            <li key={r.rule_id}>
              <button className="card block w-full p-3 text-left" onClick={() => setViewing(r.rule_id)}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-semibold text-night-900">{r.title || r.network}</p>
                  {ended ? (
                    <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Ended</span>
                  ) : stale ? (
                    <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">Re-check</span>
                  ) : null}
                </div>
                <p className="text-sm text-slate-700">{cardLabel(doc.cards.find((c) => c.card_id === r.card_id))}</p>
                <p className="text-xs text-slate-500">
                  {r.quota.unlimited ? 'Unlimited' : `${r.quota.principal ?? '?'} visits`}
                  {r.condition.type === 'min_spend' && r.condition.amount != null ? ` · ${money(r.condition.amount)} spend` : ''}
                  {r.condition.type === 'none' ? ' · No spend needed' : ''}
                  {r.last_verified ? ` · Checked ${formatDate(r.last_verified)}` : ''}
                </p>
              </button>
            </li>
          )
        })}
      </ul>
      {doc.rules.some((r) => r.effective_to && r.effective_to < today) && (
        <button className="text-sm font-medium text-night-700" onClick={() => setShowOld((s) => !s)}>
          {showOld ? 'Hide ended versions' : 'Show ended versions'}
        </button>
      )}
      {viewing && doc.rules.some((r) => r.rule_id === viewing) && (
        <RuleDetail
          rule={doc.rules.find((r) => r.rule_id === viewing)}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(doc.rules.find((r) => r.rule_id === viewing)); setViewing(null) }}
        />
      )}
      {editing && <RuleForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------- T&C documents ----------

function DocumentForm({ initial, onClose }) {
  const doc = useStore((s) => s.doc)
  const upsert = useStore((s) => s.upsert)
  const remove = useStore((s) => s.remove)
  const showToast = useStore((s) => s.showToast)
  const [d, setD] = useState(() => ({ doc_id: uid('doc'), title: '', card_ids: [], text: '', file_name: null, added_at: todayIso(), ...initial }))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const isEdit = doc.documents.some((x) => x.doc_id === d.doc_id)
  const set = (patch) => setD((x) => ({ ...x, ...patch }))

  async function pickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setBusy('Reading the PDF…')
    try {
      const text = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? await extractPdfText(file) : await file.text()
      let fileName = null
      if (cloudEnabled()) {
        setBusy('Saving the file to Koofr…')
        const stored = `${d.doc_id}-${file.name}`
        fileName = (await uploadFile(stored, file)).name
      }
      set({ text, file_name: fileName, title: d.title || file.name.replace(/\.[^.]+$/, '') })
    } catch (err) {
      setError(`Couldn’t read that file: ${err.message}. You can paste the text instead.`)
    } finally {
      setBusy('')
    }
  }

  async function openFile() {
    setBusy('Downloading…')
    try {
      downloadBlob(d.file_name, await fetchFile(d.file_name))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  function toggleCard(id) {
    set({ card_ids: d.card_ids.includes(id) ? d.card_ids.filter((x) => x !== id) : [...d.card_ids, id] })
  }

  return (
    <Sheet
      wide
      title={isEdit ? 'T&C document' : 'Add a T&C'}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button className="btn-danger mr-auto" onClick={() => { if (window.confirm('Delete this saved T&C text? Rules imported from it stay.')) { remove('documents', d.doc_id); onClose() } }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={() => { onClose(); go(`import/rules/${d.doc_id}`) }} disabled={!isEdit}>Use in import</button>
          <button className="btn-primary" disabled={!d.title.trim() || !d.text.trim() || Boolean(busy)} onClick={() => { upsert('documents', d); showToast('T&C saved'); onClose() }}>Save</button>
        </>
      }
    >
      <TextField label="Title" value={d.title} onChange={(title) => set({ title })} placeholder="AEON Plaza Premium T&C, Aug 2026" />
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">PDF or text file</p>
        <input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={pickFile} className="block w-full text-sm" aria-label="Choose a T&C file" />
        {busy && <p className="mt-1 text-sm text-slate-600">{busy}</p>}
        {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
        {d.file_name && !isNative() && (
          <button className="mt-2 text-sm font-medium text-night-700 underline" onClick={openFile}>Download the original file</button>
        )}
      </div>
      <AreaField label="T&C text" rows={8} value={d.text} onChange={(text) => set({ text })} hint="Ask searches this text." />
      {doc.cards.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Applies to</p>
          <div className="flex flex-wrap gap-2">
            {doc.cards.map((c) => {
              const on = d.card_ids.includes(c.card_id)
              return (
                <button key={c.card_id} type="button" aria-pressed={on} onClick={() => toggleCard(c.card_id)} className={`min-h-[36px] rounded-full border px-3 text-sm ${on ? 'border-night-900 bg-night-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {c.bank} {c.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}

function DocumentsTab() {
  const doc = useStore((s) => s.doc)
  const [editing, setEditing] = useState(null)
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-ghost" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add T&C</button>
      </div>
      {!doc.documents.length && <Empty title="No T&Cs saved">Save the bank’s T&C here so Ask can quote it and you can re-import it later.</Empty>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {doc.documents.map((d) => (
          <li key={d.doc_id}>
            <button className="card block w-full p-3 text-left" onClick={() => setEditing(d)}>
              <p className="font-semibold text-night-900">{d.title}</p>
              <p className="text-xs text-slate-500">
                Added {formatDate(d.added_at)} · {(d.text || '').length.toLocaleString()} characters
                {d.file_name ? ' · File on Koofr' : ''}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {editing && <DocumentForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

export default function LibraryScreen() {
  const [tab, setTab] = useState('rules')
  return (
    <div className="space-y-4">
      <PageTitle title="Library" />
      <Segmented
        label="Library sections"
        value={tab}
        onChange={setTab}
        options={[['rules', 'Rules'], ['cards', 'Cards'], ['lounges', 'Lounges'], ['docs', 'T&Cs']]}
      />
      {tab === 'rules' && <RulesTab />}
      {tab === 'cards' && <CardsTab />}
      {tab === 'lounges' && <LoungesTab />}
      {tab === 'docs' && <DocumentsTab />}
    </div>
  )
}
