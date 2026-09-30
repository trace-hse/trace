import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, BarChart3, CheckCircle2, Dices, KeyRound, ShieldCheck, X,
} from 'lucide-react'
import type { Phase, WorkflowStage } from '../lib/guidedSteps'
import { buildWorkflow, totalSteps } from '../lib/guidedSteps'
import { PPE_TASK, ppeActionLabel, ppeActionMethodLabel, ppeActionOptionLabel, ppeCheckLabel, type PPERecordFields, type PPECheck } from '../lib/ppeInspection'

export interface PairedRaceRow {
  cmd?: string
  label: string
  p: number
  r: number
  score: number
  win: boolean
}

export interface PairedTrajectoryStep extends PPERecordFields {
  i: number
  requirement_id?: string
  procedure?: string
  variant_id?: string
  wm_index?: number | null
  event_kind?: string
  detector_eligible?: boolean
  station_id?: string
  timestamp?: string
  watermarked?: boolean
  k?: number
  action: string
  label: string
  p?: number
  rank?: number
  nCand?: number
  attest?: string | null
  required?: boolean
  race?: PairedRaceRow[]
  stage_id?: string
  phase?: string
  result?: string
  evidence_ids?: string[]
  distribution?: { cmd: string; label: string; p: number }[]
  blocked_actions?: { command?: string; label: string; reason: string }[]
  state_before?: { stage_id?: string; facts?: Record<string, unknown>; [key: string]: unknown }
  state_after?: { stage_id?: string; facts?: Record<string, unknown>; [key: string]: unknown }
  policy_source?: string
  policy_state_id?: string
  forced?: boolean
  world_state_before?: Record<string, unknown>
  world_state_after?: Record<string, unknown>
  world_events?: EntryWorldEvent[]
  fault?: ControllerFault
}

interface ReportValidation {
  valid: boolean
  success?: boolean
  issues?: string[]
}

export interface EntryWorldEvent {
  id: string
  timestamp?: string
  kind: string
  title?: string
  description?: string
  worker_state?: string
  timber_state?: string
  [key: string]: unknown
}

export interface EntryViolation {
  code?: string
  message: string
  action?: string
  evidence_ids?: string[]
  [key: string]: unknown
}

export interface EntryDecision {
  action?: string
  verdict?: string
  assessment?: unknown
  timestamp?: string
  source?: string
  [key: string]: unknown
}

export interface ControllerFault {
  id?: string
  kind?: string
  description?: string
  requested_action?: string
  effective_action?: string
  timestamp?: string
  [key: string]: unknown
}

export interface IncidentReport {
  checklist?: PPECheck[]
  evaluation?: { actual_ppe_compliant: boolean; judgment_correct: boolean; expected_assessment: string; evidence_sufficient: boolean }
  status: string
  facts: Record<string, unknown>
  unresolved?: unknown[]
  evidence_ids?: string[]
  decision?: EntryDecision
  effective_decision?: EntryDecision
  recommendation?: EntryDecision
  admission_snapshot?: { facts?: Record<string, unknown>; [key: string]: unknown }
  fault_injections?: ControllerFault[]
  world_state?: Record<string, unknown>
  safety?: { compliant: boolean; violations: EntryViolation[]; [key: string]: unknown }
  world_events?: EntryWorldEvent[]
  [key: string]: unknown
}

export interface EntryAttribution {
  record_scope: 'trace_agent_actions' | 'controlled_scenario_policy_actions_admission' | 'controlled_scenario_policy_actions_full'
    | 'controlled_codex_llm_actions_admission' | 'controlled_codex_llm_actions_full'
  candidates: { agent_id: string; label: string; z1: number; z2: number; layer1_detected: boolean; layer2_detected: boolean; n1: number; n2: number }[]
  status: 'candidate_match' | 'ambiguous' | 'insufficient_evidence'
  matched_agent_ids: string[]
  threshold: number
  limitations: string[]
}

export interface EntryAttributionScope {
  label: string
  action_count: number
  detect?: {
    layer1: { z: number; n: number; detected?: boolean }
    layer2: { z: number; n: number; detected?: boolean }
    tau?: number
  }
  attribution?: EntryAttribution
}

export interface PairedTrajectoryArm {
  steps: PairedTrajectoryStep[]
  success: boolean
  required_done: number
  required_total: number
  report?: IncidentReport
  validation?: ReportValidation
}

export interface PairedWorkflowData {
  choice_replay?: import('../lib/ppeChoiceReplay').ChoiceReplayRecord
  game_id?: string
  case_id?: string
  task_type: string
  visual_variant?: string
  query?: string
  scene?: string
  standard: PairedTrajectoryArm
  trace: PairedTrajectoryArm
  agreement: { same: number; of: number }
  stages?: WorkflowStage[]
  case_title?: string
  synthetic?: boolean
  story_frames?: { id: string; title: string; caption: string; time?: string }[]
  provenance?: {
    policy_source?: string
    source?: string
    agent_source?: string
    input_disclosure?: string
    registered_agent_id?: string
    keys?: { key1: number; key2: number }
    [key: string]: unknown
  }
  validation?: { same_facts: boolean; both_valid: boolean; same_outcome: boolean; issues?: string[] }
  attribution?: EntryAttribution
  attribution_scopes?: { admission?: EntryAttributionScope; full?: EntryAttributionScope }
}

type DecisionSource = 'trace' | 'standard'

interface DistributionEntry {
  cmd: string
  label: string
  p: number
  selected: boolean
}

function phaseContains(phase: Phase, step: number) {
  return phase.steps.some((item) => item.i === step)
}

function phaseDone(phase: Phase, current: number) {
  if (!phase.steps.length) return false
  const last = phase.steps[phase.steps.length - 1]?.i ?? 0
  return current > last
}

export function isInjectedStep(step: PairedTrajectoryStep) {
  return step.event_kind === 'injected_action' || step.policy_source === 'fault_injection'
}

