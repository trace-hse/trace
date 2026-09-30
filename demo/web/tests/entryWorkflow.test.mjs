import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
async function load(relative, dependencies = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const module = { exports: {} }
  Function('require', 'module', 'exports', output)((name) => dependencies[name] ?? (name.endsWith('/ppeInspection') ? ppe : require(name)), module, module.exports)
  return module.exports
}
const ppe = await load('../src/lib/ppeInspection.ts')
const guided = await load('../src/lib/guidedSteps.ts')
const workflow = await load('../src/components/PairedWorkflowStrip.tsx', { '../lib/guidedSteps': guided })
const attribution = await load('../src/components/EntryAttributionPanel.tsx', { './PairedWorkflowStrip': workflow })
const pending = await load('../src/components/ConstructionWorkflowPending.tsx', { '../lib/guidedSteps': guided })

function report(verdict = 'deny_entry', compliant = true) {
  return { status: 'completed', facts: {}, decision: { action: verdict, verdict, assessment: 'non_compliant' },
    safety: { compliant, violations: compliant ? [] : [{ message: 'Unsafe admission', action: verdict, evidence_ids: ['shoe'] }] },
    world_events: [{ id: 'end', kind: verdict === 'deny_entry' ? 'worker_held' : 'foot_injury', worker_state: verdict === 'deny_entry' ? 'outside' : 'injured' }] }
}
function step(action, stage, i, extra = {}) {
  return { i, action, label: action, stage_id: stage, policy_source: 'codex_llm', ...extra }
}
function pair() {
  const arm = { success: true, required_done: 2, required_total: 2, validation: { valid: true }, report: report() }
  return { task_type: 'construction_ppe_entry_check', synthetic: true,
    trace: { ...arm, steps: [step('identify_worker', 'identify', 0), step('deny_entry', 'decide', 1)] },
    standard: { ...arm, steps: [step('identify_worker', 'identify', 0), step('inspect_footwear', 'inspect', 1), step('deny_entry', 'decide', 2)] },
    agreement: { same: 1, of: 3 }, validation: { same_facts: false, both_valid: true, same_outcome: false },
    provenance: { policy_source: 'codex_llm' } }
}
const candidate = (id, z1, z2, n1 = 10, n2 = 10) => ({
  agent_id: id, label: `Agent ${id}`, z1, z2, n1, n2, layer1_detected: z1 > 2, layer2_detected: z2 > 2,
})
function evidence(candidates, status = 'candidate_match', matched = ['A']) {
  return { record_scope: 'trace_agent_actions', candidates, status, matched_agent_ids: matched, threshold: 2, limitations: [] }
}

test('entry stages use business metadata and never align by another arm’s step positions', () => {
  const data = pair()
  const trace = guided.buildWorkflow(data.trace.steps, 'hse', data.task_type)
  const ordinary = guided.buildWorkflow(data.standard.steps, 'hse', data.task_type)
  assert.deepEqual(trace.map((phase) => phase.id), ['identify', 'decide'])
  assert.deepEqual(ordinary.map((phase) => phase.id), ['identify', 'inspect', 'decide'])
  assert.equal(trace[1].steps[0].i, 1)
  assert.equal(ordinary[2].steps[0].i, 2)
})

test('shared workflow preserves a stage used only by the ordinary run', () => {
  const data = pair()
  const markup = renderToStaticMarkup(React.createElement(workflow.default, {
    pair: data, phases: guided.buildWorkflow(data.trace.steps, 'hse', data.task_type), current: 1, running: false,
    expanded: 'inspect', onToggle: () => {},
  }))
  assert.match(markup, /Inspect PPE/)
  assert.match(markup, /No recorded action in this stage/)
  assert.match(markup, /inspect_footwear/)
})

function buttonsIn(element) {
  if (!React.isValidElement(element)) return []
  return [
    ...(element.props['aria-label'] ? [element] : []),
    ...React.Children.toArray(element.props.children).flatMap(buttonsIn),
  ]
}

