import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { ArrowUp, Check, ChevronDown, Focus, Maximize2, Minimize2, MousePointer2, Play, Tablet, View } from 'lucide-react'
import type { GroupView } from './GroupCard'
import type { PairedWorkflowData } from './PairedWorkflowStrip'
import ConstructionScene from '../three/ConstructionScene'
import type { ConstructionCameraMode } from '../three/ConstructionScene'
import { reviewResumePose } from '../lib/constructionScene'
import type { EvidenceStationId } from '../lib/constructionScene'
import { ppeReplayFrame, ppeMotionSpec, ppeActionMethodLabel, ppeCheckLabel } from '../lib/ppeInspection'
import { actionPlaybackFrame, inspectionLabel, matchedRequirement } from '../lib/ppePlayback'
import type { ActionPlayback, PlaybackArm } from '../lib/ppePlayback'

export default function PPEInspectionScene({ pair, groups, running, caseId, speed = 1, replayEpoch = 0, onActionComplete, completedIndex = -1, playback = null, onPlaybackComplete, selectedCheck, onPlay }: {
  pair: PairedWorkflowData | null; groups: GroupView[]; running?: boolean; caseId?: string;
  speed?: number; replayEpoch?: number; onActionComplete?: (i: number) => void; completedIndex?: number;
  playback?: ActionPlayback | null; onPlaybackComplete?: (token: string) => void;
  selectedCheck?: string; onPlay?: (source: PlaybackArm, index: number) => void;
}) {
  const reduced = !!useReducedMotion()
  const matches = caseId === pair?.game_id || caseId === pair?.case_id
  const manual = matches && pair && playback ? actionPlaybackFrame(pair, playback) : null
  const steps = manual?.steps ?? (matches ? pair?.trace.steps ?? [] : [])
  const liveGroups = matches ? groups : []
  const current = liveGroups[liveGroups.length - 1]
  const step = manual?.step ?? steps.find(s => s.i === current?.i && s.action === current?.chosen)
  const token = manual && playback ? playback.token : `${caseId}:${replayEpoch}:${step?.i ?? 'preview'}:${step?.action ?? ''}`
  const tokenRef = useRef(token)
  tokenRef.current = token
  const [camera, setCamera] = useState<ConstructionCameraMode>('overview')
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const resultReady = manual ? manual.complete : !!step && step.i <= completedIndex
  const frame = manual ? { state: manual.state, checklist: manual.checklist, completed: manual.prefix.length } : ppeReplayFrame(steps, liveGroups, resultReady)
  const completedStep = manual ? resultReady ? step : manual.previous : frame.completed ? steps[frame.completed - 1] : undefined
  const poseGroups = manual ? manual.prefix.map(s => ({ i: s.i, chosen: s.action, result: s.result, observations: [] })) : liveGroups.slice(0, frame.completed)
  const restoring = !!manual && playback?.status === 'restoring'
  const actionRunning = manual ? playback?.status === 'playing' : !!running
  const motionSpec = ppeMotionSpec(step)
  const tablet = motionSpec?.mode !== 'inspect'
  const variant = caseId?.includes('CS02') ? 'timber-yard' : 'scaffold'
  const comparison = matches && pair && selectedCheck ? matchedRequirement(pair, selectedCheck) : null
  const complete = useCallback((value: string) => {
    if (step && value === tokenRef.current) {
      if (manual) onPlaybackComplete?.(value)
      else onActionComplete?.(step.i)
    }
  }, [step?.i, !!manual, onActionComplete, onPlaybackComplete])

  useEffect(() => { setCamera('overview') }, [caseId, replayEpoch])
  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    expandButton.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
      if (event.key !== 'Tab') return
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), summary') ?? [])]
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); previousFocus?.focus({ preventScroll: true }) }
  }, [expanded])

  function view(next: ConstructionCameraMode) { setCamera(next); setRevision(v => v + 1) }
  return <section id="ppe-inspection-scene" ref={panel} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined}
    aria-label="PPE inspection replay" className={expanded ? 'fixed inset-4 z-[100] flex flex-col overflow-auto rounded-2xl bg-white shadow-2xl' : 'flex h-full min-h-0 flex-col bg-white'}>
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-600">PPE check</span>
      <p className="text-sm font-semibold text-slate-700">{pair?.case_title ?? (variant === 'scaffold' ? 'Scaffold checkpoint' : 'Timber-yard checkpoint')}</p>
      <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${manual && playback?.source === 'standard' ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-600'}`}>{manual ? `${playback?.source === 'trace' ? 'Watermarked workflow' : 'Original workflow'} · step ${step!.i + 1}` : running ? 'Replaying full TRACE' : frame.completed === steps.length && steps.length ? 'Inspection saved' : 'Recorded inspection'}</span>
      <button ref={expandButton} onClick={() => setExpanded(v => !v)} aria-label={expanded ? 'Exit expanded view' : 'Expand inspection scene'} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
    </header>
    {comparison && onPlay && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5" aria-label="Play the same check in either run">
      <span className="mr-1 text-xs font-semibold text-slate-500">Selected check: {inspectionLabel(comparison.standard ?? comparison.trace).split(' · ')[0]}</span>
      {(['standard', 'trace'] as const).map(source => <button type="button" key={source} disabled={!comparison[source]}
        onClick={() => comparison[source] && onPlay(source, comparison[source]!.i)}
        aria-label={`Scene: play ${source === 'trace' ? 'watermarked' : 'original'} workflow`}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-35 ${source === 'trace' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700'}`}>
        <Play size={13} />{source === 'trace' ? 'Watermarked workflow' : 'Original workflow'} · step {comparison[source] ? comparison[source]!.i + 1 : '—'}
      </button>)}
      <button type="button" onClick={() => { setExpanded(false); document.getElementById('ppe-workflow-comparison')?.scrollIntoView({ block: 'start', behavior: 'instant' }) }}
        className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white"><ArrowUp size={13} />Back to workflows</button>
    </div>}
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] max-[800px]:grid-cols-1 max-[800px]:overflow-y-auto">
      <div className="relative min-h-[340px] overflow-hidden bg-[#eeece6]">
        <ConstructionScene key={`${caseId}:${replayEpoch}`} variant={variant} inspection ppe={frame.state?.ppe}
          mode={step ? 'review' : 'preview'} actionToken={token} actionSpec={motionSpec} actionFinished={resultReady}
          robotResetKey={manual ? token : 'full-replay'} paused={!!step && !actionRunning && !resultReady}
          stationId={(step?.station_id ?? 'entry') as EvidenceStationId} command={step?.action}
          initialRobotPose={reviewResumePose(steps.map(s => ({ ...s, scene_action: ppeMotionSpec(s) })), poseGroups)}
          replayEpoch={replayEpoch} cameraMode={camera} cameraRevision={revision} speed={speed} reducedMotion={reduced}
          onCameraInteract={() => setCamera('free')} onActionComplete={complete} />
        {restoring && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-[#eeece6]/95 text-sm font-medium text-slate-600">Restoring this run’s starting state…</div>}
        <div className="absolute left-3 right-3 top-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs text-slate-600">Worker at checkpoint · equipment revision {frame.state?.ppe_revision ?? 1}</span>
          <div className="flex rounded-full bg-white/90 p-1">
            {([['overview', View, 'Overview'], ['follow', Focus, 'Follow']] as const).map(([mode, Icon, label]) =>
              <button key={mode} onClick={() => view(mode)} className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${camera === mode ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500'}`}><Icon size={12} />{label}</button>)}
          </div>
        </div>
        <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1.5 text-xs text-slate-500"><MousePointer2 size={12} />Drag to rotate · scroll to zoom</span>
      </div>
      <aside className="min-h-0 overflow-y-auto border-l border-slate-100 bg-[#fafbfe] p-4" aria-live="polite">
        <p className="text-xs font-semibold text-indigo-500">{step ? `ACTION ${step.i + 1} / ${steps.length}` : 'BEFORE THE INSPECTION'}</p>
        <h3 className="mt-2 text-base font-semibold leading-snug text-slate-800">{step ? inspectionLabel(step, resultReady) : 'Check clothes and shoes'}</h3>
        {step && tablet && <p className="mt-2 flex items-center gap-1.5 text-xs text-indigo-500"><Tablet size={13} />Reading or recording on the tablet</p>}
        {step && !/^record_ppe_/.test(step.action) && <p className="mt-2 text-xs leading-5 text-slate-500">{ppeActionMethodLabel(step.action)}</p>}
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{resultReady ? step?.result : manual && playback?.status === 'error' ? 'This action did not finish. Its new finding is still hidden. Press Play this step to retry.' : restoring ? 'Loading the equipment and evidence as they were before this action.' : step ? 'The agent is carrying out this action. Its recorded finding appears when the action finishes.' : 'Choose Play this step above to compare an action, or Replay full TRACE to watch the entire inspection.'}</p>
        {manual && <p className="mt-2 text-xs leading-5 text-slate-400">Single-action replay. Earlier steps are restored from this run’s record, not replayed or added to the detection log.</p>}
        {!resultReady && completedStep?.result && <details className="mt-3 rounded-xl border border-indigo-100 bg-white p-3"><summary className="cursor-pointer text-xs font-semibold text-indigo-500">{manual ? 'Previous finding in this record' : 'Latest completed finding'}</summary><p className="mt-2 text-sm leading-relaxed text-slate-600">{completedStep.result}</p></details>}
        <div className="mt-5 space-y-2">
          <p className="text-xs font-bold text-slate-500">Current evidence checklist</p>
          {frame.checklist.length ? frame.checklist.map(row => <details key={row.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-700">
              <span className={`h-2 w-2 shrink-0 rounded-full ${row.status === 'pass' ? 'bg-emerald-500' : row.status === 'fail' ? 'bg-amber-500' : 'bg-slate-300'}`} />
              {ppeCheckLabel(row.id, row.label)}<span className="ml-auto text-[11px] text-slate-400">{row.status === 'unknown' ? 'Unverified' : row.status === 'pass' ? 'Meets rule' : 'Issue'}</span><ChevronDown size={11} />
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{row.finding}</p>
            {!!row.evidence_ids.length && <p className="mt-2 break-all text-[11px] text-slate-400">{row.observed_at} · {row.evidence_ids.join(', ')}</p>}
          </details>) : <p className="text-xs text-slate-400">No current findings recorded yet.</p>}
        </div>
        {completedStep?.k === 2 && (!manual || resultReady) && <p className="mt-4 rounded-lg bg-violet-50 p-3 text-xs leading-relaxed text-violet-600">Layer 2 adds a confirmation entry within the same log. The check is performed once.</p>}
        {!manual && frame.completed === steps.length && !!steps.length && <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-indigo-600"><Check size={14} />Report and evidence references saved</p>}
        <p className="mt-5 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-400">3D illustrates the synthetic execution record, not camera footage. Visible appearance alone does not certify PPE protection.</p>
      </aside>
    </div>
  </section>
}