export function trajectorySource(pair: PairedWorkflowData) {
  const source = pair.provenance?.policy_source ?? pair.provenance?.agent_source ?? pair.provenance?.source


  const decisions = [...pair.trace.steps, ...pair.standard.steps].filter((step) =>
    !isInjectedStep(step) && step.policy_source !== 'forced_rule')
  const verified = decisions.length > 0 && decisions.every((step) => step.policy_source === source)
  const label = verified && source === 'scenario_policy' ? 'Authored scenario policy · not an LLM run'
    : verified && source === 'codex_llm' ? 'Recorded Codex LLM run'
      : verified && source === 'api' ? 'Recorded API agent run' : 'Agent source not verified'
  return { source, verified, label }
}

export function probabilitySnapshot(step: PairedTrajectoryStep) {
  if (isInjectedStep(step)) return { rows: [] as DistributionEntry[], otherCount: 0, otherProbability: 0 }
  const candidates = new Map<string, DistributionEntry>()
  for (const row of step.distribution ?? step.race ?? []) {
    const cmd = row.cmd ?? row.label
    candidates.set(cmd, {
      cmd,
      label: row.label,
      p: row.p,
      selected: row.cmd ? row.cmd === step.action : row.label === step.label,
    })
  }
  if (![...candidates.values()].some((row) => row.selected) && step.p != null) {
    candidates.set(step.action, {
      cmd: step.action,
      label: step.label,
      p: step.p,
      selected: true,
    })
  }

  const chosen = [...candidates.values()].find((row) => row.selected)
  const others = [...candidates.values()]
    .filter((row) => !row.selected)
    .sort((a, b) => b.p - a.p)
  const rows = [...(chosen ? [chosen] : []), ...others].slice(0, 5)
  const shownProbability = rows.reduce((sum, row) => sum + row.p, 0)
  return {
    rows,
    otherCount: Math.max(0, (step.distribution?.length ?? step.nCand ?? candidates.size) - rows.length),
    otherProbability: Math.max(0, 1 - shownProbability),
  }
}

export function percent(value: number) {
  if (value > 0 && value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}

export function probabilityValue(value: number) {
  return value > 0 && value < 0.001 ? '<0.001' : value.toFixed(3)
}



export function canInspectAction(taskType: string, source: DecisionSource, index: number, current: number, running: boolean, total: number, completedIndex?: number) {
  if (taskType === PPE_TASK && completedIndex !== undefined) return index >= 0 && total > 0 && (source === 'trace' ? index <= completedIndex : !running && completedIndex >= total - 1)
  if (taskType !== 'construction_ppe_shift' && taskType !== PPE_TASK) return true
  if (index < 0 || current < 0 || total <= 0) return false
  const finished = !running && current + 1 >= total
  if (source === 'standard') return finished
  return index <= current - (running ? 1 : 0)
}

export function ActionWindow({ indices, steps, focus, source, selectedSource, current, running = false, onSelect, canInspect }: {
  indices: number[]
  steps: PairedTrajectoryStep[]
  focus: number
  source: DecisionSource
  selectedSource: DecisionSource | null
  current: number
  running?: boolean
  onSelect: (source: DecisionSource, index: number) => void
  canInspect?: (index: number) => boolean
}) {
  const trace = source === 'trace'
  const detailsAvailable = !canInspect || indices.every(canInspect)
  const phaseIndices = indices
  const focusPosition = Math.max(0, phaseIndices.indexOf(focus))
  const windowSize = Math.min(3, phaseIndices.length)
  const start = Math.max(0, Math.min(focusPosition - 1, phaseIndices.length - windowSize))
  const visible = phaseIndices.slice(start, start + windowSize)

  return (
    <div className={[
      'grid items-center gap-2 rounded-xl border px-3 py-2.5 sm:grid-cols-[154px_minmax(0,1fr)]',
      trace ? 'border-indigo-100 bg-indigo-50/35' : 'border-slate-200/80 bg-slate-50/70',
    ].join(' ')}>
      <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-start">
        <span className={[
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.04em]',
          trace ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-white',
        ].join(' ')}>
          {trace ? <ShieldCheck size={11} /> : <Dices size={11} />}
          {trace ? 'With watermark' : 'Without watermark'}
        </span>
        <span className="text-[9px] font-medium leading-relaxed text-slate-400">{canInspect
          ? trace ? detailsAvailable ? 'Recorded actions · click for details' : 'Recorded actions · replay highlighted' : detailsAvailable ? 'Recorded comparison · click for details' : 'Recorded comparison · details after replay'
          : 'Click an action for details'}</span>
      </div>

      <div className="mx-auto grid w-full max-w-[840px] grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-2">
        {start > 0 ? <button type="button"
          onClick={() => onSelect(source, phaseIndices[start - 1])}
          aria-label={`${trace ? 'With' : 'Without'} watermark earlier actions`}
          title="Show earlier actions"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-lg text-slate-500 ring-1 ring-slate-200 transition hover:text-indigo-600 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">‹</button> : <span aria-hidden="true" className="h-7 w-7" />}
        <div data-workflow-slots={source} className="mx-auto grid w-full gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, visible.length)}, minmax(0, 1fr))`, maxWidth: Math.max(1, visible.length) * 240 + Math.max(0, visible.length - 1) * 12 }}>
        {visible.map((index, order) => {
          const item = steps.find((step) => step.i === index)
          if (!item) return null
          const locked = canInspect ? !canInspect(index) : false
          const selected = !locked && selectedSource === source && index === focus


          const active = trace && running && index === current
          const label = ppeActionLabel(item.action, item.label, !locked)
          return (
            <div key={index} data-workflow-slot={index} className="relative min-w-0">
              {order > 0 && <span aria-hidden="true" className="absolute -left-3 top-1/2 w-3 -translate-y-1/2 text-center text-[10px] text-slate-300">›</span>}
              <motion.button layout animate={{ scale: 1 }}
                onClick={() => { if (!locked) onSelect(source, index) }}
                disabled={locked}
                aria-label={`${trace ? 'With' : 'Without'} watermark step ${index + 1}: ${label}`}
                aria-current={active ? 'step' : undefined}
                data-active={active}
                title={label}
                className={[
                  'flex h-12 w-full min-w-0 max-w-[240px] items-center gap-2 rounded-lg px-2.5 text-left text-[10.5px] transition-colors',
                  active
                    ? isInjectedStep(item) ? 'bg-amber-50 text-amber-900 ring-2 ring-amber-400' : 'bg-indigo-100 text-indigo-900 ring-2 ring-indigo-500 shadow-sm'
                    : selected
                    ? trace
                      ? 'bg-indigo-600 text-white ring-1 ring-indigo-600 shadow-sm'
                      : 'bg-slate-800 text-white ring-1 ring-slate-800 shadow-sm'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 enabled:hover:ring-indigo-300',
                  locked ? 'cursor-default disabled:opacity-100' : '',
                ].join(' ')}>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${active ? 'bg-white/80 text-indigo-700' : selected ? 'bg-white/15 text-white/80' : 'bg-slate-100 text-slate-400'}`}>{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 font-semibold leading-[14px]">{label}</span>
                  {isInjectedStep(item) && <span className={`block text-[8px] font-bold ${selected ? 'text-amber-100' : 'text-amber-700'}`}>Controller · excluded</span>}
                </span>
                {active && <span aria-label="Playing now" className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${isInjectedStep(item) ? 'bg-amber-500' : 'bg-indigo-500'}`} />}
              </motion.button>
            </div>
          )
        })}
        {!visible.length && <span className="text-[10px] text-slate-400">No recorded action in this stage.</span>}
        </div>
        {start + windowSize < phaseIndices.length ? <button type="button"
          onClick={() => onSelect(source, phaseIndices[start + windowSize])}
          aria-label={`${trace ? 'With' : 'Without'} watermark later actions`}
          title="Show later actions"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-lg text-slate-500 ring-1 ring-slate-200 transition hover:text-indigo-600 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">›</button> : <span aria-hidden="true" className="h-7 w-7" />}
      </div>
    </div>
  )
}

