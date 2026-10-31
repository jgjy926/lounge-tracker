// Single source of truth. Mutations update the in-memory doc, persist to
// IndexedDB immediately (local-first), and schedule a cloud save.
import { create } from 'zustand'
import { defaultDocument, normalizeDoc, normalizeRule, ruleGroup } from '../lib/schema'
import { loadState, loadSyncMeta, saveState, saveSyncMeta } from '../lib/storage'
import { createSync } from '../lib/sync'
import { cloudEnabled, fetchRemoteState, pushRemoteState } from '../lib/api'

const ID_KEY = {
  cards: 'card_id',
  lounges: 'lounge_id',
  rules: 'rule_id',
  visits: 'visit_id',
  spends: 'spend_id',
  documents: 'doc_id',
}

let sync
let toastTimer

export const useStore = create((set, get) => {
  sync = createSync({
    api: { enabled: cloudEnabled, fetchRemoteState, pushRemoteState },
    getDoc: () => get().doc,
    adopt: (remote) => {
      const doc = normalizeDoc(remote)
      set({ doc })
      saveState(doc)
    },
    onStatus: (syncStatus) => set({ syncStatus }),
    onConflict: (conflict) => set({ conflict }),
    saveMeta: saveSyncMeta,
  })

  function commit(next) {
    const doc = { ...next, last_updated: new Date().toISOString() }
    set({ doc })
    saveState(doc)
    sync.markDirty()
    return doc
  }

  return {
    doc: defaultDocument(),
    ready: false,
    syncStatus: 'idle', // idle | saving | saved | offline | error | conflict
    conflict: null,
    toast: null,

    init: async () => {
      const [raw, meta] = await Promise.all([loadState(), loadSyncMeta()])
      if (raw) set({ doc: normalizeDoc(raw) })
      sync.init(meta)
      set({ ready: true })
      await sync.pull()
    },

    pull: () => sync.pull(),
    flush: () => sync.flush(),
    resolveConflict: (choice) => sync.resolve(choice),
    cloudChanged: async () => {
      sync.reset()
      await sync.pull()
    },

    showToast: (message) => {
      clearTimeout(toastTimer)
      set({ toast: message })
      toastTimer = setTimeout(() => set({ toast: null }), 3500)
    },

    upsert: (collection, item) => {
      const key = ID_KEY[collection]
      const { doc } = get()
      const list = doc[collection]
      const exists = list.some((x) => x[key] === item[key])
      commit({
        ...doc,
        [collection]: exists ? list.map((x) => (x[key] === item[key] ? item : x)) : [...list, item],
      })
    },

    remove: (collection, id) => {
      const key = ID_KEY[collection]
      const { doc } = get()
      commit({ ...doc, [collection]: doc[collection].filter((x) => x[key] !== id) })
    },

    upsertRule: (rule) => {
      const next = normalizeRule({ ...rule, group: ruleGroup(rule.card_id, rule.network) })
      get().upsert('rules', next)
    },

    // A card takes its rules, visits and spend with it. The Library warns first.
    removeCard: (cardId) => {
      const { doc } = get()
      commit({
        ...doc,
        cards: doc.cards.filter((c) => c.card_id !== cardId),
        rules: doc.rules.filter((r) => r.card_id !== cardId),
        visits: doc.visits.filter((v) => v.card_id !== cardId),
        spends: doc.spends.filter((s) => s.card_id !== cardId),
      })
    },

    replaceDoc: (next) => commit(next),
  }
})
