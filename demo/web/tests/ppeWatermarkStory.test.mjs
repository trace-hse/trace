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
  Function('require', 'module', 'exports', 'window', 'setTimeout', 'clearTimeout', 'fetch', code)(name => dependencies[name] ?? require(name), module, module.exports,
    dependencies.window, dependencies.clock?.setTimeout ?? globalThis.setTimeout, dependencies.clock?.clearTimeout ?? globalThis.clearTimeout,
    () => assert.fail('the story must not run a model or detector'))
  return module.exports
}
const ppe = await load('../src/lib/ppeInspection.ts')
const playback = await load('../src/lib/ppePlayback.ts', { './ppeInspection': ppe })
const choices = await load('../src/lib/ppeChoiceComparison.ts', { './ppePlayback': playback, './ppeInspection': ppe })
const story = await load('../src/lib/ppeWatermarkStory.ts', {
  './ppeChoiceComparison': choices, './ppePlayback': playback, './ppeInspection': ppe,
})
const replay = await load('../src/lib/ppeChoiceReplay.ts')
const componentDependencies = {
  '../lib/ppeWatermarkStory': story,
  '../lib/ppeChoiceReplay': replay,
  '../lib/ppeChoiceComparison': choices,
  '../lib/ppePlayback': playback,
  '../lib/ppeInspection': ppe,
  '../lib/ppeChoiceArt': { choiceArt: art => ({ src: `/test-story-art/${art}.png`, position: '0% 0%' }) },
  'framer-motion': { useReducedMotion: () => false }, './PPEWatermarkStory.css': {},
}
const pairs = await Promise.all(['CS01', 'CS02'].map(async id => JSON.parse(await readFile(new URL(`../public/static/compare/hse_ppe-${id}.json`, import.meta.url), 'utf8'))))
const hidden = () => false

function freezeRecord(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeRecord(child)
  }
  return value
}
function propsFor(pair, patch = {}) {
  return {
    pair,
    selected: playback.matchedRequirement(pair, 'worker_identity'),
    revealed: hidden,
    onSelect() {},
    appliedCandidateId: replay.registeredChoiceReplayCandidate(pair)?.agent_id,
    ...patch,
  }
}
async function render(pair, patch) {
  const harness = await animationHarness(), props = propsFor(pair, patch)
  try {
    const tree = expandComparison(harness, props)
    return renderToStaticMarkup(tree)
  } finally { harness.unmount() }
}
function decode(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'",
  })[entity])
}
function attribute(markup, name) {
  return decode(markup.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '')
}
function assertNoSourcePanel(markup) {
  assert.doesNotMatch(markup, /Full-log watermark detection|data-story-source-status|data-source-candidate|data-source-state/)
}

for (const [caseIndex, expected] of [[0, 8], [1, 15]]) {
  const pair = pairs[caseIndex]
  test(`${pair.game_id}: differences match requirements while the one log retains all 24 TRACE actions`, () => {
    const original = JSON.stringify(pair)
    freezeRecord(pair)
    const data = story.buildPPEWatermarkStory(pair, playback.matchedRequirement(pair, 'worker_identity'), hidden)
    assert.equal(data.differences.length, expected)
    assert.ok(data.differences.some(item => item.standard.i !== item.trace.i), 'the fixture exercises different execution positions')
    for (const difference of data.differences) {
      assert.equal(difference.standard.requirement_id, difference.trace.requirement_id)
      assert.notEqual(difference.standard.action, difference.trace.action)
      assert.equal(difference.trace, pair.trace.steps.find(step => step.requirement_id === difference.trace.requirement_id))
      const expectedActions = new Set(difference.trace.distribution.filter(candidate => candidate.p > 0 && candidate.cmd.startsWith(`${difference.trace.requirement_id} method=`)).map(candidate => candidate.cmd))
      expectedActions.add(difference.trace.action)
      assert.deepEqual(new Set(difference.options.map(option => option.action)), expectedActions)
      assert.deepEqual(difference.options.filter(option => option.selected).map(option => option.action), [difference.trace.action])
    }
    assert.equal(data.log.length, 24)
    assert.deepEqual(data.log.map(entry => entry.step.i), pair.trace.steps.map(step => step.i))
    data.log.forEach((entry, index) => assert.equal(entry.step, pair.trace.steps[index]))
    assert.ok(data.log.some(entry => !entry.changed), 'same-method actions remain part of the detector input')
    assert.equal(JSON.stringify(pair), original)
  })
}