for (const source of ['trace', 'standard']) {
  test(`${source} action window exposes earlier/later navigation and selects the adjacent hidden action`, () => {


    const indices = [2, 3, 5, 7, 8, 10, 12]
    const steps = Array.from({ length: 13 }, (_, i) => step(`action_${i}`, 'inspect', i))
    const calls = []
    let focus = indices[0]
    const prefix = source === 'trace' ? 'With' : 'Without'
    const render = () => buttonsIn(workflow.ActionWindow({ indices, steps, focus, source,
      selectedSource: null, current: -1,
      onSelect: (selectedSource, index) => { calls.push([selectedSource, index]); focus = index },
    }))
    assert.equal(render().some((button) => button.props['aria-label'] === `${prefix} watermark earlier actions`), false)
    const reached = new Set()
    while (true) {
      const buttons = render()
      for (const index of indices) {
        if (buttons.some((button) => button.props['aria-label'] === `${prefix} watermark step ${index + 1}: action_${index}`)) reached.add(index)
      }
      const next = buttons.find((button) => button.props['aria-label'] === `${prefix} watermark later actions`)
      if (!next) break
      next.props.onClick()
    }
    assert.deepEqual([...reached], indices, 'every action is reachable through explicit next buttons')
    assert.deepEqual(calls, [[source, 7], [source, 10]], 'navigation uses onSelect, opening the hidden action’s existing inspector')
    const previous = render().find((button) => button.props['aria-label'] === `${prefix} watermark earlier actions`)
    assert.ok(previous)
    previous.props.onClick()
    assert.deepEqual(calls.at(-1), [source, 7])
  })
}

test('a four-action stage has an explicit button to open its last assessment', () => {
  const calls = []
  const buttons = buttonsIn(workflow.ActionWindow({
    indices: [2, 3, 4, 5], steps: Array.from({ length: 6 }, (_, i) => step(i === 5 ? 'assess_non_compliant' : `action_${i}`, 'inspect', i)),
    focus: 2, source: 'trace', selectedSource: null, current: -1,
    onSelect: (...args) => calls.push(args),
  }))
  buttons.find((button) => button.props['aria-label'] === 'With watermark later actions').props.onClick()
  assert.deepEqual(calls, [['trace', 5]])
})

test('positive probabilities never round to displayed zero in bars or score rows', () => {
  for (const probability of [Number.MIN_VALUE, 1e-8, 0.0004, 0.000999]) {
    assert.equal(workflow.percent(probability), '<0.1%')
    assert.equal(workflow.probabilityValue(probability), '<0.001')
  }
  assert.equal(workflow.percent(0), '0.0%')
  assert.equal(workflow.probabilityValue(0), '0.000')
  assert.equal(workflow.percent(0.001), '0.1%')
  assert.equal(workflow.probabilityValue(0.001), '0.001')
  assert.equal(workflow.percent(1), '100.0%')
  assert.equal(workflow.probabilityValue(1), '1.000')
})

test('different observations, decisions and site outcomes can be valid records', () => {
  const data = pair()
  data.trace.report = report('approve_entry', false)
  data.trace.report.facts = { footwear: 'uncertain' }
  const result = workflow.entryComparison(data)
  assert.equal(result.valid, true)
  assert.equal(result.decisionsSame, false)
  assert.equal(result.outcomesSame, false)
})

test('event timestamp and id differences do not imply different physical outcomes', () => {
  const data = pair()
  data.standard.report = structuredClone(data.trace.report)
  data.standard.report.world_events[0].timestamp = '09:30:02'
  data.standard.report.world_events[0].id = 'another-run-end'
  assert.equal(workflow.entryComparison(data).outcomesSame, true)
  delete data.standard.report.world_events
  assert.equal(workflow.entryComparison(data).outcomesKnown, false)
})

test('candidate attribution does not pick the highest score below threshold', () => {
  assert.match(attribution.attributionSummary(evidence([candidate('A', 1.9, 1.7), candidate('B', 1.5, 1.2)])), /Insufficient/)
})

test('multiple supported candidates remain ambiguous despite unequal scores', () => {
  assert.match(attribution.attributionSummary(evidence([candidate('A', 7, 6), candidate('B', 2.1, 0)])), /ambiguous/)
})

test('unique supported candidate is qualified, with matching identity and nonempty evidence', () => {
  assert.match(attribution.attributionSummary(evidence([candidate('A', 3, 0), candidate('B', 0, 0)])), /supports Agent A.*not conclusive/)
  assert.match(attribution.attributionSummary(evidence([candidate('A', 3, 0)], 'candidate_match', ['B'])), /Insufficient/)
  assert.match(attribution.attributionSummary(evidence([candidate('A', 3, 3, 0, 0)])), /Insufficient/)
})

