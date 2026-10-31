import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSync } from './sync'

const withData = (t) => ({ last_updated: t, cards: [{ card_id: 'c' }], rules: [] })
const empty = () => ({ last_updated: null, cards: [], rules: [] })

let doc, remote, statuses, conflicts, api, sync

// A fake cloud with the Worker's real save check.
beforeEach(() => {
  vi.useFakeTimers()
  doc = empty()
  remote = empty()
  statuses = []
  conflicts = []
  api = {
    enabled: () => true,
    fetchRemoteState: vi.fn(async () => remote),
    pushRemoteState: vi.fn(async (d, { base, force }) => {
      if (!force && remote.last_updated && remote.last_updated !== base) return { conflict: true }
      remote = d
      return { conflict: false }
    }),
  }
  sync = createSync({
    api,
    getDoc: () => doc,
    adopt: (d) => { doc = d },
    onStatus: (s) => statuses.push(s),
    onConflict: (c) => conflicts.push(c),
    saveMeta: () => {},
    debounceMs: 100,
  })
})

describe('sync', () => {
  test('a new device with an empty cache adopts the cloud copy', async () => {
    remote = withData('t1')
    sync.init({})
    await sync.pull()
    expect(doc.last_updated).toBe('t1')
    expect(sync.state.base).toBe('t1')
  })

  test('the first device seeds an empty cloud', async () => {
    doc = withData('t1')
    sync.init({ dirty: true })
    await sync.pull()
    expect(remote.last_updated).toBe('t1')
    expect(sync.state.dirty).toBe(false)
  })

  test('an edit is saved after the pause, not before', async () => {
    sync.init({})
    doc = withData('t1')
    sync.markDirty()
    expect(api.pushRemoteState).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(remote.last_updated).toBe('t1')
    expect(statuses.at(-1)).toBe('saved')
  })

  test('no local edits and a newer cloud copy: take the cloud copy', async () => {
    doc = withData('t1')
    remote = withData('t2')
    sync.init({ base: 't1', dirty: false })
    await sync.pull()
    expect(doc.last_updated).toBe('t2')
  })

  test('offline edits with an unchanged cloud copy are pushed on resume', async () => {
    doc = withData('t2')
    remote = withData('t1')
    sync.init({ base: 't1', dirty: true })
    await sync.pull()
    expect(remote.last_updated).toBe('t2')
  })

  test('both sides changed: nothing is overwritten until the user chooses', async () => {
    doc = withData('local')
    remote = withData('cloud')
    sync.init({ base: 'old', dirty: true })
    await sync.pull()
    expect(statuses.at(-1)).toBe('conflict')
    expect(conflicts.at(-1).last_updated).toBe('cloud')
    expect(doc.last_updated).toBe('local')
    expect(remote.last_updated).toBe('cloud')

    // Further edits wait for the choice.
    sync.markDirty()
    await vi.advanceTimersByTimeAsync(200)
    expect(api.pushRemoteState).not.toHaveBeenCalled()
  })

  test('choosing the cloud copy replaces this device', async () => {
    doc = withData('local')
    remote = withData('cloud')
    sync.init({ base: 'old', dirty: true })
    await sync.pull()
    await sync.resolve('cloud')
    expect(doc.last_updated).toBe('cloud')
    expect(sync.state.dirty).toBe(false)
  })

  test('choosing this device force-saves it', async () => {
    doc = withData('local')
    remote = withData('cloud')
    sync.init({ base: 'old', dirty: true })
    await sync.pull()
    await sync.resolve('local')
    expect(remote.last_updated).toBe('local')
    expect(conflicts.at(-1)).toBeNull()
  })

  test('a save refused by the cloud becomes a conflict', async () => {
    doc = withData('local')
    remote = withData('other-device')
    sync.init({ base: 'old', dirty: false })
    sync.markDirty()
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses.at(-1)).toBe('conflict')
  })

  test('a failed save stays dirty and retries on the next pull', async () => {
    doc = withData('t1')
    sync.init({})
    api.pushRemoteState.mockRejectedValueOnce(new Error('network'))
    sync.markDirty()
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses.at(-1)).toBe('error')
    expect(sync.state.dirty).toBe(true)
    await sync.pull()
    expect(remote.last_updated).toBe('t1')
    expect(sync.state.dirty).toBe(false)
  })

  test('an edit during a save stays unsaved and goes out next', async () => {
    doc = withData('t1')
    sync.init({})
    api.pushRemoteState.mockImplementationOnce(async (d) => {
      remote = d
      doc = withData('t2')
      return { conflict: false }
    })
    sync.markDirty()
    await vi.advanceTimersByTimeAsync(100)
    expect(sync.state.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(remote.last_updated).toBe('t2')
  })

  test('with cloud off, nothing is sent', async () => {
    api.enabled = () => false
    doc = withData('t1')
    sync.init({})
    sync.markDirty()
    await vi.advanceTimersByTimeAsync(200)
    await sync.pull()
    expect(api.fetchRemoteState).not.toHaveBeenCalled()
    expect(api.pushRemoteState).not.toHaveBeenCalled()
  })
})
