import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, CircleOff, GitCompareArrows, KeyRound, Play, ScanSearch } from 'lucide-react'
import type { PairedTrajectoryStep, PairedWorkflowData } from './PairedWorkflowStrip'
import type { PlaybackArm } from '../lib/ppePlayback'
import { ppeActionOptionLabel } from '../lib/ppeInspection'
import { buildPPEWatermarkStory, savedExperimentSummary } from '../lib/ppeWatermarkStory'
import { optionArt } from '../lib/ppeChoiceComparison'
import { buildChoiceReplay, buildOriginalComparison, choiceReplayCandidates, ORIGINAL_COMPARISON_ID, TASK_SUCCESS } from '../lib/ppeChoiceReplay'
import { choiceArt } from '../lib/ppeChoiceArt'
import './PPEWatermarkStory.css'

export interface PPEWatermarkStoryProps {
  pair: PairedWorkflowData
  selected: { standard?: PairedTrajectoryStep; trace?: PairedTrajectoryStep }
  revealed: (source: PlaybackArm, step?: PairedTrajectoryStep) => boolean
  onSelect: (step: PairedTrajectoryStep) => void
  appliedCandidateId?: string
  selectedCandidateId?: string
  onCandidateChange?: (candidateId: string) => void
  children?: ReactNode
}

type ReplayState = { phase: 'idle' | 'running' | 'complete' | 'invalid'; candidateId: string; count: number }

function publicKeyLabel(candidates: ReturnType<typeof choiceReplayCandidates>, candidateId?: string) {
  const index = candidates.findIndex(candidate => candidate.agent_id === candidateId)
  return index >= 0 ? `Key ${String.fromCharCode(65 + index)}` : 'Key unavailable'
}

function comparisonLabel(candidates: ReturnType<typeof choiceReplayCandidates>, candidateId?: string) {
  return candidateId === ORIGINAL_COMPARISON_ID ? 'Original' : publicKeyLabel(candidates, candidateId)
}

function Illustration({ action, art }: { action?: string; art?: string }) {
  const image = choiceArt(art ?? optionArt(action ?? ''))
  return <div className="pws-image" data-story-art={art ?? optionArt(action ?? '')} aria-hidden="true"
    style={{ backgroundImage: `url("${image.src}")`, backgroundPosition: image.position, backgroundSize: image.size }} />
}