test('violation details use only observations before the questioned action', () => {
  const steps = [step('inspect_footwear', 'inspect', 0, { result: 'ordinary shoes', evidence_ids: ['shoe'] }),
    step('approve_entry', 'decide', 1), step('future_result', 'decide', 2, { result: 'future injury', evidence_ids: ['shoe'] })]
  const context = attribution.violationContext(steps, { message: 'Unsafe admission', action: 'approve_entry', evidence_ids: ['shoe'] })
  assert.equal(context.step.action, 'approve_entry')
  assert.deepEqual(context.observations.map((item) => item.result), ['ordinary shoes'])
  assert.deepEqual(attribution.violationContext(steps, { message: 'missing', action: 'not-recorded' }).observations, [])
})

test('attribution panel hides future decisions and candidate scores until replay completes', () => {
  const data = pair()
  data.attribution = evidence([candidate('A', 9.876, 0)])
  const markup = renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available: false }))
  assert.match(markup, /Finish the replay/)
  assert.doesNotMatch(markup, /9\.88|Agent A|deny entry/)
})

test('completed attribution panel separates original-log source evidence from safety findings', () => {
  const data = pair()
  data.trace.report = report('approve_entry', false)
  data.attribution = evidence([candidate('A', 3, 0)])
  const markup = renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available: true }))
  assert.match(markup, /Unsafe admission/)
  assert.match(markup, /not edited attack logs or physical site events/)
  assert.match(markup, /do not establish factual truth or legal responsibility/)
  assert.match(markup, /original.*action log/)
})

function shiftPair() {
  const data = pair()
  data.task_type = 'construction_ppe_shift'
  data.case_title = 'Controlled shift'
  data.provenance.policy_source = 'scenario_policy'
  const actions = guided.SHIFT_PHASES.map((phase, i) => step(`observe_${phase.id}`, phase.id, i, {
    policy_source: 'scenario_policy', event_kind: 'agent_action', detector_eligible: true, wm_index: i,
  }))
  actions[3] = step('recommend_deny worker=A', 'admission', 3, {
    policy_source: 'scenario_policy', event_kind: 'agent_action', detector_eligible: true, wm_index: 3,
  })
  actions.splice(4, 0, step('approve_entry', 'admission', 4, {
    label: 'Controller admission override', policy_source: 'fault_injection', event_kind: 'injected_action',
    detector_eligible: false, wm_index: null, watermarked: false, forced: false, k: 1, distribution: [], race: [],
    fault: { id: 'fault-1', description: 'Separate controller replaces the recommendation.', requested_action: 'recommend_deny', effective_action: 'approve_entry' },
  }))
  actions.forEach((action, i) => { action.i = i })
  data.trace.steps = actions
  data.standard.steps = structuredClone(actions)
  data.trace.report = report('approved', false)
  data.trace.report.decision = { action: 'approve_entry', verdict: 'approved', assessment: 'non_compliant', timestamp: '2026-09-08T09:30:01', source: 'injected_controller_fault' }
  data.trace.report.recommendation = { action: 'recommend_deny worker=A', verdict: 'denied', assessment: 'non_compliant', timestamp: '2026-09-08T09:30:00' }
  data.trace.report.admission_snapshot = { facts: { footwear: { status: 'observed', value: 'ordinary_shoes' } } }
  data.trace.report.fault_injections = [actions[4].fault]
  data.trace.report.world_events = [{ id: 'impact', kind: 'foot_injury', title: 'Recorded injury', worker_state: 'injured' }]
  data.standard.report = structuredClone(data.trace.report)
  data.attribution_scopes = {
    admission: { label: 'Before admission', action_count: 19, detect: { layer1: { z: 3.042, n: 11 }, layer2: { z: 4.359, n: 19 } }, attribution: evidence([candidate('A', 3.042, 4.359, 11, 19)]) },
    full: { label: 'Whole shift', action_count: 30, detect: { layer1: { z: 2.746, n: 15 }, layer2: { z: 5.477, n: 30 } }, attribution: evidence([candidate('A', 2.746, 5.477, 15, 30)]) },
  }
  data.attribution_scopes.admission.attribution.record_scope = 'controlled_scenario_policy_actions_admission'
  data.attribution_scopes.full.attribution.record_scope = 'controlled_scenario_policy_actions_full'
  return data
}

