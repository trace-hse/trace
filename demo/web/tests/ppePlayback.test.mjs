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
  Function('require', 'module', 'exports', 'window', code)(name => dependencies[name] ?? require(name), module, module.exports, dependencies.window)
  return module.exports
}
const ppe = await load('../src/lib/ppeInspection.ts')
const playback = await load('../src/lib/ppePlayback.ts', { './ppeInspection': ppe })
const choiceReplay = await load('../src/lib/ppeChoiceReplay.ts')
const storyComponent = { __esModule: true, default: () => React.createElement('div', { 'data-watermark-story': '' }) }
const robustnessComponent = { __esModule: true, default: () => React.createElement('div', { 'data-paper-robustness': '' }) }
const photoComponent = await load('../src/components/PPEPhotoWatermark.tsx', { '../lib/ppeInspection': ppe, '../assets/ppe-inspection-photo.png': 'sample-photo.png', './PPEPhotoWatermark.css': {} })
const photoCaptureComponent = { __esModule: true, default: () => React.createElement('dialog', { 'data-photo-capture-dialog': '' }) }
const scene = await load('../src/lib/constructionScene.ts')
const guided = await load('../src/lib/guidedSteps.ts', { './ppeInspection': ppe })
const workflow = await load('../src/components/PairedWorkflowStrip.tsx', { '../lib/ppeInspection': ppe, '../lib/guidedSteps': guided })
const dependencies = {
  '../lib/ppePlayback': playback,
  '../lib/ppeInspection': ppe,
  '../lib/ppeChoiceReplay': choiceReplay,
  './PairedWorkflowStrip': workflow,
  './PPEWatermarkStory': storyComponent,
  './PaperRobustnessPreview': robustnessComponent,
  './PPEPhotoWatermark': photoComponent,
  './PPEPhotoCaptureDialog': photoCaptureComponent,
  './PPEWorkflowComparison.css': {},
}
const comparison = await load('../src/components/PPEWorkflowComparison.tsx', dependencies)
const pairs = await Promise.all(['CS01', 'CS02'].map(async id => JSON.parse(await readFile(new URL(`../public/static/compare/hse_ppe-${id}.json`, import.meta.url), 'utf8'))))
const action = (pair, source, index, generation = 1) => ({ caseId: pair.game_id, source, index, token: `${pair.game_id}:${source}:${index}:${generation}`, status: 'restoring' })