function ProbabilityBars({ step, trace }: { step: PairedTrajectoryStep; trace: boolean }) {
  const recordedRows = step.distribution?.length ? step.distribution : step.race ?? []
  const candidates = new Map<string, DistributionEntry>()
  for (const row of recordedRows) {
    if (!Number.isFinite(row.p) || row.p < 0 || row.p > 1) continue
    const cmd = row.cmd ?? row.label
    candidates.set(cmd, {
      cmd,
      label: row.label,
      p: row.p,
      selected: row.cmd ? row.cmd === step.action : row.label === step.label,
    })
  }
  if (!isInjectedStep(step) && ![...candidates.values()].some(row => row.selected)
    && step.p != null && Number.isFinite(step.p) && step.p >= 0 && step.p <= 1) {
    candidates.set(step.action, { cmd: step.action, label: step.label, p: step.p, selected: true })
  }
  const rows = isInjectedStep(step) ? [] : [...candidates.values()].sort((a, b) => b.p - a.p)
  const candidateCount = Math.max(step.nCand ?? 0, recordedRows.length, step.race?.length ?? 0, rows.length)
  const missingCount = candidateCount - rows.length
  const forced = step.forced || step.policy_source === 'forced_rule'
    || (step.distribution?.length || step.nCand) === 1
  const showScores = trace && !forced && !isInjectedStep(step)
  const savedScore = (row: DistributionEntry) => {
    const record = step.race?.find(candidate => typeof candidate.cmd === 'string'
      ? candidate.cmd === row.cmd : candidate.label === row.label)
    return typeof record?.score === 'number' && Number.isFinite(record.score) && record.score >= 0
      ? record.score : undefined
  }
  const validScores = rows.map(savedScore).filter((score): score is number => score !== undefined)
  const completeScores = showScores && rows.length > 0 && rows.length === candidateCount && validScores.length === rows.length
  if (completeScores) rows.sort((a, b) => savedScore(a)! - savedScore(b)!)
  const lowestScore = validScores.length ? Math.min(...validScores) : undefined
  const distinctScores = [...new Set(validScores)]
  const scoreDigits = new Set(distinctScores.map(score => score.toFixed(2))).size < distinctScores.length ? 3 : 2
  const roundedScoresOverlap = new Set(distinctScores.map(score => score.toFixed(scoreDigits))).size < distinctScores.length
  const optionLabel = (row: DistributionEntry) => row.cmd.split(' method=')[0] === step.action.split(' method=')[0]
    ? ppeActionMethodLabel(row.cmd, true) || ppeActionOptionLabel(row.cmd, row.label)
    : ppeActionOptionLabel(row.cmd, row.label)
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <BarChart3 size={16} className="shrink-0 text-indigo-500" /> {showScores ? 'Chances & selection scores' : 'Action probabilities'}
      </div>
      <div className="mt-3 space-y-3">
        {rows.map((row) => {
          const score = showScores ? savedScore(row) : undefined
          const selectedLowest = row.selected && completeScores && score === lowestScore
          const tiedLowest = selectedLowest && validScores.filter(value => value === lowestScore).length > 1
          return <div key={row.cmd} data-action-probability={row.cmd} className="grid min-w-0 items-center gap-3 text-xs"
            style={{ gridTemplateColumns: showScores ? 'minmax(0, 1fr) 84px' : 'minmax(0, 1fr)' }}>
            <div className="min-w-0">
              <div className="mb-1.5 flex items-start justify-between gap-3">
                <span className={`min-w-0 break-words leading-relaxed ${row.selected ? 'font-semibold text-indigo-700' : 'text-slate-600'}`}>
                  {optionLabel(row)}
                  {row.selected && <span className="ml-1.5 inline-block rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">Selected</span>}
                </span>
                <span className={`shrink-0 tabular-nums ${row.selected ? 'font-bold text-indigo-700' : 'text-slate-600'}`}>{percent(row.p)}</span>
              </div>
              <span aria-hidden="true" className="block h-2.5 overflow-hidden rounded-full bg-slate-100">
                <span style={{ width: `${row.p * 100}%` }}
                  className={['block h-full rounded-full', row.selected ? trace ? 'bg-indigo-500' : 'bg-slate-700' : 'bg-slate-300'].join(' ')} />
              </span>
            </div>
            {showScores && <div data-selection-score={row.cmd} data-score-missing={score === undefined || undefined}
              className={`min-w-0 text-right tabular-nums ${selectedLowest ? 'text-indigo-700' : 'text-slate-600'}`}>
              <span className="block text-xs">Score</span>
              <span className={`block break-all text-sm ${selectedLowest ? 'font-bold' : 'font-semibold'}`}
                title={score === undefined ? undefined : `Saved selection score: ${score}`}>{score === undefined ? 'Not saved' : score.toFixed(scoreDigits)}</span>
              {selectedLowest && <span data-lowest-score className="mt-0.5 block text-xs font-semibold leading-tight">{tiedLowest ? 'Tied lowest score' : 'Lowest score'}</span>}
            </div>}
          </div>
        })}
        {!rows.length && <p className="rounded-lg bg-slate-50 p-2 text-xs leading-relaxed text-slate-600">No action probabilities were saved for this step.</p>}
      </div>
      {showScores && roundedScoresOverlap && <p className="mt-3 text-xs leading-relaxed text-slate-500">Scores are rounded here; the lowest mark uses the full saved values.</p>}
      {!!rows.length && (missingCount > 0 || (!recordedRows.length && candidateCount === 1 && !forced)) && <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {missingCount > 0
          ? `Chances for ${missingCount} other action${missingCount === 1 ? '' : 's'} are unavailable.`
          : 'Only the selected action’s chance was saved.'}
      </p>}
    </div>
  )
}