test('shift workflow has six stages and keeps display indices distinct from sampler indices', () => {
  const data = shiftPair()
  const phases = guided.buildWorkflow(data.trace.steps, 'hse', data.task_type)
  assert.deepEqual(phases.map((phase) => phase.id), ['briefing', 'identity', 'ppe', 'admission', 'patrol', 'response'])
  assert.deepEqual(phases.find((phase) => phase.id === 'admission').steps.map((item) => item.i), [3, 4])
  assert.equal(phases.find((phase) => phase.id === 'patrol').steps[0].i, 5)
  assert.equal(data.trace.steps[5].wm_index, 4)
  const sparse = guided.buildWorkflow([step('observe', 'patrol', 17, { wm_index: 12 })], 'hse', data.task_type)
  assert.equal(sparse[0].steps[0].i, 17, 'recorded display index, not array position or wm_index')
})

test('source verification accepts mixed controller events but validates all normal policy actions', () => {
  const data = shiftPair()
  assert.equal(workflow.trajectorySource(data).verified, true)
  assert.match(workflow.trajectorySource(data).label, /Authored scenario policy.*not an LLM/)
  data.trace.steps[0].policy_source = 'api'
  data.trace.steps[0].detector_eligible = false
  assert.equal(workflow.trajectorySource(data).verified, false, 'excluded normal action still has a source')
  data.trace.steps[0].forced = true
  assert.equal(workflow.trajectorySource(data).verified, false, 'forced flag alone cannot hide a provenance mismatch')
  assert.match(workflow.trajectorySource(pair()).label, /Recorded Codex LLM run/)
})

test('controlled Codex about-record copy uses verified normal-action provenance, not the shift task type', () => {
  const data = shiftPair()
  data.provenance.policy_source = 'codex_llm'
  for (const arm of [data.trace, data.standard]) {
    for (const action of arm.steps) if (!workflow.isInjectedStep(action)) action.policy_source = 'codex_llm'
    arm.steps[0].policy_source = 'forced_rule'
  }
  const render = () => renderToStaticMarkup(React.createElement(workflow.default, {
    pair: data, phases: guided.buildWorkflow(data.trace.steps, 'hse', data.task_type), current: -1, running: false,
    expanded: 'briefing', onToggle: () => {},
  }))
  assert.equal(workflow.trajectorySource(data).verified, true)
  let markup = render()
  assert.match(markup, /Recorded Codex LLM run/)
  assert.match(markup, /Codex LLM elicits weights.*synthetic text observations.*not token probabilities/)
  assert.match(markup, /Single-action steps follow environment rules/)
  assert.match(markup, /injected fault is not a naturally occurring LLM error/)
  assert.doesNotMatch(markup, /Normal actions use authored scenario weights|Authored scenario policy/)
  data.standard.steps[1].policy_source = 'scenario_policy'
  markup = render()
  assert.match(markup, /Agent source not verified/)
  assert.doesNotMatch(markup, /Recorded Codex LLM run|Codex LLM elicits weights/)
})

test('optional input disclosure appears only inside the closed about-record section', () => {
  const data = shiftPair()
  const disclosure = 'TEST_ONLY_DISCLOSURE: the identifier reveals the scenario genre, not future event details.'
  const render = () => renderToStaticMarkup(React.createElement(workflow.default, {
    pair: data, phases: guided.buildWorkflow(data.trace.steps, 'hse', data.task_type), current: -1, running: false,
    expanded: 'briefing', onToggle: () => {},
  }))
  assert.doesNotMatch(render(), /Input disclosure:/)
  data.provenance.input_disclosure = disclosure
  const markup = render()
  const about = markup.match(/<details\b([^>]*)><summary\b[^>]*>About this record[^]*?<\/details>/)
  assert.ok(about, 'About this record remains a native collapsible')
  assert.doesNotMatch(about[1], /\bopen(?:\s|=|$)/, 'the disclosure must not expand or clutter the page by default')
  assert.ok(about[0].includes(disclosure))
  assert.equal(markup.split(disclosure).length - 1, 1, 'no duplicate disclosure in a banner or action card')
  assert.match(about[0], /Input disclosure:/)
  assert.doesNotMatch(markup, /Recorded injury|Entry approved|same site outcome/)
  for (const missing of ['', '  ', null, 42]) {
    data.provenance.input_disclosure = missing
    assert.doesNotMatch(render(), /Input disclosure:/)
  }
})

