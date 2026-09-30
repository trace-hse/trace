import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  Function('require', 'module', 'exports', 'fetch', code)(name => dependencies[name] ?? require(name), module, module.exports,
    () => assert.fail('the paper preview must not fetch or run a new experiment'))
  return module.exports
}
const paper = await load('../src/lib/paperRobustness.ts')
const dependencies = {
  '../lib/paperRobustness': paper,
  './PaperRobustnessPreview.css': {},
  'framer-motion': { ...require('framer-motion'), useReducedMotion: () => false },
}
const component = await load('../src/components/PaperRobustnessPreview.tsx', dependencies)

test('paper data retains the published strengths and digitized Figure 5 channel values', () => {
  assert.equal(paper.PAPER_ROBUSTNESS_SOURCE.url, 'https://arxiv.org/html/2607.08400v1#S6.F5')
  assert.equal(paper.PAPER_ROBUSTNESS_SOURCE.benchmark, 'ToolBench')
  assert.equal(paper.PAPER_ROBUSTNESS_SOURCE.threshold, 2)
  assert.match(paper.PAPER_ROBUSTNESS_SOURCE.precision, /Digitized.*not the original experiment outputs/)
  assert.deepEqual(paper.PAPER_ROBUSTNESS.deletion.map(point => point.strength), [0, 10, 20, 30, 40, 50, 60, 70])
  assert.deepEqual(paper.PAPER_ROBUSTNESS.deletion.map(point => point.selection), [11.34, 10.15, 8.99, 8.27, 7.13, 5.99, 5.30, 4.06])
  assert.deepEqual(paper.PAPER_ROBUSTNESS.deletion.map(point => point.tally), [14.34, 10.79, 7.88, 5.26, 3.52, 1.77, .64, -.41])
  assert.deepEqual(paper.PAPER_ROBUSTNESS.rewriting.map(point => point.strength), [0, 20, 40, 60, 80, 100])
  assert.deepEqual(paper.PAPER_ROBUSTNESS.rewriting.map(point => point.selection), [11.34, 8.16, 5.22, -1.53, -2.90, -3.51])
  assert.deepEqual(paper.PAPER_ROBUSTNESS.rewriting.map(point => point.tally), [14.34, 14.34, 14.34, 14.34, 14.34, 14.34])
})

test('attack strength selects a published point and never interpolates missing results', () => {
  const original = JSON.stringify(paper.PAPER_ROBUSTNESS)
  const deletion = paper.PAPER_ROBUSTNESS.deletion, rewriting = paper.PAPER_ROBUSTNESS.rewriting
  for (const [attack, points] of [['deletion', deletion], ['rewriting', rewriting]]) {
    for (const point of points) assert.equal(paper.nearestPaperPoint(attack, point.strength), point)
    assert.equal(paper.nearestPaperPoint(attack, -10), points[0])
    assert.equal(paper.nearestPaperPoint(attack, 1000), points.at(-1))
    assert.equal(paper.nearestPaperPoint(attack, NaN), points[0])
  }
  assert.equal(paper.nearestPaperPoint('deletion', 34), deletion[3])
  assert.equal(paper.nearestPaperPoint('deletion', 35), deletion[3], 'a tie selects the lower published strength')
  assert.equal(paper.nearestPaperPoint('rewriting', 30), rewriting[1])
  assert.equal(paper.nearestPaperPoint('rewriting', 31), rewriting[2])
  assert.equal(JSON.stringify(paper.PAPER_ROBUSTNESS), original)
})

test('the preview shows detection status and identifies its edited records as a paper-based illustration', () => {
  const html = renderToStaticMarkup(React.createElement(component.default))
  assert.match(html, /data-paper-robustness/)
  assert.match(html, /data-channel="selection"/)
  assert.match(html, /data-channel="tally"/)
  assert.match(html, /Choice watermark/)
  assert.match(html, /Count watermark/)
  assert.match(html, /≈11\.3/)
  assert.match(html, /≈14\.3/)
  assert.match(html, /aria-live="polite"/)
  assert.equal([...html.matchAll(/<strong\b[^>]*data-detection-verdict[^>]*>[\s\S]*?Still detected<\/strong>/g)].length, 2)
  assert.match(html, /Illustration only/)
  assert.match(html, /approximate ToolBench readings/)
  assert.match(html, /not HSE measurements/)
  assert.ok(html.includes(`href="${paper.PAPER_ROBUSTNESS_SOURCE.url}"`))
})