export function DecisionInspector({ source, step, phaseTitle, onClose, showResult = true }: {
  source: DecisionSource
  step: PairedTrajectoryStep
  phaseTitle: string
  onClose: () => void
  showResult?: boolean
}) {
  const trace = source === 'trace'
  const injected = isInjectedStep(step)
  const selectedLabel = ppeActionOptionLabel(step.action, step.label)
  const selectionRecorded = step.race?.some(row => (typeof row.cmd === 'string'
    ? row.cmd === step.action : row.label === step.label)
    && typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0)
  const forced = !injected && (step.forced || step.policy_source === 'forced_rule'
    || (step.distribution?.length || step.nCand) === 1)
  const principle = injected
    ? 'The demo inserted this action; the agent did not choose it.'
    : forced
      ? 'Only one action is available, so both workflows choose it.'
      : trace
        ? 'The key and action chances produce selection scores; the lowest score wins.'
        : 'Actions are drawn from these chances; the highest percentage is not guaranteed.'
  const sourceDescription = step.policy_source === 'codex_llm'
    ? 'Codex suggested how strongly to favor each available action. Those values were converted into percentages before selection. They describe actions, not word-by-word probabilities.'
    : step.policy_source === 'scenario_policy'
      ? 'These chances were supplied by the demo’s scenario rules, rather than estimated by an AI model.'
      : step.policy_source === 'forced_rule'
        ? 'A workflow rule supplied this action.'
        : 'These are the action chances saved in the recording. How the original values were produced was not recorded.'

  return (
    <motion.div initial={{ opacity: 0, height: 0, y: -6 }} animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, y: -6 }} transition={{ duration: 0.24 }} className="overflow-hidden">
      <div data-decision-inspector className={[
        'my-2.5 rounded-2xl border p-3',
        trace ? 'border-indigo-200 bg-indigo-50/45' : 'border-slate-300 bg-slate-50/80',
      ].join(' ')}>
        <div className="mb-3 flex items-start gap-2">
          <span className={[
            'inline-flex min-w-0 items-center gap-1.5 text-sm font-bold',
            trace ? 'text-indigo-700' : 'text-slate-700',
          ].join(' ')}>
            {injected ? <AlertCircle size={16} className="shrink-0" /> : trace ? <KeyRound size={16} className="shrink-0" /> : <Dices size={16} className="shrink-0" />}
            {trace ? 'Watermarked workflow' : 'Original workflow'} · Step {step.i + 1}
          </span>
          <button type="button" onClick={onClose} aria-label="Close decision details"
            className="ml-auto shrink-0 rounded-full bg-white p-2 text-slate-500 ring-1 ring-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 break-words text-sm leading-relaxed text-slate-800"><b>{injected ? 'Recorded action:' : 'Selected action:'}</b> {selectedLabel}</p>

        {!injected && <ProbabilityBars step={step} trace={trace} />}
        <p data-decision-principle className={`mt-3 text-sm leading-relaxed ${injected ? 'text-amber-800' : trace ? 'text-indigo-800' : 'text-slate-700'}`}>{principle}</p>

        <details data-decision-more-details className="mt-3 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600">
          <summary className="cursor-pointer rounded py-1 font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">More details</summary>
          <div className="mt-2 space-y-2 break-words">
            {injected ? <>
              <p><b>Action inserted by the demo controller.</b> This simulates a fault, so no action probabilities apply. It carries neither watermark layer and is excluded from watermark detection.</p>
              {step.fault?.description && <p>{step.fault.description}</p>}
            </> : <>
              <p><b>Probability source.</b> {sourceDescription}</p>
              {forced ? <p><b>One available action.</b> The workflow requires this action next. Both selection methods have to choose it. The first watermark layer cannot change this choice.</p>
                : trace ? <>
                  <p><b>How the watermark guides the choice.</b> The recorded chances stay unchanged. Using the recorded key, the same action chances and the same decision history lets us replay this choice. A sequence of choices forms a pattern that can help identify the recording’s source.</p>
                  {!selectionRecorded && <p>The selected action was saved, but the key-based selection details for this step are unavailable.</p>}
                </> : <p>This selection uses ordinary randomness. No watermark key guides the choice.</p>}
              {!forced && <p>The action with the highest percentage does not have to be the one chosen. These percentages describe selection chances, not confidence that a judgment is correct.</p>}
              {(step.stage_id || step.phase) && <p><b>{phaseTitle}.</b> Available actions depend on what has already been done.</p>}
              {!!step.blocked_actions?.length && <div>
                <p className="font-semibold">Why other actions are unavailable</p>
                <ul className="mt-1 space-y-1">
                  {step.blocked_actions.map((action, index) => <li key={action.command ?? index}>{ppeActionOptionLabel(action.command, action.label)}: {action.reason}</li>)}
                </ul>
              </div>}
              {step.detector_eligible === false && <p>This step is excluded from watermark detection.</p>}
              {step.attest && <p><b>Second watermark layer:</b> one extra read-only record was added. This does not repeat the on-site inspection or change the situation being inspected.</p>}
            </>}
          </div>
        </details>
        {showResult && step.result && <details data-decision-result className="mt-2 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600">
          <summary className="cursor-pointer rounded py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Result at that time</summary>
          <p className="mt-2 break-words">{step.result}</p>
        </details>}
      </div>
    </motion.div>
  )
}