test('injected actions have no probability or keyed-score UI, even if malformed input contains p=1', () => {
  const injected = shiftPair().trace.steps[4]
  injected.p = 1
  injected.nCand = 1
  injected.attest = 'do not claim Layer 2'
  assert.deepEqual(workflow.probabilitySnapshot(injected), { rows: [], otherCount: 0, otherProbability: 0 })
  const markup = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, {
    source: 'trace', step: injected, phaseTitle: 'Admission', onClose: () => {},
  }))
  assert.match(markup, /Watermarked workflow.*Step 5/)
  assert.match(markup, /Action inserted by the demo controller/)
  assert.match(markup, /excluded from watermark detection/)
  assert.match(markup, /the agent did not choose it/)
  assert.match(markup, /neither watermark layer/)
  assert.doesNotMatch(markup, /100\.0%|One executable action|lowest wins|Layer 2 · additional|Watermarked decision/)
})

test('scenario policy details explain key-guided selection without claiming AI-generated chances', () => {
  const action = step('inspect_shoes', 'ppe', 8, {
    policy_source: 'scenario_policy', wm_index: 7, detector_eligible: false, distribution: [{ cmd: 'inspect_shoes', label: 'Inspect shoes', p: .6 }, { cmd: 'inspect_shirt', label: 'Inspect shirt', p: .4 }],
    race: [{ cmd: 'inspect_shoes', label: 'Inspect shoes', p: .6, r: .8, score: .37, win: true }, { cmd: 'inspect_shirt', label: 'Inspect shirt', p: .4, r: .4, score: 2.29, win: false }],
  })
  for (const source of ['trace', 'standard']) {
    const markup = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, { source, step: action, phaseTitle: 'PPE check', onClose: () => {} }))
    const moreDetails = markup.match(/<details\b[^>]*data-decision-more-details[^>]*>[\s\S]*?<\/details>/)?.[0]
    assert.ok(moreDetails)
    assert.doesNotMatch(moreDetails.match(/^<details\b[^>]*>/)[0], /\bopen=/)
    assert.match(moreDetails, /chances were supplied by the demo’s scenario rules, rather than estimated by an AI model/)
    assert.match(moreDetails, /This step is excluded from watermark detection/)
    assert.match(markup, /60\.0%/)
    assert.match(markup, /40\.0%/)
    assert.match(markup, /highest percentage does not have to be the one chosen/)
    assert.doesNotMatch(markup, /Normalized action weights from the model|distribution comes directly from the Agent/)
    assert.doesNotMatch(markup, /<code\b|−ln|eligible sampler index/)
    if (source === 'trace') {
      assert.match(markup, /The key and action chances produce selection scores; the lowest score wins/)
      assert.match(moreDetails, /same action chances and the same decision history lets us replay this choice/)
    } else assert.match(markup, /ordinary randomness\. No watermark key guides the choice/)
  }
})

