import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Play, KeyRound, Radio, ShieldCheck, Loader2, WifiOff, Gauge, ArrowDown,
  Home, House, Factory, BookOpen, ChevronDown,
} from 'lucide-react'
import { navigate } from './Router'
import { api, subscribe, API_BASE } from './api'
import type { DetectResult, GameInfo, Health, MatrixRow } from './api'
import {
  loadStaticManifest, loadStaticGame, staticHealth, staticAttack, staticMatrix,
} from './lib/staticSource'
import type { StaticGame } from './lib/staticSource'
import VoxelRoom from './three/VoxelRoom'
import type { SceneState } from './three/VoxelRoom'
import ConstructionReviewScene from './components/ConstructionReviewScene'
import PPEInspectionScene from './components/PPEInspectionScene'
import PPEWorkflowComparison from './components/PPEWorkflowComparison'
import { usePPEPlayback } from './lib/usePPEPlayback'
import type { PlaybackArm } from './lib/ppePlayback'
import { PPE_TASK } from './lib/ppeInspection'
import ConstructionWorkflowPending from './components/ConstructionWorkflowPending'
import EntryAttributionPanel from './components/EntryAttributionPanel'
import GroupCard from './components/GroupCard'
import type { GroupView } from './components/GroupCard'
import DetectPanel from './components/DetectPanel'
import AttackPanel from './components/AttackPanel'
import RoomLegend from './components/RoomLegend'
import WorkflowStrip from './components/WorkflowStrip'
import PairedWorkflowStrip from './components/PairedWorkflowStrip'
import type { PairedWorkflowData } from './components/PairedWorkflowStrip'
import GuidedRace from './components/GuidedRace'
import { GuidedBanner, GuidedDetect, GuidedAttack } from './components/GuidedPanels'
import { buildWorkflow } from './lib/guidedSteps'
import type { WorkflowAction } from './lib/guidedSteps'
import Logo from './components/Logo'
import { parseCommand } from './lib/room'
import { useI18n } from './i18n'
import { asset } from './lib/asset'
import { CONSTRUCTION_CASES, constructionPolicyCopy } from './site/content'

function demoOptions() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '')
}