export default function PairedWorkflowStrip({
  phases, pair, current, running, expanded, onToggle, followReplay = false, onFollow, completedIndex,
}: {
  phases: Phase[]
  pair: PairedWorkflowData
  current: number
  completedIndex?: number
  running: boolean
  expanded: string | null
  onToggle: (id: string) => void
  followReplay?: boolean
  onFollow?: () => void
}) {
  const total = totalSteps(phases)
  const shown = Math.max(0, Math.min(current + 1, total))

  const completionCursor = !running && shown === total ? current + 1 : current
  const [manualFocus, setManualFocus] = useState<Record<DecisionSource, number | null>>({ trace: null, standard: null })
  const [selectedSource, setSelectedSource] = useState<DecisionSource | null>(null)
  const armPhases = useMemo(() => ({
    trace: buildWorkflow(pair.trace.steps, 'hse', pair.task_type, pair.stages),
    standard: buildWorkflow(pair.standard.steps, 'hse', pair.task_type, pair.stages),
  }), [pair])


  const displayPhases = useMemo(() => {
    const stageOrder = pair.stages?.length ? pair.stages : [...phases, ...armPhases.standard]
    return [...new Map(stageOrder.map((stage) => [stage.id, stage])).values()].map((stage, index): Phase => ({
      id: stage.id, num: index + 1, title: stage.title,
      desc: ('description' in stage ? stage.description : undefined) ?? stage.desc ?? '',
      steps: phases.find((phase) => phase.id === stage.id)?.steps ?? [],
    }))
  }, [pair.stages, phases, armPhases.standard])
  const activePhase = displayPhases.find((phase) => phaseContains(phase, current))
  const selectedPhase = (followReplay ? activePhase : displayPhases.find((phase) => phase.id === expanded)) ?? activePhase ?? displayPhases[0] ?? null

  useEffect(() => {
    setManualFocus({ trace: null, standard: null })
    setSelectedSource(null)
  }, [selectedPhase?.id, pair])

  const indices = {
    trace: armPhases.trace.find((phase) => phase.id === selectedPhase?.id)?.steps.map((step) => step.i) ?? [],
    standard: armPhases.standard.find((phase) => phase.id === selectedPhase?.id)?.steps.map((step) => step.i) ?? [],
  }
  const focus = {
    trace: (followReplay ? null : manualFocus.trace) ?? (indices.trace.includes(current) ? current : indices.trace[0]) ?? -1,
    standard: (followReplay ? null : manualFocus.standard) ?? indices.standard[0] ?? -1,
  }

  const shift = pair.task_type === 'construction_ppe_shift'
  const inspection = pair.task_type === PPE_TASK
  const gated = shift || inspection
  const canInspect = (source: DecisionSource, index: number) =>
    canInspectAction(pair.task_type, source, index, current, running, total, completedIndex)

  function selectAction(source: DecisionSource, index: number) {
    const alreadyOpen = selectedSource === source && focus[source] === index
    if (followReplay) onToggle(selectedPhase!.id)
    setManualFocus((previous) => ({ ...previous, [source]: index }))

    setSelectedSource(alreadyOpen || !canInspect(source, index) ? null : source)
  }

  function resumeFollow() {
    setManualFocus({ trace: null, standard: null })
    setSelectedSource(null)
    onFollow?.()
  }

  if (!selectedPhase) return null



  const inspectorAllowed = selectedSource !== null && canInspect(selectedSource, focus[selectedSource])
  const inspectedStep = selectedSource && inspectorAllowed ? pair[selectedSource].steps.find((step) => step.i === focus[selectedSource]) : null
  const entryCheck = pair.task_type === 'construction_ppe_entry_check'
  const construction = shift || inspection || entryCheck || pair.task_type === 'construction_ppe_incident_review'
  const agentSource = trajectorySource(pair)
  const agentLabel = agentSource.label
  const shiftPolicyNote = !agentSource.verified ? 'The source of normal action weights has not been verified.'
    : agentSource.source === 'scenario_policy' ? 'Normal actions use authored scenario weights, not LLM probabilities.'
      : agentSource.source === 'codex_llm' ? 'Codex LLM elicits weights over legal actions from synthetic text observations; they are normalized before sampling, not token probabilities.'
        : agentSource.source === 'api' ? 'The API LLM elicits weights over legal actions from synthetic text observations; they are normalized before sampling, not token probabilities.'
          : 'The source of normal action weights has not been verified.'

  return (
    <section className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white/85 p-3.5 shadow-[0_16px_50px_-38px_rgba(15,23,42,.45)]">
      <div className="mb-3 flex flex-wrap items-center gap-2 px-0.5">
        <div>
          <h2 className="text-[13px] font-extrabold text-slate-800">{construction ? pair.case_title ?? 'Site entry check' : 'Same task, two ways through it'}</h2>
          <p className="mt-0.5 text-[10.5px] text-slate-400">{shift ? 'Two recorded trajectories · replay highlights the current action' : 'Click an action to see how the Agent chose it'}</p>
        </div>
        <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500 tabular-nums">
          TRACE replay · step {shown} / {total}
        </span>
        {onFollow && (running || !followReplay) && <button type="button" onClick={resumeFollow}
          title={followReplay ? 'The workflow follows the currently playing action' : 'Return to the currently playing action'}
          aria-pressed={followReplay} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${followReplay ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600'}`}>
          {running && followReplay && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />}
          {followReplay ? 'Following replay' : 'Follow replay'}
        </button>}
      </div>

      {construction && (
        <details className="mb-2 px-0.5 text-slate-500">
          <summary className="cursor-pointer text-[10px] text-slate-400">About this record · {agentLabel}</summary>
          <p className="text-[10px] font-bold text-indigo-600">
            {pair.synthetic ? 'Synthetic site scenario' : 'Recorded site scenario'} · {agentLabel}
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
            {inspection ? `Pre-entry PPE inspection. ${shiftPolicyNote} Both runs use the same evidence and prerequisite rules. A correction receipt must be followed by fresh inspection. No access-control action or incident is part of this task.` : shift
              ? `Controlled fault demonstration. ${shiftPolicyNote} Single-action steps follow environment rules. A separate controller injects an admission transaction, excluded from detection. Site events advance with the recorded clock. The injected fault is not a naturally occurring LLM error.`
              : entryCheck
              ? 'Replay what the Agent observed, checked and decided at the time. Site events follow its entry decision; the Agent cannot see future events.'
              : 'The Agent reviews recorded incident evidence. This legacy record is not a site-entry decision run.'}
          </p>
          {typeof pair.provenance?.input_disclosure === 'string' && pair.provenance.input_disclosure.trim() && (
            <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500"><b>Input disclosure:</b> {pair.provenance.input_disclosure}</p>
          )}
        </details>
      )}

      <ActionWindow indices={indices.trace} steps={pair.trace.steps} focus={focus.trace}
        source="trace" selectedSource={selectedSource} current={current} running={running} onSelect={selectAction}
        canInspect={gated ? (index) => canInspect('trace', index) : undefined} />

      {(!gated || inspectorAllowed) && <AnimatePresence initial={false} mode="wait">
        {selectedSource === 'trace' && inspectedStep && (
          <DecisionInspector key={`trace-${focus.trace}`} source="trace" step={inspectedStep} phaseTitle={selectedPhase.title}
            onClose={resumeFollow} />
        )}
      </AnimatePresence>}

      <div className="my-2 rounded-xl border border-indigo-200 bg-white p-2.5">
        <div className="flex flex-wrap items-center gap-2 px-0.5">
          <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[.08em] text-white">
            Shared main workflow
          </span>
          <span className="text-[10px] font-medium text-indigo-500">Shared timing rules · independent choices and outcomes</span>
        </div>
        <div data-workflow-phases className="mx-auto mt-2 flex max-w-[960px] items-stretch justify-between gap-2 overflow-x-auto p-1">
          {displayPhases.map((phase, index) => {
            const selected = phase.id === selectedPhase.id
            return (
              <div key={phase.id} className="relative min-w-[112px] max-w-[144px] flex-1">
                {index > 0 && <div aria-hidden="true" className="absolute -left-2 top-1/2 w-2 -translate-y-1/2 text-center text-[10px] text-indigo-200">›</div>}
                <button onClick={() => onToggle(phase.id)}
                  data-workflow-phase={phase.id}
                  className={[
                    'relative flex h-11 w-full items-center rounded-lg px-2 text-left transition-colors duration-200',
                    selected
                      ? 'bg-white ring-2 ring-indigo-400 shadow-sm'
                      : phaseDone(phase, completionCursor)
                        ? 'bg-emerald-50/70 ring-1 ring-emerald-200'
                        : 'bg-white/70 ring-1 ring-indigo-100 hover:bg-white',
                  ].join(' ')}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-[9px] font-bold text-slate-400">{phase.num}</span>
                    <span className={[
                      'line-clamp-2 min-w-0 text-[10px] font-semibold leading-[13px]',
                      selected ? 'text-indigo-700' : 'text-slate-600',
                    ].join(' ')}>{phase.title}</span>
                    {phase.id === activePhase?.id && running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 animate-pulse" />}
                    {phaseDone(phase, completionCursor) && <span className="ml-auto text-[10px] font-bold text-emerald-600">✓</span>}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
        <p className="mt-2 px-1 text-[10px] leading-relaxed text-slate-500">{selectedPhase.desc}</p>
      </div>

      <ActionWindow indices={indices.standard} steps={pair.standard.steps} focus={focus.standard}
        source="standard" selectedSource={selectedSource} current={-1} onSelect={selectAction}
        canInspect={gated ? (index) => canInspect('standard', index) : undefined} />

      {(!gated || inspectorAllowed) && <AnimatePresence initial={false} mode="wait">
        {selectedSource === 'standard' && inspectedStep && (
          <DecisionInspector key={`standard-${focus.standard}`} source="standard" step={inspectedStep} phaseTitle={selectedPhase.title}
            onClose={resumeFollow} />
        )}
      </AnimatePresence>}

      <p className="mt-2 px-1 text-[9px] text-slate-400">
        Aligned by workflow stage, not by step number. Probabilities describe each action's recorded state; different states can have different distributions.
      </p>
      {inspection ? <PPEOutcomeComparison pair={pair} available={!running && total > 0 && shown === total && completedIndex === total - 1} />
        : entryCheck || shift ? <EntryOutcomeComparison pair={pair} available={!running && total > 0 && shown === total} /> : <OutcomeComparison pair={pair} />}
    </section>
  )
}

export function PPEOutcomeComparison({ pair, available }: { pair: PairedWorkflowData; available: boolean }) {
  if (!available) return <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">The current PPE findings and each agent’s conclusion appear after the replay.</p>
  return <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
    <p className="text-xs font-bold text-slate-700">Recorded inspection results <span className="ml-2 font-normal text-slate-500">{pair.validation?.same_outcome ? 'Same inspection outcome' : 'Compare the two recorded outcomes'}</span></p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">{(['trace', 'standard'] as const).map(source => {
      const report = pair[source].report
      return <div key={source} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <p className={`text-xs font-bold ${source === 'trace' ? 'text-indigo-600' : 'text-slate-500'}`}>{source === 'trace' ? 'With watermark' : 'Without watermark'} · {pair[source].steps.length} actions</p>
        <p className="mt-2 text-sm font-semibold text-slate-800">{decisionLabel(report?.decision)}</p>
        <p className="mt-1 text-xs text-slate-600">Current PPE: {report?.evaluation ? report.evaluation.actual_ppe_compliant ? 'meets the supplied rules' : 'does not meet the supplied rules' : 'evaluation not recorded'}.</p>
        <p className="mt-1 text-xs text-slate-600">Agent conclusion: {report?.evaluation ? report.evaluation.judgment_correct ? 'consistent with the observed evidence' : 'does not match the observed evidence' : 'not evaluated'}.</p>
        <div className="mt-2 space-y-1">{report?.checklist?.map(row => <p key={row.id} className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{ppeCheckLabel(row.id, row.label)}</span><span className={row.status === 'pass' ? 'text-emerald-600' : 'text-amber-700'}>{row.status === 'pass' ? 'Meets rule' : row.status === 'fail' ? 'Issue' : 'Unverified'}</span></p>)}</div>
      </div>
    })}</div>
    <p className="mt-2 text-xs leading-relaxed text-slate-500">Both runs use the same inspection rules. TRACE changes how an action is sampled, not the supplied probabilities or PPE evidence. Matching source keys does not prove a finding is correct.</p>
  </div>
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'not recorded'
}

export function displayFact(value: unknown): string {
  if (value == null) return 'Not established'
  if (typeof value === 'string') return value.replaceAll('_', ' ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map(displayFact).join('; ') : 'None recorded'
  if (typeof value === 'object' && 'status' in value) {
    const fact = value as { status?: string; value?: unknown }
    const status = fact.status?.replaceAll('_', ' ') ?? 'status not recorded'
    return `${displayFact(fact.value)} · ${status}`
  }
  return JSON.stringify(value)
}

export function effectiveEntryDecision(report?: IncidentReport): EntryDecision | undefined {
  return report?.effective_decision ?? report?.decision
}

export function decisionLabel(decision?: EntryDecision): string {
  const labels: Record<string, string> = { approved: 'Entry approved', denied: 'Entry denied', held: 'Entry held for review',
    passed: 'PPE check passed', not_passed: 'PPE check not passed', pending: 'Further verification needed' }
  return decision?.verdict ? labels[decision.verdict] ?? displayFact(decision.verdict)
    : decision?.action ? displayFact(decision.action) : 'Decision not recorded'
}

export function entryDecisionLabel(report?: IncidentReport): string {
  return decisionLabel(effectiveEntryDecision(report))
}

export function entryComparison(pair: PairedWorkflowData) {
  const trace = pair.trace.report
  const standard = pair.standard.report
  const available = !!trace && !!standard


  const valid = available && pair.trace.validation?.valid === true && pair.standard.validation?.valid === true
  const traceDecision = effectiveEntryDecision(trace)
  const standardDecision = effectiveEntryDecision(standard)
  const decisionsKnown = !!traceDecision && !!standardDecision
  const decisionsSame = available && decisionsKnown
    && canonical({ action: traceDecision.action, verdict: traceDecision.verdict, assessment: traceDecision.assessment })
      === canonical({ action: standardDecision.action, verdict: standardDecision.verdict, assessment: standardDecision.assessment })
  const outcomesKnown = available && Array.isArray(trace.world_events) && Array.isArray(standard.world_events)
  const outcomesSame = outcomesKnown && canonical((trace.world_events ?? []).map((event) => ({ kind: event.kind, worker_state: event.worker_state, timber_state: event.timber_state })))
    === canonical((standard.world_events ?? []).map((event) => ({ kind: event.kind, worker_state: event.worker_state, timber_state: event.timber_state })))
  return { available, valid, decisionsKnown, decisionsSame, outcomesKnown, outcomesSame }
}

export function EntryOutcomeComparison({ pair, available }: { pair: PairedWorkflowData; available: boolean }) {
  const comparison = entryComparison(pair)
  const shift = pair.task_type === 'construction_ppe_shift'
  if (!available) return <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[10px] text-slate-500">Entry decisions and recorded site outcomes appear after the replay. The two runs are allowed to differ.</p>
  if (!comparison.available) return <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[10px] text-amber-800">Entry outcome records are incomplete. No shared outcome is asserted.</p>
  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-bold text-slate-700">
        <CheckCircle2 size={14} className="text-indigo-500" /> Recorded outcomes
        <span className="ml-auto text-[9px] font-medium text-slate-500">
          {comparison.decisionsKnown ? comparison.decisionsSame ? 'Same effective decision' : 'Different effective decisions' : 'Decision not recorded'} · {comparison.outcomesKnown ? comparison.outcomesSame ? 'same site outcome' : 'different site outcomes' : 'site outcome not recorded'}
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(['trace', 'standard'] as const).map((source) => {
          const arm = pair[source]
          const report = arm.report!
          return <div key={source} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <div className={`text-[9px] font-extrabold uppercase tracking-wide ${source === 'trace' ? 'text-indigo-600' : 'text-slate-500'}`}>{source === 'trace' ? 'With watermark' : 'Without watermark'} · {pair.task_type === 'construction_ppe_shift' ? `${arm.steps.filter(step => step.event_kind !== 'injected_action').length} actions + injected fault` : `${arm.steps.length} actions`}</div>
            {shift && <p className="mt-1 text-[10px] text-slate-600">Agent recommendation: <b>{decisionLabel(report.recommendation)}</b></p>}
            <div className="mt-1 text-[12px] font-bold text-slate-800">{shift ? 'Effective decision: ' : ''}{entryDecisionLabel(report)}</div>
            {shift && !!report.fault_injections?.length && <p className="mt-1 text-[9px] font-semibold text-amber-700">Injected controller transaction · not an agent sample</p>}
            <p className="mt-1 text-[10px] text-slate-500">Agent assessment: {displayFact((shift ? report.recommendation : effectiveEntryDecision(report))?.assessment)}</p>
            <p className={`mt-1 text-[10px] ${report.safety?.compliant === false ? 'text-amber-700' : 'text-slate-600'}`}>
              {report.safety ? report.safety.compliant ? 'No rule violation flagged in this record.' : `${report.safety.violations?.length ?? 0} safety-rule issue(s) flagged.` : 'Safety evaluation not recorded.'}
            </p>
            <details className="mt-2 text-[10px] text-slate-500">
              <summary className="cursor-pointer font-semibold">Site events · not Agent actions</summary>
              <ul className="mt-2 space-y-1.5">{report.world_events?.map((event) => <li key={event.id}><span className="mr-1 text-slate-400">{event.timestamp}</span>{event.title ?? displayFact(event.kind)}{event.description ? ` — ${event.description}` : ''}</li>)}</ul>
              {!report.world_events?.length && <p className="mt-1">No site events recorded.</p>}
            </details>
          </div>
        })}
      </div>
      <p className="mt-2 text-[9px] text-slate-500">A completed execution is not necessarily a safe decision. TRACE preserves the supplied probabilities; it does not guarantee identical choices or consequences in two runs.</p>
      {shift && <p className="mt-1 text-[9px] text-slate-500">The fault and physical events are controlled scenario records, not watermarked choices. PPE absence is not asserted to be the sole cause of injury.</p>}
      {!comparison.valid && <p className="mt-1 text-[9px] text-amber-700">Execution-record validation is unavailable or needs attention.</p>}
    </div>
  )
}

function OutcomeComparison({ pair }: { pair: PairedWorkflowData }) {
  const construction = pair.task_type === 'construction_ppe_incident_review'
  const traceReport = pair.trace.report
  const standardReport = pair.standard.report
  const reportsAvailable = !!traceReport && !!standardReport
  const factsSame = reportsAvailable && canonical(traceReport.facts) === canonical(standardReport.facts)
  const bothSucceeded = pair.trace.success && pair.standard.success
  const pathsDiffer = canonical(pair.trace.steps.map((step) => step.action)) !== canonical(pair.standard.steps.map((step) => step.action))
  const verified = construction
    ? bothSucceeded && reportsAvailable && factsSame
      && pair.trace.validation?.valid === true && pair.standard.validation?.valid === true
      && traceReport.status === 'complete' && standardReport.status === 'complete'
      && pair.validation?.same_facts === true && pair.validation?.both_valid === true && pair.validation?.same_outcome === true
    : bothSucceeded && pair.trace.required_done === pair.trace.required_total
      && pair.standard.required_done === pair.standard.required_total
  const factKeys = [...new Set([...Object.keys(traceReport?.facts ?? {}), ...Object.keys(standardReport?.facts ?? {})])]
  const issues = [...new Set([
    ...(pair.validation?.issues ?? []), ...(pair.trace.validation?.issues ?? []), ...(pair.standard.validation?.issues ?? []),
  ])]
  return (
    <div className={[
      'mt-2.5 rounded-2xl border px-3 py-2.5',
      verified ? 'border-emerald-200 bg-emerald-50/75 text-emerald-800' : 'border-amber-200 bg-amber-50/75 text-amber-800',
    ].join(' ')}>
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide opacity-70">Recorded outcomes · both runs</div>
      <div className="flex flex-wrap items-center gap-2">
        {verified ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        <div className="flex-1">
          <div className="text-[11.5px] font-extrabold">
            {construction
              ? verified ? `${pathsDiffer ? 'Different review paths' : 'Same review path'}. Same verified facts.` : reportsAvailable ? 'Review outcomes need attention.' : 'Report comparison not available.'
              : verified ? 'Both runs completed the required checks.' : 'The recorded runs did not both complete.'}
          </div>
          <div className="mt-0.5 text-[10px] opacity-80">
            With watermark: {pair.trace.required_done}/{pair.trace.required_total} checks · without: {pair.standard.required_done}/{pair.standard.required_total} checks.
            {reportsAvailable && ` Report facts ${factsSame ? 'match' : 'differ'}.`}
          </div>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[9.5px] font-bold">
          {verified ? construction ? 'review complete ✓' : 'checks complete ✓' : 'see recorded outcome'}
        </span>
      </div>
      {reportsAvailable && (
        <details className="mt-2 text-[10px]">
          <summary className="cursor-pointer font-semibold">Compare the report facts ({factKeys.length})</summary>
          <div className="mt-2 overflow-x-auto rounded-xl bg-white p-2">
            <table className="w-full text-left text-[9px] text-slate-600">
              <thead><tr><th className="p-1">Recorded fact</th><th className="p-1">With watermark</th><th className="p-1">Without watermark</th></tr></thead>
              <tbody>{factKeys.map((key) => <tr key={key} className="border-t border-slate-100">
                <td className="p-1 font-medium">{key.replaceAll('_', ' ').replaceAll('.', ' · ')}</td>
                <td className="p-1">{displayFact(traceReport.facts[key])}</td>
                <td className="p-1">{displayFact(standardReport.facts[key])}</td>
              </tr>)}</tbody>
            </table>
            <p className="mt-2 text-[9px] text-slate-500">Report status · with: {traceReport.status.replaceAll('_', ' ')} · without: {standardReport.status.replaceAll('_', ' ')}</p>
            {(traceReport.unresolved?.length || standardReport.unresolved?.length) ? <p className="mt-1 text-[9px] text-amber-700">Unresolved findings · with: {displayFact(traceReport.unresolved)} · without: {displayFact(standardReport.unresolved)}</p> : null}
          </div>
        </details>
      )}
      {!!issues.length && <p className="mt-2 text-[9px]">{issues.join(' · ')}</p>}
    </div>
  )
}