test('Codex details retain action-chance provenance in both workflows without inventing injected probabilities', () => {
  const action = step('inspect_shoes', 'ppe', 8, {
    wm_index: 7, distribution: [{ cmd: 'inspect_shoes', label: 'Inspect shoes', p: .6 }, { cmd: 'inspect_shirt', label: 'Inspect shirt', p: .4 }],
    race: [{ cmd: 'inspect_shoes', label: 'Inspect shoes', p: .6, r: .8, score: .37, win: true }],
  })
  for (const source of ['trace', 'standard']) {
    const markup = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, { source, step: action, phaseTitle: 'PPE check', onClose: () => {} }))
    const moreDetails = markup.match(/<details\b[^>]*data-decision-more-details[^>]*>[\s\S]*?<\/details>/)?.[0]
    assert.ok(moreDetails)
    assert.doesNotMatch(moreDetails.match(/^<details\b[^>]*>/)[0], /\bopen=/)
    assert.match(moreDetails, /Codex suggested how strongly to favor each available action/)
    assert.match(moreDetails, /values were converted into percentages before selection/)
    assert.match(moreDetails, /actions, not word-by-word probabilities/)
    assert.doesNotMatch(markup, /Authored scenario weights/)
    assert.doesNotMatch(markup, /<code\b|−ln/)
    if (source === 'trace') assert.match(markup, /The key and action chances produce selection scores; the lowest score wins/)
    else assert.match(markup, /No watermark key guides the choice/)
  }
  const injected = shiftPair().trace.steps[4]
  const markup = renderToStaticMarkup(React.createElement(workflow.DecisionInspector, { source: 'trace', step: injected, phaseTitle: 'Admission', onClose: () => {} }))
  assert.match(markup, /Action inserted by the demo controller/)
  assert.doesNotMatch(markup, /Codex suggested|Action probabilities|lowest keyed score|Agent&#x27;s action probabilities/)
})

test('shift source and injected badges are visible without prematurely publishing final outcomes', () => {
  const data = shiftPair()
  const markup = renderToStaticMarkup(React.createElement(workflow.default, {
    pair: data, phases: guided.buildWorkflow(data.trace.steps, 'hse', data.task_type), current: 5, running: true,
    expanded: 'admission', onToggle: () => {},
  }))
  assert.match(markup, /Controlled fault demonstration/)
  assert.match(markup, /Controller · excluded/)
  assert.doesNotMatch(markup, /Recorded injury|Entry approved|same site outcome/)
})

test('controlled attribution panel gates recommendations, fault reports and both score scopes', () => {
  const data = shiftPair()
  const markup = renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available: false }))
  assert.match(markup, /Finish the replay/)
  assert.doesNotMatch(markup, /Entry denied|Entry approved|ordinary shoes|3\.04|5\.48|Agent A/)
})

test('controlled attribution separates recommendation, effective fault and prefix/full evidence', () => {
  const data = shiftPair()
  const markup = renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available: true }))
  assert.match(markup, /Agent recommendation: Entry denied/)
  assert.match(markup, /Effective controller decision: approve_entry/)
  assert.match(markup, /2026-09-08T09:30:00/)
  assert.match(markup, /ordinary shoes/)
  assert.match(markup, /Admission prefix.*19 normal agent actions.*L1 z 3\.04 · n 11.*L2 z 4\.36 · n 19/)
  assert.match(markup, /Full trajectory.*30 normal agent actions.*L1 z 2\.75 · n 15.*L2 z 5\.48 · n 30/)
  assert.match(markup, /full-trajectory match does not prove authorship of the injected fault/)
  assert.match(markup, /Scores need not rise/)
  assert.match(markup, /not evidence of a natural LLM failure/)
})

test('missing scope data is not silently replaced with a full-log attribution', () => {
  const data = shiftPair()
  delete data.attribution_scopes
  data.attribution = evidence([candidate('A', 19.123, 18.456)])
  const markup = renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available: true }))
  assert.match(markup, /Admission prefix.*Not recorded/)
  assert.match(markup, /Full trajectory.*Not recorded/)
  assert.doesNotMatch(markup, /19\.12|18\.46|Agent A/)
})

test('a candidate result for the wrong scope is not shown as prefix attribution', () => {
  const data = shiftPair()
  data.attribution_scopes.admission.attribution = { ...evidence([candidate('Wrong-scope', 12.3, 14.5)]), record_scope: 'controlled_scenario_policy_actions_full' }
  const markup = renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available: true }))
  assert.doesNotMatch(markup, /Agent Wrong-scope|12\.30|14\.50/)
  assert.match(markup, /Candidate-key detection is not available/)
})

