// A local stand-in for Koofr's WebDAV, for trying the full app with no account:
//   node test/fake-koofr.mjs   then point KOOFR_DAV_BASE at http://localhost:8788/dav
// It keeps files in memory and forgets them on exit.
import http from 'node:http'

const files = new Map()
const dirs = new Set()

http
  .createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.replace(/^\/dav\//, ''))
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    const parent = path.split('/').slice(0, -1).join('/')
    console.log(req.method, path)

    if (req.method === 'MKCOL') {
      dirs.add(path)
      res.writeHead(201).end()
    } else if (req.method === 'PUT') {
      if (parent && !dirs.has(parent)) return res.writeHead(409).end()
      files.set(path, { body, type: req.headers['content-type'] })
      res.writeHead(201).end()
    } else if (files.has(path)) {
      const f = files.get(path)
      res.writeHead(200, { 'Content-Type': f.type || 'application/octet-stream' })
      res.end(req.method === 'HEAD' ? undefined : f.body)
    } else {
      res.writeHead(404).end()
    }
  })
  .listen(8788, () => console.log('fake Koofr on http://localhost:8788/dav'))
