// App shell: hash routes, bottom tabs on a phone, side rail on a desktop.
import { useEffect, useRef, useState } from 'react'
import { Icon, go } from './components/ui'
import { useStore } from './store/useStore'
import { cloudEnabled } from './lib/api'
import { installBackButton } from './lib/platform'
import CheckScreen from './screens/CheckScreen'
import AskScreen from './screens/AskScreen'
import VisitsScreen from './screens/VisitsScreen'
import SpendScreen from './screens/SpendScreen'
import LibraryScreen from './screens/LibraryScreen'
import ImportScreen from './screens/ImportScreen'
import SettingsScreen from './screens/SettingsScreen'
import HelpScreen from './screens/HelpScreen'

const TABS = [
  ['check', 'Check', 'check'],
  ['ask', 'Ask', 'ask'],
  ['visits', 'Visits', 'visits'],
  ['spend', 'Spend', 'spend'],
  ['library', 'Library', 'library'],
]
const RAIL_EXTRA = [
  ['import', 'Import', 'import'],
  ['settings', 'Settings', 'gear'],
  ['help', 'Guide', 'help'],
]

const readRoute = () => {
  const [name = 'check', ...rest] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { name: name || 'check', arg: rest.join('/') }
}

const SYNC_UI = {
  saving: ['Saving…', 'text-brass-400'],
  saved: ['Synced', 'text-emerald-300'],
  idle: ['Connected', 'text-emerald-300'],
  offline: ['Offline, saved here', 'text-slate-300'],
  error: ['Sync failed', 'text-red-300'],
  conflict: ['Choose a copy', 'text-brass-400'],
}

function SyncStatus() {
  const status = useStore((s) => s.syncStatus)
  if (!cloudEnabled()) {
    return (
      <button onClick={() => go('settings')} className="text-xs text-slate-300 underline-offset-2 hover:underline">
        This device only
      </button>
    )
  }
  const [label, cls] = SYNC_UI[status] || SYNC_UI.idle
  return (
    <button onClick={() => go('settings')} className={`text-xs ${cls}`} role="status">
      {label}
    </button>
  )
}

function ConflictBanner() {
  const conflict = useStore((s) => s.conflict)
  const doc = useStore((s) => s.doc)
  const resolve = useStore((s) => s.resolveConflict)
  if (!conflict) return null
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const count = (d) =>
    `${plural(d.cards?.length || 0, 'card')}, ${plural(d.visits?.length || 0, 'visit')}, ${plural(d.spends?.length || 0, 'spend')}, saved ${new Date(d.last_updated).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}`
  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold text-amber-900">Another device saved changes too</p>
        <p className="mt-0.5 text-sm text-amber-900">
          This device: {count(doc)}. Cloud: {count(conflict)}. Using the cloud copy discards this device’s unsaved changes. Keeping this device’s copy moves the cloud copy to your Koofr backups.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => resolve('cloud')}>Use the cloud copy</button>
          <button className="btn-ghost" onClick={() => resolve('local')}>Keep this device’s copy</button>
        </div>
      </div>
    </div>
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-6">
      <p className="rounded-full bg-night-950 px-4 py-2 text-sm text-white shadow-lg">{toast}</p>
    </div>
  )
}

export default function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const pull = useStore((s) => s.pull)
  const flush = useStore((s) => s.flush)
  const [route, setRoute] = useState(readRoute)
  const routeRef = useRef(route)
  routeRef.current = route
  const mainRef = useRef(null)

  useEffect(() => {
    init()
    const onHash = () => {
      setRoute(readRoute())
      mainRef.current?.scrollTo?.(0, 0)
    }
    // Save before the phone may kill the app, and catch up when it comes back.
    const onVisibility = () => (document.visibilityState === 'hidden' ? flush() : pull())
    const onOnline = () => pull()
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    installBackButton(() => go('check'), () => routeRef.current.name === 'check')
    return () => {
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [init, pull, flush])

  const screen = {
    check: <CheckScreen />,
    ask: <AskScreen />,
    visits: <VisitsScreen />,
    spend: <SpendScreen />,
    library: <LibraryScreen />,
    import: <ImportScreen arg={route.arg} />,
    settings: <SettingsScreen />,
    help: <HelpScreen />,
  }[route.name] || <CheckScreen />

  const navBtn = (name, label, icon) => {
    const active = route.name === name
    return { active, label, icon, name }
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="pad-safe-top bg-night-900 text-white lg:hidden">
        <div className="flex h-12 items-center justify-between px-4">
          <button className="flex items-center gap-2 font-semibold" onClick={() => go('check')}>
            <img src="./icons/favicon-64.png" alt="" className="h-7 w-7 rounded-lg" />
            Lounge Tracker
          </button>
          <div className="flex items-center gap-1">
            <SyncStatus />
            <button aria-label="Import" onClick={() => go('import')} className="flex h-10 w-9 items-center justify-center text-slate-200"><Icon name="import" /></button>
            <button aria-label="Guide" onClick={() => go('help')} className="flex h-10 w-9 items-center justify-center text-slate-200"><Icon name="help" /></button>
            <button aria-label="Settings" onClick={() => go('settings')} className="-mr-2 flex h-10 w-9 items-center justify-center text-slate-200"><Icon name="gear" /></button>
          </div>
        </div>
      </header>

      <ConflictBanner />

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col gap-1 bg-night-900 p-3 text-slate-200 lg:flex">
          <div className="mb-3 flex items-center gap-2 px-2 pt-1 font-semibold text-white">
            <img src="./icons/favicon-64.png" alt="" className="h-8 w-8 rounded-lg" />
            Lounge Tracker
          </div>
          {[...TABS, ...RAIL_EXTRA].map(([name, label, icon]) => {
            const b = navBtn(name, label, icon)
            return (
              <button key={name} aria-current={b.active ? 'page' : undefined} onClick={() => go(name)} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${b.active ? 'bg-night-700 font-semibold text-white' : 'hover:bg-night-800'}`}>
                <Icon name={icon} size={18} /> {label}
              </button>
            )
          })}
          <div className="mt-auto px-3 py-2"><SyncStatus /></div>
        </nav>

        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto h-full max-w-5xl px-4 pb-6 pt-4">{ready ? screen : <p className="text-sm text-slate-500">Loading…</p>}</div>
        </main>
      </div>

      <nav aria-label="Main" className="pad-safe-bottom border-t border-slate-200 bg-white lg:hidden">
        <div className="grid grid-cols-5">
          {TABS.map(([name, label, icon]) => {
            const active = route.name === name
            return (
              <button key={name} aria-current={active ? 'page' : undefined} onClick={() => go(name)} className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'font-semibold text-night-900' : 'text-slate-500'}`}>
                <Icon name={icon} size={22} className={active ? 'text-brass-600' : ''} />
                {label}
              </button>
            )
          })}
        </div>
      </nav>

      <Toast />
    </div>
  )
}