/** Compares saved sampler results; it never runs an agent or changes the recorded log. */
export default function PPEWatermarkStory({ pair, selected, revealed, onSelect, appliedCandidateId, selectedCandidateId, onCandidateChange, children }: PPEWatermarkStoryProps) {
  const titleId = useId(), contentId = useId()
  const reducedMotion = useReducedMotion()
  const candidates = choiceReplayCandidates(pair), first = candidates[0]
  const initialCandidateId = selectedCandidateId === ORIGINAL_COMPARISON_ID
    ? ORIGINAL_COMPARISON_ID
    : candidates.find(candidate => candidate.agent_id === selectedCandidateId)?.agent_id
      ?? candidates.find(candidate => candidate.agent_id === appliedCandidateId)?.agent_id ?? first?.agent_id ?? ''
  const [candidateId, setCandidateId] = useState(initialCandidateId)
  const [check, setCheck] = useState<ReplayState>({ phase: 'idle', candidateId: '', count: 0 })
  const [focusedChoiceKey, setFocusedChoiceKey] = useState('')
  const [expanded, setExpanded] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const story = buildPPEWatermarkStory(pair, selected, revealed)
  const differences = story.differences.filter(choice => choice.keyGuided && !choice.forced)
  const current = differences.find(choice => choice.key === story.current?.key) ?? differences[0]
  const replay = check.candidateId === ORIGINAL_COMPARISON_ID
    ? buildOriginalComparison(differences, true)
    : buildChoiceReplay(pair, differences, check.candidateId, true)
  const activeRow = check.phase === 'running' ? replay.rows[Math.max(0, check.count - 1)] : undefined
  const focusedRow = replay.rows.find(row => row.choice.key === focusedChoiceKey)
  const firstDifferentRow = check.phase === 'complete' ? replay.rows.find(row => !row.match) : undefined
  const detailRow = activeRow ?? focusedRow ?? firstDifferentRow
  const detailVisible = !!detailRow && (check.phase === 'complete' || check.phase === 'running' && check.count > 0)
  const activeCandidate = candidates.find(candidate => candidate.agent_id === candidateId)
  const appliedCandidate = candidates.find(candidate => candidate.agent_id === appliedCandidateId)
  const activeIsOriginal = candidateId === ORIGINAL_COMPARISON_ID
  const checkedIsOriginal = check.candidateId === ORIGINAL_COMPARISON_ID
  const activeSelectionValid = activeIsOriginal || !!activeCandidate
  const activeSelectionLabel = comparisonLabel(candidates, candidateId)
  const appliedKeyLabel = publicKeyLabel(candidates, appliedCandidate?.agent_id)
  const checkedSelectionLabel = comparisonLabel(candidates, check.candidateId)
  const matchesShown = replay.rows.slice(0, check.count).filter(row => row.match).length
  const comparedCount = Math.min(check.count, differences.length)
  const scoreMatches = check.phase === 'complete' && replay.matches !== null ? replay.matches : matchesShown
  const scorePercent = differences.length ? Math.round(scoreMatches / differences.length * 100) : 0
  const savedExperiment = savedExperimentSummary(pair)
  const experimentCandidate = checkedIsOriginal ? undefined : savedExperiment.candidates.find(candidate => candidate.id === check.candidateId)
  const experimentReady = check.phase === 'complete' && savedExperiment.status !== 'unavailable' && !!experimentCandidate
    && savedExperiment.threshold !== null && experimentCandidate.z1 !== null && experimentCandidate.z2 !== null
    && experimentCandidate.layer1 !== null && experimentCandidate.layer2 !== null
    && experimentCandidate.n1 !== null && experimentCandidate.n1 > 0
    && experimentCandidate.n2 !== null && experimentCandidate.n2 > 0
  const experimentPasses = experimentReady && experimentCandidate
    ? Number(experimentCandidate.layer1 === true) + Number(experimentCandidate.layer2 === true)
    : null
  const verdictState = check.phase !== 'complete' ? 'pending'
    : checkedIsOriginal ? 'no-key'
      : !appliedCandidate ? 'unavailable'
        : check.candidateId !== appliedCandidate.agent_id ? 'incorrect'
          : replay.matches === replay.total ? 'correct' : 'unavailable'

  function cancel() { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => {
    cancel()
    const available = choiceReplayCandidates(pair)
    const nextId = selectedCandidateId === ORIGINAL_COMPARISON_ID
      ? ORIGINAL_COMPARISON_ID
      : available.find(candidate => candidate.agent_id === selectedCandidateId)?.agent_id
        ?? available.find(candidate => candidate.agent_id === appliedCandidateId)?.agent_id ?? available[0]?.agent_id ?? ''
    setCandidateId(nextId)
    setCheck({ phase: 'idle', candidateId: '', count: 0 })
    setFocusedChoiceKey('')
    return cancel
  }, [pair, reducedMotion, selectedCandidateId, appliedCandidateId])

  function changeCandidate(nextCandidateId: string) {
    cancel()
    setCandidateId(nextCandidateId)
    setCheck({ phase: 'idle', candidateId: '', count: 0 })
    setFocusedChoiceKey('')
    onCandidateChange?.(nextCandidateId)
  }

  function compare() {
    cancel()
    const data = candidateId === ORIGINAL_COMPARISON_ID
      ? buildOriginalComparison(differences, true)
      : buildChoiceReplay(pair, differences, candidateId, true)
    if (!activeSelectionValid || data.status !== 'ready') {
      setCheck({ phase: 'invalid', candidateId, count: 0 })
      return
    }
    if (reducedMotion) {
      setCheck({ phase: 'complete', candidateId, count: data.rows.length })
      return
    }
    setCheck({ phase: 'running', candidateId, count: 0 })
    const delay = Math.max(110, Math.min(250, 2000 / data.rows.length))
    data.rows.forEach((_, index) => timers.current.push(setTimeout(() => {
      setCheck({ phase: index === data.rows.length - 1 ? 'complete' : 'running', candidateId, count: index + 1 })
    }, delay * (index + 1))))
  }

  const resultState = check.phase === 'invalid' ? 'unavailable'
    : check.phase === 'complete' && replay.status === 'ready' && replay.total > 0
      ? replay.matches === replay.total ? 'match' : 'different'
      : 'pending'
  const differentCount = replay.status === 'ready' && replay.matches !== null ? replay.total - replay.matches : 0
  const resultTitle = check.phase === 'invalid' ? 'Comparison unavailable'
    : check.phase === 'running' ? 'Comparing choices…'
      : verdictState === 'correct' ? 'Correct demo key'
        : verdictState === 'incorrect' ? 'Not the injected key'
          : verdictState === 'no-key' ? 'Original — no key'
            : verdictState === 'unavailable' ? 'Result unavailable'
              : `Ready to check ${activeSelectionLabel}`
  const resultNote = check.phase === 'invalid' ? 'Choose Original or one of the registered demo keys.'
    : check.phase === 'running' ? `${comparedCount} of ${differences.length} choices checked for ${checkedSelectionLabel}.`
      : verdictState === 'correct' ? `${checkedSelectionLabel} was injected in step 2.`
        : verdictState === 'incorrect' && experimentPasses === 1 ? `Mixed test result — step 2 recorded ${appliedKeyLabel}, not ${checkedSelectionLabel}.`
          : verdictState === 'incorrect' ? `Step 2 recorded ${appliedKeyLabel}, not ${checkedSelectionLabel}.`
            : verdictState === 'no-key' ? 'Original is the no-watermark reference, so there are no key scores to test.'
              : verdictState === 'unavailable' ? 'The saved record is not complete enough to verify this key.'
                : `We’ll compare the choices, then show the saved experiment scores.`
  const gridStatus = check.phase === 'invalid' ? 'Unavailable'
    : check.phase === 'running' ? `Checking ${comparedCount}/${differences.length}`
      : resultState === 'match' ? 'No differences'
        : resultState === 'different' ? `${differentCount} ${differentCount === 1 ? 'difference' : 'differences'}`
          : 'Ready'
  const liveMessage = check.phase === 'running' ? `Comparison started for ${checkedSelectionLabel}.`
    : check.phase === 'complete' || check.phase === 'invalid' ? `${resultTitle}. ${resultNote}`
      : `Ready to check ${activeSelectionLabel}.`
  const scoreAriaLabel = check.phase === 'running'
    ? `${matchesShown} of ${comparedCount} checked choices match; ${comparedCount} of ${differences.length} choices checked`
    : checkedIsOriginal
      ? `Choice match ${scoreMatches} of ${differences.length}; match rate ${scorePercent} percent; no key scores to test`
      : experimentReady && experimentCandidate && experimentPasses !== null && savedExperiment.threshold !== null
        ? `Choice match ${scoreMatches} of ${differences.length}; match rate ${scorePercent} percent; saved experiment ${experimentPasses} of 2 checks passed; scores ${experimentCandidate.z1?.toFixed(2)} and ${experimentCandidate.z2?.toFixed(2)}; pass above ${savedExperiment.threshold.toFixed(2)}`
        : `Choice match ${scoreMatches} of ${differences.length}; match rate ${scorePercent} percent; saved experiment unavailable`

  return <section className="ppe-watermark-story" data-watermark-story data-expanded={expanded} data-replay-state={check.phase} aria-labelledby={titleId}>
    <header className="pws-toolbar">
      <h3 id={titleId}><span className="pws-number">3</span>Check the watermark</h3>
      <span className="pws-current-key"><KeyRound size={13} />{appliedCandidate ? `Recorded with ${appliedKeyLabel} · step 2` : 'Injected key not available'}</span>
      <button type="button" className="pws-expand" aria-label={expanded ? 'Collapse comparison' : 'Expand comparison'}
        aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{expanded ? 'Collapse' : 'Expand'}
      </button>
    </header>
    <div id={contentId} hidden={!expanded}>{expanded && <>
      <section className="pws-replay" aria-label="Check Original or a demo key against the recorded workflow">
        <div className="pws-key-line">
          <div className="pws-key-copy"><strong>Choose what to compare</strong><span>Original has no watermark. Key A is the workflow recorded in step 2.</span></div>
          <div className="pws-key-presets" role="group" aria-label="Choose Original or a demo key">
            <button type="button" data-replay-option="original" aria-pressed={activeIsOriginal}
              onClick={() => changeCandidate(ORIGINAL_COMPARISON_ID)}>Original</button>
            {candidates.map((candidate, index) => {
              const label = `Key ${String.fromCharCode(65 + index)}`
              return <button key={candidate.agent_id} type="button" data-replay-option={label} aria-pressed={activeCandidate?.agent_id === candidate.agent_id}
                data-applied={candidate.agent_id === appliedCandidate?.agent_id} onClick={() => changeCandidate(candidate.agent_id)}>{label}</button>
            })}
          </div>
          <button type="button" className="pws-verify" data-replay-verify onClick={compare}
            disabled={!differences.length || !activeSelectionValid || check.phase === 'running'}>
            <Play size={14} />{activeIsOriginal ? 'Check Original' : `Check ${activeSelectionLabel}`}
          </button>
        </div>
        <div className="pws-replay-result" data-replay-result={resultState} data-verdict={verdictState}>
          <div className="pws-result-summary">
            {verdictState === 'correct' ? <CheckCircle2 size={24} /> : verdictState === 'incorrect' ? <GitCompareArrows size={24} /> : verdictState === 'no-key' ? <CircleOff size={21} /> : check.phase === 'running' ? <ScanSearch size={22} /> : activeIsOriginal ? <CircleOff size={21} /> : <KeyRound size={21} />}
            <div><strong>{resultTitle}</strong><p>{resultNote}</p></div>
          </div>
          {(check.phase === 'running' || check.phase === 'complete') && <div className="pws-result-metrics"
            data-score-phase={check.phase} role="group" aria-label={scoreAriaLabel}
            style={{ '--pws-score': scorePercent / 100, '--pws-progress': differences.length ? comparedCount / differences.length : 0 } as CSSProperties}>
            <div className="pws-result-metric pws-replay-score">
              <div className="pws-metric-heading"><span>Choice match</span><strong>{check.phase === 'running' ? `${matchesShown}/${comparedCount}` : `${scoreMatches}/${differences.length}`}</strong></div>
              <div className="pws-score-track" aria-hidden="true"><i className="pws-score-progress" /><i className="pws-score-fill" /></div>
              <div className="pws-metric-foot"><span>{check.phase === 'running' ? `Checking ${comparedCount}/${differences.length}` : 'Match rate'}</span><b>{check.phase === 'running' ? 'Checking…' : `${scorePercent}%`}</b></div>
            </div>
            {check.phase === 'complete' && <div className="pws-result-metric pws-experiment-metric" data-experiment-ready={experimentReady}>
              <div className="pws-metric-heading"><span>Saved experiment checks</span><strong>{checkedIsOriginal ? 'Not tested' : experimentPasses === null ? 'Unavailable' : `${experimentPasses} of 2 passed`}</strong></div>
              {experimentReady && experimentCandidate && savedExperiment.threshold !== null ? <>
                <div className="pws-experiment-scores" aria-hidden="true">
                  <span data-passed={experimentCandidate.layer1}><b>{experimentCandidate.z1?.toFixed(2)}</b><i>{experimentCandidate.layer1 ? <Check size={11} /> : '×'}</i></span>
                  <span data-passed={experimentCandidate.layer2}><b>{experimentCandidate.z2?.toFixed(2)}</b><i>{experimentCandidate.layer2 ? <Check size={11} /> : '×'}</i></span>
                </div>
                <small>Saved scores · pass above {savedExperiment.threshold.toFixed(2)}</small>
              </> : <small>{checkedIsOriginal ? 'Original has no watermark key.' : 'No valid saved scores for this key.'}</small>}
            </div>}
          </div>}
          <span className="pws-sr-only" role="status" aria-live="polite">{liveMessage}</span>
        </div>
        <div className="pws-grid-caption">
          <span>{differences.length} comparable choices · {pair.trace.steps.length - differences.length} unchanged steps hidden</span>
          <span data-grid-state={resultState}><i />{gridStatus}</span>
        </div>
        <div className="pws-action-matrix-wrap">
          <div className="pws-action-matrix" role="group" aria-label={`${activeSelectionLabel} on top compared with the recorded ${appliedKeyLabel} workflow below`}
            aria-busy={check.phase === 'running'}
            style={{ '--pws-choice-count': differences.length } as CSSProperties}>
            <span className="pws-matrix-corner">Action</span>
            {differences.map(choice => <span key={`step-${choice.key}`} className="pws-matrix-step">{String(choice.trace.i + 1).padStart(2, '0')}</span>)}
            <div className="pws-row-label pws-compare-label"><span>Top</span><strong>{activeSelectionLabel}</strong><small>{activeIsOriginal ? 'No watermark' : 'Selected replay'}</small></div>
            {differences.map((choice, index) => {
              const row = replay.rows[index]
              const visible = !!row && index < check.count && (check.phase === 'running' || check.phase === 'complete')
              const matchState = visible && row ? String(row.match) : 'pending'
              return <button key={`compare-${choice.key}`} type="button" className="pws-matrix-cell pws-replay-choice"
                data-replay-step={choice.trace.i} data-replay-match={matchState}
                data-top-action={visible && row ? row.replayed : ''} data-recorded-action={choice.trace.action}
                data-mismatch-highlighted={visible && row && !row.match ? 'true' : 'false'}
                data-active={check.phase === 'running' && index === check.count - 1}
                aria-pressed={choice.key === current?.key} disabled={check.phase === 'running'}
                aria-label={visible && row
                  ? `Action ${choice.trace.i + 1}: ${choice.title}. ${activeSelectionLabel}: ${ppeActionOptionLabel(row.replayed, row.replayed)}. Recorded: ${ppeActionOptionLabel(row.chosen, row.chosen)}. ${row.match ? 'Match' : 'Different'}.`
                  : `Action ${choice.trace.i + 1}: ${choice.title}. Waiting for comparison.`}
                onClick={() => { setFocusedChoiceKey(choice.key); onSelect(choice.trace) }}>
                <span className="pws-replayed-art" data-visible={visible}>{visible && row
                  ? <Illustration action={row.replayed} />
                  : activeIsOriginal ? <CircleOff size={19} /> : <KeyRound size={19} />}</span>
                {visible && row && <span className="pws-cell-mark" aria-hidden="true">{row.match ? <Check size={13} /> : '≠'}</span>}
              </button>
            })}
            <div className="pws-row-label pws-recorded-label"><span>Bottom</span><strong>Recorded · {appliedKeyLabel}</strong><small>Fixed reference</small></div>
            {differences.map(choice => <div key={`recorded-${choice.key}`} className="pws-matrix-cell pws-recorded-cell"
              data-recorded-step={choice.trace.i} data-recorded-action={choice.trace.action} role="img"
              aria-label={`Action ${choice.trace.i + 1} recorded choice: ${ppeActionOptionLabel(choice.trace.action, choice.trace.action)}`}>
              <Illustration action={choice.trace.action} />
            </div>)}
          </div>
        </div>
        {detailVisible && detailRow && <div className="pws-choice-detail" data-match={detailRow.match}>
          <strong>Action {detailRow.choice.trace.i + 1} · {detailRow.choice.title}</strong>
          <div><span>{checkedIsOriginal ? 'Original chose' : `${checkedSelectionLabel} replays`}: <b>{ppeActionOptionLabel(detailRow.replayed, detailRow.replayed)}</b></span><ArrowRight size={15} /><span>Recorded workflow: <b>{ppeActionOptionLabel(detailRow.chosen, detailRow.chosen)}</b></span></div>
        </div>}
        <details className="pws-replay-details"><summary>How this comparison works</summary><p>Only choice points where the unwatermarked and recorded workflows differ are shown. Original uses the paired unwatermarked action. Key A, B or C replays each saved decision using its recorded probabilities and preceding history. The comparison never runs a new inspection or changes the recorded log, and it is separate from statistical watermark detection.</p></details>
      </section>
      <section className="pws-success" aria-label="Task success in our tests"><h4>Task success in our tests<span>Task success maintained</span></h4>
        <div className="pws-success-values"><div><span>Without watermark</span><strong>≈{TASK_SUCCESS.without.toFixed(1)}%</strong><div className="pws-success-track"><i style={{ width: `${TASK_SUCCESS.without}%` }} /></div></div>
          <div><span>With watermark</span><strong>≈{TASK_SUCCESS.with.toFixed(1)}%</strong><div className="pws-success-track"><i style={{ width: `${TASK_SUCCESS.with}%` }} /></div></div></div>
        <details><summary>Test details</summary><p>Approximate task-count-weighted summary of our reported main experiments: weights 140, 134 and 150, using the rounded Table 2 means. GPT-5.4-mini, three seeds; scores are 1 for solved, 0.5 for unsure and 0 for unsolved. These are the reported experiments, not a new measurement of the two HSE examples. <a href={TASK_SUCCESS.source} target="_blank" rel="noreferrer">Source and method</a></p></details>
      </section>
    </>}{children}</div>
  </section>
}
