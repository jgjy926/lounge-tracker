// Local-first sync. Every edit lands in IndexedDB at once, then pushes after a
// short pause. `base` is the cloud version this device last saw, and the Worker
// refuses a save whose base is out of date, so two devices can't silently
// overwrite each other: the user chooses instead.
export const hasContent = (doc) =>
  ['cards', 'lounges', 'rules', 'visits', 'spends', 'documents'].some((k) => doc?.[k]?.length)

export function createSync({ api, getDoc, adopt, onStatus, onConflict, saveMeta, debounceMs = 3000 }) {
  let base = null
  let dirty = false
  let timer = null
  let pushing = false
  let conflict = null

  const persist = () => saveMeta({ base, dirty })
  const status = (s) => onStatus?.(s)
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

  const fail = (e) => {
    console.warn('sync:', e.message)
    status(offline() ? 'offline' : 'error')
  }

  function setConflict(remote) {
    conflict = remote
    onConflict?.(remote)
    status('conflict')
  }

  async function pull() {
    if (!api.enabled() || pushing || conflict) return
    try {
      const remote = await api.fetchRemoteState()
      const updated = remote?.last_updated || null
      if (!updated) {
        // The cloud is empty: this device seeds it.
        if (hasContent(getDoc())) await push()
        else status('saved')
        return
      }
      if (updated === base) {
        if (dirty) await push()
        else status('saved')
        return
      }
      if (dirty && hasContent(getDoc())) {
        setConflict(remote)
        return
      }
      if (!hasContent(getDoc()) || !dirty) {
        adopt(remote)
        base = updated
        dirty = false
        persist()
        status('saved')
      }
    } catch (e) {
      fail(e)
    }
  }

  async function push({ force = false, keepalive = false } = {}) {
    if (!api.enabled() || pushing || (conflict && !force)) return
    clearTimeout(timer)
    timer = null
    const doc = getDoc()
    if (!doc.last_updated) return
    pushing = true
    status('saving')
    try {
      const res = await api.pushRemoteState(doc, { base, force, keepalive })
      pushing = false
      if (res.conflict) {
        const remote = await api.fetchRemoteState()
        setConflict(remote)
        return
      }
      base = doc.last_updated
      // An edit made during the push is still unsaved.
      dirty = getDoc().last_updated !== doc.last_updated
      persist()
      if (dirty) schedule()
      else status('saved')
    } catch (e) {
      pushing = false
      fail(e)
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => push(), debounceMs)
  }

  return {
    init(meta) {
      base = meta?.base || null
      dirty = Boolean(meta?.dirty)
    },
    pull,
    push,
    markDirty() {
      dirty = true
      persist()
      if (api.enabled() && !conflict) schedule()
    },
    // Going to the background: don't wait for the pause, the app may be killed.
    flush() {
      if (dirty && api.enabled() && !conflict) push({ keepalive: true })
    },
    async resolve(choice) {
      const remote = conflict
      if (!remote) return
      conflict = null
      onConflict?.(null)
      if (choice === 'cloud') {
        adopt(remote)
        base = remote.last_updated
        dirty = false
        persist()
        status('saved')
      } else {
        await push({ force: true })
      }
    },
    // A new Worker or token was entered, so what this device saw no longer applies.
    reset() {
      base = null
      conflict = null
      onConflict?.(null)
      dirty = hasContent(getDoc())
      persist()
    },
    get state() {
      return { base, dirty, pushing, conflict }
    },
  }
}