test('TRACE illustrations retain their own candidates rather than importing baseline alternatives', () => {
  const pair = structuredClone(pairs[0])
  const selected = playback.matchedRequirement(pair, 'worker_identity')
  selected.trace.distribution = [
    { cmd: selected.trace.action, label: 'Own candidate', p: 1 },
    { cmd: selected.standard.action, label: 'Unavailable in this state', p: 0 },
    { cmd: 'work_assignment method=record', label: 'Different requirement', p: 1 },
  ]
  const data = story.buildPPEWatermarkStory(freezeRecord(pair), selected, hidden)
  assert.deepEqual(data.current.options.map(option => option.action), [selected.trace.action])
  assert.equal(data.log.length, 24)
})

test('missing counterparts and mismatched selections never compare unrelated step numbers', () => {
  const pair = structuredClone(pairs[0])
  const mixed = { standard: pair.standard.steps[2], trace: pair.trace.steps[2] }
  assert.notEqual(mixed.standard.requirement_id, mixed.trace.requirement_id)
  let data = story.buildPPEWatermarkStory(pair, mixed, hidden)
  assert.equal(data.current, null)
  pair.standard.steps = pair.standard.steps.filter(step => step.requirement_id !== 'worker_identity')
  data = story.buildPPEWatermarkStory(freezeRecord(pair), { trace: pair.trace.steps[0] }, hidden)
  assert.equal(data.current, null)
  assert.equal(data.log.length, pair.trace.steps.length)
  assert.ok(!data.differences.some(item => item.trace.requirement_id === 'worker_identity'))
})

test('future conclusions stay out of the choice demonstration and unrevealed log labels', () => {
  const pair = structuredClone(pairs[0])
  const selected = playback.matchedRequirement(pair, 'ppe_conclusion')
  selected.trace.action = 'record_ppe_fail'
  freezeRecord(pair)
  for (const permitted of [[], ['standard'], ['trace'], ['standard', 'trace']]) {
    const data = story.buildPPEWatermarkStory(pair, selected, source => permitted.includes(source))
    if (permitted.length < 2) {
      assert.equal(data.current, null)
      assert.ok(!data.differences.some(item => item.trace.requirement_id === 'ppe_conclusion'))
    } else assert.equal(data.current.trace.action, 'record_ppe_fail')
    const entry = data.log.find(item => item.step.requirement_id === 'ppe_conclusion')
    if (permitted.length < 2) assert.doesNotMatch(`${entry.title} ${entry.method}`, /passed|not passed|needs review/i)
  }
})

test('source results remain unavailable before full completion, even when all individual steps were viewed', () => {
  for (const pair of pairs) {
    const source = story.sourceSummary(pair, false)
    assert.equal(source.status, 'pending')
    assert.deepEqual(source.supportedIds, [])
    for (const candidate of source.candidates) {
      assert.equal(candidate.state, 'pending')
      for (const field of ['z1', 'z2', 'n1', 'n2', 'layer1', 'layer2']) assert.ok(candidate[field] == null, `${field} does not leak an unavailable result`)
    }
  }
})

test('source evidence preserves the actual unique or ambiguous candidate result rather than always naming Agent A', () => {
  const first = story.sourceSummary(pairs[0], true), second = story.sourceSummary(pairs[1], true)
  assert.deepEqual(story.savedExperimentSummary(pairs[0]), first, 'the saved demo snapshot reuses the same strict validation')
  assert.deepEqual(story.savedExperimentSummary(pairs[1]), second, 'the saved demo snapshot preserves ambiguous evidence')
  assert.equal(first.status, 'candidate_match')
  assert.deepEqual(first.supportedIds, pairs[0].attribution.matched_agent_ids)
  assert.equal(second.status, 'ambiguous')
  assert.deepEqual(new Set(second.supportedIds), new Set(pairs[1].attribution.matched_agent_ids))
  assert.equal(second.supportedIds.length, 2)
  const changed = structuredClone(pairs[0])
  changed.attribution.candidates.forEach((candidate, index) => {
    candidate.agent_id = `test-candidate-${index}`
    candidate.label = `Test candidate ${index}`
    candidate.z1 = index === 1 ? 3 : 0
    candidate.z2 = 0
    candidate.layer1_detected = index === 1
    candidate.layer2_detected = false
  })
  changed.attribution.matched_agent_ids = ['test-candidate-1']
  const other = story.sourceSummary(freezeRecord(changed), true)
  assert.equal(other.status, 'candidate_match')
  assert.deepEqual(other.supportedIds, ['test-candidate-1'])
  const withoutReference = structuredClone(pairs[0])
  delete withoutReference.standard
  assert.deepEqual(story.sourceSummary(withoutReference, true), first, 'the baseline reference log is not a source-detection input')
})

