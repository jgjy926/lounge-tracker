// Cloud connection and backups.
import { useState } from 'react'
import { AreaField, Icon, PageTitle, TextField, go } from '../components/ui'
import { useStore } from '../store/useStore'
import { cloudEnabled, getCloudConfig, pingCloud, setCloudConfig } from '../lib/api'
import { copyText, downloadText, isNative } from '../lib/platform'
import { normalizeDoc } from '../lib/schema'
import { extractJsonText } from '../lib/importer'
import { todayIso } from '../lib/dates'

export default function SettingsScreen() {
  const doc = useStore((s) => s.doc)
  const syncStatus = useStore((s) => s.syncStatus)
  const cloudChanged = useStore((s) => s.cloudChanged)
  const pull = useStore((s) => s.pull)
  const replaceDoc = useStore((s) => s.replaceDoc)
  const showToast = useStore((s) => s.showToast)
  const [cfg, setCfg] = useState(getCloudConfig)
  const [test, setTest] = useState(null)
  const [restore, setRestore] = useState('')
  const [restoreError, setRestoreError] = useState('')

  async function connect() {
    setTest({ busy: true })
    try {
      const res = await pingCloud(cfg)
      setCloudConfig(cfg)
      setTest({ ok: true, message: res.has_data ? 'Connected. Found your saved data.' : 'Connected. Koofr is empty, so this device will fill it.' })
      await cloudChanged()
    } catch (e) {
      const message = e instanceof TypeError ? 'Couldn’t reach that Worker. Check the URL and your connection.' : e.message
      setTest({ ok: false, message })
    }
  }

  function disconnect() {
    setCloudConfig({ url: cfg.url, token: '' })
    setCfg((c) => ({ ...c, token: '' }))
    setTest({ ok: true, message: 'Disconnected. This device now works locally only.' })
  }

  const json = () => JSON.stringify(doc, null, 2)

  function doRestore() {
    setRestoreError('')
    try {
      const parsed = JSON.parse(extractJsonText(restore))
      if (!parsed || !Array.isArray(parsed.cards) || !Array.isArray(parsed.rules)) throw new Error('This isn’t a Lounge Tracker backup.')
      if (!window.confirm('Replace all data on this device, and in the cloud on next sync, with this backup?')) return
      replaceDoc(normalizeDoc(parsed))
      setRestore('')
      showToast('Backup restored')
    } catch (e) {
      setRestoreError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle title="Settings" />

      <section className="card space-y-3 p-3.5" aria-label="Cloud sync">
        <h2 className="font-semibold text-night-900">Cloud sync</h2>
        <p className="text-sm text-slate-600">
          {cloudEnabled() ? 'This device syncs through your Worker to Koofr.' : 'Your data is only on this device until you connect.'}{' '}
          <button className="font-medium text-night-700 underline" onClick={() => go('help')}>What are these?</button>
        </p>
        <TextField label="Worker URL" type="url" autoCapitalize="none" autoCorrect="off" value={cfg.url} onChange={(url) => setCfg((c) => ({ ...c, url }))} placeholder="https://lounge-tracker.your-name.workers.dev" />
        <TextField label="Access token" type="password" autoComplete="off" value={cfg.token} onChange={(token) => setCfg((c) => ({ ...c, token }))} hint="The APP_API_KEY you set on the Worker. It stays on this device." />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!cfg.url.trim() || !cfg.token.trim() || test?.busy} onClick={connect}>
            {test?.busy ? 'Testing…' : 'Save and test'}
          </button>
          {cloudEnabled() && (
            <>
              <button className="btn-ghost" onClick={pull}><Icon name="refresh" size={16} /> Sync now</button>
              <button className="btn-ghost" onClick={disconnect}>Disconnect</button>
            </>
          )}
        </div>
        {test?.message && <p role="status" className={`text-sm ${test.ok ? 'text-emerald-700' : 'text-red-700'}`}>{test.message}</p>}
        {cloudEnabled() && syncStatus === 'error' && <p className="text-sm text-red-700">The last sync failed. Your changes are safe here and will retry.</p>}
      </section>

      <section className="card space-y-3 p-3.5" aria-label="Backup">
        <h2 className="font-semibold text-night-900">Backup</h2>
        <p className="text-sm text-slate-600">When connected, Koofr also keeps a dated copy each day in LoungeTracker/backups.</p>
        <div className="flex flex-wrap gap-2">
          {!isNative() && (
            <button className="btn-ghost" onClick={() => downloadText(`lounge-tracker-${todayIso()}.json`, json())}>Download backup</button>
          )}
          <button className="btn-ghost" onClick={async () => showToast((await copyText(json())) ? 'Backup copied' : 'Couldn’t copy')}>
            <Icon name="copy" size={16} /> Copy backup
          </button>
        </div>
        <AreaField label="Restore from a backup" rows={3} value={restore} onChange={setRestore} placeholder="Paste a backup here" />
        {restoreError && <p role="alert" className="text-sm text-red-700">{restoreError}</p>}
        <button className="btn-danger" disabled={!restore.trim()} onClick={doRestore}>Restore</button>
      </section>

      <p className="text-center text-xs text-slate-500">
        Lounge Tracker {__APP_VERSION__} · {doc.cards.length} cards · {doc.rules.length} rules · {doc.visits.length} visits · {doc.spends.length} spends
      </p>
    </div>
  )
}
