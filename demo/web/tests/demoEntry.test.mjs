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
const effects = []
const hooks = {
  ...React,
  useEffect(effect, deps) { effects.push({ effect, deps }) },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
}
// Tiny CommonJS loader: transpiles the site's own .ts/.tsx on demand, real packages come from node_modules.
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  cache.set(file, module)
  const req = (name) => {
    if (name === 'react') return hooks
    if (['./App', './site/Landing', './story/AcrossDomains'].includes(name)) return { default: () => null }
    if (name.startsWith('.')) {
      const base = resolve(dirname(file), name)
      for (const ext of ['.ts', '.tsx']) { try { readFileSync(base + ext); return load(base + ext) } catch { /* next */ } }
    }
    return require(name)
  }
  Function('require', 'module', 'exports', code)(req, module, module.exports)
  return module.exports
}
const { STUDIO_ONLINE_URL } = load(resolve(root, 'lib/studioConfig.ts'))
const entry = load(resolve(root, 'site/DemoEntry.tsx'))
const copy = load(resolve(root, 'site/content.ts')).STUDIO_COPY
const html = (el) => renderToStaticMarkup(el)
const custom = () => html(React.createElement(entry.default))
const chooser = () => html(React.createElement(entry.DemoChooserView))
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const links = (out) => [...out.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
const card = (out, title) => {
  const link = links(out).find((match) => text(match[2]).includes(title))
  assert.ok(link, title + ' link is present')
  return link
}

test('the entry pages are English only: plain strings, no language switch, no Chinese', () => {
  const walk = (o, path) => Object.entries(o).forEach(([k, v]) => {
    if (typeof v === 'string') { assert.ok(v.trim(), path + '.' + k); assert.doesNotMatch(v, /[\u3400-\u9fff]/) } else walk(v, path + '.' + k)
  })
  walk(copy, 'STUDIO_COPY')
  for (const out of [chooser(), custom()]) {
    assert.doesNotMatch(out, /aria-pressed|role="group"|[\u3400-\u9fff]|>EN<|Language/, 'no language switch anywhere')
  }
})

test('chooser Custom card links directly to the online app in the same tab', () => {
  const link = card(chooser(), copy.chooser.customTitle)
  assert.equal(link[1].match(/href="([^"]+)"/)[1], STUDIO_ONLINE_URL)
  assert.doesNotMatch(link[1], /\btarget=/)
  assert.ok(text(link[2]).includes(copy.chooser.customBody))
  assert.ok(text(link[2]).includes('Try your own workflow'))
  assert.ok(text(link[2]).includes('Runs online'))
  assert.doesNotMatch(text(link[2]), /desktop|on your computer/i)
})

test('chooser Existing workflows card keeps its recorded-case route and copy', () => {
  const link = card(chooser(), 'Existing workflows')
  assert.equal(link[1].match(/href="([^"]+)"/)[1], '#/demo?scenario=hse')
  assert.match(text(link[2]), /Replay the recorded HSE cases\. Opens instantly, nothing to install\./)
  assert.match(text(link[2]), /Open the recorded cases/)
})

test('legacy custom route renders the redirect component and replaces the location on mount', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const calls = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { hash: '#/demo/custom', replace: (url) => calls.push(url) },
  } })
  try {
    const Router = load(resolve(root, 'Router.tsx')).default
    effects.length = 0
    const route = Router()
    assert.equal(route.type, entry.default)
    const out = html(route)
    assert.deepEqual(calls, [], 'rendering does not navigate before mount')
    assert.match(out, /<h1>Opening the online version\.\.\.<\/h1>/)
    const link = card(out, 'Open the online version')
    assert.equal(link[1].match(/href="([^"]+)"/)[1], STUDIO_ONLINE_URL)
    assert.doesNotMatch(link[1], /\btarget=/)
    const redirect = effects.at(-1)
    assert.deepEqual(redirect.deps, [], 'redirect runs on mount')
    redirect.effect()
    assert.deepEqual(calls, [STUDIO_ONLINE_URL])
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  }
})

test('each demo entry page has exactly one main heading', () => {
  for (const out of [chooser(), custom()]) {
    assert.equal((out.match(/<h1\b/g) || []).length, 1)
  }
})