test('Codex controlled attribution preserves distinct admission/full scopes and the final-result lock', () => {
  const data = shiftPair()
  data.provenance.policy_source = 'codex_llm'
  for (const id of ['admission', 'full']) {
    data.attribution_scopes[id].attribution.record_scope = `controlled_codex_llm_actions_${id}`
    assert.match(attribution.attributionSummary(data.attribution_scopes[id].attribution), /supports Agent A/)
  }
  const render = (available) => renderToStaticMarkup(React.createElement(attribution.default, { pair: data, available }))
  assert.doesNotMatch(render(false), /Agent A|3\.04|5\.48|ordinary shoes/)
  const markup = render(true)
  assert.match(markup, /Admission prefix.*19 normal agent actions.*3\.04 · n 11/)
  assert.match(markup, /Full trajectory.*30 normal agent actions.*5\.48 · n 30/)
  assert.equal((markup.match(/Watermark evidence supports Agent A/g) ?? []).length, 2)
  assert.match(markup, /full-trajectory match does not prove authorship of the injected fault/)
  data.attribution_scopes.admission.attribution = {
    ...evidence([candidate('Wrong-Codex-scope', 12.3, 14.5)]), record_scope: 'controlled_codex_llm_actions_full',
  }
  assert.doesNotMatch(render(true), /Wrong-Codex-scope|12\.30|14\.50/)
})

test('controlled outcome comparison keeps effective decision distinct from recommendation and gates final events', () => {
  const data = shiftPair()
  data.standard.report.recommendation.verdict = 'held'
  assert.equal(workflow.entryComparison(data).decisionsSame, true, 'same injected transaction, not necessarily same agent recommendation')
  const before = renderToStaticMarkup(React.createElement(workflow.EntryOutcomeComparison, { pair: data, available: false }))
  assert.doesNotMatch(before, /Entry approved|Recorded injury/)
  const after = renderToStaticMarkup(React.createElement(workflow.EntryOutcomeComparison, { pair: data, available: true }))
  assert.match(after, /Agent recommendation/)
  assert.match(after, /Effective decision/)
  assert.match(after, /not an agent sample/)
  assert.match(after, /Recorded injury/)
})

test('pending workflow supports six shift stages without changing legacy entry defaults', () => {
  const shift = renderToStaticMarkup(React.createElement(pending.default, { taskType: 'construction_ppe_shift' }))
  for (const label of ['Briefing', 'Identity', 'PPE check', 'Admission', 'Patrol', 'Response']) assert.ok(shift.includes(label))
  assert.match(shift, /not a natural LLM failure/)
  assert.match(shift, /recorded action weights, their source/)
  assert.doesNotMatch(shift, /authored weights|Codex LLM-elicited/)
  const legacy = renderToStaticMarkup(React.createElement(pending.default))
  assert.match(legacy, /Identify worker/)
  assert.doesNotMatch(legacy, /Patrol/)
})

test('v3 inspection availability uses completed TRACE prefix and does not stream the baseline', () => {
  const allowed = (source, index, current, running) => workflow.canInspectAction('construction_ppe_shift', source, index, current, running, 31)
  for (const source of ['trace', 'standard']) assert.equal(allowed(source, 0, -1, false), false)
  assert.equal(allowed('trace', 0, 0, true), false, 'the current moving/checking action is not complete')
  assert.equal(allowed('trace', 0, 1, true), true)
  assert.equal(allowed('trace', 1, 1, true), false)
  assert.equal(allowed('trace', 29, 30, true), true)
  assert.equal(allowed('trace', 30, 30, true), false)
  assert.equal(allowed('standard', 0, 30, true), false, 'baseline waits even when final TRACE action has arrived')
  assert.equal(allowed('trace', 30, 30, false), true)
  assert.equal(allowed('standard', 30, 30, false), true)
  assert.equal(workflow.canInspectAction('construction_ppe_entry_check', 'standard', 8, -1, false, 10), true, 'v2 keeps its original inspection behavior')
})

