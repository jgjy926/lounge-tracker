// Questions in plain words. The app answers from its own rules first, so it
// works offline. With the cloud on, an AI also explains that same result in words.
import { useEffect, useRef, useState } from 'react'
import { Empty, Icon, PageTitle, go } from '../components/ui'
import ResultCard from '../components/ResultCard'
import { useStore } from '../store/useStore'
import { answerQuestion, askContext } from '../lib/question'
import { formatDate, todayIso } from '../lib/dates'
import { askAi, cloudEnabled } from '../lib/api'

const SUGGESTIONS = [
  'Which cards can I use at KLIA tomorrow?',
  'What happens if I miss the spend?',
  'Can I bring a guest?',
  'What spend doesn’t count?',
]

function Turn({ turn }) {
  const { question, answer, ai } = turn
  const nothing = !answer.results.length && !answer.clauses.length && !answer.excerpts.length
  return (
    <li className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-night-900 px-3.5 py-2 text-sm text-white">{question}</p>

      {answer.results.length > 0 && (
        <p className="text-xs text-slate-500">
          For {formatDate(answer.date)}{answer.dateStated ? '' : ' (today, since you didn’t give a date)'}
          {answer.holder === 'supplementary' ? ', supplementary cardholder' : ''}
          {answer.flight !== 'unknown' ? `, ${answer.flight} flight` : ''}
        </p>
      )}
      {answer.results.map((r, i) => (
        <ResultCard key={i} result={r} defaultOpen={answer.results.length === 1} />
      ))}

      {answer.clauses.map((c, i) => (
        <div key={i} className="card p-3 text-sm">
          <p className="text-xs font-medium text-slate-500">{c.card}</p>
          <p className="text-slate-800">{c.text}</p>
          {c.quote && <p className="mt-1 border-l-2 border-brass-400 pl-2 text-xs italic text-slate-500">“{c.quote}”</p>}
        </div>
      ))}

      {answer.excerpts.length > 0 && (
        <details className="card p-3 text-sm">
          <summary className="cursor-pointer font-medium text-night-700">From your saved T&Cs ({answer.excerpts.length})</summary>
          <ul className="mt-2 space-y-2">
            {answer.excerpts.map((x, i) => (
              <li key={i}>
                <p className="text-xs font-medium text-slate-500">{x.doc}</p>
                <p className="text-slate-700">{x.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {nothing && !ai?.text && !ai?.loading && (
        <div className="card p-3 text-sm text-slate-700">I couldn’t find that in your saved rules or T&Cs. Try naming a card, airport or date, or ask the bank.</div>
      )}

      {ai?.loading && <p className="text-sm text-slate-500">Explaining…</p>}
      {ai?.text && (
        <div className="rounded-xl bg-brass-100 p-3 text-sm text-slate-800">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brass-600">AI explanation</p>
          <p className="whitespace-pre-wrap">{ai.text}</p>
        </div>
      )}
      {ai?.failed && <p className="text-xs text-slate-500">The AI explanation isn’t available right now. The answer above doesn’t depend on it.</p>}
    </li>
  )
}

export default function AskScreen() {
  const doc = useStore((s) => s.doc)
  const [text, setText] = useState('')
  const [turns, setTurns] = useState([])
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [turns.length])

  async function ask(question) {
    const q = question.trim()
    if (!q) return
    setText('')
    const today = todayIso()
    const answer = answerQuestion(doc, q, today)
    const id = Date.now()
    const useAi = cloudEnabled() && navigator.onLine !== false
    setTurns((t) => [...t, { id, question: q, answer, ai: useAi ? { loading: true } : null }])
    if (!useAi) return
    const setAi = (ai) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ai } : x)))
    try {
      const { answer: reply } = await askAi(q, askContext(answer, today))
      setAi(reply?.trim() ? { text: reply.trim() } : null)
    } catch {
      setAi({ failed: true })
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      <PageTitle title="Ask" />

      {!doc.rules.length ? (
        <Empty title="Nothing to answer from yet" action={<button className="btn-accent" onClick={() => go('import')}>Import a T&C</button>}>
          Ask answers from the rules and T&Cs you’ve saved, never from general knowledge about banks.
        </Empty>
      ) : (
        !turns.length && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="rounded-full border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )
      )}

      <ul className="flex-1 space-y-5">
        {turns.map((t) => (
          <Turn key={t.id} turn={t} />
        ))}
      </ul>
      <div ref={endRef} />

      <form
        className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-slate-100 px-4 py-2.5"
        onSubmit={(e) => { e.preventDefault(); ask(text) }}
      >
        <input className="input" aria-label="Your question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Can I use my AEON card at KLIA on 20 Nov?" />
        <button className="btn-primary shrink-0" aria-label="Send" disabled={!text.trim()}>
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  )
}