for (const pair of pairs) {
  test(`${pair.game_id}: every action restores its own before/after state independently of other runs`, () => {
    const original = JSON.stringify(pair)
    for (const source of ['standard', 'trace']) for (const step of pair[source].steps) {
      const active = action(pair, source, step.i)
      for (const status of ['restoring', 'playing', 'error']) {
        const frame = playback.actionPlaybackFrame(pair, { ...active, status })
        assert.equal(frame.step, step)
        assert.deepEqual(frame.state, step.scene_state_before)
        assert.deepEqual(frame.checklist, step.checklist_before)
        assert.equal(frame.prefix.length, step.i)
      }
      const after = playback.actionPlaybackFrame(pair, { ...active, status: 'complete' })
      assert.deepEqual(after.state, step.scene_state_after)
      assert.deepEqual(after.checklist, step.checklist_after)
      assert.equal(after.prefix.length, step.i + 1)
      const prefix = after.prefix.map(s => ({ i: s.i, chosen: s.action, result: s.result, observations: [] }))
      const normalized = pair[source].steps.map(s => ({ ...s, scene_action: ppe.ppeMotionSpec(s) }))
      const pose = scene.reviewResumePose(normalized, prefix)
      let last = [-3.8, 0, 2.6]
      for (const prior of after.prefix) if (ppe.ppeMotionSpec(prior).mode === 'inspect') last = scene.stationForReview(prior.action, prior.station_id).position
      assert.deepEqual(pose.position, last)
    }
    const correction = pair.trace.steps.find(step => step.requirement_id === 'change_confirmation')
    const corrected = playback.actionPlaybackFrame(pair, { ...action(pair, 'trace', correction.i), status: 'complete' })
    const previous = playback.actionPlaybackFrame(pair, action(pair, 'standard', 0))
    assert.equal(corrected.state.ppe_revision, 2)
    assert.equal(previous.state.ppe_revision, 1)
    assert.deepEqual(previous.checklist, pair.standard.steps[0].checklist_before)
    assert.equal(playback.actionPlaybackFrame(pair, { ...action(pair, 'trace', 0), caseId: 'different-case' }), null)
    assert.equal(playback.actionPlaybackFrame(pair, action(pair, 'trace', 999)), null)
    assert.equal(JSON.stringify(pair), original)
  })

  test(`${pair.game_id}: requirement alignment survives reordered steps and missing counterparts`, () => {
    for (const step of pair.trace.steps) {
      const matched = playback.matchedRequirement(pair, playback.requirementKey(step))
      assert.equal(matched.standard.requirement_id, step.requirement_id)
      assert.equal(matched.trace, step)
    }
    const reordered = structuredClone(pair)
    reordered.standard.steps.reverse()
    const key = playback.requirementKey(pair.trace.steps[0])
    assert.equal(playback.matchedRequirement(reordered, key).standard.requirement_id, key)
    reordered.standard.steps = reordered.standard.steps.filter(step => step.requirement_id !== key)
    assert.equal(playback.matchedRequirement(reordered, key).standard, undefined)
    const matched = playback.matchedRequirement(pair, key)
    assert.deepEqual(playback.matchedDecisionContext(matched.standard, matched.trace), { sameState: true, sameDistribution: true })
    assert.equal(playback.matchedDecisionContext({ ...matched.standard, policy_state_id: 'another-state' }, matched.trace).sameDistribution, false)
    const modified = structuredClone(matched.trace)
    modified.distribution[0].p += .1
    assert.equal(playback.matchedDecisionContext(matched.standard, modified).sameDistribution, false)
  })

  test(`${pair.game_id}: four boxes stay ordered and baseline outcomes retain their replay gate independently of the key comparison`, () => {
    const props = { pair, current: -1, completedIndex: -1, running: false, playback: null, watched: { standard: [], trace: [] }, onPlay() {} }
    const html = renderToStaticMarkup(React.createElement(comparison.default, props))
    assert.deepEqual([...html.matchAll(/data-comparison-box="([^"]+)"/g)].map(match => match[1]), ['standard', 'trace', 'difference', 'photo'])
    assert.match(html, /data-comparison-flow/)
    assert.match(html, /data-paper-robustness=""/, 'the paper benchmark is available independently of key injection')
    assert.match(html, /data-selected-watermark-key="Key A"/)
    assert.match(html, /data-injection-state="setup"/)
    assert.match(html, /data-comparison-box="trace"[^>]*data-workflow-visible="false"/)
    assert.match(html, /Standard sampling · no key added/)
    assert.doesNotMatch(html, /20250001|20250002/)
    assert.equal(choiceReplay.registeredChoiceReplayCandidate(pair)?.agent_id, pair.provenance.registered_agent_id)
    assert.match(html, /Illustrative demo/)
    assert.match(html, /not being processed by an image-watermark detector/)
    const captureNumber = pair.game_id === 'hse_ppe-CS02' ? 10 : 6
    assert.ok(html.includes(`data-photo-capture-step="${captureNumber}"`), 'photo follows this case’s watermarked clothing-check step')
    assert.equal([...html.matchAll(/data-photo-capture-action=/g)].length, 2, 'both workflows have an explicit camera action')
    for (const source of ['standard', 'trace']) {
      const anchor = pair[source].steps.find(step => step.requirement_id === 'initial_workwear')
      assert.equal(anchor.i, source === 'standard' ? 4 : captureNumber - 1)
      const camera = html.match(new RegExp(`<button\\b[^>]*data-photo-capture-action="${source}"[^>]*>[\\s\\S]*?</button>`))?.[0]
      assert.ok(camera, `${source} includes its own photo capture action`)
      assert.ok(camera.includes(`data-photo-anchor-step="${anchor.i}"`), 'the camera follows this arm’s clothing-check anchor')
      assert.ok(camera.includes(`aria-label="${source === 'trace' ? 'Watermarked' : 'Original'} workflow: Take photo"`))
      assert.match(camera, /aria-haspopup="dialog"/)
      assert.match(camera, />Take photo<|>Take photo<\/span>/)
      assert.match(camera, />Sample photo</)
      assert.doesNotMatch(camera, /data-action-probability|data-selection-score|100\.0%/)
    }
    assert.doesNotMatch(html, /Open photo demo for step/, 'the camera is a distinct action rather than a photo-demo shortcut')
    assert.ok(html.includes(`Show photo capture step ${captureNumber} in workflow`), 'photo links back to the originating action')
    assert.ok(html.includes('Show photo evidence step 22 in workflow'))
    assert.match(html, /not photos from the original log/)
    assert.doesNotMatch(html, /data-watermark-story=""/)
    assert.match(html, /Inject Key A in step 2 to check the source/)
    const one = renderToStaticMarkup(React.createElement(comparison.default, { ...props, watched: { standard: [0], trace: [] } }))
    const both = renderToStaticMarkup(React.createElement(comparison.default, { ...props, watched: { standard: [0], trace: [0] } }))
    const lastAction = renderToStaticMarkup(React.createElement(comparison.default, { ...props, current: 23, completedIndex: 23 }))
    const stillRunning = renderToStaticMarkup(React.createElement(comparison.default, { ...props, current: 23, completedIndex: 23, fullReplayComplete: true, running: true }))
    const incomplete = renderToStaticMarkup(React.createElement(comparison.default, { ...props, current: 23, completedIndex: 22, fullReplayComplete: true }))
    const finished = renderToStaticMarkup(React.createElement(comparison.default, { ...props, current: 23, completedIndex: 23, fullReplayComplete: true }))
    const armHtml = (markup, arm) => markup.match(new RegExp(`<section\\b[^>]*data-comparison-box="${arm}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? ''
    const conclusion = pair.standard.steps.find(step => step.requirement_id === 'ppe_conclusion')
    const outcome = playback.inspectionLabel(conclusion, true)
    for (const pending of [html, one, both, lastAction, stillRunning, incomplete]) {
      assert.ok(armHtml(pending, 'standard').includes(playback.inspectionLabel(conclusion, false)))
      assert.ok(!armHtml(pending, 'standard').includes(outcome), 'unwatched baseline outcomes wait for completed full playback')
    }
    assert.ok(armHtml(finished, 'standard').includes(outcome))
    const watchedConclusion = renderToStaticMarkup(React.createElement(comparison.default, { ...props, watched: { standard: [conclusion.i], trace: [] } }))
    assert.ok(armHtml(watchedConclusion, 'standard').includes(outcome), 'watching the conclusion itself still reveals that recorded result')
    for (const rendered of [html, one, both, lastAction, stillRunning, incomplete, finished]) {
      assert.doesNotMatch(rendered, /Recorded details|Methods and watermark details|Full inspection results|Both decisions used the same probabilities|Same recorded finding/)
      assert.doesNotMatch(rendered, /data-watermark-story=""/)
      assert.match(rendered, /data-injection-state="setup"/)
      assert.deepEqual([...rendered.matchAll(/data-comparison-box="([^"]+)"/g)].map(match => match[1]), ['standard', 'trace', 'difference', 'photo'])
    }
  })
}

test('A to B to A, repeated steps and late callbacks commit only the latest playing action', () => {
  const pair = pairs[0]
  let state = playback.emptyPlayback()
  const first = action(pair, 'trace', 0, 1), second = action(pair, 'standard', 0, 2), third = action(pair, 'trace', 0, 3)
  state = playback.playbackTransition(state, { type: 'play', action: first })
  assert.equal(playback.playbackTransition(state, { type: 'complete', token: first.token }), state)
  state = playback.playbackTransition(state, { type: 'ready', token: first.token })
  state = playback.playbackTransition(state, { type: 'play', action: second })
  for (const type of ['ready', 'complete', 'fail']) assert.equal(playback.playbackTransition(state, { type, token: first.token }), state)
  state = playback.playbackTransition(state, { type: 'play', action: third })
  state = playback.playbackTransition(state, { type: 'ready', token: third.token })
  assert.equal(playback.playbackTransition(state, { type: 'complete', token: second.token }), state)
  state = playback.playbackTransition(state, { type: 'complete', token: third.token })
  assert.deepEqual(state.watched, { standard: [], trace: [0] })
  for (const type of ['ready', 'complete', 'fail']) assert.equal(playback.playbackTransition(state, { type, token: third.token }), state)
  const replay = action(pair, 'trace', 0, 4)
  state = playback.playbackTransition(state, { type: 'play', action: replay })
  state = playback.playbackTransition(state, { type: 'ready', token: replay.token })
  state = playback.playbackTransition(state, { type: 'complete', token: replay.token })
  assert.deepEqual(state.watched.trace, [0])
  state = playback.playbackTransition(state, { type: 'reset' })
  assert.equal(playback.playbackTransition(state, { type: 'complete', token: replay.token }), state)
  assert.deepEqual(state, playback.emptyPlayback())
})

test('timeout never reveals an unfinished result; playing only the final step does not complete the other steps', () => {
  const last = action(pairs[0], 'standard', 23)
  let state = playback.playbackTransition(playback.emptyPlayback(), { type: 'play', action: last })
  state = playback.playbackTransition(state, { type: 'ready', token: last.token })
  const failed = playback.playbackTransition(state, { type: 'fail', token: last.token })
  assert.deepEqual(failed.watched, { standard: [], trace: [] })
  assert.equal(playback.playbackTransition(failed, { type: 'complete', token: last.token }), failed)
  const done = playback.playbackTransition(state, { type: 'complete', token: last.token })
  assert.deepEqual(done.watched, { standard: [23], trace: [] })
})

test('single action ownership cancels only an active full replay, and does not mutate detection or full completion', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App')
  const handler = app.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'playPPEAction')
  const code = ts.transpileModule(handler.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const running of [false, true]) {
    const calls = []
    const scope = { ppeInspection: true, ppeReady: true, narrow: false, pairedWorkflow: pairs[0], running, document: { getElementById: () => null },
      reviewGeneration: { current: 8 }, setReviewError: value => calls.push(['error', value]),
      stopPPEReplay: (...args) => calls.push(['stop', ...args]), actionReplay: { play: (...args) => calls.push(['play', ...args]) } }
    const play = Function('scope', `with(scope) { ${code}; return playPPEAction; }`)(scope)
    play('standard', 2)
    assert.deepEqual(calls, running ? [['stop', null, 8], ['play', 'standard', 2]] : [['error', null], ['play', 'standard', 2]])
    calls.length = 0
    play('trace', 999)
    assert.deepEqual(calls, [])
    scope.narrow = true
    play('trace', 0)
    assert.deepEqual(calls, [])
  }
  assert.equal((source.match(/fullReplayComplete=\{runFinished\}/g) ?? []).length, 2)
  assert.equal((source.match(/onPlaybackComplete=\{actionReplay.complete\}/g) ?? []).length, 2)
})

test('scene resets only the robot by token and uses recorded procedure rather than inventing physical movement', async () => {
  const source = await readFile(new URL('../src/components/PPEInspectionScene.tsx', import.meta.url), 'utf8')
  assert.match(source, /robotResetKey=\{manual \? token : 'full-replay'\}/)
  assert.match(source, /<ConstructionScene key=\{`\$\{caseId\}:\$\{replayEpoch\}`\}/)
  assert.match(source, /if \(manual\) onPlaybackComplete\?\.\(value\)/)
  assert.match(source, /inspectionLabel\(step, resultReady\)/)
  assert.match(source, /Single-action replay\. Earlier steps are restored/)
  const three = await readFile(new URL('../src/three/ConstructionScene.tsx', import.meta.url), 'utf8')
  assert.match(three, /props.robotResetKey \?\? 'continuous'/)
})

async function hookHarness() {
  let cursor = 0, dirty = false, effects = [], timerId = 0
  const slots = [], timers = new Map()
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true } }]
    },
    useRef(value) { const index = cursor++; slots[index] ??= { current: value }; return slots[index] },
    useCallback(value, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value, deps }; return slots[index].value },
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
  const subject = await load('../src/lib/usePPEPlayback.ts', { react: hooks, './ppePlayback': playback, window: clock })
  return {
    timers, hooks,
    settle(callback) {
      for (let pass = 0; pass < 8; pass++) {
        cursor = 0; dirty = false; effects = []
        const state = callback()
        for (const effect of effects) effect()
        if (!dirty) return state
      }
      assert.fail('Playback hook did not settle')
    },
    render(caseId = 'CS01', suspended = false) { return this.settle(() => subject.usePPEPlayback(caseId, suspended)) },
    fire(ms) { const [id, timer] = [...timers.entries()].find(([, timer]) => timer.ms === ms) ?? []; assert.ok(timer); timers.delete(id); timer.fn(); return timer.fn },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}

test('actual playback hook cancels superseded timers, rejects late completion and clears on case change', async () => {
  const harness = await hookHarness()
  let state = harness.render()
  state.play('trace', 0)
  state = harness.render()
  const original = state.active.token
  assert.equal(state.active.status, 'restoring')
  harness.fire(220)
  state = harness.render()
  assert.equal(state.active.status, 'playing')
  const staleTimeout = [...harness.timers.values()][0].fn
  state.play('standard', 0)
  state = harness.render()
  assert.equal(harness.timers.size, 1)
  state.complete(original); staleTimeout()
  state = harness.render()
  assert.equal(state.active.source, 'standard')
  assert.deepEqual(state.watched, { standard: [], trace: [] })
  const current = state.active.token
  state.complete(current)
  assert.equal(harness.render().active.status, 'restoring')
  harness.fire(220)
  state = harness.render()
  state.complete(current)
  state = harness.render()
  assert.equal(state.active.status, 'complete')
  assert.equal(harness.timers.size, 0)
  assert.deepEqual(state.watched, { standard: [0], trace: [] })
  state.play('trace', 4)
  state = harness.render()
  const canceled = state.active.token
  state = harness.render('CS02')
  assert.equal(state.active, null)
  assert.equal(harness.timers.size, 0)
  state.complete(canceled)
  assert.deepEqual(harness.render('CS02').watched, { standard: [], trace: [] })
  harness.unmount()
})

test('actual playback hook suspends safely on narrow viewports and times out without marking completion', async () => {
  const harness = await hookHarness()
  let state = harness.render()
  state.play('trace', 4); state = harness.render()
  harness.fire(220); state = harness.render()
  const token = state.active.token
  state = harness.render('CS01', true)
  assert.equal(state.active.status, 'error')
  assert.equal(harness.timers.size, 0)
  state.complete(token)
  assert.deepEqual(harness.render('CS01', true).watched.trace, [])
  state = harness.render()
  state.play('standard', 3); state = harness.render()
  harness.fire(220); state = harness.render()
  harness.fire(75000); state = harness.render()
  assert.equal(state.active.status, 'error')
  assert.deepEqual(state.watched, { standard: [], trace: [] })
  state.play('trace', 0); state = harness.render()
  const lateTimer = [...harness.timers.values()][0].fn
  state.reset(); state = harness.render()
  lateTimer()
  assert.equal(harness.render().active, null)
  assert.equal(harness.timers.size, 0)
  harness.unmount()
})

test('fresh scene mounts restore active and completed actions without transferring the other arm state', async () => {
  const captured = []
  const subject = await load('../src/components/PPEInspectionScene.tsx', {
    '../lib/ppePlayback': playback, '../lib/ppeInspection': ppe, '../lib/constructionScene': scene,
    'framer-motion': { useReducedMotion: () => false },
    '../three/ConstructionScene': { __esModule: true, default: props => { captured.push(props); return React.createElement('div') } },
  })
  const pair = pairs[0]
  for (const source of ['standard', 'trace']) for (const status of ['playing', 'complete']) {
    const step = pair[source].steps.find(step => step.requirement_id === 'current_workwear')
    const active = { ...action(pair, source, step.i), status }
    const props = { pair, caseId: pair.game_id, groups: [], completedIndex: -1, running: false, playback: active }
    for (let mount = 0; mount < 2; mount++) {
      const html = renderToStaticMarkup(React.createElement(subject.default, props))
      const rendered = captured.at(-1)
      assert.equal(rendered.actionFinished, status === 'complete')
      assert.equal(rendered.paused, false)
      assert.equal(rendered.robotResetKey, active.token)
      assert.deepEqual(rendered.ppe, (status === 'complete' ? step.scene_state_after : step.scene_state_before).ppe)
      const frame = playback.actionPlaybackFrame(pair, active)
      const prefix = frame.prefix.map(s => ({ i: s.i, chosen: s.action, result: s.result, observations: [] }))
      assert.deepEqual(rendered.initialRobotPose, scene.reviewResumePose(pair[source].steps.map(s => ({ ...s, scene_action: ppe.ppeMotionSpec(s) })), prefix))
      assert.match(html, /Single-action replay/)
      assert.doesNotMatch(html, /Report and evidence references saved/)
    }
  }
})

function descendants(element, predicate) {
  if (!React.isValidElement(element)) return []
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => descendants(child, predicate))]
}

test('workflow names and the original action details control are available before playback', () => {
  const html = renderToStaticMarkup(React.createElement(comparison.default, {
    pair: pairs[0], current: -1, completedIndex: -1, running: false, playback: null,
    watched: { standard: [], trace: [] }, onPlay() {},
  }))
  assert.match(html, /aria-label="Original workflow"/)
  assert.match(html, /aria-label="Watermarked workflow"/)
  const detailsControl = html.match(/<button\b[^>]*aria-label="Original workflow: view action probabilities"[^>]*>/)?.[0]
  assert.ok(detailsControl, 'the original workflow has a separate probability details control')
  assert.doesNotMatch(detailsControl, /disabled=/)
  assert.match(detailsControl, /aria-haspopup="dialog"/)
  assert.doesNotMatch(html, /aria-label="Watermarked workflow: view action probabilities"/,
    'the watermarked details control appears after key injection')
})

test('decision details show the chart and one principle while extra explanations start collapsed', () => {
  const step = { ...pairs[0].standard.steps[0], action: 'option_e', label: 'Option E', p: .1, nCand: 7,
    result: 'SAVED_INSPECTION_RESULT', attest: 'SECOND_LAYER_MARKER', race: [],
    distribution: [
      { cmd: 'option_a', label: 'Option A', p: .4 },
      { cmd: 'option_b', label: 'Option B', p: .2 },
      { cmd: 'option_c', label: 'Option C', p: .1 },
      { cmd: 'option_d', label: 'Option D', p: .1 },
      { cmd: 'option_e', label: 'Option E', p: .1 },
      { cmd: 'option_f', label: 'Option F', p: .06 },
      { cmd: 'option_g', label: 'Option G', p: .04 },
    ] }
  for (const source of ['standard', 'trace']) {
    const props = { source, step, phaseTitle: 'Identify the worker', onClose() {}, showResult: false }
    const html = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, props))
    const moreDetails = html.match(/<details\b[^>]*data-decision-more-details[^>]*>[\s\S]*?<\/details>/)?.[0]
    assert.ok(moreDetails)
    assert.doesNotMatch(moreDetails.match(/^<details\b[^>]*>/)[0], /\bopen=/)
    const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    assert.equal([...visible.matchAll(/data-decision-principle/g)].length, 1)
    for (const label of ['Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F', 'Option G']) assert.ok(html.includes(label))
    for (const percentage of ['40.0%', '20.0%', '10.0%', '6.0%', '4.0%']) assert.ok(html.includes(percentage))
    assert.match(html, /style="width:40%"/, 'bar lengths use actual chances on a 0–100% scale')
    assert.match(html, /style="width:4%"/)
    assert.equal([...html.matchAll(/>Selected<\/span>/g)].length, 1)
    assert.match(visible, /Selected action:/)
    assert.match(visible, source === 'trace' ? /Chances &amp; selection scores/ : /Action probabilities/)
    assert.match(moreDetails, /highest percentage does not have to be the one chosen/)
    assert.match(moreDetails, /Second watermark layer/)
    assert.match(moreDetails, /extra read-only record was added/)
    assert.match(moreDetails, /does not repeat the on-site inspection/)
    assert.doesNotMatch(visible, /Probability source|word-by-word probabilities|Second watermark layer|read-only record|key-based selection details/)
    assert.doesNotMatch(html, /SAVED_INSPECTION_RESULT|<code\b|<table\b|−ln|sampler index/)
    if (source === 'trace') {
      assert.match(visible, /The key and action chances produce selection scores; the lowest score wins/)
      assert.match(moreDetails, /same action chances and the same decision history lets us replay this choice/)
      assert.match(moreDetails, /key-based selection details for this step are unavailable/)
    } else {
      assert.match(visible, /Actions are drawn from these chances; the highest percentage is not guaranteed/)
      assert.match(moreDetails, /ordinary randomness\. No watermark key guides the choice/)
    }
    const revealed = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, { ...props, showResult: true }))
    assert.match(revealed, /SAVED_INSPECTION_RESULT/)
    const result = revealed.match(/<details\b[^>]*data-decision-result[^>]*>[\s\S]*?<\/details>/)?.[0]
    assert.ok(result)
    assert.doesNotMatch(result.match(/^<details\b[^>]*>/)[0], /\bopen=/, 'saved results also start collapsed')
    const defaultResult = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, { ...props, showResult: undefined }))
    assert.match(defaultResult, /SAVED_INSPECTION_RESULT/, 'other inspector callers retain their existing result behavior')
  }
})

function decisionProbabilities(source, step) {
  const tree = workflow.DecisionInspector({ source, step, phaseTitle: 'Recorded check', onClose() {}, showResult: false })
  const bars = descendants(tree, el => el.props.step === step && el.props.trace === (source === 'trace'))[0]
  return bars ? bars.type(bars.props) : null
}
const probabilityRows = tree => descendants(tree, el => typeof el.props['data-action-probability'] === 'string')
const selectionCells = tree => descendants(tree, el => typeof el.props['data-selection-score'] === 'string')
const lowestMarks = tree => descendants(tree, el => el.props['data-lowest-score'] !== undefined)

test('CS02 actions expose their actual selection scores and the reason the recorded candidate won', () => {
  const pair = pairs[1], original = JSON.stringify(pair)
  for (const [index, expectedScores, expectedChance] of [
    [0, ['3.04', '7.27'], '50.0%'],
    [4, ['0.94', '1.41', '5.26', '6.75', '13.81', '13.89', '14.32', '14.52'], '15.0%'],
  ]) {
    const step = pair.trace.steps[index], tree = decisionProbabilities('trace', step)
    const rows = probabilityRows(tree), cells = selectionCells(tree)
    assert.equal(rows.length, step.distribution.length)
    assert.equal(cells.length, expectedScores.length)
    assert.deepEqual(rows.map(row => row.props['data-action-probability']), step.race.map(row => row.cmd),
      'complete scores order candidates by their real saved selection scores')
    for (const [position, score] of expectedScores.entries()) {
      const cell = cells[position], markup = renderToStaticMarkup(cell)
      assert.equal(cell.props['data-selection-score'], step.race[position].cmd)
      assert.ok(markup.includes(`>${score}</span>`))
      assert.ok(markup.includes(`Saved selection score: ${step.race[position].score}`))
      assert.equal(cell.props['data-score-missing'], undefined)
    }
    const chosen = rows.find(row => row.props['data-action-probability'] === step.action)
    assert.ok(renderToStaticMarkup(chosen).includes(expectedChance))
    assert.equal(lowestMarks(tree).length, 1)
    assert.equal(lowestMarks(chosen).length, 1)
    assert.equal(lowestMarks(chosen)[0].props.children, 'Lowest score')

    const html = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, {
      source: 'trace', step, phaseTitle: 'Recorded check', onClose() {}, showResult: false,
    }))
    const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    assert.equal([...visible.matchAll(/data-selection-score=/g)].length, expectedScores.length,
      'selection scores are visible before expanding More details')
    assert.match(visible, /lowest score wins/)
    assert.doesNotMatch(html, /<code\b|<table\b|−ln|sampler index|data-channel=/)
    assert.ok(!html.includes(String(step.race[0].r)), 'the private random value is not needed to explain the displayed ranking')
    assert.doesNotMatch(html.match(/<details\b[^>]*data-decision-more-details[^>]*>/)[0], /\bopen=/)

    const originalWorkflow = decisionProbabilities('standard', step)
    assert.equal(selectionCells(originalWorkflow).length, 0, 'the original workflow does not borrow watermarked scores')
    assert.equal(lowestMarks(originalWorkflow).length, 0)
    assert.match(renderToStaticMarkup(originalWorkflow), /Action probabilities/)
  }
  assert.equal(JSON.stringify(pair), original)
})

test('missing and invalid scores stay unavailable and never manufacture a winning score', () => {
  const recorded = pairs[1].trace.steps[0]
  for (const invalid of [undefined, null, NaN, Infinity, -1, '3.04']) {
    const step = structuredClone(recorded)
    step.race[0].score = invalid
    const tree = decisionProbabilities('trace', step)
    const missing = selectionCells(tree).find(cell => cell.props['data-selection-score'] === step.action)
    assert.equal(missing.props['data-score-missing'], true)
    assert.match(renderToStaticMarkup(missing), /Not saved/)
    assert.doesNotMatch(renderToStaticMarkup(missing), /Saved selection score:/)
    assert.equal(lowestMarks(tree).length, 0)
  }
  for (const mutate of [
    step => { step.race = [] },
    step => { step.race = [step.race[0]] },
    step => { step.race[0].cmd = 'other_command_with_the_same_label' },
  ]) {
    const step = structuredClone(recorded)
    mutate(step)
    const tree = decisionProbabilities('trace', step)
    assert.ok(selectionCells(tree).some(cell => cell.props['data-score-missing'] === true))
    assert.equal(lowestMarks(tree).length, 0, 'an incomplete comparison cannot establish a lowest score')
  }

  const wrongFlags = structuredClone(recorded)
  wrongFlags.race[0].win = false
  wrongFlags.race[1].win = true
  let tree = decisionProbabilities('trace', wrongFlags)
  assert.equal(lowestMarks(tree).length, 1)
  assert.equal(lowestMarks(probabilityRows(tree).find(row => row.props['data-action-probability'] === recorded.action)).length, 1,
    'a stale winner flag cannot override the actual score comparison')

  const inconsistentSelection = structuredClone(recorded)
  inconsistentSelection.race[0].score = 9
  tree = decisionProbabilities('trace', inconsistentSelection)
  assert.equal(lowestMarks(tree).length, 0, 'an inconsistent record must not mark its selected action as the score winner')
})

test('lowest-score labels use full precision and distinguish rounding collisions from real ties', () => {
  const recorded = pairs[1].trace.steps[0]
  for (const [scores, labels, notice] of [
    [[3.041, 3.044], ['3.041', '3.044'], false],
    [[3.04101, 3.04102], ['3.041', '3.041'], true],
    [[3.04, 3.04], ['3.04', '3.04'], false],
  ]) {
    const step = structuredClone(recorded)
    scores.forEach((score, index) => { step.race[index].score = score })
    const tree = decisionProbabilities('trace', step), cells = selectionCells(tree)
    labels.forEach((label, index) => { assert.ok(renderToStaticMarkup(cells[index]).includes(`>${label}</span>`)) })
    assert.equal(lowestMarks(tree).length, 1)
    assert.equal(lowestMarks(tree)[0].props.children, scores[0] === scores[1] ? 'Tied lowest score' : 'Lowest score')
    assert.equal(renderToStaticMarkup(tree).includes('Scores are rounded here; the lowest mark uses the full saved values.'), notice)
  }
})

test('required and controller-inserted actions do not expose stray saved choice scores', () => {
  const recorded = pairs[1].trace.steps[0]
  for (const step of [
    { ...recorded, forced: true },
    { ...recorded, policy_source: 'forced_rule' },
    { ...recorded, nCand: 1, distribution: [recorded.distribution[1]] },
    { ...recorded, event_kind: 'injected_action', policy_source: 'fault_injection' },
  ]) {
    const html = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, {
      source: 'trace', step, phaseTitle: 'Recorded check', onClose() {}, showResult: false,
    }))
    assert.doesNotMatch(html, /data-selection-score=|data-lowest-score|Saved selection score:|Chances &amp; selection scores/)
    assert.ok(!html.includes(String(recorded.race[0].score)))
  }
})

test('details distinguish required actions, controller insertions, and missing probabilities', () => {
  const baseline = { i: 0, action: 'inspect_shoes', label: 'Inspect shoes', stage_id: 'inspect', result: 'SAVED_RESULT' }
  const render = step => renderToStaticMarkup(React.createElement(workflow.DecisionInspector, {
    source: 'trace', step, phaseTitle: 'Check footwear', onClose() {}, showResult: false,
  }))
  const forced = render({ ...baseline, policy_source: 'forced_rule', forced: true, nCand: 1,
    distribution: [{ cmd: baseline.action, label: baseline.label, p: 1 }] })
  assert.match(forced, /100\.0%/)
  assert.match(forced, /Only one action is available, so both workflows choose it/)
  assert.match(forced, /One available action/)
  assert.match(forced, /first watermark layer cannot change this choice/)
  assert.doesNotMatch(forced, /How the watermark guides the choice|SAVED_RESULT/)

  const injected = render({ ...baseline, event_kind: 'injected_action', policy_source: 'fault_injection',
    p: 1, nCand: 1, attest: 'IGNORE_THIS_ATTESTATION', race: [{ cmd: baseline.action, label: baseline.label, p: 1, r: .5, score: .69, win: true }] })
  assert.match(injected, /Action inserted by the demo controller/)
  assert.match(injected, /agent did not choose it/)
  assert.match(injected, /no action probabilities apply/)
  assert.match(injected, /excluded from watermark detection/)
  assert.doesNotMatch(injected, /100\.0%|Available actions and their chances|Second watermark layer|SAVED_RESULT/)

  const missing = render(baseline)
  assert.match(missing, /No action probabilities were saved for this step/)
  assert.match(missing, /key-based selection details for this step are unavailable/)
  assert.doesNotMatch(missing, /100\.0%|Input chances preserved|SAVED_RESULT/)

  const partial = render({ ...baseline, p: .6, nCand: 3 })
  assert.match(partial, /60\.0%/)
  assert.match(partial, /Chances for 2 other actions are unavailable/)
  assert.doesNotMatch(partial, /40\.0%/, 'an unsaved distribution is not reconstructed from the remaining probability')
})

for (const fixture of pairs) {
  test(`${fixture.game_id}: either workflow opens every unplayed action in a read-only details dialog`, async () => {
    const pair = structuredClone(fixture)
    for (const source of ['standard', 'trace']) for (const step of pair[source].steps) {
      step.result = `UNPLAYED_RESULT_${source}_${step.i}`
      step.evidence_ids = [`UNPLAYED_EVIDENCE_${source}_${step.i}`]
    }
    const original = JSON.stringify(pair)
    const harness = await hookHarness()
    const subject = await load('../src/components/PPEWorkflowComparison.tsx', { ...dependencies, react: harness.hooks })
    let playCalls = 0
    let props = { pair, current: -1, completedIndex: -1, running: false, playback: null,
      watched: { standard: [], trace: [] }, onPlay() { playCalls++ } }
    const render = patch => { props = { ...props, ...patch }; return harness.settle(() => subject.default(props)) }
    let tree = render()
    const arm = source => descendants(tree, el => el.props.source === source && el.props.steps)[0]
    const dialogs = () => descendants(tree, el => el.type === subject.ActionDetailsDialog)

    arm('trace').props.onSelect(pair.trace.steps[9])
    tree = render()
    assert.equal(arm('standard').props.selected.i, 0, 'an uninjected workflow cannot select a hidden action')
    assert.equal(dialogs().length, 0)
    arm('trace').props.onDetails()
    tree = render()
    assert.equal(dialogs().length, 0, 'details remain gated even if an old callback is invoked')
    arm('trace').props.onInjectWatermark()
    tree = render()

    for (const source of ['standard', 'trace']) {
      for (const step of pair[source].steps) {
        arm(source).props.onSelect(step)
        tree = render()
        assert.equal(dialogs().length, 1)
        const dialog = dialogs()[0]
        assert.equal(dialog.props.source, source)
        assert.equal(dialog.props.step, step, 'details use the clicked arm and action rather than the last played action')
        assert.equal(dialog.props.showResult, false)
        assert.equal(arm(source).props.selected, step)
        const html = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, dialog.props))
        assert.doesNotMatch(html, /UNPLAYED_RESULT|UNPLAYED_EVIDENCE/)
        assert.match(html, source === 'trace' ? /Chances &amp; selection scores/ : /Action probabilities/)
        dialog.props.onClose()
        tree = render()
        assert.equal(dialogs().length, 0)
      }

      arm(source).props.onDetails()
      tree = render()
      assert.equal(dialogs().length, 1, 'the details control also opens an unplayed action')
      assert.equal(dialogs()[0].props.showResult, false)
      dialogs()[0].props.onClose()
      tree = render()

      const last = pair[source].steps.at(-1)
      tree = render({ watched: { standard: [], trace: [], [source]: [last.i] } })
      arm(source).props.onDetails()
      tree = render()
      assert.equal(dialogs()[0].props.showResult, true)
      assert.ok(renderToStaticMarkup(React.createElement(workflow.DecisionInspector, dialogs()[0].props)).includes(last.result),
        'a completed action reveals its own saved result')
      dialogs()[0].props.onClose()
      tree = render({ watched: { standard: [], trace: [] } })
    }

    arm('trace').props.onSelect(pair.trace.steps[4])
    tree = render()
    assert.equal(dialogs().length, 1)
    arm('trace').props.onChangeWatermark()
    tree = render()
    assert.equal(dialogs().length, 0, 'changing the injected key closes its action details')
    assert.equal(arm('trace').props.injectionPhase, 'setup')
    assert.equal(descendants(tree, el => el.type === robustnessComponent.default).length, 1,
      'changing the demo key does not hide the independent paper benchmark')
    assert.equal(playCalls, 0, 'viewing and closing details never starts playback')
    assert.deepEqual(props.watched, { standard: [], trace: [] })
    assert.equal(props.completedIndex, -1)
    assert.equal(props.playback, null)
    assert.equal(JSON.stringify(pair), original, 'browsing must not alter recorded decisions or inspection results')
    harness.unmount()
  })
}

for (const fixture of pairs) {
  test(`${fixture.game_id}: Take photo opens either arm’s capture without replaying or fabricating a recorded decision`, async () => {
    const pair = structuredClone(fixture), original = JSON.stringify(pair)
    const harness = await hookHarness()
    const subject = await load('../src/components/PPEWorkflowComparison.tsx', { ...dependencies, react: harness.hooks })
    let playCalls = 0
    let props = { pair, current: -1, completedIndex: -1, running: false, playback: null,
      watched: { standard: [], trace: [] }, onPlay() { playCalls++ } }
    const render = patch => { props = { ...props, ...patch }; return harness.settle(() => subject.default(props)) }
    let tree = render()
    const arm = source => descendants(tree, el => el.props.source === source && el.props.steps)[0]
    const captures = () => descendants(tree, el => el.type === photoCaptureComponent.default)
    const decisions = () => descendants(tree, el => el.type === subject.ActionDetailsDialog)
    const photoDemo = () => descendants(tree, el => el.type === photoComponent.default)[0]
    const anchor = source => pair[source].steps.find(step => step.requirement_id === 'initial_workwear')

    arm('trace').props.onPhoto(anchor('trace'))
    tree = render()
    assert.equal(captures().length, 0, 'an uninjected watermarked workflow cannot open a hidden photo action')
    assert.equal(arm('standard').props.selected.i, 0, 'an uninjected camera callback cannot alter selection')

    arm('standard').props.onSelect(pair.standard.steps[0])
    tree = render()
    assert.equal(decisions().length, 1)
    arm('standard').props.onPhoto(anchor('standard'))
    tree = render()
    assert.equal(captures().length, 1)
    assert.equal(captures()[0].props.source, 'standard')
    assert.equal(captures()[0].props.step, anchor('standard'))
    assert.equal(captures()[0].props.onOpenWatermarkDemo, undefined, 'the original camera does not imply an image watermark')
    assert.equal(arm('standard').props.selected, anchor('standard'))
    assert.equal(decisions().length, 0, 'taking a photo closes action probabilities instead of inventing a camera score')
    captures()[0].props.onClose()
    tree = render()
    assert.equal(captures().length, 0)

    arm('trace').props.onInjectWatermark()
    tree = render()
    arm('trace').props.onPhoto(anchor('trace'))
    tree = render()
    assert.equal(captures().length, 1)
    assert.equal(captures()[0].props.source, 'trace')
    assert.equal(captures()[0].props.step, anchor('trace'))
    assert.equal(arm('trace').props.selected, anchor('trace'))
    assert.equal(decisions().length, 0)
    assert.equal(typeof captures()[0].props.onOpenWatermarkDemo, 'function')
    assert.equal(photoDemo().props.openRequest, 0)
    captures()[0].props.onOpenWatermarkDemo()
    tree = render()
    assert.equal(captures().length, 0)
    assert.equal(photoDemo().props.openRequest, 1, 'the watermarked capture links to the existing fourth-box photo example')

    arm('trace').props.onPhoto(anchor('trace'))
    tree = render()
    arm('trace').props.onChangeWatermark()
    tree = render()
    assert.equal(captures().length, 0, 'changing the key closes the watermarked capture')
    arm('standard').props.onPhoto(anchor('standard'))
    tree = render()
    assert.equal(captures().length, 1)
    tree = render({ pair: pairs.find(other => other.game_id !== pair.game_id) })
    assert.equal(captures().length, 0, 'changing the case closes the old capture')
    assert.equal(playCalls, 0)
    assert.deepEqual(props.watched, { standard: [], trace: [] })
    assert.equal(props.completedIndex, -1)
    assert.equal(props.playback, null)
    assert.equal(JSON.stringify(pair), original, 'camera UI does not modify recorded steps, probabilities, or results')
    harness.unmount()
  })
}

test('Key A unlocks the watermarked workflow and then flows into the key checker', async () => {
  const harness = await hookHarness()
  const subject = await load('../src/components/PPEWorkflowComparison.tsx', { ...dependencies, react: harness.hooks })
  const pair = pairs[0]
  const original = JSON.stringify(pair)
  const candidates = choiceReplay.choiceReplayCandidates(pair)
  const applied = choiceReplay.registeredChoiceReplayCandidate(pair)
  assert.equal(applied, candidates[0])
  const props = { pair, current: -1, completedIndex: -1, running: false, playback: null, watched: { standard: [], trace: [] }, onPlay() { assert.fail('injecting a key must not run the workflow') } }
  const render = () => harness.settle(() => subject.default(props))
  let tree = render()
  const traceArm = () => descendants(tree, element => element.props.source === 'trace' && element.props.steps)[0]
  const storyPanel = () => descendants(tree, element => element.type === storyComponent.default)[0]

  assert.deepEqual(traceArm().props.watermarkKey, { id: applied.agent_id, label: 'Key A' })
  assert.equal(traceArm().props.injectionPhase, 'setup')
  assert.equal(storyPanel(), undefined, 'the checker waits until a key has been injected')

  traceArm().props.onInjectWatermark()
  tree = render()
  assert.equal(traceArm().props.injectionPhase, 'injected')
  assert.equal(storyPanel().props.appliedCandidateId, applied.agent_id)
  assert.equal(storyPanel().props.selectedCandidateId, applied.agent_id)

  storyPanel().props.onCandidateChange(candidates[1].agent_id)
  tree = render()
  assert.equal(traceArm().props.injectionPhase, 'injected', 'checking another key does not change the injected key')
  assert.equal(traceArm().props.watermarkKey.id, applied.agent_id)
  assert.equal(storyPanel().props.selectedCandidateId, candidates[1].agent_id)

  traceArm().props.onChangeWatermark()
  tree = render()
  assert.equal(traceArm().props.injectionPhase, 'setup')
  assert.equal(storyPanel(), undefined)
  traceArm().props.onInjectWatermark()
  tree = render()
  assert.equal(storyPanel().props.selectedCandidateId, applied.agent_id)
  assert.equal(JSON.stringify(pair), original)
  harness.unmount()
})

test('a missing registered key cannot unlock a borrowed watermarked workflow', () => {
  const pair = structuredClone(pairs[0])
  pair.provenance.registered_agent_id = 'not-a-candidate'
  const html = renderToStaticMarkup(React.createElement(comparison.default, {
    pair, current: -1, completedIndex: -1, running: false, playback: null,
    watched: { standard: [], trace: [] }, onPlay() {},
  }))
  assert.match(html, /Recorded key unavailable/)
  assert.match(html, /<button[^>]*disabled=""[^>]*data-inject-watermark-key=""/)
  assert.match(html, /data-comparison-box="trace"[^>]*data-workflow-visible="false"/)
  assert.doesNotMatch(html, /data-watermark-story=""/)
})

test('the comparison flow has no decorative vertical connector rail', async () => {
  const css = await readFile(new URL('../src/components/PPEWorkflowComparison.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /\.pwc-flow::before/)
  assert.doesNotMatch(css, /\.pwc-flow-item:not\(:last-child\)::after/)
})

test('scene mirror controls identify the selected requirement independently of the last played action', async () => {
  const subject = await load('../src/components/PPEInspectionScene.tsx', {
    '../lib/ppePlayback': playback, '../lib/ppeInspection': ppe, '../lib/constructionScene': scene,
    'framer-motion': { useReducedMotion: () => false },
    '../three/ConstructionScene': { __esModule: true, default: () => React.createElement('div') },
  })
  const pair = pairs[0]
  const selected = playback.matchedRequirement(pair, 'initial_footwear_view')
  assert.ok(selected.standard && selected.trace)
  const html = renderToStaticMarkup(React.createElement(subject.default, {
    pair, caseId: pair.game_id, groups: [],
    playback: { ...action(pair, 'standard', 0), status: 'complete' },
    selectedCheck: 'initial_footwear_view', onPlay() {},
  }))
  assert.ok(html.includes(`Selected check: ${playback.inspectionLabel(selected.standard).split(' · ')[0]}</span>`))
  assert.ok(html.includes(`Original workflow · step ${selected.standard.i + 1}`))
  assert.ok(html.includes(`Watermarked workflow · step ${selected.trace.i + 1}`))
  const source = await readFile(new URL('../src/components/PPEInspectionScene.tsx', import.meta.url), 'utf8')
  assert.match(source, /previousFocus\?\.focus\(\{ preventScroll: true \}\)/)
})

test('after single-step playback the first stage or next-action click is not reverted by the completed playback', async () => {
  for (const choice of ['stage', 'next', 'tile', 'story']) {
    const harness = await hookHarness()
    const subject = await load('../src/components/PPEWorkflowComparison.tsx', { ...dependencies, react: harness.hooks })
    const pair = pairs[0]
    let props = { pair, current: -1, completedIndex: -1, running: false, playback: null, watched: { standard: [], trace: [] }, onPlay() {} }
    const render = patch => { props = { ...props, ...patch }; return harness.settle(() => subject.default(props)) }
    render()
    const original = { ...action(pair, 'standard', 0), status: 'complete' }
    let tree = render({ playback: original, watched: { standard: [0], trace: [] } })
    const arm = source => descendants(tree, el => el.props.source === source && el.props.steps)[0]
    assert.equal(arm('standard').props.steps.length, 24)
    if (choice === 'stage') descendants(tree, el => el.type === 'button' && React.Children.toArray(el.props.children).includes('Check clothes and shoes'))[0].props.onClick()
    else if (choice === 'story') {
      arm('trace').props.onInjectWatermark()
      tree = render()
      descendants(tree, el => el.type === storyComponent.default)[0].props.onSelect(pair.trace.steps[10])
    }
    else if (choice === 'next') arm('standard').props.onNext(arm('standard').props.next)
    else arm('standard').props.onSelect(pair.standard.steps[9])
    tree = render()
    const expected = choice === 'stage' ? 4 : choice === 'next' ? 1 : choice === 'story' ? 5 : 9
    assert.equal(arm('standard').props.selected.i, expected)
    assert.equal(descendants(tree, el => el.type === subject.ActionDetailsDialog).length, choice === 'tile' ? 1 : 0,
      'only an action tile opens the details dialog; navigation keeps its existing selection behavior')
    tree = render({ playback: { ...original } })
    assert.equal(arm('standard').props.selected.i, expected, 'same token or status updates cannot steal a manual selection')
    tree = render({ playback: { ...action(pair, 'trace', 6, 2), status: 'playing' } })
    assert.equal(arm('trace').props.selected.i, 6, 'a new explicit play request does select its recorded check')
    harness.unmount()
  }
})

test('full replay follows steps until browsing, then Follow replay returns to the current action', async () => {
  const harness = await hookHarness()
  const subject = await load('../src/components/PPEWorkflowComparison.tsx', { ...dependencies, react: harness.hooks })
  const pair = pairs[0]
  let props = { pair, current: 0, completedIndex: -1, running: true, playback: null, watched: { standard: [], trace: [] }, onPlay() {} }
  const render = patch => { props = { ...props, ...patch }; return harness.settle(() => subject.default(props)) }
  let tree = render()
  const trace = () => descendants(tree, el => el.props.source === 'trace' && el.props.steps)[0]
  trace().props.onInjectWatermark()
  tree = render()
  tree = render({ current: 1, completedIndex: 0 })
  assert.equal(trace().props.selected.i, 1)
  trace().props.onSelect(pair.trace.steps[6])
  tree = render({ current: 2, completedIndex: 1 })
  assert.equal(trace().props.selected.i, 6)
  descendants(tree, el => el.type === 'button' && el.props.children === 'Follow replay')[0].props.onClick()
  tree = render()
  assert.equal(trace().props.selected.i, 2)
  harness.unmount()
})
