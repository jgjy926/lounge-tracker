// LocalForage wrapper: the local-first cache of the document and its sync state.
import localforage from 'localforage'

const store = localforage.createInstance({ name: 'lounge-tracker', storeName: 'state' })

export const loadState = async () => (await store.getItem('doc')) || null
export const saveState = (doc) => store.setItem('doc', doc)
export const loadSyncMeta = async () => (await store.getItem('sync')) || { base: null, dirty: false }
export const saveSyncMeta = (meta) => store.setItem('sync', meta)
