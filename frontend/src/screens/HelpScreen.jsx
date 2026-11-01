// The pocket version of the guide: what you need to register a card, and what
// the answers mean. Full setup steps are in the Lounge Tracker guide.
import { Icon, PageTitle, STATUS_UI, go } from '../components/ui'

const Item = ({ children }) => (
  <li className="flex gap-2 text-sm text-slate-800">
    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-brass-600" />
    <span>{children}</span>
  </li>
)

const Section = ({ title, children }) => (
  <section className="card space-y-2 p-3.5" aria-label={title}>
    <h2 className="font-semibold text-night-900">{title}</h2>
    {children}
  </section>
)

const MEANINGS = [
  ['eligible', 'The saved terms are met by the spend and visits you’ve recorded.'],
  ['needs_spend', 'You can still qualify. It shows how much more and the last day.'],
  ['unclear', 'The T&C is silent on something this answer depends on, or the rule hasn’t been checked for 180 days. Ask the bank or re-verify.'],
  ['not_eligible', 'A stated term rules it out: no visits left, a closed window, or the wrong flight type.'],
  ['not_covered', 'This card has no rule for that lounge or date.'],
]

export default function HelpScreen() {
  return (
    <div className="space-y-4">
      <PageTitle title="Guide" />

      <Section title="Registering a card">
        <p className="text-sm text-slate-600">Have these ready before you start:</p>
        <ul className="space-y-1.5">
          <Item>The bank and exact card name, as printed on the T&C</Item>
          <Item>The bank’s current lounge T&C, as a PDF or text</Item>
          <Item>Your card’s next anniversary month and year, only if visits reset by card year</Item>
          <Item>Last 4 digits, optional. Never enter the full number</Item>
          <Item>The bank’s lounge list, if the T&C doesn’t name its lounges</Item>
        </ul>
        <button className="btn-accent mt-2" onClick={() => go('import')}><Icon name="import" size={16} /> Start an import</button>
      </Section>

      <Section title="The steps">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-800">
          <li>Import › Copy prompt, then paste it into any AI chat with the T&C attached.</li>
          <li>Paste the JSON answer back and tap Read it.</li>
          <li>Check the amber items and quotes, and pick the right card.</li>
          <li>Tap Register. The card and rule are saved.</li>
          <li>Library › Banks: open the card and check its eligible lounges. If the T&C didn’t name them, use Import lounge list with the bank’s own list.</li>
          <li>Spend: add recent spend, or import a statement, if the card has a spend condition.</li>
          <li>Find: search a lounge and confirm the answers look right.</li>
        </ol>
      </Section>

      <Section title="How lounges and cards link">
        <p className="text-sm text-slate-800">Each bank has its own T&C, and each T&C sets the lounges its card can use. Importing it adds those lounges to that card. If the T&C says any lounge in a programme counts, such as Plaza Premium, every saved lounge in that programme applies. Nothing is looked up on the web.</p>
      </Section>

      <Section title="Planning a trip">
        <p className="text-sm text-slate-800">Add a flight in Trips, or import an e-ticket. You’ll see the best card, how much is left to spend, when counting starts, and the deadlines. Visits on earlier trips count against your quota, so two trips can’t rely on your last visit.</p>
        <p className="text-sm text-slate-800">The Android app reminds you when the window opens, a week before the deadline and the day before. In a browser, add the reminders to your calendar from the Trips tab.</p>
      </Section>

      <Section title="When the bank changes its terms">
        <p className="text-sm text-slate-800">Import the new T&C the same way. You’ll see what changed. The old version stays for past visits, and your visit count carries on. If nothing changed, open the rule and tap Checked today.</p>
      </Section>

      <Section title="What the answers mean">
        <ul className="space-y-2">
          {MEANINGS.map(([k, text]) => (
            <li key={k} className="text-sm">
              <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_UI[k].pill}`}>{STATUS_UI[k].label}</span>
              {text}
            </li>
          ))}
        </ul>
        <p className="pt-1 text-xs text-slate-500">This is an estimate from what you’ve recorded. The bank’s own records decide, so check its latest T&C before you rely on an answer.</p>
      </Section>

      <Section title="Connecting the cloud">
        <p className="text-sm text-slate-800">You need your Worker URL and access token. Enter them once on each device in Settings. Without them the app still works, on this device only.</p>
        <button className="btn-ghost mt-1" onClick={() => go('settings')}>Open Settings</button>
      </Section>
    </div>
  )
}