function descendants(element, predicate) {
  if (!React.isValidElement(element)) return []
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => descendants(child, predicate))]
}
async function previewHarness(paperModule = paper) {
  let cursor = 0, reducedMotion = false
  const slots = []
  const hooks = {
    useId() { const index = cursor++; return `paper-preview-test-${index}` },
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
  }
  const subject = await load('../src/components/PaperRobustnessPreview.tsx', {
    ...dependencies, '../lib/paperRobustness': paperModule, react: hooks,
    'framer-motion': { ...require('framer-motion'), useReducedMotion: () => reducedMotion },
  })
  return { render() { cursor = 0; return subject.default() }, setReducedMotion(value) { reducedMotion = value } }
}
const slider = tree => descendants(tree, el => el.type === 'input' && el.props.type === 'range')[0]
const channel = (tree, name) => descendants(tree, el => el.props['data-channel'] === name)[0]
const recordSlots = tree => descendants(tree, el => el.props['data-record-slot'] !== undefined)
const verdict = card => descendants(card, el => el.props['data-detection-verdict'] !== undefined)[0]
const score = card => descendants(card, el => el.props['data-paper-score'] !== undefined)[0]
function attackButton(tree, label) {
  return descendants(tree, el => el.type === 'button' && React.Children.toArray(el.props.children)
    .some(child => typeof child === 'string' && child.trim() === label))[0]
}
function assertScore(tree, name, expected) {
  assert.ok(renderToStaticMarkup(score(channel(tree, name))).includes(`≈${expected}`))
}
function assertPoint(tree, point, attack) {
  assert.equal(slider(tree).props.value, point.strength)
  assert.equal(tree.props['data-edited-count'], point.strength / 10)
  const slots = recordSlots(tree)
  assert.equal(slots.length, 10, 'the illustration keeps ten slots instead of presenting them as experiment samples')
  assert.equal(slots.filter(slot => slot.props['data-edited'] === true).length, point.strength / 10)
  for (const slot of slots) {
    assert.equal(slot.props['data-edit-kind'], slot.props['data-edited'] ? attack === 'deletion' ? 'deleted' : 'rewritten' : 'none')
    const actionWords = descendants(slot, el => el.props['data-action-word'] !== undefined)
    assert.equal(actionWords.length, 1,
      'removing an observation record retains its action in the illustration')
    const expectedWords = slot.props['data-edited'] && attack === 'rewriting'
      ? ['View', 'Scan', 'Tell', 'Send'] : ['Read', 'Look', 'Ask', 'Save']
    assert.ok(expectedWords.includes(actionWords[0].props.children),
      'rewriting changes action words while deletion retains their original text')
    assert.equal(descendants(slot, el => el.props['data-note-removed'] !== undefined)[0].props['data-note-removed'],
      slot.props['data-edited'] && attack === 'deletion')
  }
  const caption = descendants(tree, el => el.props['data-illustrated-edit-count'] !== undefined)[0]
  assert.ok(renderToStaticMarkup(caption).includes(`${point.strength / 10} of 10 ${attack === 'deletion' ? 'notes removed' : 'actions rewritten'}`))
  for (const name of ['selection', 'tally']) {
    const card = channel(tree, name), expectedDetected = point[name] > paper.PAPER_ROBUSTNESS_SOURCE.threshold
    assert.equal(card.props['data-detected'], expectedDetected)
    assert.equal(score(card).props['data-paper-score'], point[name], 'display data uses the saved paper score rather than counting illustration tiles')
    assert.ok(renderToStaticMarkup(verdict(card)).includes(expectedDetected ? 'Still detected' : 'Not detected'))
    assertScore(tree, name, point[name].toFixed(1))
    const meter = descendants(card, el => el.props.role === 'meter')[0]
    assert.ok(meter)
    assert.equal(meter.props['aria-valuenow'], point[name])
    assert.equal(meter.props['aria-valuemin'], -5)
    assert.equal(meter.props['aria-valuemax'], 16)
  }
}

test('every published attack strength has the correct illustrated edit count and two raw-score detection verdicts', async () => {
  const original = JSON.stringify(paper.PAPER_ROBUSTNESS)
  const harness = await previewHarness()
  let tree = harness.render()
  assert.equal(slider(tree).props.max, 70)
  assert.equal(slider(tree).props.step, 10)
  for (const attack of ['deletion', 'rewriting']) {
    attackButton(tree, attack === 'deletion' ? 'Delete records' : 'Rewrite actions').props.onClick()
    tree = harness.render()
    assert.equal(tree.props['data-attack'], attack)
    assert.equal(slider(tree).props.max, attack === 'deletion' ? 70 : 100)
    assert.equal(slider(tree).props.step, attack === 'deletion' ? 10 : 20)
    for (const point of paper.PAPER_ROBUSTNESS[attack]) {
      slider(tree).props.onChange({ target: { value: String(point.strength) } })
      tree = harness.render()
      assertPoint(tree, point, attack)
    }
  }
  assert.equal(JSON.stringify(paper.PAPER_ROBUSTNESS), original, 'the animation never modifies the saved benchmark measurements')
})

