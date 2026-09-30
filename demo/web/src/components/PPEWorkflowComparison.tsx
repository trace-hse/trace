import { useEffect, useRef, useState } from 'react'
import { BarChart3, Camera, Check, ChevronRight, Dices, KeyRound, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { DecisionInspector, trajectorySource } from './PairedWorkflowStrip'
import type { PairedTrajectoryStep, PairedWorkflowData } from './PairedWorkflowStrip'
import { PPE_PHASES, ppeActionMethodLabel } from '../lib/ppeInspection'
import { inspectionLabel, matchedRequirement, requirementKey } from '../lib/ppePlayback'
import type { ActionPlayback, PlaybackArm, PairedPlaybackState } from '../lib/ppePlayback'
import { choiceReplayCandidates, ORIGINAL_COMPARISON_ID, registeredChoiceReplayCandidate } from '../lib/ppeChoiceReplay'
import PPEWatermarkStory from './PPEWatermarkStory'
import PaperRobustnessPreview from './PaperRobustnessPreview'
import PPEPhotoWatermark from './PPEPhotoWatermark'
import PPEPhotoCaptureDialog from './PPEPhotoCaptureDialog'
import './PPEWorkflowComparison.css'

interface Props {
  pair: PairedWorkflowData
  current: number
  completedIndex: number
  running: boolean
  fullReplayComplete?: boolean
  playback: ActionPlayback | null
  watched: PairedPlaybackState['watched']
  onPlay: (source: PlaybackArm, index: number) => void
  onSelectCheck?: (key: string) => void
}

type WatermarkKey = { id: string; label: string }
type InjectionPhase = 'setup' | 'injected'

function WatermarkInjection({ watermarkKey, phase, onInject, onChange }: {
  watermarkKey?: WatermarkKey
  phase: InjectionPhase
  onInject: () => void
  onChange: () => void
}) {
  const injected = phase === 'injected' && !!watermarkKey
  return <div className="pwc-key-injection" data-injection-state={injected ? 'injected' : 'setup'}>
    <div className="pwc-key-injection-copy">
      <span><KeyRound size={13} />Watermark key</span>
      <strong>{injected ? `${watermarkKey.label} injected` : watermarkKey ? `Inject the watermark with ${watermarkKey.label}` : 'Recorded key unavailable'}</strong>
      <small>{injected ? 'The complete recorded workflow is shown below.' : watermarkKey ? 'Apply the recorded demo key to reveal the complete workflow.' : 'This record has no valid key to inject.'}</small>
    </div>
    {watermarkKey && <span className="pwc-key-selection" data-selected-watermark-key={watermarkKey.label}>
      {watermarkKey.label}{injected && <Check size={13} />}
    </span>}
    <button type="button" className={injected ? 'pwc-key-change' : 'pwc-key-inject'}
      onClick={injected ? onChange : onInject} disabled={!watermarkKey}
      data-inject-watermark-key={watermarkKey?.label ?? ''} aria-expanded={injected}>
      {injected ? 'Change key' : <><KeyRound size={14} />Inject watermark</>}
    </button>
  </div>
}

function ArmWorkflow({ source, steps, selected, next, playback, revealed, onSelect, onPlay, onDetails, onNext, onPhoto, watermarkKey, injectionPhase = 'injected', onInjectWatermark, onChangeWatermark }: {
  source: PlaybackArm; steps: PairedTrajectoryStep[]; selected?: PairedTrajectoryStep; playback: ActionPlayback | null;
  next?: PairedTrajectoryStep;
  revealed: (step: PairedTrajectoryStep) => boolean; onSelect: (step: PairedTrajectoryStep) => void;
  onPlay: () => void; onDetails: () => void; onNext: (step: PairedTrajectoryStep) => void;
  onPhoto: (step: PairedTrajectoryStep) => void;
  watermarkKey?: WatermarkKey;
  injectionPhase?: InjectionPhase;
  onInjectWatermark?: () => void;
  onChangeWatermark?: () => void;
}) {
  const trace = source === 'trace'
  const workflowVisible = !trace || injectionPhase === 'injected'
  const strip = useRef<HTMLDivElement>(null)
  const active = playback?.source === source && playback.index === selected?.i
  const playing = active && ['restoring', 'playing'].includes(playback.status)
  const workflowLabel = trace ? 'Watermarked workflow' : 'Original workflow'
  useEffect(() => {
    const item = strip.current?.querySelector<HTMLElement>('[aria-current="step"]')
    if (item && strip.current) strip.current.scrollLeft = item.offsetLeft - strip.current.offsetLeft - 12
  }, [selected?.i, workflowVisible])
  return <section aria-label={workflowLabel} data-comparison-box={source}
    data-workflow-visible={workflowVisible} className={`rounded-xl border p-3 ${trace ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${trace ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-white'}`}>{trace ? 2 : 1}</span>
      <h3 className={`flex items-center gap-1.5 text-sm font-bold ${trace ? 'text-indigo-700' : 'text-slate-700'}`}>
        {trace ? <ShieldCheck size={15} /> : <Dices size={15} />}{workflowLabel}
      </h3>
      <span className="text-xs text-slate-400">{workflowVisible ? selected ? `Step ${selected.i + 1} / ${steps.length}` : 'No matching action' : watermarkKey ? `Inject ${watermarkKey.label} to begin` : 'Key unavailable'}</span>
      {workflowVisible && <div className="ml-auto flex items-center gap-1.5">
        <button type="button" onClick={onDetails} disabled={!selected} aria-label={`${workflowLabel}: view action probabilities`}
          title="View this action's probabilities and how it was chosen" aria-haspopup="dialog" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:text-indigo-600 disabled:opacity-35"><BarChart3 size={16} /></button>
        <button type="button" disabled={!selected} onClick={onPlay} aria-label={`Play ${workflowLabel.toLowerCase()} step ${selected ? selected.i + 1 : ''}`}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 ${trace ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-700 hover:bg-slate-800'}`}>
          {playing ? <RotateCcw size={14} /> : <Play size={14} />}{playing ? 'Replay step' : active && playback.status === 'complete' ? 'Play again' : 'Play this step'}
        </button>
        <button type="button" onClick={() => next && onNext(next)} disabled={!next} aria-label={`Next ${trace ? 'watermarked' : 'original'} action`}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:text-indigo-600 disabled:opacity-30"><ChevronRight size={16} /></button>
      </div>}
    </div>
    {trace ? <WatermarkInjection watermarkKey={watermarkKey} phase={injectionPhase}
      onInject={() => onInjectWatermark?.()} onChange={() => onChangeWatermark?.()} />
      : <div className="mt-2 flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/65 px-2.5 py-1.5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Dices size={13} />Watermark</span>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">Off</span>
        <span className="text-slate-400">Standard sampling · no key added</span>
      </div>}
    <div ref={strip} hidden={!workflowVisible} className={`relative mt-2 items-stretch gap-2 overflow-x-auto pb-1 ${workflowVisible ? `flex${trace ? ' pwc-injected-content' : ''}` : ''}`}
      aria-label={`${workflowLabel} recorded actions`}>
      {steps.map((step, index) => <div key={step.i} className="flex shrink-0 items-center gap-2">
        {index > 0 && <ChevronRight size={12} className="text-slate-300" aria-hidden="true" />}
        <button type="button" onClick={() => onSelect(step)} aria-current={step.i === selected?.i ? 'step' : undefined}
          aria-haspopup="dialog" title="Click to see action probabilities and why this action was chosen"
          className={`flex w-48 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${step.i === selected?.i
            ? trace ? 'border-indigo-400 bg-white text-indigo-700' : 'border-slate-500 bg-white text-slate-800'
            : 'border-slate-200 bg-white/70 text-slate-500 hover:border-indigo-300'}`}>
          <span className="text-xs tabular-nums text-slate-400">{step.i + 1}</span>
          <span className="min-w-0">
            <span className="block leading-5">{inspectionLabel(step, revealed(step))}</span>
            {!/^record_ppe_/.test(step.action) && <span className="mt-1 block text-[11px] leading-4 text-slate-400">{ppeActionMethodLabel(step.action)}</span>}
          </span>
          {revealed(step) && <Check size={12} className="ml-auto shrink-0 text-emerald-600" />}
        </button>
        {step.requirement_id === 'initial_workwear' && <>
          <ChevronRight size={12} className="text-slate-300" aria-hidden="true" />
          <button type="button" onClick={() => onPhoto(step)} data-photo-capture-action={source} data-photo-anchor-step={step.i}
            aria-label={`${workflowLabel}: Take photo`} aria-haspopup="dialog" title="Take an inspection photo"
            className={`flex w-48 shrink-0 items-center gap-2 rounded-lg border bg-white/70 px-3 py-2 text-left text-sm transition-colors ${trace
              ? 'border-indigo-200 text-indigo-700 hover:border-indigo-400' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
            <Camera size={17} className="shrink-0" aria-hidden="true" />
            <span><span className="block leading-5">Take photo</span><span className="mt-1 block text-[11px] leading-4 text-slate-400">Sample photo</span></span>
          </button>
        </>}
      </div>)}
      {!steps.length && <p className="py-2 text-sm text-slate-400">No recorded action in this stage.</p>}
    </div>
    {workflowVisible && <p className="mt-2 text-xs leading-5 text-slate-500">Click a check to see how it was chosen. Take photo opens the photo preview. Use Play this step to watch the check.</p>}
  </section>
}

export function ActionDetailsDialog({ source, step, phaseTitle, showResult, onClose }: {
  source: PlaybackArm
  step: PairedTrajectoryStep
  phaseTitle: string
  showResult: boolean
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={dialog} className="pwc-decision-dialog"
    aria-label={`${source === 'trace' ? 'Watermarked workflow' : 'Original workflow'}: action details, step ${step.i + 1}`}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last && first) {
        event.preventDefault(); first.focus()
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <DecisionInspector source={source} step={step} phaseTitle={phaseTitle} showResult={showResult} onClose={onClose} />
  </dialog>
}

export default function PPEWorkflowComparison({ pair, current, completedIndex, running, fullReplayComplete = false, playback, watched, onPlay, onSelectCheck }: Props) {
  const [phaseId, setPhaseId] = useState(PPE_PHASES[0].id)
  const [selectedRequirementKey, setSelectedRequirementKey] = useState(() => requirementKey(pair.standard.steps[0]))
  const replayCandidates = choiceReplayCandidates(pair)
  const appliedCandidate = registeredChoiceReplayCandidate(pair)
  const appliedCandidateIndex = replayCandidates.findIndex(candidate => candidate.agent_id === appliedCandidate?.agent_id)
  const appliedCandidateLabel = appliedCandidateIndex >= 0 ? `Key ${String.fromCharCode(65 + appliedCandidateIndex)}` : ''
  const [injectionPhase, setInjectionPhase] = useState<InjectionPhase>('setup')
  const [verificationCandidateId, setVerificationCandidateId] = useState(() => appliedCandidate?.agent_id ?? replayCandidates[0]?.agent_id ?? '')
  const [details, setDetails] = useState<PlaybackArm | null>(null)
  const [following, setFollowing] = useState(true)
  const [photoOpenRequest, setPhotoOpenRequest] = useState(0)
  const [photoCapture, setPhotoCapture] = useState<{ source: PlaybackArm; step: PairedTrajectoryStep } | null>(null)
  const lastPlaybackToken = useRef<string | null>(null)
  const fullComplete = fullReplayComplete && !running && completedIndex === pair.trace.steps.length - 1
  const selected = matchedRequirement(pair, selectedRequirementKey)
  const phase = PPE_PHASES.find(item => item.id === phaseId) ?? PPE_PHASES[0]
  const revealed = (source: PlaybackArm, step?: PairedTrajectoryStep) => !!step && (
    watched[source].includes(step.i) || fullComplete || source === 'trace' && step.i <= completedIndex
  )
  const inspected = details ? selected[details] : undefined

  useEffect(() => {
    setInjectionPhase('setup')
    setVerificationCandidateId(appliedCandidate?.agent_id ?? '')
    setDetails(null)
    setPhotoCapture(null)
  }, [pair.game_id, appliedCandidate?.agent_id])

  useEffect(() => {
    if (verificationCandidateId !== ORIGINAL_COMPARISON_ID && !replayCandidates.some(candidate => candidate.agent_id === verificationCandidateId)) {
      setVerificationCandidateId(appliedCandidate?.agent_id ?? replayCandidates[0]?.agent_id ?? '')
    }
  }, [pair, verificationCandidateId, appliedCandidate?.agent_id, replayCandidates[0]?.agent_id])

  useEffect(() => { onSelectCheck?.(selectedRequirementKey) }, [selectedRequirementKey, onSelectCheck])

  useEffect(() => {
    if (!playback || playback.token === lastPlaybackToken.current) return
    lastPlaybackToken.current = playback.token
    const step = pair[playback.source].steps.find(step => step.i === playback.index)
    if (step) { setPhaseId(step.stage_id ?? PPE_PHASES[0].id); setSelectedRequirementKey(requirementKey(step)); setDetails(null) }
  }, [playback, pair])

  useEffect(() => {
    if (playback || !running || !following) return
    const step = pair.trace.steps.find(step => step.i === current)
    if (step) { setPhaseId(step.stage_id ?? PPE_PHASES[0].id); setSelectedRequirementKey(requirementKey(step)); setDetails(null) }
  }, [current, running, following, pair, !!playback])

  function select(step: PairedTrajectoryStep) {
    setFollowing(false)
    setSelectedRequirementKey(requirementKey(step)); setPhaseId(step.stage_id ?? phaseId); setDetails(null)
  }
  function selectPhase(id: string) {
    const step = pair.standard.steps.find(step => step.stage_id === id) ?? pair.trace.steps.find(step => step.stage_id === id)
    if (step) select(step)
  }
  function injectWatermark() {
    if (!appliedCandidate) return
    setInjectionPhase('injected')
    setVerificationCandidateId(appliedCandidate.agent_id)
    setDetails(null)
  }
  function changeWatermark() {
    setInjectionPhase('setup')
    setVerificationCandidateId(appliedCandidate?.agent_id ?? '')
    setDetails(null)
    setPhotoCapture(null)
  }

  return <section id="ppe-workflow-comparison" aria-label="Compare inspection workflows" className="scroll-mt-20 rounded-[1.4rem] border border-slate-200 bg-white/90 p-3.5 shadow-[0_16px_50px_-38px_rgba(15,23,42,.35)]">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="text-base font-bold text-slate-800">Compare the inspection</h2>
      <p className="text-xs text-slate-500">Two recorded runs · one shared 3D scene</p>
      {running && !following && <button type="button" onClick={() => setFollowing(true)} className="ml-auto rounded-full border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-600">Follow replay</button>}
      {playback && <span role="status" className="ml-auto text-xs font-medium text-indigo-600">{playback.source === 'trace' ? 'Watermarked workflow' : 'Original workflow'} · step {playback.index + 1} · {playback.status === 'restoring' ? 'restoring' : playback.status === 'playing' ? 'playing' : playback.status === 'error' ? 'stopped; retry this action' : 'complete'}</span>}
    </div>
    <nav aria-label="Shared inspection stages" className="mb-3 flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-50 p-1">
      {PPE_PHASES.map((item, index) => <button type="button" key={item.id} onClick={() => selectPhase(item.id)} aria-current={phaseId === item.id ? 'step' : undefined}
        className={`flex min-w-max flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${phaseId === item.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white'}`}>
        <span className="text-slate-400">{index + 1}</span>{item.title}
      </button>)}
    </nav>
    <div className="pwc-flow" data-comparison-flow>
      {(['standard', 'trace'] as const).map(source => <div key={source} className="pwc-flow-item" data-flow-item={source === 'standard' ? '1' : '2'}>
        <ArmWorkflow source={source} steps={pair[source].steps} selected={selected[source]}
          next={selected[source] ? pair[source].steps[pair[source].steps.findIndex(step => step.i === selected[source]!.i) + 1] : undefined}
          playback={playback} revealed={step => revealed(source, step)} onSelect={step => {
            if (source === 'trace' && injectionPhase !== 'injected') return
            select(step); setDetails(source)
          }}
          onNext={select}
          onPlay={() => selected[source] && onPlay(source, selected[source]!.i)}
          onDetails={() => setDetails(previous => previous === source ? null : source)}
          onPhoto={step => {
            if (source === 'trace' && injectionPhase !== 'injected') return
            select(step); setPhotoCapture({ source, step })
          }}
          watermarkKey={source === 'trace' && appliedCandidate ? {
            id: appliedCandidate.agent_id,
            label: appliedCandidateLabel,
          } : undefined}
          injectionPhase={source === 'trace' ? injectionPhase : 'injected'}
          onInjectWatermark={source === 'trace' ? injectWatermark : undefined}
          onChangeWatermark={source === 'trace' ? changeWatermark : undefined} />
      </div>)}
      <div className="pwc-flow-item" data-flow-item="3">
        <section data-comparison-box="difference" className="rounded-xl border border-indigo-100 bg-white p-3.5">
          {injectionPhase === 'injected' && appliedCandidate ? <PPEWatermarkStory pair={pair} selected={selected} revealed={revealed} onSelect={select}
            appliedCandidateId={appliedCandidate.agent_id} selectedCandidateId={verificationCandidateId}
            onCandidateChange={setVerificationCandidateId}>
              <PaperRobustnessPreview />
            </PPEWatermarkStory> : <><div className="pwc-verification-waiting">
              <span className="pwc-waiting-number">3</span>
              <div><strong>Check the watermark</strong><small>Inject Key A in step 2 to check the source.</small></div>
              <span>Waiting for key</span>
            </div><PaperRobustnessPreview /></>}
        </section>
      </div>
      <div className="pwc-flow-item" data-flow-item="4">
        <PPEPhotoWatermark key={pair.game_id} steps={pair.trace.steps} openRequest={photoOpenRequest}
          onShowStep={step => { select(step); document.getElementById('ppe-workflow-comparison')?.scrollIntoView({ block: 'start' }) }} />
      </div>
    </div>
    {details && inspected && (details !== 'trace' || injectionPhase === 'injected') && <ActionDetailsDialog
      key={`${pair.game_id}:${details}:${inspected.i}`} source={details} step={inspected} phaseTitle={phase.title}
      showResult={revealed(details, inspected)} onClose={() => setDetails(null)} />}
    {photoCapture && (photoCapture.source !== 'trace' || injectionPhase === 'injected') && <PPEPhotoCaptureDialog
      key={`${pair.game_id}:${photoCapture.source}:${photoCapture.step.i}`} source={photoCapture.source} step={photoCapture.step}
      onClose={() => setPhotoCapture(null)} onOpenWatermarkDemo={photoCapture.source === 'trace' ? () => {
        setPhotoCapture(null); setPhotoOpenRequest(value => value + 1)
      } : undefined} />}
    <details className="mt-3 text-xs leading-5 text-slate-400"><summary className="cursor-pointer">About these records · {trajectorySource(pair).label} · PPE-4B.2</summary>
      <p className="mt-1">Synthetic pre-entry PPE inspection. Action probabilities are normalized model-elicited weights over legal actions, not token probabilities. Single-step playback loads an existing record; it does not run the model again or add to the full TRACE detection log.</p>
    </details>
  </section>
}
