// Cloudflare Worker: secure proxy between the app and Koofr (WebDAV), plus the
// grounded /api/ask endpoint (Workers AI). Koofr credentials live only here (as
// secrets); the access token is entered per device and never built into the app.

const DEFAULT_DOC = {
  schema_version: 1,
  last_updated: null,
  cards: [],
  lounges: [],
  rules: [],
  visits: [],
  spends: [],
  documents: [],
}

const MAX_DOC_BYTES = 5 * 1024 * 1024
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const COLLECTIONS = ['cards', 'lounges', 'rules', 'visits', 'spends', 'documents']

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Auth gate for every real call.
    if (!authorized(request, env)) {
      return json({ error: 'unauthorized' }, 401, cors)
    }

    try {
      if (url.pathname === '/api/ping' && request.method === 'GET') {
        return await handlePing(env, cors)
      }
      if (url.pathname === '/api/sync' && request.method === 'GET') {
        return await handleSync(env, cors)
      }
      if (url.pathname === '/api/save' && request.method === 'POST') {
        return await handleSave(request, env, cors)
      }
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        return await handleUpload(request, env, cors)
      }
      if (url.pathname.startsWith('/api/media/') && request.method === 'GET') {
        return await handleMediaFetch(url, env, cors)
      }
      if (url.pathname === '/api/ask' && request.method === 'POST') {
        return await handleAsk(request, env, cors)
      }
      return json({ error: 'not found' }, 404, cors)
    } catch (e) {
      return json({ error: e.message || 'server error' }, 500, cors)
    }
  },
}

// ---- Handlers ----

// Used by Settings > Test connection: proves the token and the Koofr credentials.
async function handlePing(env, cors) {
  const res = await koofr(env, statePath(env), { method: 'GET' })
  if (res.ok || res.status === 404) return json({ ok: true, has_data: res.ok }, 200, cors)
  return json({ ok: false, error: `koofr ${res.status}` }, 502, cors)
}

async function handleSync(env, cors) {
  const res = await koofr(env, statePath(env), { method: 'GET' })
  if (res.status === 404) return json(DEFAULT_DOC, 200, cors)
  if (!res.ok) return json({ error: `koofr ${res.status}` }, 502, cors)
  const text = await res.text()
  return new Response(text, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Optimistic concurrency: the client says which version it edited
// (X-Base-Updated). If the cloud has moved on, another device saved first, so
// answer 409 instead of overwriting. X-Force-Save is the user's explicit
// "keep this device" choice; the overwritten copy is still kept in backups.
async function handleSave(request, env, cors) {
  const body = await request.text()
  if (body.length > MAX_DOC_BYTES) return json({ error: 'document too large' }, 413, cors)

  // Validate before touching stored state: a malformed body must never be able
  // to overwrite the document.
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return json({ error: 'invalid json' }, 400, cors)
  }
  if (!parsed || !COLLECTIONS.every((k) => Array.isArray(parsed[k])) || !parsed.last_updated) {
    return json({ error: 'invalid document shape' }, 400, cors)
  }

  const cur = await koofr(env, statePath(env), { method: 'GET' })
  if (!cur.ok && cur.status !== 404) return json({ error: `koofr ${cur.status}` }, 502, cors)

  if (cur.ok) {
    const prev = await cur.text()
    let remoteUpdated = null
    try {
      remoteUpdated = JSON.parse(prev).last_updated || null
    } catch {
      // A corrupt cloud file can't be a newer version; let the save repair it.
    }
    const base = request.headers.get('X-Base-Updated') || null
    const force = request.headers.get('X-Force-Save') === '1'
    if (!force && remoteUpdated && remoteUpdated !== base) {
      return json({ error: 'conflict', remote_updated: remoteUpdated }, 409, cors)
    }
    await backup(env, prev, force)
  }

  const res = await putWithDir(env, statePath(env), body, 'application/json')
  if (!res.ok) return json({ error: `koofr ${res.status}` }, 502, cors)
  return json({ ok: true, last_updated: parsed.last_updated }, 200, cors)
}

// First save of each day keeps a dated copy, so a bad day is recoverable by date.
// A forced save always keeps the copy it replaces, since the user was promised that.
// Best-effort: a failed backup never blocks the save.
async function backup(env, text, force = false) {
  try {
    const now = new Date().toISOString()
    if (force) {
      const stamp = now.slice(0, 19).replace(/[:T]/g, '-')
      await putWithDir(env, `${env.DATA_DIR}/backups/lounge-replaced-${stamp}.json`, text, 'application/json')
      return
    }
    const path = `${env.DATA_DIR}/backups/lounge-${now.slice(0, 10)}.json`
    const head = await koofr(env, path, { method: 'HEAD' })
    if (head.status === 404) await putWithDir(env, path, text, 'application/json')
  } catch {
    // best-effort
  }
}

async function handleUpload(request, env, cors) {
  const form = await request.formData()
  const name = sanitize(form.get('name') || `upload_${Date.now()}.pdf`)
  const file = form.get('file')
  if (!file || typeof file === 'string') return json({ error: 'missing file' }, 400, cors)
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'file too large' }, 413, cors)

  const res = await putWithDir(
    env,
    `${env.DATA_DIR}/media/${name}`,
    await file.arrayBuffer(),
    file.type || 'application/octet-stream',
  )
  if (!res.ok) return json({ error: `koofr ${res.status}` }, 502, cors)
  return json({ ok: true, name }, 200, cors)
}