test('missing attribution or a different log scope cannot borrow a full-log source result', () => {
  const pair = structuredClone(pairs[0])
  pair.attribution.record_scope = 'controlled_codex_llm_actions_admission'
  assert.equal(story.sourceSummary(pair, true).status, 'unavailable')
  delete pair.attribution
  assert.equal(story.sourceSummary(pair, true).status, 'unavailable')
})

function variableDifferences(pair) {
  return story.buildPPEWatermarkStory(pair, playback.matchedRequirement(pair, 'worker_identity'), () => true)
    .differences.filter(choice => choice.keyGuided)
}

for (const [caseIndex, expected] of [[0, 8], [1, 15]]) {
  const pair = pairs[caseIndex]
  test(`${pair.game_id}: the compact matrix replaces the duplicate arm cards and keeps the recorded choices fixed`, async () => {
    const original = JSON.stringify(pair), differences = variableDifferences(pair)
    assert.equal(differences.length, expected)
    const html = await render(pair)
    assert.match(html, /data-watermark-story/)
    const replayTags = [...html.matchAll(/<button\b[^>]*data-replay-step="[^"]*"[^>]*>/g)].map(([tag]) => tag)
    assert.deepEqual(replayTags.map(tag => Number(attribute(tag, 'data-replay-step'))), differences.map(choice => choice.trace.i))
    assert.deepEqual(replayTags.map(tag => attribute(tag, 'data-recorded-action')), differences.map(choice => choice.trace.action))
    assert.ok(replayTags.every(tag => attribute(tag, 'data-top-action') === '' && attribute(tag, 'data-replay-match') === 'pending'))
    assert.doesNotMatch(html, /data-choice-arm=|data-story-choice=|Previous difference|Next difference/)
    assert.doesNotMatch(html, /data-story-log-step=|data-path-arm|pap-drawing/)
    for (const option of ['original', 'Key A', 'Key B', 'Key C']) assert.match(html, new RegExp(`data-replay-option="${option}"`))
    assert.equal([...html.matchAll(/data-replay-option="[^"]*" aria-pressed="true"/g)].length, 1)
    assertNoSourcePanel(html)
    assert.equal(JSON.stringify(pair), original)
  })

  test(`${pair.game_id}: registered keys replay the actual selected decisions, with partial matches for other keys`, () => {
    const differences = variableDifferences(pair), candidates = replay.choiceReplayCandidates(pair)
    assert.equal(candidates.length, 3)
    const totals = candidates.map(candidate => {
      const result = replay.buildChoiceReplay(pair, differences, candidate.agent_id, true)
      assert.equal(result.status, 'ready')
      assert.equal(result.total, expected)
      assert.equal(result.rows.length, expected)
      assert.deepEqual(result.rows.map(row => row.choice.trace.i), differences.map(choice => choice.trace.i))
      assert.equal(result.matches, result.rows.filter(row => row.match).length)
      result.rows.forEach(row => {
        assert.equal(row.chosen, row.choice.trace.action)
        assert.equal(row.match, row.chosen === row.replayed)
        assert.ok(row.choice.trace.distribution.some(candidate => candidate.cmd === row.replayed && candidate.p > 0))
      })
      return result.matches
    })
    assert.equal(totals[0], expected)
    assert.ok(totals[1] > 0 && totals[1] < expected, 'a different key may still pick some of the same actions')
    assert.ok(totals[2] > 0 && totals[2] < expected, 'a different key must not be portrayed as universally mismatching')
    assert.deepEqual(totals, caseIndex === 0 ? [8, 4, 4] : [15, 7, 6])
    const originalComparison = replay.buildOriginalComparison(differences, true)
    assert.equal(originalComparison.status, 'ready')
    assert.equal(originalComparison.matches, 0)
    assert.deepEqual(originalComparison.rows.map(row => row.replayed), differences.map(choice => choice.standard.action))
    assert.deepEqual(originalComparison.rows.map(row => row.chosen), differences.map(choice => choice.trace.action))
    assert.ok(originalComparison.rows.every(row => row.match === (row.replayed === row.chosen)))
  })
}

test('the generic replay helper honors unavailable data and the loaded comparison has no verdict before key replay', async () => {
  for (const pair of pairs) {
    for (const candidate of replay.choiceReplayCandidates(pair)) {
      const pending = replay.buildChoiceReplay(pair, variableDifferences(pair), candidate.agent_id, false)
      assert.equal(pending.status, 'pending')
      assert.equal(pending.matches, null)
      assert.ok(pending.rows.every(row => row.match == null && row.replayed == null), 'pending rows do not expose the saved answer')
    }
    assert.equal(replay.buildOriginalComparison(variableDifferences(pair), false).status, 'pending')
    const html = await render(pair)
    assertNoSourcePanel(html)
    assert.doesNotMatch(html, /data-replay-match="true"|data-replay-match="false"/)
  }
})

test('key entry only resolves registered public keys; unknown and missing replay data cannot succeed', () => {
  const pair = pairs[0], differences = variableDifferences(pair)
  assert.equal(replay.registeredChoiceReplayCandidate(pair)?.agent_id, pair.provenance.registered_agent_id)
  for (const candidate of replay.choiceReplayCandidates(pair)) {
    assert.equal(replay.keyCandidate(pair, `${candidate.key1}/${candidate.key2}`)?.agent_id, candidate.agent_id)
    assert.equal(replay.keyCandidate(pair, ` ${candidate.key1} / ${candidate.key2} `)?.agent_id, candidate.agent_id)
    assert.equal(replay.keyCandidate(pair, String(candidate.key1)), undefined, 'one channel alone is not a complete registered key pair')
  }
  for (const unknown of ['', '1234', 'Key A', '20250001junk', 'NaN']) assert.equal(replay.keyCandidate(pair, unknown), undefined)
  assert.equal(replay.buildChoiceReplay(pair, differences, 'missing-key', true).status, 'unavailable')
  const missing = structuredClone(pair)
  delete missing.choice_replay
  assert.deepEqual(replay.choiceReplayCandidates(missing), [])
  assert.equal(replay.keyCandidate(missing, '20250001'), undefined)
  assert.equal(replay.buildChoiceReplay(missing, differences, 'gate-agent-01', true).status, 'unavailable')
  const wrongScope = structuredClone(pair)
  wrongScope.choice_replay.scope = 'standard_recorded_decisions'
  assert.equal(replay.buildChoiceReplay(wrongScope, differences, 'gate-agent-01', true).status, 'unavailable')
  const mismatchedProvenance = structuredClone(pair)
  mismatchedProvenance.provenance.keys.key1 += 1
  assert.equal(replay.registeredChoiceReplayCandidate(mismatchedProvenance), undefined)
})

test('replay rows must belong to the actual recorded decision and malformed rows cannot manufacture a match', () => {
  for (const change of [
    row => { row.chosen = 'invented_original_action' },
    row => { row.replayed = 'invented_replayed_action' },
    row => { row.match = !row.match },
  ]) {
    const pair = structuredClone(pairs[0]), differences = variableDifferences(pair)
    const candidate = pair.choice_replay.candidates[0]
    const row = candidate.steps.find(step => step.i === differences[0].trace.i)
    change(row)
    const result = replay.buildChoiceReplay(pair, differences, candidate.agent_id, true)
    assert.equal(result.status, 'unavailable')
    assert.equal(result.matches, null)
  }
  const missingRow = structuredClone(pairs[0]), differences = variableDifferences(missingRow)
  const candidate = missingRow.choice_replay.candidates[0]
  candidate.steps = candidate.steps.filter(step => step.i !== differences[0].trace.i)
  assert.equal(replay.buildChoiceReplay(missingRow, differences, candidate.agent_id, true).status, 'unavailable')
})

test('the full-log source panel stays removed as recorded actions are revealed without altering saved attribution', async () => {
  for (const pair of pairs) {
    const original = JSON.stringify(pair)
    const expected = story.sourceSummary(pair, true)
    for (const revealed of [hidden, () => true]) {
      const html = await render(pair, { revealed })
      assertNoSourcePanel(html)
      assert.match(html, /data-watermark-story/)
      assert.equal(JSON.stringify(pair), original)
      assert.deepEqual(story.sourceSummary(pair, true), expected)
    }
  }
  assert.equal(story.sourceSummary(pairs[1], true).status, 'ambiguous')
  assert.deepEqual(story.sourceSummary(pairs[1], true).supportedIds, ['gate-agent-01', 'gate-agent-03'])
})

test('conclusion details remain gated and absent replay data leaves the comparison usable', async () => {
  const pair = structuredClone(pairs[0]), selected = playback.matchedRequirement(pair, 'ppe_conclusion')
  selected.trace.action = 'record_ppe_fail'
  for (const permitted of [[], ['standard'], ['trace']]) {
    const html = await render(pair, { selected, revealed: source => permitted.includes(source) })
    assert.doesNotMatch(html, /Result: passed|Result: not passed|Record: passed|Record: not passed/)
    assertNoSourcePanel(html)
  }
  const missing = structuredClone(pairs[0])
  delete missing.choice_replay
  delete missing.attribution
  const html = await render(missing, { revealed: () => true })
  assert.match(html, /data-watermark-story/)
  assertNoSourcePanel(html)
  assert.doesNotMatch(html, /data-replay-match="true"|data-replay-match="false"/)
})

function descendants(element, predicate) {
  if (!React.isValidElement(element)) return []
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => descendants(child, predicate))]
}

async function animationHarness() {
  let cursor = 0, dirty = false, effects = [], timerId = 0, reducedMotion = false
  const slots = [], timers = new Map()
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useId() { const index = cursor++; slots[index] ??= { value: `story-test-${index}` }; return slots[index].value },
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true } }]
    },
    useRef(value) { const index = cursor++; slots[index] ??= { current: value }; return slots[index] },
    useMemo(factory, deps) {
      const index = cursor++, previous = slots[index]
      if (!same(previous?.deps, deps)) slots[index] = { deps, value: factory() }
      return slots[index].value
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps) },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index]
      if (!same(previous?.deps, deps)) {
        const slot = { deps, cleanup: previous?.cleanup }
        slots[index] = slot
        effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() })
      }
    },
  }
  const clock = { setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id }, clearTimeout(id) { timers.delete(id) } }
  const subject = await load('../src/components/PPEWatermarkStory.tsx', {
    ...componentDependencies, react: hooks, clock, 'framer-motion': { useReducedMotion: () => reducedMotion },
  })
  return {
    timers,
    setReducedMotion(value) { reducedMotion = value },
    render(props) {
      for (let pass = 0; pass < 8; pass++) {
        cursor = 0; dirty = false; effects = []
        const tree = subject.default(props)
        for (const effect of effects) effect()
        if (!dirty) return tree
      }
      assert.fail('story state did not settle')
    },
    fireNext() {
      const [id, timer] = [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)[0] ?? []
      assert.ok(timer)
      timers.delete(id); timer.fn()
    },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}

