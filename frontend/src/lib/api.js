// Thin fetch client to the Cloudflare Worker. The Worker URL and access token are
// entered once per device in Settings and stay on that device: the web page is
// public, so nothing secret is built into the app. With no token set, the app
// runs fully local and these calls are skipped.
const KEY = 'lounge-tracker.cloud'
const DEFAULT_URL = (import.meta.env?.VITE_WORKER_URL || '').replace(/\/$/, '')

export function getCloudConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { url: saved.url || DEFAULT_URL, token: saved.token || '' }
  } catch {
    return { url: DEFAULT_URL, token: '' }
  }
}

export function setCloudConfig({ url, token }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ url: (url || '').trim().replace(/\/$/, ''), token: (token || '').trim() }))
  } catch {
    // Private mode: the app keeps working, just local-only.
  }
}

export const cloudEnabled = () => {
  const { url, token } = getCloudConfig()
  return Boolean(url && token)
}

function request(path, init = {}) {
  const { url, token } = getCloudConfig()
  return fetch(`${url}${path}`, {
    ...init,
    headers: { 'X-App-Auth': token, ...(init.headers || {}) },
  })
}

export async function pingCloud(config) {
  const res = await fetch(`${config.url.trim().replace(/\/$/, '')}/api/ping`, {
    headers: { 'X-App-Auth': config.token.trim() },
  })
  if (res.status === 401) throw new Error('The Worker rejected this access token.')
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok) throw new Error(body.error === 'koofr 401' ? 'The Worker can’t sign in to Koofr. Check KOOFR_AUTH_HEADER.' : body.error || `Worker answered ${res.status}`)
  return body
}

export async function fetchRemoteState() {
  const res = await request('/api/sync')
  if (!res.ok) throw new Error(`sync failed: ${res.status}`)
  return res.json()
}

// Resolves to { conflict: true } when another device saved first.
export async function pushRemoteState(doc, { base, force = false, keepalive = false } = {}) {
  const body = JSON.stringify(doc)
  const res = await request('/api/save', {
    method: 'POST',
    // Browsers refuse keepalive bodies over 64 KB.
    keepalive: keepalive && body.length < 60000,
    headers: {
      'Content-Type': 'application/json',
      ...(base ? { 'X-Base-Updated': base } : {}),
      ...(force ? { 'X-Force-Save': '1' } : {}),
    },
    body,
  })
  if (res.status === 409) return { conflict: true }
  if (!res.ok) throw new Error(`save failed: ${res.status}`)
  return { conflict: false }
}

export async function uploadFile(name, blob) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', blob, name)
  const res = await request('/api/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  return res.json()
}

export async function fetchFile(name) {
  const res = await request(`/api/media/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  return res.blob()
}

export async function askAi(question, context) {
  const res = await request('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context }),
  })
  if (!res.ok) throw new Error(`ask failed: ${res.status}`)
  return res.json()
}