async function handleMediaFetch(url, env, cors) {
  const name = sanitize(decodeURIComponent(url.pathname.replace('/api/media/', '')))
  if (!name) return json({ error: 'missing name' }, 400, cors)
  const res = await koofr(env, `${env.DATA_DIR}/media/${name}`, { method: 'GET' })
  if (res.status === 404) return json({ error: 'not found' }, 404, cors)
  if (!res.ok) return json({ error: `koofr ${res.status}` }, 502, cors)
  return new Response(res.body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
    },
  })
}

// The app works out eligibility itself and sends the result as context. The
// model only explains it in words, so it is told never to overrule those results.
async function handleAsk(request, env, cors) {
  const { question, context } = await request.json()
  if (!question) return json({ error: 'missing question' }, 400, cors)

  const system =
    'You answer questions about credit-card airport lounge access for one cardholder. ' +
    'Use ONLY the JSON context. "engine_results" are computed facts about eligibility, spend and ' +
    'quota: repeat their status and figures exactly and never overrule them. In "clauses", ' +
    '"summary" is a note you may use but must not present as a quotation; "tnc_quote" and ' +
    '"tnc_excerpts" are the T&C wording, and only those may be quoted. If the context ' +
    'does not contain the answer, say it is not in the saved T&Cs and suggest asking the bank. ' +
    'Answer in 2 to 5 short sentences, in plain language, without restating the question.'
  const user = `Context (JSON):\n${JSON.stringify(context).slice(0, 12000)}\n\nQuestion: ${String(question).slice(0, 1000)}`

  const out = await env.AI.run(env.AI_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  return json({ answer: out.response || out.result || '' }, 200, cors)
}

// ---- Helpers ----

const statePath = (env) => `${env.DATA_DIR}/lounge.json`

function koofr(env, path, init = {}) {
  const base = env.KOOFR_DAV_BASE.replace(/\/$/, '')
  return fetch(`${base}/${path}`, {
    ...init,
    headers: { Authorization: env.KOOFR_AUTH_HEADER, ...(init.headers || {}) },
  })
}

// PUT, creating the parent folders only if the first attempt says they're missing.
async function putWithDir(env, path, body, contentType) {
  const put = () =>
    koofr(env, path, { method: 'PUT', headers: { 'Content-Type': contentType }, body })
  const res = await put()
  if (res.status !== 404 && res.status !== 409) return res
  const parts = path.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    await koofr(env, parts.slice(0, i).join('/'), { method: 'MKCOL' })
  }
  return put()
}

function authorized(request, env) {
  const sent = request.headers.get('X-App-Auth') || ''
  const expected = env.APP_API_KEY || ''
  if (!expected || sent.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= sent.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const origin = request.headers.get('Origin') || ''
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) || isLocal ? origin : allowed[0] || '',
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Auth, X-Base-Updated, X-Force-Save',
    'Access-Control-Max-Age': '86400',
  }
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