test('recorded future v3 action labels stay readable while their result inspectors remain disabled', () => {
  const calls = []
  const view = workflow.ActionWindow({ indices: [0, 1, 2], steps: [
    step('known', 'ppe', 0), step('RECORDED_ASSESSMENT_ACTION', 'ppe', 1, { result: 'LOCKED_ASSESSMENT_RESULT' }),
    step('RECORDED_RESPONSE_ACTION', 'response', 2, { result: 'LOCKED_INJURY_RESULT' }),
  ], focus: 1, source: 'trace', selectedSource: 'trace', current: 1,
  canInspect: (index) => workflow.canInspectAction('construction_ppe_shift', 'trace', index, 1, true, 3),
  onSelect: (...args) => calls.push(args) })
  const buttons = buttonsIn(view).filter((button) => button.props['aria-label'].includes('watermark step'))
  assert.equal(buttons[0].props.disabled, false)
  assert.equal(buttons[1].props.disabled, true)
  assert.equal(buttons[2].props.disabled, true)
  buttons[1].props.onClick()
  assert.deepEqual(calls, [])
  const markup = renderToStaticMarkup(view)
  assert.match(markup, /RECORDED_ASSESSMENT_ACTION/)
  assert.match(markup, /RECORDED_RESPONSE_ACTION/)
  assert.doesNotMatch(markup, /Not yet replayed|Stage not reached|LOCKED_ASSESSMENT_RESULT|LOCKED_INJURY_RESULT|Keyed score|Result at that time/)
})

test('retained future inspector state and pagination cannot reveal v3 future probabilities or outcomes', async () => {
  let hookIndex = 0
  let state = [{ trace: 6, standard: 6 }, 'trace']
  const hooks = { ...React, useEffect() {}, useMemo: (compute) => compute(), useState: () => {
    const index = hookIndex++
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  const subject = await load('../src/components/PairedWorkflowStrip.tsx', { react: hooks, '../lib/guidedSteps': guided })
  const data = shiftPair()
  for (const arm of [data.trace, data.standard]) {
    arm.steps[6].label = 'SECRET_FUTURE_ASSESSMENT'
    arm.steps[6].result = 'SECRET_FUTURE_INJURY'
    arm.steps[6].distribution = [{ cmd: arm.steps[6].action, label: 'SECRET_FUTURE_PROBABILITY', p: .9876 }]
  }
  const props = { pair: data, phases: guided.buildWorkflow(data.trace.steps, 'hse', data.task_type), expanded: 'response', onToggle() {}, current: -1, running: false }
  const render = (patch = {}) => { hookIndex = 0; return subject.default({ ...props, ...patch }) }
  for (const source of ['trace', 'standard']) {
    state[1] = source
    for (const position of [{ current: -1, running: false }, { current: 5, running: true }, { current: 6, running: true }]) {
      const markup = renderToStaticMarkup(render(position))



      assert.doesNotMatch(markup, /SECRET_FUTURE_INJURY|SECRET_FUTURE_PROBABILITY|98\.8%|Result at that time|Keyed score/)
      assert.doesNotMatch(markup, /Not yet replayed|Stage not reached/)
      const traceButton = markup.match(/<button\b[^>]*aria-label="With watermark step 7: SECRET_FUTURE_ASSESSMENT"[^>]*>/)?.[0]
      assert.ok(traceButton, 'the recorded TRACE name remains visible even before playback or while browsing future stages')
      assert.match(traceButton, /disabled=""/)
      if (position.current === 6) assert.match(traceButton, /aria-current="step"/)
      else assert.doesNotMatch(traceButton, /aria-current="step"|data-active="true"/)
      const baselineButton = markup.match(/<button\b[^>]*aria-label="Without watermark step 7: SECRET_FUTURE_ASSESSMENT"[^>]*>/)?.[0]
      assert.ok(baselineButton, 'the recorded baseline name also remains visible without claiming a live run')
      assert.match(baselineButton, /disabled=""/)
      assert.doesNotMatch(baselineButton, /aria-current="step"|data-active="true"/)
    }
    const complete = renderToStaticMarkup(render({ current: 6, running: false }))
    assert.match(complete, /SECRET_FUTURE_INJURY/, 'details unlock after completed replay')
  }


  function findWindow(element) {
    if (!React.isValidElement(element)) return null
    if (element.type === subject.ActionWindow && element.props.source === 'trace') return element
    return React.Children.toArray(element.props.children).map(findWindow).find(Boolean)
  }
  state = [{ trace: 0, standard: 0 }, 'trace']
  findWindow(render({ current: 1, running: true })).props.onSelect('trace', 6)
  assert.equal(state[0].trace, 6, 'future window can be navigated')
  assert.equal(state[1], null, 'navigation does not open locked inspector')
  assert.doesNotMatch(renderToStaticMarkup(render({ current: 1, running: true })), /SECRET_FUTURE_INJURY|SECRET_FUTURE_PROBABILITY/)
})