function buttonNamed(tree, name) {
  const matches = descendants(tree, element => element.type === 'button' && (
    element.props['aria-label'] === name || React.Children.toArray(element.props.children)
      .filter(child => typeof child === 'string' || typeof child === 'number').join('') === name
  ))
  assert.equal(matches.length, 1, `one ${name} button exists`)
  return matches[0]
}
function expandComparison(harness, props, tree = harness.render(props)) {
  buttonNamed(tree, 'Expand comparison').props.onClick()
  return harness.render(props)
}
function replayButton(tree) {
  const buttons = descendants(tree, element => element.type === 'button' && element.props['data-replay-verify'] !== undefined)
  assert.equal(buttons.length, 1, 'one replay button exists')
  return buttons[0]
}
function selectedComparisonLabel(tree) {
  const selected = descendants(tree, element => element.type === 'button' && element.props['data-replay-option'] !== undefined
    && element.props['aria-pressed'] === true)
  assert.equal(selected.length, 1, 'one comparison option is selected')
  return React.Children.toArray(selected[0].props.children).filter(child => typeof child === 'string').join('')
}
function replayState(tree) {
  return descendants(tree, element => element.props['data-replay-state'] !== undefined)[0]?.props['data-replay-state']
}
function replayResult(tree) {
  return descendants(tree, element => element.props['data-replay-result'] !== undefined)[0]?.props['data-replay-result']
}
function replayRows(tree) {
  return descendants(tree, element => element.props['data-replay-step'] !== undefined)
}
function alignmentScore(tree) {
  return descendants(tree, element => element.props['data-score-phase'] !== undefined)[0]
}
function experimentMetric(tree) {
  return descendants(tree, element => element.props['data-experiment-ready'] !== undefined)[0]
}
function verdict(tree) {
  return descendants(tree, element => element.props['data-verdict'] !== undefined)[0]?.props['data-verdict']
}
function finishAnimation(harness, props) {
  let tree
  for (let tick = 0; tick < 100 && harness.timers.size; tick++) {
    harness.fireNext()
    tree = harness.render(props)
  }
  assert.equal(harness.timers.size, 0, 'the finite visual replay finishes')
  return tree ?? harness.render(props)
}

