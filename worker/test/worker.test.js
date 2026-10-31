// Runs the Worker's fetch handler against an in-memory fake of Koofr WebDAV.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.js'

const KEY = 'test-key-0123456789'
const env = {
  APP_API_KEY: KEY,
  KOOFR_AUTH_HEADER: 'Basic x',
  KOOFR_DAV_BASE: 'https://dav.test/Koofr',
  DATA_DIR: 'LoungeTracker',
  ALLOWED_ORIGIN: 'https://jgjy926.github.io',
  AI_MODEL: 'test-model',
  AI: { run: async () => ({ response: 'grounded answer' }) },
}

let files, dirs, calls

// WebDAV-like: PUT into a missing folder is a 409, as a real server answers.
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname.replace('/Koofr/', '')
  const method = init.method || 'GET'
  calls.push(`${method} ${path}`)
  if (method === 'MKCOL') {
    dirs.add(path)
    return new Response(null, { status: 201 })
  }
  if (method === 'PUT') {
    const parent = path.split('/').slice(0, -1).join('/')
    if (parent && !dirs.has(parent)) return new Response(null, { status: 409 })
    const body = init.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : init.body
    files.set(path, body)
    return new Response(null, { status: 201 })
  }
  if (!files.has(path)) return new Response(null, { status: 404 })
  return new Response(method === 'HEAD' ? null : files.get(path), { status: 200 })
}

const call = (path, init = {}, key = KEY) =>
  worker.fetch(
    new Request(`https://w.test${path}`, {
      ...init,
      headers: { 'X-App-Auth': key, Origin: 'https://jgjy926.github.io', ...(init.headers || {}) },
    }),
    env,
  )

const doc = (last_updated, extra = {}) => ({
  last_updated,
  cards: [],
  lounges: [],
  rules: [],
  visits: [],
  spends: [],
  documents: [],
  ...extra,
})

const save = (d, headers = {}) =>
  call('/api/save', { method: 'POST', body: JSON.stringify(d), headers })

beforeEach(() => {
  files = new Map()
  dirs = new Set()
  calls = []
})

test('rejects a missing or wrong token', async () => {
  assert.equal((await call('/api/sync', {}, 'nope')).status, 401)
  assert.equal((await call('/api/sync', {}, '')).status, 401)
})

test('CORS allows the Pages origin and the Android WebView, not others', async () => {
  const origin = async (o) =>
    (
      await worker.fetch(new Request('https://w.test/api/sync', { method: 'OPTIONS', headers: { Origin: o } }), env)
    ).headers.get('Access-Control-Allow-Origin')
  assert.equal(await origin('https://jgjy926.github.io'), 'https://jgjy926.github.io')
  assert.equal(await origin('https://localhost'), 'https://localhost')
  assert.equal(await origin('https://evil.test'), 'https://jgjy926.github.io')
})

test('sync returns an empty document before the first save', async () => {
  const body = await (await call('/api/sync')).json()
  assert.deepEqual(body.cards, [])
  assert.equal(body.last_updated, null)
})

test('first save creates the folder, then sync returns it', async () => {
  const res = await save(doc('2026-10-31T00:00:00.000Z', { cards: [{ card_id: 'c1' }] }))
  assert.equal(res.status, 200)
  assert.ok(dirs.has('LoungeTracker'))
  const body = await (await call('/api/sync')).json()
  assert.equal(body.cards[0].card_id, 'c1')
})

test('a malformed body can never overwrite the document', async () => {
  await save(doc('t1'))
  assert.equal((await call('/api/save', { method: 'POST', body: '{oops' })).status, 400)
  assert.equal((await call('/api/save', { method: 'POST', body: '{"cards":[]}' })).status, 400)
  assert.equal(JSON.parse(files.get('LoungeTracker/lounge.json')).last_updated, 't1')
})

test('a stale device gets 409, and force keeps a dated backup', async () => {
  await save(doc('t1'))
  assert.equal((await save(doc('t2'), { 'X-Base-Updated': 't1' })).status, 200)

  const stale = await save(doc('t3'), { 'X-Base-Updated': 't1' })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).remote_updated, 't2')
  assert.equal(JSON.parse(files.get('LoungeTracker/lounge.json')).last_updated, 't2')

  assert.equal((await save(doc('t3'), { 'X-Force-Save': '1' })).status, 200)
  assert.equal(JSON.parse(files.get('LoungeTracker/lounge.json')).last_updated, 't3')
  const replaced = [...files.entries()].find(([k]) => k.includes('/backups/lounge-replaced-'))
  assert.equal(JSON.parse(replaced[1]).last_updated, 't2')
})

test('only the first save of the day writes a backup', async () => {
  await save(doc('t1'))
  await save(doc('t2'), { 'X-Base-Updated': 't1' })
  await save(doc('t3'), { 'X-Base-Updated': 't2' })
  const backup = [...files.entries()].find(([k]) => k.includes('/backups/'))
  assert.equal(JSON.parse(backup[1]).last_updated, 't1')
})

test('upload stores the file and media returns it, with a safe name', async () => {
  const form = new FormData()
  form.append('name', '../../secret tnc.pdf')
  form.append('file', new File(['pdf-bytes'], 'x.pdf', { type: 'application/pdf' }))
  const res = await call('/api/upload', { method: 'POST', body: form })
  assert.equal(res.status, 200)
  const { name } = await res.json()
  assert.ok(!name.includes('/'))
  assert.equal(await (await call(`/api/media/${name}`)).text(), 'pdf-bytes')
  assert.equal((await call('/api/media/missing.pdf')).status, 404)
})

test('ping reports the state of the connection', async () => {
  assert.deepEqual(await (await call('/api/ping')).json(), { ok: true, has_data: false })
})

test('ask returns the model answer and requires a question', async () => {
  const ok = await call('/api/ask', { method: 'POST', body: JSON.stringify({ question: 'q', context: {} }) })
  assert.equal((await ok.json()).answer, 'grounded answer')
  assert.equal((await call('/api/ask', { method: 'POST', body: '{}' })).status, 400)
})