function syncDemoAddress(scenario: 'alfworld' | 'hse', gameId: string) {
  const url = new URL(window.location.href)
  const params = demoOptions()
  params.set('scenario', scenario)
  if (gameId) {
    const sample = scenario === 'hse' ? CONSTRUCTION_CASES.find((item) => item.gameId === gameId) : undefined
    params.set('case', sample?.key ?? gameId)
  } else params.delete('case')
  url.hash = `/demo?${params.toString()}`

  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function replayOptions(rows: any[], scenario: 'alfworld' | 'hse'): any[] {
  if (scenario !== 'hse') return rows.filter((row) => (row.scenario ?? 'alfworld') === scenario)
  return CONSTRUCTION_CASES.map((sample) => {
    const recorded = rows.find((row) => row.game_id === sample.gameId
      && row.task_type === sample.taskType && (['api', 'codex_llm'].includes(constructionPolicyCopy(row).source ?? '')
        || (row.task_type === 'construction_ppe_shift' && constructionPolicyCopy(row).source === 'scenario_policy' && row.run_kind === 'controlled_fault_demo')))
    return recorded ? { ...recorded, case_title: recorded.case_title ?? sample.title, previewOnly: false } : {
      game_id: sample.gameId, case_title: sample.title, task_type: sample.taskType,
      scenario: 'hse', previewOnly: true,
    }
  })
}

function replayOptionLabel(row: any, index: number): string {
  if (row.previewOnly) return `${row.case_title} · 3D preview · agent run pending`
  if (row.task_type === PPE_TASK) return `${row.case_title} · ${row.groups} actions · ${constructionPolicyCopy(row).label}`
  if (row.task_type === 'construction_ppe_shift') return `${row.case_title} · ${row.groups} steps · Controlled fault · ${constructionPolicyCopy(row).label}`
  const title = row.task_type === 'construction_ppe_entry_check'
    ? row.case_title ?? `Entry check · Sample ${index + 1}` : row.task_type.replaceAll('_', ' ')
  if (row.task_type === 'construction_ppe_entry_check') return `${title} · ${row.groups} steps · ${constructionPolicyCopy(row).label}`
  return `${row.success ? '✓' : '✗'} ${title} · ${row.groups} steps${row.policy_source === 'codex_llm' ? ' · Codex LLM replay' : ''}`
}

function defaultReplay(options: any[], scenario: 'alfworld' | 'hse') {
  return (scenario === 'hse' ? options.find(row => row.game_id === 'hse_ppe-CS02') : undefined) ?? options[0]
}

function constructionReplayNote(row: any): string {
  const policy = constructionPolicyCopy(row)
  if (row?.task_type === PPE_TASK) return `PPE inspection · ${policy.label}. ${policy.detail} Recorded replay of checks and reporting; no worksite admission or incident.`
  return row?.task_type === 'construction_ppe_shift'
    ? `Controlled fault demo · ${policy.label}. ${policy.detail} Injected controller actions and physical events are excluded from watermark detection; the fault is not a natural LLM failure. Recorded replay, not a live session.`
    : `Recorded entry check · ${policy.label}. ${policy.detail} Recorded replay, not a live session.`
}

export default function App() {
  const { t } = useI18n()




  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const [health, setHealth] = useState<Health | null>(null)
  const [connErr, setConnErr] = useState(false)
  const [apiInput, setApiInput] = useState('')



  const [staticMode, setStaticMode] = useState(false)
  const staticGame = useRef<StaticGame | null>(null)
  const sessionStatic = useRef(false)
  const [games, setGames] = useState<GameInfo[]>([])
  const [replays, setReplays] = useState<any[]>([])
  const [mode, setMode] = useState<'live' | 'offline'>('offline')
  const [taskId, setTaskId] = useState(0)
  const [gameId, setGameId] = useState<string>('')

  const [scenario, setScenario] = useState<'alfworld' | 'hse'>(() => demoOptions().get('scenario') === 'alfworld' ? 'alfworld' : 'hse')
  const scenarioMenuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = scenarioMenuRef.current
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  const scenarioReplays = useMemo(() => replayOptions(replays, scenario), [replays, scenario])
  const selectedReplay = scenarioReplays.find((row) => row.game_id === gameId)
  const constructionPreview = scenario === 'hse' && (!selectedReplay || selectedReplay.previewOnly)
  const controlledShift = selectedReplay?.task_type === 'construction_ppe_shift'
  const ppeInspection = selectedReplay?.task_type === PPE_TASK
  const constructionSourceNote = constructionReplayNote(selectedReplay)
  function chooseScenario(next: 'alfworld' | 'hse') {
    if (running) return
    if (next === scenario) { syncDemoAddress(next, gameId); return }
    const nextId = defaultReplay(replayOptions(replays, next), next)?.game_id ?? ''
    reset()
    staticGame.current = null
    setTask(null)
    setGameId(nextId)
    setMode('offline')
    setScenario(next)
    syncDemoAddress(next, nextId)
  }
  function chooseReplay(id: string) {
    if (running) return
    reset()
    staticGame.current = null
    setTask(null)
    setPairedWorkflow(null)
    setGameId(id)
    syncDemoAddress(scenario, id)
  }
  const [speed, setSpeed] = useState(1)
  const [roomFocus, setRoomFocus] = useState(false)


  const [roomH, setRoomH] = useState(() => {
    const v = Number(localStorage.getItem('trace.roomH'))
    return v >= 280 ? v : Math.round(window.innerHeight * 0.62)
  })
  useEffect(() => { localStorage.setItem('trace.roomH', String(roomH)) }, [roomH])

  const dragging = useRef(false)
  function startResize(e: React.PointerEvent) {
    dragging.current = true
    const y0 = e.clientY, h0 = roomH
    const move = (ev: PointerEvent) =>
      dragging.current && setRoomH(Math.max(280, Math.min(1400, h0 + ev.clientY - y0)))
    const up = () => {
      dragging.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const [sid, setSid] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const [groups, setGroups] = useState<(GroupView & WorkflowAction)[]>([])
  const [scene, setScene] = useState<SceneState>({
    receptacles: [], visited: [], opened: [], step: 0,
  })
  const [task, setTask] = useState<{ desc: string; type: string } | null>(null)
  const [hse, setHse] = useState({ taskType: '', done: false, success: false })
  const [detect, setDetect] = useState<DetectResult | null>(null)


  const [lastAttackResult, setLastAttackResult] = useState<DetectResult | null>(null)
  const [detectTarget, setDetectTarget] = useState<'original' | 'attacked'>('original')
  const [curve, setCurve] = useState<{ groups: number; z1: number; z2: number }[]>([])




  const [keyMode, setKeyMode] = useState<'right' | 'wrong'>('right')
  const [rate, setRate] = useState(0.3)
  const [rows, setRows] = useState<MatrixRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [instrumentError, setInstrumentError] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)




  const [view, setView] = useState<'guided' | 'expert'>(() =>
    localStorage.getItem('trace.view') === 'expert' ? 'expert' : 'guided')
  useEffect(() => { localStorage.setItem('trace.view', view) }, [view])

  const [expandedPhase, setExpandedPhase] = useState<string | null>(null)
  const [showTech, setShowTech] = useState(false)
  const [showRace, setShowRace] = useState(false)

  const [previewTick, setPreviewTick] = useState(0)


  const [pairedWorkflow, setPairedWorkflow] = useState<PairedWorkflowData | null>(null)
  const [reviewCompleted, setReviewCompleted] = useState(-1)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [pairRetry, setPairRetry] = useState(0)
  const actionReplay = usePPEPlayback(gameId, narrow)
  const [selectedPPECheck, setSelectedPPECheck] = useState<string>('worker_identity')
  const ppeReady = !ppeInspection || pairedWorkflow?.task_type === PPE_TASK && pairedWorkflow?.game_id === gameId
  const retryRecord = () => { setReviewError(null); setPairRetry(v => v + 1) }

  useEffect(() => {
    if (scenario !== 'hse' || !gameId || constructionPreview) {
      setPairedWorkflow(null)
      return
    }
    let dead = false
    setPairedWorkflow(null)
    fetch(asset(`static/compare/${gameId}.json`), { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`paired trajectory ${response.status}`)
        return response.json()
      })
      .then((data: PairedWorkflowData) => {
        if (ppeInspection && (data.game_id !== gameId || data.task_type !== PPE_TASK || !data.trace?.steps?.length || !data.standard?.steps?.length)) throw new Error('Mismatched PPE record')
        if (!dead) setPairedWorkflow(data)
      })
      .catch(() => { if (!dead) { setPairedWorkflow(null); setReviewError('The paired record could not be loaded. Retry before starting the replay.') } })
    return () => { dead = true }
  }, [scenario, gameId, constructionPreview, pairRetry, ppeInspection])



  const workflow = useMemo(() => {
    const g = staticGame.current
    const actions: WorkflowAction[] = g
      ? g.events.filter((e: any) => e.kind === 'group')
      : groups
    const taskType = (g?.summary as any)?.task_type ?? task?.type
    return buildWorkflow(actions, scenario, taskType, pairedWorkflow?.stages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, gameId, scenario, task?.type, previewTick, pairedWorkflow])

  const constructionReview = scenario === 'hse'

  const current = groups.length - 1
  const activePhaseId = useMemo(() => {
    if (!workflow.length) return null
    const hit = workflow.find((p) => p.steps.some((s) => s.i === current))
    if (hit) return hit.id
    return (workflow.find((p) => p.steps[p.steps.length - 1].i >= current)
      ?? workflow[workflow.length - 1]).id
  }, [workflow, current])
  const expanded = expandedPhase ?? activePhaseId
  const currentStep = current >= 0
    ? workflow.flatMap((p) => p.steps).find((s) => s.i === current)
    : undefined
  const runFinished = !running && groups.length > 0 && !!(scene.done || hse.done)
    && (!ppeInspection || reviewCompleted === groups.length - 1)


  const raceGroup = useMemo(() => {
    const latest = groups[groups.length - 1]
    if (latest?.event_kind === 'injected_action') return latest
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].race?.length) return groups[i]
    }
    return null
  }, [groups])
  const racePrevLabel = useMemo(() => {
    if (!raceGroup) return null
    const s = workflow.flatMap((p) => p.steps).find((x) => x.i === raceGroup.i - 1)
    return s?.label ?? null
  }, [raceGroup, workflow])

  useEffect(() => {
    if (!scenarioReplays.length) return
    if (!scenarioReplays.some((r) => r.game_id === gameId)) {
      const requested = demoOptions().get('case')
      const requestedId = CONSTRUCTION_CASES.find((sample) => sample.key === requested)?.gameId
      const selected = requested ? scenarioReplays.find((r) => r.game_id === (requestedId ?? requested) || r.game_id.includes(`-${requested}-`)) : null
      setGameId((selected ?? defaultReplay(scenarioReplays, scenario)).game_id)
    }
  }, [scenarioReplays, gameId])




  async function loadBackend() {
    let manifest = null
    try {
      manifest = await loadStaticManifest()
      setStaticMode(true)
      setReplays(manifest.games)
      const available = replayOptions(manifest.games, scenario)
      const requested = demoOptions().get('case')
      const requestedId = CONSTRUCTION_CASES.find((sample) => sample.key === requested)?.gameId
      const selected = requested ? available.find((row) => row.game_id === (requestedId ?? requested) || row.game_id.includes(`-${requested}-`)) : null
      setGameId((selected ?? defaultReplay(available, scenario))?.game_id ?? '')
    } catch {                          }



    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('probe timeout')), 3500))
    try {
      const h = await Promise.race([api.health(), timeout])
      setHealth(h)
      setConnErr(false)
      if (h.live) {
        setMode(scenario === 'hse' ? 'offline' : 'live')
        api.games().then((g) => setGames(g.games)).catch(() => {})
      }
    } catch {
      if (manifest) {
        setHealth(staticHealth(manifest))
        setConnErr(false)
        setMode('offline')
      } else {
        setConnErr(true)
      }
    }
  }
  useEffect(() => { loadBackend() }, [])




  useEffect(() => {
    if (mode !== 'offline' || !staticMode || !gameId || constructionPreview || running || groups.length > 0) return
    let dead = false
    loadStaticGame(gameId).then((g) => {
      if (dead) return
      staticGame.current = g
      if (g.summary?.query) setTask({ desc: g.summary.query, type: g.summary.task_type })
      if (scenario === 'hse') setHse((previous) => ({ ...previous, taskType: g.summary?.task_type }))
      setPreviewTick((n) => n + 1)
    }).catch(() => {})
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, staticMode, mode, constructionPreview])



  function connectTo(u: string) {
    const url = u.trim().replace(/\/+$/, '')
    if (!url) return
    const base = window.location.origin + window.location.pathname
    const params = demoOptions()
    params.set('scenario', scenario)
    window.location.href = `${base}?api=${encodeURIComponent(url)}#/demo?${params.toString()}`
    window.location.reload()
  }




  const [follow, setFollow] = useState(false)
  const [unseen, setUnseen] = useState(0)




  const scrollable = () =>
    document.documentElement.scrollHeight > window.innerHeight + 200
  const atBottom = () =>
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120

  useEffect(() => {
    const onScroll = () => {
      if (!scrollable()) return
      if (atBottom()) { setFollow(true); setUnseen(0) } else setFollow(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!groups.length) { setUnseen(0); return }
    if (follow) {
      feedRef.current?.lastElementChild?.scrollIntoView(
        { block: 'nearest', behavior: 'smooth' })
    } else if (scrollable()) {
      setUnseen((n) => n + 1)
    }
  }, [groups.length])

  function jumpToLatest() {
    setFollow(true); setUnseen(0)
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
  }

  function reset() {
    actionReplay.reset()
    setSelectedPPECheck('worker_identity')
    setReviewCompleted(-1); setReviewError(null)
    reviewGeneration.current += 1
    sessionUnsubscribe.current?.()
    sessionUnsubscribe.current = null
    setGroups([]); setDetect(null); setCurve([]); setRows([])
    setLastAttackResult(null); setDetectTarget('original')
    setSid(null)
    setKeyMode('right'); setBusy(null); setInstrumentError(null)
    setRunning(false)
    sessionStatic.current = false
    setFollow(false); setUnseen(0); setExpandedPhase(null)
    moveQ.current = []; walking.current = false
    queue.current = []
    if (timer.current != null) { window.clearInterval(timer.current); timer.current = null }
    if (watchdog.current != null) { window.clearTimeout(watchdog.current); watchdog.current = null }
    if (reviewWatchdog.current != null) { window.clearTimeout(reviewWatchdog.current); reviewWatchdog.current = null }
    reviewPending.current = null
    setReviewEpoch(reviewGeneration.current)
    setScene({ receptacles: [], visited: [], opened: [], step: 0 })
    setHse((h) => ({ ...h, done: false, success: false }))
  }



  const queue = useRef<any[]>([])
  const timer = useRef<number | null>(null)
  const reviewGeneration = useRef(0)
  const sessionUnsubscribe = useRef<(() => void) | null>(null)
  const [reviewEpoch, setReviewEpoch] = useState(0)
  const reviewPending = useRef<{ step: number; generation: number } | null>(null)
  const reviewWatchdog = useRef<number | null>(null)

  function releaseReviewStep(step: number, generation: number) {
    const pending = reviewPending.current
    if (!pending || pending.step !== step || pending.generation !== generation
      || reviewGeneration.current !== generation) return
    reviewPending.current = null
    if (reviewWatchdog.current != null) { window.clearTimeout(reviewWatchdog.current); reviewWatchdog.current = null }
  }

  function stopPPEReplay(message: string | null, generation: number) {
    if (generation !== reviewGeneration.current) return
    reviewGeneration.current += 1
    sessionUnsubscribe.current?.(); sessionUnsubscribe.current = null
    queue.current = []; reviewPending.current = null
    if (timer.current != null) { window.clearInterval(timer.current); timer.current = null }
    if (reviewWatchdog.current != null) { window.clearTimeout(reviewWatchdog.current); reviewWatchdog.current = null }
    setRunning(false); setReviewError(message)
  }

  function playPPEAction(source: PlaybackArm, index: number) {
    if (!ppeInspection || !ppeReady || narrow || !pairedWorkflow?.[source].steps.some(step => step.i === index)) return
    if (running) stopPPEReplay(null, reviewGeneration.current)
    else setReviewError(null)
    const scenePanel = document.getElementById('ppe-inspection-scene')
    if (scenePanel && scenePanel.getAttribute('role') !== 'dialog') {
      const top = scenePanel.getBoundingClientRect().top
      if (top < 64 || top > 120) window.scrollTo({ top: Math.max(0, window.scrollY + top - 72), behavior: 'instant' })
    }
    actionReplay.play(source, index)
  }

  useEffect(() => {
    if (narrow && running && ppeInspection) stopPPEReplay('Replay stopped because the 3D viewport is too narrow. Widen the window and restart; unfinished actions remain unverified.', reviewGeneration.current)
  }, [narrow, running, ppeInspection])



  const onReviewActionComplete = useCallback((step: number) => {
    if (reviewPending.current?.step !== step || reviewPending.current.generation !== reviewEpoch) return
    setReviewCompleted(step)
    if (ppeInspection) {
      if (reviewWatchdog.current != null) window.clearTimeout(reviewWatchdog.current)
      reviewWatchdog.current = window.setTimeout(() => releaseReviewStep(step, reviewEpoch), 1100 / Math.max(1, speed))
    } else releaseReviewStep(step, reviewEpoch)
  }, [reviewEpoch, ppeInspection, speed])

  function beginReviewStep(step: number) {
    const generation = reviewGeneration.current
    reviewPending.current = { step, generation }
    if (reviewWatchdog.current != null) window.clearTimeout(reviewWatchdog.current)




    reviewWatchdog.current = window.setTimeout(
      () => {
        if (ppeInspection && generation === reviewGeneration.current) {
          stopPPEReplay('The 3D action did not finish. Check WebGL and restart the replay; this step has not been marked complete.', generation)
          return
        }
        releaseReviewStep(step, generation)
      }, 75000)
  }




  const moveQ = useRef<{ cmd: string; i: number; confirm: boolean; done: boolean }[]>([])
  const walking = useRef(false)
  const watchdog = useRef<number | null>(null)

  function pump() {
    if (walking.current) return
    const m = moveQ.current.shift()
    if (!m) return
    walking.current = true
    applyCommand(m.cmd, m.i, m.confirm, m.done)
    if (watchdog.current) window.clearTimeout(watchdog.current)
    watchdog.current = window.setTimeout(onArrive, 2600 / Math.max(0.5, speed))
  }

  function onArrive() {
    if (watchdog.current) { window.clearTimeout(watchdog.current); watchdog.current = null }
    walking.current = false

    window.setTimeout(pump, Math.max(60, 260 / speed))
  }

  function enqueueMove(cmd: string, i: number, confirm: boolean, done = false) {
    moveQ.current.push({ cmd, i, confirm, done })
    pump()
  }

  function drain() {
    if (timer.current != null) return
    timer.current = window.setInterval(() => {

      if (moveQ.current.length > 2) return
      const next = queue.current[0]
      if (reviewPending.current && next && ['group', 'task_done', 'eof'].includes(next.kind)) return
      const e = queue.current.shift()
      if (!e) { window.clearInterval(timer.current!); timer.current = null; return }
      handle(e)
    }, Math.max(50, (scenario === 'hse' ? 120 : 320) / speed))
  }

  useEffect(() => () => {
    reviewGeneration.current += 1
    sessionUnsubscribe.current?.()
    sessionUnsubscribe.current = null
    if (timer.current != null) window.clearInterval(timer.current)
    if (watchdog.current != null) window.clearTimeout(watchdog.current)
    if (reviewWatchdog.current != null) window.clearTimeout(reviewWatchdog.current)
    reviewPending.current = null
  }, [])

  async function start() {
    if (!ppeReady) return
    if (constructionPreview) return
    reset(); setRunning(true)
    const generation = reviewGeneration.current
    queue.current = []
    moveQ.current = []; walking.current = false
    if (timer.current != null) { window.clearInterval(timer.current); timer.current = null }
    if (watchdog.current != null) { window.clearTimeout(watchdog.current); watchdog.current = null }




    if (mode === 'offline' && staticMode) {
      try {
        const g = await loadStaticGame(gameId)
        if (reviewGeneration.current !== generation) return
        staticGame.current = g
        sessionStatic.current = true
        setSid('static:' + gameId)
        g.events.forEach((e) => queue.current.push(e))
        drain()
      } catch {
        if (reviewGeneration.current !== generation) return
        setRunning(false)
      }
      return
    }


    sessionStatic.current = false
    try {
      const { session_id } = await api.run(
        mode === 'live'
          ? { task_id: taskId, arm: 'wm', mode: 'live' }
          : { mode: 'replay', game_id: gameId })
      if (reviewGeneration.current !== generation) return
      setSid(session_id)
      const unsubscribe = subscribe(session_id, (e) => {
        if (reviewGeneration.current !== generation) return
        if (mode === 'offline') { queue.current.push(e); drain() } else handle(e)
      })
      if (reviewGeneration.current !== generation) unsubscribe()
      else sessionUnsubscribe.current = unsubscribe
    } catch {
      if (reviewGeneration.current !== generation) return
      setRunning(false)
    }
  }

  function handle(e: any) {
    switch (e.kind) {

      case 'task_start':
        setTask({ desc: e.query, type: e.task_type })
        setScene((s) => ({ ...s, receptacles: e.receptacles ?? [] }))
        setHse({ taskType: e.task_type, done: false, success: false })
        break
      case 'group': {
        if (scenario === 'hse' && !constructionPreview) beginReviewStep(e.i)
        setGroups((g) => [...g, {
          i: e.i, timestamp: e.timestamp, window: e.window, chosen: e.chosen, race: e.race, phi: e.phi,
          nCandidates: e.n_candidates, k: e.k, green: e.green, l2hit: e.l2_hit,
          roundNum: e.round_num, phase: e.phase, stage_id: e.stage_id, label: e.label, result: e.result, evidence_ids: e.evidence_ids,
          event_kind: e.event_kind, detector_eligible: e.detector_eligible, wm_index: e.wm_index,
          policy_source: e.policy_source, station_id: e.station_id,
          world_state_before: e.world_state_before, world_state_after: e.world_state_after,
          world_events: e.world_events, fault: e.fault,
          scene_action: e.scene_action, scene_state_before: e.scene_state_before, scene_state_after: e.scene_state_after,
          checklist_before: e.checklist_before, checklist_after: e.checklist_after,
          observations: (e.observations ?? []).map((o: any) => ({
            command: o.cmd, text: o.text, confirm: o.confirm,
          })),
        }])


        if (scenario !== 'hse') (e.observations ?? []).forEach((o: any) =>
          enqueueMove(o.cmd, e.i, o.confirm))
        break
      }
      case 'task_done':
        setScene((s) => ({ ...s, done: true, success: !!e.success }))
        setHse((h) => ({ ...h, done: true, success: !!e.success }))
        setRunning(false)
        break
      case 'eof':
        setRunning(false)
        break
      case 'start':
        setTask({ desc: e.task, type: e.task_type })
        setScene((s) => ({ ...s, receptacles: e.receptacles ?? [] }))
        break
      case 'perceive':
        setScene((s) => ({
          ...s,
          receptacles: e.receptacles?.length ? e.receptacles : s.receptacles,
        }))
        setGroups((g) => [...g, { i: e.i, observations: [] }])
        break
      case 'layer1':
        setGroups((g) => g.map((x) => x.i === e.i ? {
          ...x, window: e.window, chosen: e.chosen, race: e.race, phi: e.phi,
          nCandidates: e.n_candidates, thought: e.thought,
        } : x))
        break
      case 'layer2':
        setGroups((g) => g.map((x) => x.i === e.i ? {
          ...x, k: e.k, green: e.green, l2hit: e.hit, roundNum: e.round_num,
        } : x))
        break
      case 'execute':
        setGroups((g) => g.map((x) => x.i === e.i ? {
          ...x,
          observations: [...x.observations,
            { command: e.command, text: e.observation, confirm: !!e.confirm }],
        } : x))
        if (scenario !== 'hse') enqueueMove(e.command, e.i, !!e.confirm, !!e.done)
        break
      case 'detect':
        setDetectTarget('original')
        setDetect(e)
        setCurve((c) => [...c, { groups: (e.i ?? 0) + 1, z1: e.layer1.z, z2: e.layer2.z }])
        break
      case 'end':
        setScene((s) => ({ ...s, done: true, success: !!e.success }))
        setRunning(false)
        break
      case 'error':
        setRunning(false)
        break
    }
  }


  function applyCommand(command: string, step: number, confirm: boolean, done = false) {
    if (scenario === 'hse') return
    const p = parseCommand(command)
    setScene((s) => {
      const visited = p.target && !s.visited.includes(p.target)
        ? [...s.visited, p.target] : s.visited
      const opened = p.verb === 'open' && p.target && !s.opened.includes(p.target)
        ? [...s.opened, p.target]
        : p.verb === 'close' && p.target
          ? s.opened.filter((x) => x !== p.target) : s.opened
      const carrying = p.verb === 'take' ? p.object
        : p.verb === 'put' ? undefined : s.carrying
      return { ...s, command, confirm, visited, opened, carrying, step,
               done: done || s.done }
    })
  }

  async function switchKey(mode: 'right' | 'wrong') {
    if (!sid || !health || running || busy || !groups.length || constructionPreview) return
    if (sessionStatic.current && !staticGame.current) return
    const generation = reviewGeneration.current
    setBusy('__key'); setInstrumentError(null)
    try {
      const k = health.keys
      const result = sessionStatic.current
        ? (mode === 'right' ? staticGame.current!.detect.right : staticGame.current!.detect.wrong)
        : await api.detect(sid,
          mode === 'right' ? k.key1 : k.wrong_key1,
          mode === 'right' ? k.key2 : k.wrong_key2)
      if (reviewGeneration.current !== generation) return
      setKeyMode(mode); setDetectTarget('original'); setDetect(result)
    } catch {
      if (reviewGeneration.current === generation) setInstrumentError('Key calibration could not be completed. The previous result has been kept.')
    } finally {
      if (reviewGeneration.current === generation) setBusy(null)
    }
  }

  async function runAttack(kind: string) {
    if (!sid || running || busy || !groups.length || constructionPreview) return
    if (sessionStatic.current && !staticGame.current) return
    const generation = reviewGeneration.current
    setBusy(kind); setInstrumentError(null)
    try {
      const r = sessionStatic.current
        ? staticAttack(staticGame.current!, kind, rate)
        : await api.attack(sid, kind, rate)
      if (reviewGeneration.current !== generation) return
      setKeyMode('right')
      setDetectTarget('attacked')
      setLastAttackResult(r.after)
      setDetect(r.after)
      setRows((rs) => {
        const base = rs.length ? rs : [{
          attack: 'clean', param: null, z1: r.before.layer1.z, z2: r.before.layer2.z,
          z1_wrong: r.before.layer1.z_wrong, z2_wrong: r.before.layer2.z_wrong,
          n1: r.before.layer1.n, n2: r.before.layer2.n,
          inconsistency: r.before.consistency.rate,
        } as MatrixRow]
        const row: MatrixRow = {
          attack: kind, param: rate, z1: r.after.layer1.z, z2: r.after.layer2.z,
          z1_wrong: r.after.layer1.z_wrong, z2_wrong: r.after.layer2.z_wrong,
          n1: r.after.layer1.n, n2: r.after.layer2.n,
          inconsistency: r.after.consistency.rate,
        }
        return [...base.filter((x) => x.attack !== kind), row]
      })
    } catch {
      if (reviewGeneration.current === generation) setInstrumentError('This attack could not be evaluated. No new result has been added.')
    } finally {
      if (reviewGeneration.current === generation) setBusy(null)
    }
  }

  async function runMatrix() {
    if (!sid || running || busy || !groups.length || constructionPreview) return
    if (sessionStatic.current && !staticGame.current) return
    const generation = reviewGeneration.current
    setBusy('__matrix'); setInstrumentError(null)
    try {
      const rows = sessionStatic.current
        ? staticMatrix(staticGame.current!, rate)
        : (await api.matrix(sid, rate)).rows
      if (reviewGeneration.current !== generation) return
      setRows(rows)
    } catch {
      if (reviewGeneration.current === generation) setInstrumentError('The attack matrix could not be evaluated. The previous results have been kept.')
    } finally {
      if (reviewGeneration.current === generation) setBusy(null)
    }
  }

  const activeKeys = health
    ? (keyMode === 'right'
        ? [health.keys.key1, health.keys.key2]
        : [health.keys.wrong_key1, health.keys.wrong_key2])
    : [0, 0]

  const instrumentsLocked = !sid || running || groups.length === 0
  const detectionContextText = `${detectTarget === 'attacked' ? 'Attacked record' : 'Original record'} · ${keyMode === 'right' ? 'correct keys' : 'wrong keys'}`
  const detectionContext = detect ? (
    <div className="px-1 text-[10px] font-semibold text-slate-500">Detector: {detectionContextText}</div>
  ) : null
  const keyCalibration = (
    <div className="card p-2.5 flex flex-wrap items-center gap-2">
      <KeyRound size={12} className="text-slate-400" />
      <span className="text-[10px] font-semibold text-slate-500">Key calibration · original record</span>
      <div className="flex rounded-full bg-slate-100/80 ring-1 ring-slate-900/[0.04] p-0.5">
        {(['right', 'wrong'] as const).map((m) => (
          <button key={m} onClick={() => switchKey(m)} disabled={instrumentsLocked || !!busy}
            title={instrumentsLocked ? 'Available after a recorded run finishes.' : 'Check the original recorded run with this key pair.'}
            className={[
              'rounded-full px-3 py-1 text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              keyMode === m
                ? (m === 'right' ? 'bg-white text-l1-700 shadow-sm' : 'bg-rose-500 text-white shadow-sm')
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}>
            {m === 'right' ? t('rightKey') : t('wrongKey')}
          </button>
        ))}
      </div>
    </div>
  )

  function renderInstruments(twoColumns: boolean) {
    return (
      <div className={twoColumns ? 'grid grid-cols-2 gap-3 items-start' : 'space-y-2'}>
        <div className="space-y-2">
          {keyCalibration}
          {detectionContext}
          <DetectPanel d={detect} curve={detectTarget === 'original' && keyMode === 'right' ? curve : []} />
        </div>
        <AttackPanel attacks={health?.attacks ?? []} rate={rate} setRate={setRate}
          precomputedAttacks={constructionReview ? ['deletion', 'strip_redundant', 'semantic_rewrite'] : undefined}
          locked={instrumentsLocked}
          onAttack={runAttack} onMatrix={runMatrix} rows={rows} busy={busy}
          tau={health?.tau ?? 2} live={mode === 'live' && !!health?.live}
          hse={scenario === 'hse'} />
      </div>
    )
  }

  if (narrow) return <MobileGate />

  return (
    <div className="min-h-screen">
      {                                  }
      <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-4
                         bg-white/70 backdrop-blur-xl ring-1 ring-slate-900/[0.05]
                         shadow-[0_1px_0_rgba(255,255,255,.6),0_8px_24px_-18px_rgba(15,23,42,.25)]">
        {                                                     }
        <a href="#/" title="← TRACE home" className="flex shrink-0 items-center gap-3 group">
          <div className="bezel p-1 group-hover:shadow-lift transition-shadow duration-500 ease-fluid">
            <div className="bezel-core grid place-items-center w-8 h-8
                            bg-gradient-to-br from-l1-50 to-white">
              <Logo size={22} />
            </div>
          </div>
          <div title={t('paperTitle')} className="leading-none">
            <div className="font-display text-[15px] font-extrabold text-slate-900 tracking-[-0.02em]">
              <span className="text-l1-500">TRACE</span> Watermark
            </div>
            <div className="hidden 2xl:block text-[9px] text-slate-400 mt-1 tracking-wide">
              {t('appSub')}
            </div>
          </div>
        </a>

        {
                                                                                     }
        <nav className="ml-4 flex items-center gap-1 rounded-xl bg-slate-100/80 p-1
                        ring-1 ring-slate-900/[0.05]" aria-label="Primary navigation">
          <button onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5
                       text-[10.5px] font-semibold text-slate-500 transition-colors
                       hover:bg-white hover:text-slate-800 hover:shadow-sm">
            <Home size={12} /> Home
          </button>

          <div className="mx-0.5 h-5 w-px bg-slate-200" />
          <button onClick={() => chooseScenario('hse')} disabled={running}
            title="Entry decisions, site replay and record attribution"
            aria-current={scenario === 'hse' ? 'page' : undefined}
            className={[
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px]',
              'font-semibold ring-1 transition-all disabled:cursor-not-allowed disabled:opacity-50',
              scenario === 'hse'
                ? 'bg-white text-amber-700 ring-amber-200 shadow-sm'
                : 'bg-transparent text-slate-500 ring-transparent hover:bg-white hover:text-slate-800',
            ].join(' ')}>
            <Factory size={12} /> Industrial Safety (HSE)
          </button>

          <details ref={scenarioMenuRef} className="group relative"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && event.currentTarget.open) {
                event.preventDefault()
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }
            }}>
            <summary className={[
              'flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px]',
              'font-semibold ring-1 transition-colors [&::-webkit-details-marker]:hidden',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-l1-400',
              scenario === 'alfworld'
                ? 'bg-white text-l1-700 ring-l1-200 shadow-sm'
                : 'text-slate-500 ring-transparent hover:bg-white hover:text-slate-800 group-open:bg-white',
            ].join(' ')}>
              Scenarios
              <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute left-0 top-full z-40 mt-2 w-60 rounded-xl border border-slate-200/80
                            bg-white p-1.5 shadow-[0_12px_36px_-8px_rgba(15,23,42,.2)]">
              <button onClick={() => {
                chooseScenario('alfworld')
                const menu = scenarioMenuRef.current
                if (menu) {
                  menu.open = false
                  menu.querySelector('summary')?.focus()
                }
              }} disabled={running}
                aria-current={scenario === 'alfworld' ? 'page' : undefined}
                title="Everyday household tasks used in the paper benchmark"
                className={[
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold',
                  'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  scenario === 'alfworld' ? 'bg-l1-50 text-l1-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                ].join(' ')}>
                <House size={15} /> Household Tasks
              </button>
              <button onClick={() => navigate('/across-domains')}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px]
                           font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
                <BookOpen size={15} /> General Attack Scenarios
              </button>
            </div>
          </details>
        </nav>

        <div className="flex-1 min-w-2" />

        <span className={[
          'chip ring-1 shrink-0',
          mode === 'live' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            : 'bg-slate-100 text-slate-600 ring-slate-200',
        ].join(' ')}>
          {constructionPreview
            ? <><Factory size={10} /> 3D preview</>
            : mode === 'live'
            ? <><Radio size={10} className="animate-pulse" /> {t('live')}</>
            : <><WifiOff size={10} /> {t('offline')}</>}
        </span>

        {                                                               }
        <div className="flex rounded-full bg-slate-100/80 ring-1 ring-slate-900/[0.04] p-0.5">
          {(['guided', 'expert'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={[
                'rounded-full px-3 py-1 text-[11px] font-semibold transition-all duration-500 ease-fluid',
                view === v ? 'bg-white text-l1-700 shadow-sm ring-1 ring-slate-900/[0.05]'
                           : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}>
              {v === 'guided' ? 'Guided view' : 'Expert dashboard'}
            </button>
          ))}
        </div>

        {
                                                                                 }
        {view === 'expert' && (
        <div className="hidden 2xl:flex items-center gap-2.5">
          <KeyRound size={12} className="text-slate-400" />
          <div className="flex rounded-full bg-slate-100/80 ring-1 ring-slate-900/[0.04] p-0.5">
            {(['right', 'wrong'] as const).map((m) => (
              <button key={m} onClick={() => switchKey(m)} disabled={instrumentsLocked || !!busy}
                className={[
                  'rounded-full px-3 py-1 text-[11px] font-semibold',
                  'transition-all duration-500 ease-fluid active:scale-[0.97]',
                  keyMode === m
                    ? (m === 'right' ? 'bg-white text-l1-700 shadow-sm ring-1 ring-slate-900/[0.05]'
                                     : 'bg-rose-500 text-white shadow-sm')
                    : 'text-slate-500 hover:text-slate-700',
                  instrumentsLocked || busy ? 'opacity-40 cursor-not-allowed' : '',
                ].join(' ')}>
                {m === 'right' ? t('rightKey') : t('wrongKey')}
              </button>
            ))}
          </div>
          <span className="mono text-slate-400 tabular-nums">
            {activeKeys[0]} · {activeKeys[1]}
          </span>
        </div>
        )}
      </header>

      {instrumentError && <div role="alert" className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">{instrumentError}</div>}

      {
                                                               }
      {connErr && !constructionPreview && (
        <div className="mx-3 mt-3 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3
                        flex items-start gap-3">
          <WifiOff size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-amber-900">{t('connErrTitle')}</div>
            <div className="text-[12.5px] text-amber-800/90 mt-0.5 break-words">
              {t('connErrBody')}
            </div>
            <div className="text-[11px] text-amber-700/80 mt-1 mono break-all">
              {t('connErrTrying', { api: API_BASE || '/api' })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={apiInput}
                onChange={(e) => setApiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') connectTo(apiInput) }}
                placeholder={t('connErrPlaceholder')}
                spellCheck={false}
                className="flex-1 min-w-[240px] rounded-lg bg-white ring-1 ring-amber-300
                           px-3 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-400
                           outline-none focus:ring-2 focus:ring-amber-500" />
              <button onClick={() => connectTo(apiInput)}
                className="rounded-full bg-amber-600 text-white px-3.5 py-1.5 text-[12px]
                           font-semibold hover:bg-amber-700 transition-colors active:scale-[0.97]">
                {t('connErrConnect')}
              </button>
              <button onClick={loadBackend}
                className="rounded-full bg-white ring-1 ring-amber-300 text-amber-800 px-3 py-1.5
                           text-[12px] font-semibold hover:bg-amber-100 transition-colors active:scale-[0.97]">
                {t('connErrRetry')}
              </button>
            </div>
          </div>
        </div>
      )}

      {                                                                               }
      {view === 'guided' && (
        <div className="p-3 space-y-3 max-w-[1500px] mx-auto">

          {                                                                   }
          <div className="card px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              <button onClick={() => setMode('live')} disabled={!health?.live || running || scenario === 'hse'}
                className={[
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  mode === 'live' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  !health?.live || scenario === 'hse' ? 'opacity-40 cursor-not-allowed' : '',
                ].join(' ')}>
                <Radio size={11} /> {t('modeLive')}
              </button>
              <button onClick={() => setMode('offline')} disabled={running}
                className={[
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  mode === 'offline' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}>
                <WifiOff size={11} /> {constructionPreview ? '3D preview' : t('modeOffline')}
              </button>
            </div>

            {mode === 'offline' && (
              <>
                <select value={gameId} onChange={(e) => chooseReplay(e.target.value)} disabled={running}
                  className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11.5px] max-w-[22rem]
                             ring-1 ring-slate-200 outline-none focus:ring-l1-400">
                  {!scenarioReplays.length && <option value="">No recorded LLM replay available yet</option>}
                  {scenarioReplays.map((r, index) => (
                    <option key={r.game_id} value={r.game_id}>
                      {replayOptionLabel(r, index)}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <Gauge size={11} className="text-slate-400 shrink-0" />
                  <input type="range" min={0.5} max={4} step={0.5} value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-20 accent-l1-500" />
                  <span className="text-[10px] tabular-nums text-slate-500">{speed}×</span>
                </div>
              </>
            )}

            {mode === 'live' && (
              <select value={taskId} onChange={(e) => setTaskId(+e.target.value)}
                className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11.5px]
                           ring-1 ring-slate-200 outline-none focus:ring-l1-400">
                {games.map((g) => (
                  <option key={g.task_id} value={g.task_id}>#{g.task_id} · {g.task_type}</option>
                ))}
              </select>
            )}

            <button onClick={start}
              disabled={running || constructionPreview || !ppeReady || (mode === 'live' ? !health?.live : !gameId)}
              title={constructionPreview ? 'A recorded LLM run is required before replaying agent actions.' : undefined}
              className="group flex items-center gap-2 rounded-full bg-l1-500 text-white
                         text-[12px] font-semibold pl-4 pr-3 py-1.5
                         shadow-[0_8px_20px_-8px_rgba(99,102,241,.6)]
                         transition-all duration-500 ease-fluid hover:bg-l1-700
                         active:scale-[0.98] disabled:opacity-40 disabled:shadow-none">
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? t('runningNow') : ppeInspection ? 'Replay full TRACE' : constructionReview ? 'Start replay' : mode === 'live' ? t('startLive') : t('startReplay')}
            </button>

            {task && (
              <div className="rounded-lg bg-amber-50 px-2.5 py-1 ring-1 ring-amber-200 text-[11px] text-amber-900 max-w-[26rem] truncate"
                   title={task.desc}>
                <span className="font-semibold text-amber-600">{t('goal')}: </span>{task.desc}
              </div>
            )}
          </div>

          {constructionPreview ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-[12px] leading-relaxed text-indigo-800">
              <span className="font-semibold">3D preview · agent run pending.</span> Explore the PPE checkpoint. Recorded workwear checks, footwear evidence, correction and reinspection appear once the verified model run is available.
            </div>
          ) : constructionReview && <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2 text-[11px] text-indigo-700">{constructionSourceNote}</div>}
          {reviewError && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{reviewError} <button onClick={retryRecord} className="ml-2 underline">Reload record</button></div>}

          {                    }
          {constructionPreview && <ConstructionWorkflowPending taskType={selectedReplay?.task_type} />}
          {(workflow.length > 0 || ppeInspection && pairedWorkflow) && (
            pairedWorkflow && ppeInspection ? (
              <PPEWorkflowComparison key={`${gameId}:${reviewEpoch}`} pair={pairedWorkflow} current={current}
                completedIndex={reviewCompleted} running={running} fullReplayComplete={runFinished} playback={actionReplay.active} watched={actionReplay.watched} onPlay={playPPEAction} onSelectCheck={setSelectedPPECheck} />
            ) : pairedWorkflow ? (
              <PairedWorkflowStrip key={`${gameId}:${reviewEpoch}`} phases={workflow} pair={pairedWorkflow}
                current={current} completedIndex={reviewCompleted} running={running} expanded={expanded}
                followReplay={expandedPhase === null} onFollow={() => setExpandedPhase(null)}
                onToggle={(id) => setExpandedPhase(id)} />
            ) : (
              <WorkflowStrip phases={workflow} current={current} running={running}
                expanded={expanded}
                onToggle={(id) => setExpandedPhase(id === expanded ? '' : id)} />
            )
          )}

          {                   }
          {constructionPreview ? null : constructionReview ? (
            <div className="card flex items-center gap-3 px-5 py-3.5">
              <ShieldCheck size={23} className="shrink-0 text-indigo-500" />
              <div>
                <div className="text-[13px] font-extrabold text-slate-700">
                  {ppeInspection ? actionReplay.active ? 'Single-action comparison · shared inspection scene' : runFinished ? 'PPE inspection saved — compare the findings and source evidence below' : running ? 'Replaying the PPE inspection' : 'Ready to replay the PPE inspection' : controlledShift
                    ? runFinished ? 'Duty record complete — inspect the outcome and source evidence below' : running ? 'Replaying the same robot’s duty shift' : 'Ready to replay the controlled duty shift'
                    : runFinished ? 'Entry decision recorded — inspect the outcome below' : running ? 'Replaying the on-duty entry agent' : 'Ready to replay the entry check'}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {ppeInspection && actionReplay.active ? 'The scene shows the selected run and action. Single-step playback does not change the full TRACE log or its detection results.' : detect
                    ? `${detectionContextText}: L1 z = ${detect.layer1.z.toFixed(2)} (n = ${detect.layer1.n}), L2 z = ${detect.layer2.z.toFixed(2)} (n = ${detect.layer2.n}); threshold ${health?.tau ?? 2}.`
                    : ppeInspection ? 'Identify the worker, inspect current PPE, request correction, reinspect and save the finding. The worker remains at the checkpoint.' : controlledShift ? 'Inspect current evidence, retain the original recommendation, then follow the controller receipt and the robot’s observation/reporting duty. Unread evidence and future event details are withheld.'
                      : 'Register the worker, inspect available observations, then assess and decide access. Executable actions are not automatically safe decisions.'}
                </p>
              </div>
            </div>
          ) : <GuidedBanner
            idle={groups.length === 0}
            running={running}
            finished={runFinished}
            detected={!!detect && (detect.layer1.z > (health?.tau ?? 2) || detect.layer2.z > (health?.tau ?? 2))}
            z1={detect?.layer1.z ?? 0} z2={detect?.layer2.z ?? 0}
            tau={health?.tau ?? 2} attacked={detectTarget === 'attacked'} />}

          {                                   }
          <div className={constructionReview ? 'space-y-3' : 'grid grid-cols-[minmax(0,1fr)_21rem] gap-3 items-start'}>
            <div className="relative">
              <div className="bezel shadow-lift" style={{ height: constructionReview ? Math.max(520, roomH) : roomH }}>
                <div className="bezel-core h-full overflow-hidden">
                  {scenario === 'hse' ? (
                    ppeInspection ? <PPEInspectionScene pair={pairedWorkflow} groups={groups} completedIndex={reviewCompleted} running={running} caseId={gameId} speed={speed} replayEpoch={reviewEpoch} onActionComplete={onReviewActionComplete} playback={actionReplay.active} onPlaybackComplete={actionReplay.complete} selectedCheck={selectedPPECheck} onPlay={playPPEAction} /> : <ConstructionReviewScene pair={pairedWorkflow} groups={groups} running={running} caseId={gameId} speed={speed} replayEpoch={reviewEpoch} onActionComplete={onReviewActionComplete} />
                  ) : (
                    <VoxelRoom s={scene} expanded={roomFocus} onArrive={onArrive}
                               speed={mode === 'offline' ? speed : 1}
                               onToggleExpand={() => setRoomFocus((v) => !v)} />
                  )}
                </div>
              </div>

              {                                                                 }
              {scenario !== 'hse' && workflow.length > 0 && current >= 0 && (
                <div className="pointer-events-none absolute top-3 left-3 chip bg-white/90 backdrop-blur
                                ring-1 ring-slate-200 text-slate-600">
                  {(() => {
                    const p = workflow.find((x) => x.id === activePhaseId)
                    return p ? `Phase ${p.num} · ${p.title}` : ''
                  })()}
                </div>
              )}
              <AnimatePresence>
                {scenario !== 'hse' && running && current >= 0 && (
                  <motion.div key={current}
                    initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                    className="pointer-events-none absolute top-3 right-3 chip bg-l1-500 text-white
                               font-bold shadow-[0_4px_12px_rgba(99,102,241,.45)]">
                    {constructionReview ? '◈ read-only log copy added' : '◈ mark embedded'}
                  </motion.div>
                )}
              </AnimatePresence>
              {scenario !== 'hse' && (currentStep || task) && (
                <div className="absolute bottom-3 left-3 right-3 max-w-[62%] rounded-xl bg-white/92 backdrop-blur
                                ring-1 ring-slate-200 px-3.5 py-2.5 flex items-center gap-2.5">
                  {currentStep && (
                    <span className="shrink-0 rounded-lg bg-l1-50 text-l1-700 text-[11px] font-extrabold px-2 py-1">
                      STEP {current + 1}
                    </span>
                  )}
                  <span className="text-[12.5px] text-slate-600 leading-snug">
                    {currentStep
                      ? constructionReview ? currentStep.label : <>{currentStep.label} — a routine choice that <b className="text-l1-700">quietly carries the watermark</b>.</>
                      : task?.desc}
                  </span>
                </div>
              )}
            </div>

            {constructionReview && !ppeInspection && <EntryAttributionPanel pair={pairedWorkflow} available={runFinished} />}
            {!ppeInspection && <div className={constructionReview ? 'grid grid-cols-2 gap-3 items-start' : 'sticky top-[3.75rem] space-y-2.5'}>
              <div className="space-y-2">
                {detectionContext}
                <GuidedDetect d={detect} tau={health?.tau ?? 2} running={running} />
              </div>
              <GuidedAttack rate={rate} setRate={setRate} busy={busy}
                precomputedAttacks={constructionReview ? ['deletion', 'strip_redundant', 'semantic_rewrite'] : undefined}
                locked={!sid || running || groups.length === 0}
                live={mode === 'live' && !!health?.live}
                onAttack={runAttack}
                attacked={lastAttackResult !== null}
                detected={!!lastAttackResult && (lastAttackResult.layer1.z > (lastAttackResult.tau ?? health?.tau ?? 2) || lastAttackResult.layer2.z > (lastAttackResult.tau ?? health?.tau ?? 2))}
                hse={scenario === 'hse'} />
            </div>}
          </div>

          {                                                            }
          {scenario !== 'hse' && <GuidedRace g={raceGroup} prevLabel={racePrevLabel} scenario={scenario}
                      open={showRace} onToggle={() => setShowRace((v) => !v)} />}


          {                                                               }
          <button onClick={() => setShowTech((v) => !v)}
            className="w-full card px-4 py-2.5 flex items-center justify-between text-[12px]
                       text-slate-500 hover:text-slate-700 border border-dashed border-slate-300
                       transition-colors">
            <span>{showTech ? '▾' : '▸'}&nbsp; Technical details — z-scores, candidate tables, key calibration</span>
            <span className="text-[11px] text-slate-300">for the engineering team</span>
          </button>
          {showTech && (
            <div className="space-y-3">
              {renderInstruments(true)}
              {groups.length > 0 && (
                <div ref={feedRef}
                     className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(23rem,1fr))]">
                  <AnimatePresence initial={false}>
                    {groups.map((g) => (
                      <GroupCard key={g.i} g={ppeInspection && g.i > reviewCompleted ? { ...g, result: '', observations: g.observations.filter(o => o.confirm) } : g}
                                 active={running && g.i === groups.length - 1} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {                                                   }
      {view === 'expert' && (
      <div className={`grid gap-3 p-3 items-start ${constructionReview ? 'grid-cols-[13rem_minmax(0,1fr)] max-w-[1500px] mx-auto' : 'grid-cols-[13rem_minmax(0,1fr)_20rem]'}`}>

        {                                         }
        <div className="sticky top-[3.75rem] flex flex-col gap-3
                        max-h-[calc(100vh-4.5rem)] overflow-y-auto pr-0.5">
          <div className="card p-2.5">
            {                                                                 }
            <div className="flex rounded-lg bg-slate-100 p-0.5 mb-2">
              <button onClick={() => setMode('live')} disabled={!health?.live || running || scenario === 'hse'}
                className={[
                  'flex-1 flex items-center justify-center gap-1 rounded-md py-1',
                  'text-[11px] font-semibold transition-colors',
                  mode === 'live' ? 'bg-white text-emerald-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                  !health?.live || scenario === 'hse' ? 'opacity-40 cursor-not-allowed' : '',
                ].join(' ')}>
                <Radio size={11} /> {t('modeLive')}
              </button>
              <button onClick={() => setMode('offline')} disabled={running}
                className={[
                  'flex-1 flex items-center justify-center gap-1 rounded-md py-1',
                  'text-[11px] font-semibold transition-colors',
                  mode === 'offline' ? 'bg-white text-slate-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}>
                <WifiOff size={11} /> {constructionPreview ? '3D preview' : t('modeOffline')}
              </button>
            </div>

            {staticMode && !health?.live && (
              <div className="mb-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-2 py-1.5
                              text-[10px] leading-snug text-slate-500">
                {constructionPreview ? '3D scene preview is available. The recorded LLM agent run is pending.' : constructionReview ? constructionSourceNote : t('staticNote')}
              </div>
            )}

            {mode === 'live' ? (
              <>
                <div className="text-[10px] font-semibold text-slate-500 mb-1.5 tracking-wide">
                  {t('liveHint', { n: games.length })}
                </div>
                <select value={taskId} onChange={(e) => setTaskId(+e.target.value)}
                  className="w-full rounded-lg bg-slate-50 px-2 py-1.5 text-[11px]
                             ring-1 ring-slate-200 outline-none focus:ring-l1-400">
                  {games.map((g) => (
                    <option key={g.task_id} value={g.task_id}>
                      #{g.task_id} · {g.task_type}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <div className="text-[10px] font-semibold text-slate-500 mb-1.5 tracking-wide">
                  {constructionPreview ? 'Choose a construction scene' : t('offlineHint', { n: scenarioReplays.length })}
                </div>
                <select value={gameId} onChange={(e) => chooseReplay(e.target.value)} disabled={running}
                  className="w-full rounded-lg bg-slate-50 px-2 py-1.5 text-[11px]
                             ring-1 ring-slate-200 outline-none focus:ring-l1-400">
                  {!scenarioReplays.length && <option value="">No recorded LLM replay available yet</option>}
                  {scenarioReplays.map((r, index) => (
                    <option key={r.game_id} value={r.game_id}>
                      {replayOptionLabel(r, index)}
                      {!r.previewOnly && Number.isFinite(r.z1) ? ` · z₁=${r.z1.toFixed(1)}` : ''}
                      {!r.previewOnly && Number.isFinite(r.z2) ? ` · z₂=${r.z2.toFixed(1)}` : ''}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Gauge size={11} className="text-slate-400 shrink-0" />
                  <input type="range" min={0.5} max={4} step={0.5} value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="flex-1 accent-l1-500" />
                  <span className="w-8 text-right text-[10px] tabular-nums text-slate-500"
                        title={t('speed')}>{speed}×</span>
                </div>
              </>
            )}

            {                                                    }
            <button onClick={start}
              disabled={running || constructionPreview || !ppeReady || (mode === 'live' ? !health?.live : !gameId)}
              title={constructionPreview ? 'A recorded LLM run is required before replaying agent actions.' : undefined}
              className="group mt-2.5 w-full flex items-center justify-between gap-1.5
                         rounded-full bg-l1-500 text-white text-[12px] font-semibold
                         pl-4 pr-1.5 py-1.5 shadow-[0_8px_20px_-8px_rgba(99,102,241,.6)]
                         transition-all duration-500 ease-fluid
                         hover:bg-l1-700 active:scale-[0.98] disabled:opacity-40
                         disabled:shadow-none">
              <span>{running ? t('runningNow') : ppeInspection ? 'Replay full TRACE' : constructionReview ? 'Start replay' : mode === 'live' ? t('startLive') : t('startReplay')}</span>
              <span className="grid place-items-center w-7 h-7 rounded-full bg-white/15
                               transition-transform duration-500 ease-fluid
                               group-hover:translate-x-0.5 group-hover:scale-105">
                {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              </span>
            </button>

            {task && (
              <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 ring-1 ring-amber-200">
                <div className="text-[9px] text-amber-600 font-semibold">{t('goal')}</div>
                <div className="text-[11px] text-amber-900 leading-snug">{task.desc}</div>
              </div>
            )}
          </div>

          {                                                                    }
          {scenario === 'alfworld' && <RoomLegend />}

          <div className="card p-2 flex items-start gap-1.5 text-[10px] text-slate-400">
            <ShieldCheck size={12} className="text-emerald-500 shrink-0 mt-0.5" />
            {constructionPreview
              ? 'The robot checks current workwear and footwear. Findings, correction and reinspection appear with a verified model record.'
              : scenario === 'hse'
              ? 'detection reads the executed stream · candidate sets come from the per-group record, which cannot be edited after the fact'
              : t('robustPath')}
          </div>

        </div>

        {                                                    }
        <div className="space-y-3">
          {reviewError && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{reviewError} <button onClick={retryRecord} className="ml-2 underline">Reload record</button></div>}
          {constructionPreview ? <ConstructionWorkflowPending taskType={selectedReplay?.task_type} /> : constructionReview && (workflow.length > 0 || ppeInspection && pairedWorkflow) && (
            pairedWorkflow
              ? ppeInspection ? <PPEWorkflowComparison key={`${gameId}:${reviewEpoch}`} pair={pairedWorkflow} current={current}
                  completedIndex={reviewCompleted} running={running} fullReplayComplete={runFinished} playback={actionReplay.active} watched={actionReplay.watched} onPlay={playPPEAction} onSelectCheck={setSelectedPPECheck} />
              : <PairedWorkflowStrip key={`${gameId}:${reviewEpoch}`} phases={workflow} pair={pairedWorkflow}
                  current={current} completedIndex={reviewCompleted} running={running} expanded={expanded}
                  followReplay={expandedPhase === null} onFollow={() => setExpandedPhase(null)}
                  onToggle={(id) => setExpandedPhase(id)} />
              : <WorkflowStrip phases={workflow} current={current} running={running}
                  expanded={expanded} onToggle={(id) => setExpandedPhase(id === expanded ? '' : id)} />
          )}
          <div>
            {                                                       }
            <div className="bezel shadow-lift"
                 style={{ height: roomFocus ? 'calc(100vh - 6rem)' : constructionReview ? Math.max(520, roomH) : roomH }}>
              <div className="bezel-core h-full overflow-hidden">
                {scenario === 'hse' ? (
                  ppeInspection ? <PPEInspectionScene pair={pairedWorkflow} groups={groups} completedIndex={reviewCompleted} running={running} caseId={gameId} speed={speed} replayEpoch={reviewEpoch} onActionComplete={onReviewActionComplete} playback={actionReplay.active} onPlaybackComplete={actionReplay.complete} selectedCheck={selectedPPECheck} onPlay={playPPEAction} /> : <ConstructionReviewScene pair={pairedWorkflow} groups={groups} running={running} caseId={gameId} speed={speed} replayEpoch={reviewEpoch} onActionComplete={onReviewActionComplete} />
                ) : (
                  <VoxelRoom s={scene} expanded={roomFocus} onArrive={onArrive}
                             speed={mode === 'offline' ? speed : 1}
                             onToggleExpand={() => setRoomFocus((v) => !v)} />
                )}
              </div>
            </div>
            {!roomFocus && (
              <div onPointerDown={startResize} title="drag to resize"
                className="group h-3 mt-1 flex items-center justify-center
                           cursor-ns-resize select-none touch-none">
                <span className="h-1 w-16 rounded-full bg-slate-300
                                 group-hover:bg-l1-400 transition-colors" />
              </div>
            )}
          </div>

          {constructionReview && <>
            {!ppeInspection && <EntryAttributionPanel pair={pairedWorkflow} available={runFinished} />}
            {renderInstruments(true)}
          </>}

          {constructionPreview ? (
            <div className="card px-4 py-3 text-[11px] leading-relaxed text-slate-500">
              <b className="text-indigo-600">3D preview · agent run pending.</b> Scene exploration does not produce an agent trajectory. The action log and watermark results will appear with a recorded LLM run.
            </div>
          ) : groups.length === 0 ? (
            <div className="card h-40 flex items-center justify-center text-center">
              <div>
                <div className="grid place-items-center mb-2 opacity-80">
                  <Logo size={40} />
                </div>
                <div className="text-sm text-slate-400">{t('emptyTitle')}</div>
                <div className="text-[11px] text-slate-300 mt-1">
                  {mode === 'live' ? t('emptySubLive') : t('emptySubOffline')}
                </div>
              </div>
            </div>
          ) : (
            <div ref={feedRef}
                 className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(23rem,1fr))]">
              <AnimatePresence initial={false}>
                {groups.map((g) => (
                  <GroupCard key={g.i} g={ppeInspection && g.i > reviewCompleted ? { ...g, result: '', observations: g.observations.filter(o => o.confirm) } : g}
                             active={running && g.i === groups.length - 1} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {                                                               }
        {!constructionReview && <div className="sticky top-[3.75rem] space-y-2
                        max-h-[calc(100vh-4.5rem)] overflow-y-auto pr-1">
          {renderInstruments(false)}
        </div>}
      </div>
      )}

      {                                                                          }
      <AnimatePresence>
        {unseen > 0 && !follow && (
          <motion.button
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }} onClick={jumpToLatest}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center
                       gap-1.5 rounded-full bg-slate-900/90 backdrop-blur px-3.5 py-2
                       text-[12px] font-semibold text-white shadow-lg
                       hover:bg-slate-900">
            <ArrowDown size={13} />
            {t('newGroups', { n: unseen })}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}


function MobileGate() {
  const { t } = useI18n()
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center text-center
                    px-6 py-10 bg-canvas">
      <motion.img src={asset("paper/mascot.png")} alt="TRACE mascot"
        className="w-40 drop-shadow-[0_16px_28px_rgba(99,102,241,0.25)]"
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} />

      <div className="mt-6 font-display text-[15px] font-extrabold text-slate-900">
        <span className="text-l1-500">TRACE</span> Watermark
      </div>
      <h1 className="mt-4 font-display font-bold text-[22px] leading-snug text-slate-900 max-w-sm">
        {t('mobileTitle')}
      </h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-slate-600 max-w-sm">
        {t('mobileBody')}
      </p>
      <a href="#/"
        className="mt-7 inline-flex items-center gap-2 rounded-full bg-l1-500 text-white
                   px-5 py-2.5 text-[14px] font-semibold shadow-[0_10px_24px_-10px_rgba(99,102,241,.7)]
                   active:scale-[0.98] transition-transform">
        {t('mobileBack')}
      </a>
    </div>
  )
}