test('the source comparison expands in place for key replay and preserves results when collapsed without changing the log', async () => {
  const harness = await animationHarness(), pair = pairs[1], calls = []
  const original = JSON.stringify(pair)
  const paperPreview = React.createElement('section', { 'data-paper-regression': true })
  const props = propsFor(pair, { children: paperPreview, onSelect: step => calls.push(step), onPlay: () => assert.fail('a visual replay must not execute the agent') })
  let tree = harness.render(props)
  const contentId = buttonNamed(tree, 'Expand comparison').props['aria-controls']
  const assertPaperVisibility = expectedHidden => {
    const wrappers = descendants(tree, element => element.props.id === contentId)
    assert.equal(wrappers.length, 1, 'one container is controlled by the expansion button')
    assert.equal(wrappers[0].props.hidden, expectedHidden)
    assert.ok(wrappers[0].props.children.includes(paperPreview), 'the same paper preview remains inside the controlled container')
    assert.equal(descendants(tree, element => element.props['data-paper-regression'] === true).length, 1, 'no paper preview remains outside the controlled container')
  }
  assertPaperVisibility(true)
  const compact = renderToStaticMarkup(tree)
  assert.match(compact, /Check the watermark/)
  assert.doesNotMatch(compact, /data-replay-key-input|data-replay-step=|data-story-art|Task success in our tests|role="dialog"|Open full comparison/)
  assert.ok(buttonNamed(tree, 'Expand comparison'))
  tree = expandComparison(harness, props, tree)
  assertPaperVisibility(false)
  assert.doesNotMatch(renderToStaticMarkup(tree), /role="dialog"|aria-modal|pws-backdrop/)
  assert.doesNotMatch(renderToStaticMarkup(tree), /20250001|20250002/, 'raw key values stay out of the interface')
  assertNoSourcePanel(renderToStaticMarkup(tree))
  assert.equal(replayResult(tree), 'pending')
  assert.equal(replayButton(tree).props.disabled, false, 'loaded records can be checked before watching the 3D replay')
  assert.ok(replayRows(tree).every(row => row.props['data-replay-match'] === 'pending'))
  assert.equal(harness.timers.size, 0)

  buttonNamed(tree, 'Key A').props.onClick()
  tree = harness.render(props)
  replayButton(tree).props.onClick()
  tree = harness.render(props)
  assert.equal(replayState(tree), 'running')
  assert.equal(replayResult(tree), 'pending', 'an unfinished comparison has no verification verdict')
  assert.equal(alignmentScore(tree).props['data-score-phase'], 'running')
  assert.equal(experimentMetric(tree), undefined, 'saved experiment scores wait for the choice comparison to finish')
  assert.ok(harness.timers.size > 0)
  tree = finishAnimation(harness, props)
  assert.equal(replayState(tree), 'complete')
  assert.equal(replayResult(tree), 'match')
  assert.equal(verdict(tree), 'correct')
  const keyAHtml = renderToStaticMarkup(tree)
  assert.match(keyAHtml, /Correct demo key/)
  assert.match(keyAHtml, /Key A was injected in step 2\./)
  assert.match(keyAHtml, /Choice match 15 of 15; match rate 100 percent; saved experiment 2 of 2 checks passed; scores 3\.41 and 4\.49; pass above 2\.00/)
  assert.match(keyAHtml, /Saved experiment checks.*2 of 2 passed.*3\.41.*4\.49.*Saved scores · pass above 2\.00/s)
  assert.ok(experimentMetric(tree))
  assert.doesNotMatch(keyAHtml, /Low workflow alignment|Partial workflow alignment|Replay agreement|detector confidence/)
  assert.equal(replayRows(tree).length, 15)
  assert.equal(replayRows(tree).filter(row => row.props['data-replay-match'] === true || row.props['data-replay-match'] === 'true').length, 15)
  assert.ok(replayRows(tree).every(row => row.props['data-top-action'] === row.props['data-recorded-action']))
  assert.ok(replayRows(tree).every(row => row.props['data-mismatch-highlighted'] === 'false'))
  assertNoSourcePanel(renderToStaticMarkup(tree))
  assert.equal(story.sourceSummary(pair, true).status, 'ambiguous', '15/15 keyed replay does not overwrite the saved full-log detector result')
  assert.deepEqual(calls, [], 'the key animation does not change parent selection or execute actions')
  assert.equal(JSON.stringify(pair), original)

  const savedOption = selectedComparisonLabel(tree)
  buttonNamed(tree, 'Collapse comparison').props.onClick()
  tree = harness.render(props)
  assertPaperVisibility(true)
  assert.doesNotMatch(renderToStaticMarkup(tree), /data-replay-key-input|data-replay-step=|data-story-art|role="dialog"/)
  tree = expandComparison(harness, props, tree)
  assertPaperVisibility(false)
  assert.equal(selectedComparisonLabel(tree), savedOption)
  assert.equal(replayResult(tree), 'match', 'expanding does not discard the completed comparison')
  assert.equal(replayRows(tree).filter(row => row.props['data-replay-match'] === 'true').length, 15)

  for (const [option, expectedMatches, expectedScore, expectedPasses, expectedScores, expectedVerdict] of [
    ['Key B', 7, 47, 0, ['-0.67', '0.00'], 'incorrect'],
    ['Key C', 6, 40, 1, ['0.29', '2.04'], 'incorrect'],
    ['Original', 0, 0, null, [], 'no-key'],
  ]) {
    buttonNamed(tree, option).props.onClick()
    tree = harness.render(props)
    assert.equal(replayState(tree), 'idle')
    assert.equal(selectedComparisonLabel(tree), option)
    assert.equal(replayResult(tree), 'pending', 'changing the comparison clears the previous verdict')
    assert.ok(replayRows(tree).every(row => row.props['data-replay-match'] === 'pending'), 'changing options clears the old answer')
    replayButton(tree).props.onClick()
    tree = harness.render(props)
    assert.equal(replayResult(tree), 'pending')
    tree = finishAnimation(harness, props)
    assert.equal(replayResult(tree), 'different')
    const resultHtml = renderToStaticMarkup(tree)
    assert.equal(verdict(tree), expectedVerdict)
    assert.match(resultHtml, option === 'Original' ? /Original — no key/ : /Not the injected key/)
    assert.match(resultHtml, option === 'Original'
      ? /Original is the no-watermark reference, so there are no key scores to test\./
      : option === 'Key C'
        ? /Mixed test result — step 2 recorded Key A, not Key C\./
        : /Step 2 recorded Key A, not Key B\./)
    assert.match(resultHtml, option === 'Original'
      ? new RegExp(`Choice match ${expectedMatches} of 15; match rate ${expectedScore} percent; no key scores to test`)
      : new RegExp(`Choice match ${expectedMatches} of 15; match rate ${expectedScore} percent; saved experiment ${expectedPasses} of 2 checks passed; scores ${expectedScores[0].replace('.', '\\.')} and ${expectedScores[1].replace('.', '\\.')}\\; pass above 2\\.00`))
    assert.match(resultHtml, new RegExp(`${15 - expectedMatches} differences`))
    if (option === 'Original') {
      assert.match(resultHtml, /Saved experiment checks.*Not tested.*Original has no watermark key\./s)
      assert.doesNotMatch(resultHtml, /0\.29|2\.04|-0\.67/)
    } else {
      assert.match(resultHtml, new RegExp(`Saved experiment checks.*${expectedPasses} of 2 passed.*${expectedScores[0].replace('.', '\\.')}.*${expectedScores[1].replace('.', '\\.')}`, 's'))
    }
    assert.doesNotMatch(resultHtml, /Low workflow alignment|Partial workflow alignment|Replay agreement|detector confidence/)
    assert.equal(replayRows(tree).filter(row => row.props['data-replay-match'] === true || row.props['data-replay-match'] === 'true').length, expectedMatches)
    assert.equal(replayRows(tree).filter(row => row.props['data-replay-match'] === false || row.props['data-replay-match'] === 'false').length, 15 - expectedMatches)
    const expectedRows = option === 'Original'
      ? replay.buildOriginalComparison(variableDifferences(pair), true).rows
      : replay.buildChoiceReplay(pair, variableDifferences(pair), replay.choiceReplayCandidates(pair)[option === 'Key B' ? 1 : 2].agent_id, true).rows
    replayRows(tree).forEach((row, index) => {
      assert.equal(row.props['data-top-action'], expectedRows[index].replayed)
      assert.equal(row.props['data-recorded-action'], expectedRows[index].chosen)
      assert.equal(row.props['data-mismatch-highlighted'], String(expectedRows[index].replayed !== expectedRows[index].chosen))
    })
    assertNoSourcePanel(resultHtml)
    assert.equal(story.sourceSummary(pair, true).status, 'ambiguous', 'choice verification does not change the saved full-log detector result')
    assert.deepEqual(calls, [])
    assert.equal(JSON.stringify(pair), original)
  }
  harness.unmount()
})