test('the two watermarks respond differently to deleted records and rewritten actions', async () => {
  const harness = await previewHarness()
  let tree = harness.render()
  slider(tree).props.onChange({ target: { value: '35' } })
  tree = harness.render()
  assert.equal(slider(tree).props.value, 30)
  assertScore(tree, 'selection', '8.3')
  assertScore(tree, 'tally', '5.3')
  for (const strength of [50, 70]) {
    slider(tree).props.onChange({ target: { value: String(strength) } })
    tree = harness.render()
    assert.equal(channel(tree, 'selection').props['data-detected'], true)
    assert.equal(channel(tree, 'tally').props['data-detected'], false)
    assert.match(renderToStaticMarkup(tree), /Choice watermark still identifies the source/)
  }
  attackButton(tree, 'Rewrite actions').props.onClick()
  tree = harness.render()
  assert.equal(tree.props['data-attack'], 'rewriting')
  assert.equal(slider(tree).props.value, 60, 'switching attack snaps to an available published strength')
  for (const strength of [60, 100]) {
    slider(tree).props.onChange({ target: { value: String(strength) } })
    tree = harness.render()
    assert.equal(channel(tree, 'selection').props['data-detected'], false)
    assert.equal(channel(tree, 'tally').props['data-detected'], true)
    assert.match(renderToStaticMarkup(tree), /Count watermark still identifies the source/)
  }
  for (const attack of ['deletion', 'rewriting']) {
    attackButton(tree, attack === 'deletion' ? 'Delete records' : 'Rewrite actions').props.onClick()
    tree = harness.render()
    slider(tree).props.onChange({ target: { value: '0' } })
    tree = harness.render()
    assert.equal(channel(tree, 'selection').props['data-detected'], true)
    assert.equal(channel(tree, 'tally').props['data-detected'], true)
    assert.match(renderToStaticMarkup(tree), /Both watermarks are still detected/)
  }
})

test('display rounding does not decide whether a watermark exceeds the threshold', async () => {
  const original = JSON.stringify(paper.PAPER_ROBUSTNESS)
  const point = { strength: 0, selection: 2, tally: 2.0001 }
  const harness = await previewHarness({ ...paper, nearestPaperPoint: () => point })
  const tree = harness.render()
  assertScore(tree, 'selection', '2.0')
  assertScore(tree, 'tally', '2.0')
  assert.equal(channel(tree, 'selection').props['data-detected'], false, 'a score equal to two is below the strict detection condition')
  assert.equal(channel(tree, 'tally').props['data-detected'], true, 'a score just above two remains detected despite the same rounded display')
  assert.equal(JSON.stringify(paper.PAPER_ROBUSTNESS), original)
})

test('reduced motion ends timed transforms without changing the selected attack, scores, or edits', async () => {
  const harness = await previewHarness()
  let tree = harness.render()
  attackButton(tree, 'Rewrite actions').props.onClick()
  tree = harness.render()
  slider(tree).props.onChange({ target: { value: '100' } })
  tree = harness.render()
  const transforms = descendants(tree, el => el.props.animate && ['x', 'y', 'rotate', 'rotateX', 'scaleX'].some(key => key in el.props.animate))
  assert.ok(transforms.some(el => el.props.transition?.duration > 0), 'the full-motion illustration has an active animation configuration')
  harness.setReducedMotion(true)
  tree = harness.render()
  assert.equal(tree.props['data-motion'], 'reduced')
  assert.equal(tree.props['data-attack'], 'rewriting')
  assertPoint(tree, paper.PAPER_ROBUSTNESS.rewriting.at(-1), 'rewriting')
  const reducedTransforms = descendants(tree, el => el.props.animate && ['x', 'y', 'rotate', 'rotateX', 'scaleX'].some(key => key in el.props.animate))
  assert.ok(reducedTransforms.length > 0)
  assert.ok(reducedTransforms.every(el => el.props.transition?.duration === 0), 'reduced motion removes the timing of transform animations')
  harness.setReducedMotion(false)
  tree = harness.render()
  assert.equal(tree.props['data-motion'], 'standard')
  assertPoint(tree, paper.PAPER_ROBUSTNESS.rewriting.at(-1), 'rewriting')
  attackButton(tree, 'Delete records').props.onClick()
  tree = harness.render()
  const animatedNotes = descendants(tree, el => el.props['data-illustrated-note'] !== undefined)
  assert.ok(animatedNotes.some(note => note.props.animate.y !== 0 || note.props.animate.rotate !== 0))
  harness.setReducedMotion(true)
  tree = harness.render()
  assertPoint(tree, paper.PAPER_ROBUSTNESS.deletion.at(-1), 'deletion')
  const staticNotes = descendants(tree, el => el.props['data-illustrated-note'] !== undefined)
  assert.ok(staticNotes.every(note => note.props.animate.y === 0 && note.props.animate.rotate === 0
    && note.props.transition.duration === 0 && note.props.transition.delay === 0),
  'reduced motion cancels the note displacement and stagger while retaining the deleted-note state')
})
