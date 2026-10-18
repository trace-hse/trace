import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const cache = new Map()
// Tiny CommonJS loader: transpiles the site's own .ts/.tsx on demand, real packages come from node_modules.
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  cache.set(file, module)
  const req = (name) => {
    if (name === '../Router') return { navigate() {} }
    if (name.startsWith('.')) {
      const base = resolve(dirname(file), name)
      for (const ext of ['.ts', '.tsx']) { try { readFileSync(base + ext); return load(base + ext) } catch { /* next */ } }
    }
    return require(name)
  }
  Function('require', 'module', 'exports', code)(req, module, module.exports)
  return module.exports
}
const entry = load(resolve(root, 'site/DemoEntry.tsx'))
const copy = load(resolve(root, 'site/content.ts')).STUDIO_COPY
const html = (el) => renderToStaticMarkup(el)
const noop = () => {}
const found = (over = {}) => ({ origin: 'http://127.0.0.1:8768', port: 8768, hello: { app: 'TRACE Studio', version: '0.1.0', ready: true, model: 'claude-haiku-4-5', ...over } })
const custom = (phase, f = null, report = undefined) => html(React.createElement(entry.CustomDemoView, { phase, found: f, onRetry: noop, report }))
const chooser = () => html(React.createElement(entry.DemoChooserView))
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

test('the new entry pages are English only: plain strings, no language switch, no Chinese', () => {
  const walk = (o, path) => Object.entries(o).forEach(([k, v]) => {
    if (typeof v === 'string') { assert.ok(v.trim(), `${path}.${k}`); assert.doesNotMatch(v, /[㐀-鿿]/, `${path}.${k} has Chinese`) } else walk(v, `${path}.${k}`)
  })
  walk(copy, 'STUDIO_COPY')
  for (const out of [chooser(), custom('checking'), custom('found', found()), custom('notfound')]) {
    assert.doesNotMatch(out, /aria-pressed|role="group"|[㐀-鿿]|>EN<|Language/, 'no language switch anywhere')
  }
})

test('chooser offers both cards and links to the right routes', () => {
  const out = chooser()
  assert.match(text(out), /Existing workflows/)
  assert.match(text(out), /Replay the recorded HSE cases\. Opens instantly, nothing to install\./)
  assert.match(text(out), /Custom workflow \(live\)/)
  assert.match(text(out), /Runs in the TRACE Studio app on your computer\./)
  assert.match(out, /href="#\/demo\?scenario=hse"/)
  assert.match(out, /href="#\/demo\/custom"/)
})

const c = copy.custom
test('custom page, checking', () => {
  const out = custom('checking')
  assert.ok(text(out).includes(c.checking))
  assert.doesNotMatch(out, /Open TRACE Studio/)
})
test('custom page, found', () => {
  const out = custom('found', found())
  assert.ok(text(out).includes(c.found))
  assert.ok(text(out).includes('0.1.0') && text(out).includes('claude-haiku-4-5'))
  assert.match(out, /href="http:\/\/127\.0\.0\.1:8768\/#\/\?from=site"/)
  assert.ok(text(out).includes(c.open) && text(out).includes(c.openNote))
})
test('custom page, starting', () => {
  const out = custom('starting', found({ ready: false }))
  assert.ok(text(out).includes(c.starting))
  assert.doesNotMatch(out, /from=site/, 'no Open button until the app is ready')
})
test('custom page, not found', () => {
  const out = custom('notfound')
  for (const k of ['notFoundTitle', 'step1', 'step2', 'step3', 'checkAgain', 'blocked', 'backExisting']) assert.ok(text(out).includes(c[k]), k)
  assert.doesNotMatch(out, /Download/, 'no download button while STUDIO_DOWNLOAD_URL is empty')
  assert.match(out, /href="#\/demo\?scenario=hse"/)
})

test('not found always offers a plain link to the app and explains what the page saw', () => {
  const none = custom('notfound')
  assert.match(none, /href="http:\/\/127\.0\.0\.1:8765\/#\/\?from=site"[^>]*>[^<]*Open TRACE Studio directly/)
  assert.doesNotMatch(none, /probe-details/, 'no details until a probe report exists')
  const rep = Array.from({ length: 21 }, (_, i) => ({ port: 8765 + i, outcome: 'unreachable' }))
  const out = custom('notfound', null, rep)
  assert.match(out, /data-testid="probe-details"/)
  assert.ok(text(out).includes(c.detailsTitle))
  assert.match(text(out), /No connection could be made to 127\.0\.0\.1 on ports 8765–8785/)
  const hidden = custom('notfound', null, [{ port: 8765, outcome: 'unreachable', answered: true }, ...rep.slice(1)])
  assert.match(text(hidden), /accepted the connection, but the browser would not share the reply/)
  assert.doesNotMatch(custom('found', found()), /Open TRACE Studio directly/, 'the direct link is only a fallback')
})