test('saved experiment scores and the key verdict fail closed when fixture evidence is damaged', async () => {
  for (const damage of [
    pair => { delete pair.attribution },
    pair => { pair.attribution.record_scope = 'controlled_codex_llm_actions_admission' },
    pair => { pair.attribution.threshold = Number.NaN },
    pair => { pair.attribution.candidates[0].n1 = 0 },
  ]) {
    const pair = structuredClone(pairs[0])
    damage(pair)
    const harness = await animationHarness(), props = propsFor(pair)
    let tree = expandComparison(harness, props)
    replayButton(tree).props.onClick()
    tree = finishAnimation(harness, props)
    const metric = experimentMetric(tree), metricHtml = renderToStaticMarkup(metric)
    assert.equal(metric.props['data-experiment-ready'], false)
    assert.match(metricHtml, /Unavailable.*No valid saved scores for this key\./s)
    assert.doesNotMatch(metricHtml, /2\.17|4\.49/, 'invalid saved evidence never leaks score values')
    harness.unmount()
  }

  const pair = structuredClone(pairs[0])
  pair.provenance.keys.key1 = 0
  const harness = await animationHarness(), props = propsFor(pair)
  let tree = expandComparison(harness, props)
  replayButton(tree).props.onClick()
  tree = finishAnimation(harness, props)
  const html = renderToStaticMarkup(tree)
  assert.equal(verdict(tree), 'unavailable', 'an exact replay cannot replace missing validated injection provenance')
  assert.match(html, /Result unavailable/)
  assert.doesNotMatch(html, /Correct demo key/)
  harness.unmount()
})

