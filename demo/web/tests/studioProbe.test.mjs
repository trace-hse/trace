import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function loadTs(path, replacements = []) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`)
}
const config = await loadTs('../src/lib/studioConfig.ts')
const configUrl = `data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(await readFile(new URL('../src/lib/studioConfig.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`
const { probeStudio, parseHello, studioOpenUrl, isLoopbackOrigin, explainReport, studioDirectUrl } =
  await loadTs('../src/lib/studioProbe.ts', [["'./studioConfig'", `'${configUrl}'`]])

const HELLO = { app: 'TRACE Studio', version: '0.1.0', ready: true, model: 'claude-haiku-4-5' }
const reply = (body) => ({ ok: true, json: async () => body })
// A fake fetch: handler(url) returns a body, throws (refused), or 'hang' (until aborted).
function fakeFetch(handler) {
  const calls = []
  const fn = (url, init = {}) => {
    calls.push({ url, init })
    const r = handler(url)
    if (r === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
    if (r instanceof Error) return Promise.reject(r)
    return Promise.resolve(r)
  }
  fn.calls = calls
  return fn
}
const hello = (port) => (url) => url === `http://127.0.0.1:${port}/api/studio/hello` ? reply(HELLO) : new TypeError('refused')

test('finds the app on a scanned port and builds the open URL', async () => {
  const f = fakeFetch(hello(8770))
  const found = await probeStudio({ fetchImpl: f, pageOrigin: 'https://zhenggao-30.github.io' })
  assert.equal(found.port, 8770)
  assert.equal(found.hello.model, 'claude-haiku-4-5')
  assert.equal(studioOpenUrl(found), 'http://127.0.0.1:8770/#/?from=site')
})

test('probe requests are plain CORS GETs: no credentials, no custom headers', async () => {
  const f = fakeFetch(hello(8765))
  await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io' })
  for (const { init } of f.calls) {
    assert.equal(init.mode, 'cors')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.headers, undefined)
    assert.equal(init.method, undefined)
  }
  assert.deepEqual(f.calls.map((c) => c.url).sort().slice(0, 2),
    ['http://127.0.0.1:8765/api/studio/hello', 'http://127.0.0.1:8766/api/studio/hello'])
  assert.equal(f.calls.length, 21, 'ports 8765..8785 are all probed in parallel')
})

test('not-ready then ready is reported as such on consecutive probes', async () => {
  let ready = false
  const f = fakeFetch((u) => u.endsWith(':8765/api/studio/hello') ? reply({ ...HELLO, ready }) : new TypeError('refused'))
  const first = await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io' })
  assert.equal(first.hello.ready, false)
  ready = true
  const second = await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io', ports: [first.port] })
  assert.equal(second.hello.ready, true)
})

test('other apps and malformed answers are "not found"', async () => {
  for (const body of [{ app: 'Something Else' }, { version: '1' }, 'nope', null, [], { app: 'trace studio' }]) {
    const f = fakeFetch(() => reply(body))
    assert.equal(await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io', ports: [8765, 8766] }), null)
  }
  const nonJson = fakeFetch(() => ({ ok: true, json: async () => { throw new SyntaxError('html') } }))
  assert.equal(await probeStudio({ fetchImpl: nonJson, pageOrigin: 'https://x.github.io', ports: [8765] }), null)
  const notOk = fakeFetch(() => ({ ok: false, json: async () => HELLO }))
  assert.equal(await probeStudio({ fetchImpl: notOk, pageOrigin: 'https://x.github.io', ports: [8765] }), null)
  assert.equal(parseHello({ app: 'TRACE Studio', ready: 'yes' }).ready, false, 'ready must be literally true')
})

test('a port that hangs times out and does not block the others', async () => {
  const f = fakeFetch((u) => u.includes(':8765/') ? 'hang' : u.includes(':8767/') ? reply(HELLO) : new TypeError('refused'))
  const found = await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io', timeoutMs: 30 })
  assert.equal(found.port, 8767)
  const allHang = fakeFetch(() => 'hang')
  const t0 = Date.now()
  assert.equal(await probeStudio({ fetchImpl: allHang, pageOrigin: 'https://x.github.io', timeoutMs: 40 }), null)
  assert.ok(Date.now() - t0 < 1000)
})

test('all ports failing resolves to null and never rejects', async () => {
  const f = fakeFetch(() => new TypeError('Failed to fetch'))
  assert.equal(await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io' }), null)
  assert.equal(await probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io', ports: [] }), null)
})

test('same-origin is probed first (relative URL) when the site is served from the app', async () => {
  const f = fakeFetch((u) => u === '/api/studio/hello' ? reply(HELLO) : new TypeError('refused'))
  const found = await probeStudio({ fetchImpl: f, pageOrigin: 'http://127.0.0.1:8765' })
  assert.equal(f.calls.length, 1, 'no port scan once the same origin answers')
  assert.equal(f.calls[0].url, '/api/studio/hello')
  assert.equal(found.origin, 'http://127.0.0.1:8765')
  assert.equal(found.port, 8765)
  assert.equal(studioOpenUrl(found), 'http://127.0.0.1:8765/#/?from=site')
})

test('same-origin miss falls through to the port scan; public origins skip it', async () => {
  const f = fakeFetch(hello(8772))
  const found = await probeStudio({ fetchImpl: f, pageOrigin: 'http://localhost:5199' })
  assert.equal(f.calls[0].url, '/api/studio/hello')
  assert.equal(found.port, 8772)
  const g = fakeFetch(hello(8772))
  await probeStudio({ fetchImpl: g, pageOrigin: 'https://zhenggao-30.github.io' })
  assert.ok(g.calls.every((c) => c.url.startsWith('http://127.0.0.1:')), 'no request to the public host')
  assert.ok(isLoopbackOrigin('http://127.0.0.1:1') && !isLoopbackOrigin('https://a.io') && !isLoopbackOrigin('file://'))
})

test('an aborted probe resolves null', async () => {
  const ctl = new AbortController()
  const f = fakeFetch(() => 'hang')
  const p = probeStudio({ fetchImpl: f, pageOrigin: 'https://x.github.io', timeoutMs: 5000 }, ctl.signal)
  ctl.abort()
  assert.equal(await p, null)
  assert.equal(config.STUDIO_DOWNLOAD_URL, '', 'download button stays hidden until a URL is configured')
})

test('a failed probe reports what every port did, and a no-cors second look tells "blocked" from "nothing listens"', async () => {
  let report = null
  // 8765 accepts the connection but the browser hides the reply (CORS-style failure); everything else is simply refused.
  const f = fakeFetch((u, ) => new TypeError('Failed to fetch'))
  const wrapped = (url, init = {}) => init.mode === 'no-cors' && url.includes(':8765/') ? Promise.resolve({ ok: false, type: 'opaque' }) : f(url, init)
  const found = await probeStudio({ fetchImpl: wrapped, pageOrigin: 'https://x.github.io', onReport: (r) => { report = r } })
  assert.equal(found, null)
  assert.equal(report.length, 21)
  assert.equal(report[0].port, 8765)
  assert.equal(report[0].outcome, 'unreachable')
  assert.equal(report[0].answered, true)
  assert.ok(report.slice(1).every((r) => r.outcome === 'unreachable' && !r.answered))
  const why = explainReport(report)
  assert.match(why.summary, /Something answers on this computer, but not as TRACE Studio, or your browser hid its reply/)
  assert.match(why.lines[0], /127\.0\.0\.1:8765: accepted the connection, but the browser would not share the reply/)
})

test('nothing listening reads as "not running or blocked", other answers are named', async () => {
  let rep = null
  await probeStudio({ fetchImpl: fakeFetch(() => new TypeError('Failed to fetch')), pageOrigin: 'https://x.github.io', onReport: (r) => { rep = r } })
  assert.equal(rep.length, 21)
  const none = explainReport(rep)
  assert.match(none.summary, /No connection could be made to 127\.0\.0\.1 on ports 8765–8785\. TRACE Studio is not running, or your browser or an extension blocks/)
  assert.deepEqual(none.lines, [])
  let rep2 = null
  await probeStudio({ fetchImpl: fakeFetch((u) => u.includes(':8765/') ? { ok: false, status: 404, json: async () => ({}) } : new TypeError('x')), pageOrigin: 'https://x.github.io', onReport: (r) => { rep2 = r } })
  assert.match(explainReport(rep2).lines[0], /127\.0\.0\.1:8765: answered with HTTP 404, not TRACE Studio/)
  let rep3 = null
  await probeStudio({ fetchImpl: fakeFetch((u) => u.includes(':8766/') ? 'hang' : new TypeError('x')), pageOrigin: 'https://x.github.io', timeoutMs: 20, onReport: (r) => { rep3 = r } })
  assert.match(explainReport(rep3).summary, /did not answer in time/)
  assert.match(explainReport(rep3).lines[0], /8766: no answer within the time limit/)
  assert.match(explainReport(null).summary, /No check has finished yet/)
})

test('onReport is not called when the app is found or the probe is aborted; direct URL points at the first port', async () => {
  let called = 0
  await probeStudio({ fetchImpl: fakeFetch(hello(8767)), pageOrigin: 'https://x.github.io', onReport: () => { called++ } })
  const ctl = new AbortController(); ctl.abort()
  await probeStudio({ fetchImpl: fakeFetch(() => new TypeError('x')), pageOrigin: 'https://x.github.io', onReport: () => { called++ } }, ctl.signal)
  assert.equal(called, 0)
  assert.equal(studioDirectUrl(), 'http://127.0.0.1:8765/#/?from=site')
})

test('public pages name the target address space for Local Network Access; loopback pages do not need to', async () => {
  const a = fakeFetch(hello(8765))
  await probeStudio({ fetchImpl: a, pageOrigin: 'https://zhenggao-30.github.io' })
  assert.ok(a.calls.every((c) => c.init.targetAddressSpace === 'loopback'))
  const b = fakeFetch(hello(8765))
  await probeStudio({ fetchImpl: b, pageOrigin: 'http://127.0.0.1:5199' })
  assert.ok(b.calls.filter((c) => c.url.startsWith('http://')).every((c) => c.init.targetAddressSpace === undefined))
})