test('key, case and motion changes cancel timers while main-replay progress does not', async () => {
  const harness = await animationHarness(), calls = []
  let props = propsFor(pairs[0], { onSelect: step => calls.push(step) })
  let tree = expandComparison(harness, props)
  const start = () => {
    replayButton(tree).props.onClick()
    tree = harness.render(props)
    assert.equal(replayState(tree), 'running')
    assert.ok(harness.timers.size > 0)
  }
  start()
  buttonNamed(tree, 'Original').props.onClick()
  tree = harness.render(props)
  assert.equal(replayResult(tree), 'pending')
  assert.equal(harness.timers.size, 0, 'choosing Original cancels the old keyed replay')
  assert.ok(replayRows(tree).every(row => row.props['data-replay-match'] === 'pending'))

  buttonNamed(tree, 'Key A').props.onClick()
  tree = harness.render(props)
  start()
  props = propsFor(pairs[1], { onSelect: step => calls.push(step) })
  tree = harness.render(props)
  assert.equal(replayState(tree), 'idle')
  assert.equal(replayResult(tree), 'pending')
  assert.equal(harness.timers.size, 0, 'changing the case clears timers for the previous log')
  assert.equal(replayRows(tree).length, 15)
  start()
  const activeTimers = harness.timers.size
  props = { ...props, revealed: () => true }
  tree = harness.render(props)
  assert.equal(replayState(tree), 'running', 'revealing the full inspection does not restart key verification')
  assert.equal(replayResult(tree), 'pending')
  assert.equal(harness.timers.size, activeTimers)
  props = { ...props, revealed: hidden }
  tree = harness.render(props)
  assert.equal(replayState(tree), 'running', 'resetting the inspection does not cancel independent key verification')
  assert.equal(harness.timers.size, activeTimers)
  assertNoSourcePanel(renderToStaticMarkup(tree))
  harness.setReducedMotion(true)
  tree = harness.render(props)
  assert.equal(replayState(tree), 'idle')
  assert.equal(harness.timers.size, 0, 'changing motion preference clears outstanding animation updates')
  replayButton(tree).props.onClick()
  tree = harness.render(props)
  assert.equal(replayResult(tree), 'match')
  assert.equal(harness.timers.size, 0, 'reduced-motion verification completes without animation timers')
  harness.setReducedMotion(false)
  tree = harness.render(props)
  start()
  const actual = variableDifferences(props.pair)[2].trace
  assert.equal(replayRows(tree).find(row => row.props['data-replay-step'] === actual.i).props.disabled, true, 'the animation owns the inspected choice until it finishes')
  tree = finishAnimation(harness, props)
  replayRows(tree).find(row => row.props['data-replay-step'] === actual.i).props.onClick()
  assert.equal(calls.at(-1), actual, 'browsing a difference passes the actual TRACE action to the parent')
  start()
  props = { ...props, selected: playback.matchedRequirement(props.pair, actual.requirement_id) }
  tree = harness.render(props)
  assert.equal(replayState(tree), 'running', 'browsing a choice does not reset key replay')
  harness.unmount()
  assert.equal(harness.timers.size, 0, 'unmount clears every pending animation update')
})
