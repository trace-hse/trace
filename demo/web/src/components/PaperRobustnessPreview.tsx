import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, FileText, PencilLine, Trash2, X, XCircle } from 'lucide-react'
import { PAPER_ROBUSTNESS, PAPER_ROBUSTNESS_SOURCE, nearestPaperPoint, type PaperAttack } from '../lib/paperRobustness'
import './PaperRobustnessPreview.css'

const EXAMPLE_ACTIONS = [
  ['Read', 'View'], ['Look', 'Scan'], ['Ask', 'Tell'], ['Save', 'Send'], ['Read', 'View'],
  ['Look', 'Scan'], ['Save', 'Send'], ['Ask', 'Tell'], ['Read', 'View'], ['Save', 'Send'],
] as const
const METER_MIN = -5, METER_MAX = 16

export default function PaperRobustnessPreview() {
  const headingId = useId(), sliderId = useId()
  const [attack, setAttack] = useState<PaperAttack>('deletion')
  const [strength, setStrength] = useState(0)
  const reducedMotion = useReducedMotion() === true
  const point = nearestPaperPoint(attack, strength)
  const points = PAPER_ROBUSTNESS[attack]
  const maximum = points[points.length - 1].strength
  const step = attack === 'deletion' ? 10 : 20
  const editedCount = Math.round(point.strength / 10)
  const selectionDetected = point.selection > PAPER_ROBUSTNESS_SOURCE.threshold
  const tallyDetected = point.tally > PAPER_ROBUSTNESS_SOURCE.threshold
  const summary = selectionDetected && tallyDetected ? 'Both watermarks are still detected.'
    : selectionDetected ? 'Choice watermark still identifies the source.'
      : tallyDetected ? 'Count watermark still identifies the source.' : 'Neither watermark is detected.'
  const transition = { duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }
  const channels = [
    { id: 'selection', label: 'Choice watermark', layer: 'Layer 1', score: point.selection, detected: selectionDetected },
    { id: 'tally', label: 'Count watermark', layer: 'Layer 2', score: point.tally, detected: tallyDetected },
  ] as const

  function changeAttack(next: PaperAttack) {
    setAttack(next)
    setStrength(nearestPaperPoint(next, point.strength).strength)
  }

  return <section className="paper-robustness" data-paper-robustness data-attack={attack}
    data-motion={reducedMotion ? 'reduced' : 'standard'} data-edited-count={editedCount} aria-labelledby={headingId}>
    <div className="pr-controls">
      <h4 id={headingId}>Try to hide the watermark</h4>
      <div className="pr-attacks" role="group" aria-label="Paper benchmark attack">
        <button type="button" aria-pressed={attack === 'deletion'} onClick={() => changeAttack('deletion')}>
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" /> Delete records
        </button>
        <button type="button" aria-pressed={attack === 'rewriting'} onClick={() => changeAttack('rewriting')}>
          <PencilLine size={14} strokeWidth={1.5} aria-hidden="true" /> Rewrite actions
        </button>
      </div>
      <label className="pr-strength" htmlFor={sliderId}>
        <span>{attack === 'deletion' ? 'Notes to remove' : 'Actions to rewrite'}</span>
        <output htmlFor={sliderId}>{point.strength}%</output>
      </label>
      <input id={sliderId} type="range" min={0} max={maximum} step={step} value={point.strength}
        aria-valuetext={`${point.strength}% of ${attack === 'deletion' ? 'observation records deleted' : 'decision groups rewritten'}`}
        onChange={event => setStrength(nearestPaperPoint(attack, Number(event.target.value)).strength)} />
      <div className="pr-records" data-illustrated-records role="img"
        aria-label={`${editedCount} of 10 illustrated ${attack === 'deletion' ? 'notes removed; all actions kept' : 'actions rewritten; record count kept'}`}>
        {EXAMPLE_ACTIONS.map(([original, replacement], index) => {
          const edited = index < editedCount
          const deleted = attack === 'deletion' && edited
          const rewritten = attack === 'rewriting' && edited
          return <div key={index} className="pr-record-slot" data-record-slot={index}
            data-edited={edited} data-edit-kind={deleted ? 'deleted' : rewritten ? 'rewritten' : 'none'} aria-hidden="true">
            <div className="pr-action-word">
              <motion.span key={rewritten ? 'rewritten' : 'original'} data-action-word
                initial={rewritten && !reducedMotion ? { rotateX: -85, opacity: 0.3 } : false}
                animate={{ rotateX: 0, opacity: 1 }} transition={transition}>
                {rewritten ? replacement : original}
              </motion.span>
            </div>
            <div className="pr-note-slot" data-note-removed={deleted}>
              <motion.span className="pr-record-note" data-illustrated-note initial={false}
                animate={{ y: deleted && !reducedMotion ? 12 : 0, rotate: deleted && !reducedMotion ? 9 : 0, opacity: deleted ? 0 : 1 }}
                transition={{ ...transition, delay: reducedMotion ? 0 : index * 0.012 }}>
                <FileText size={16} strokeWidth={1.5} />
              </motion.span>
              {deleted && <X size={14} strokeWidth={1.5} className="pr-deleted-mark" />}
            </div>
          </div>
        })}
      </div>
      <div className="pr-edit-caption">
        <strong data-illustrated-edit-count>{editedCount} of 10 {attack === 'deletion' ? 'notes removed' : 'actions rewritten'}</strong>
        <span>{attack === 'deletion' ? 'Actions kept' : 'Record count kept'}</span>
      </div>
    </div>
    <div className="pr-evidence">
      <div className="pr-results" role="group" aria-label="Approximate paper detection results" aria-live="polite" aria-atomic="true">
        {channels.map(channel => {
          const status = channel.detected ? 'Still detected' : 'Not detected'
          const StatusIcon = channel.detected ? CheckCircle2 : XCircle
          return <div key={channel.id} className="pr-result-card" data-channel={channel.id} data-detected={channel.detected}>
            <div className="pr-channel-name">{channel.label} <small>{channel.layer}</small></div>
            <motion.strong key={status} className="pr-verdict" data-detection-verdict
              initial={reducedMotion ? false : { opacity: 0.45, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={transition}>
              <StatusIcon size={20} strokeWidth={1.5} aria-hidden="true" /> {status}
            </motion.strong>
            <span className="pr-score" data-paper-score={channel.score}>Detection score ≈{channel.score.toFixed(1)}</span>
            <div className="pr-meter" role="meter" aria-label={`${channel.label} detection score`}
              aria-valuemin={METER_MIN} aria-valuemax={METER_MAX} aria-valuenow={channel.score}
              aria-valuetext={`${status}; approximately ${channel.score.toFixed(1)}; detection line ${PAPER_ROBUSTNESS_SOURCE.threshold}`}>
              <motion.span className="pr-meter-fill" data-detection-fill initial={false}
                animate={{ scaleX: (channel.score - METER_MIN) / (METER_MAX - METER_MIN) }} transition={transition} />
              <span className="pr-detection-line" data-detection-line
                style={{ left: `${(PAPER_ROBUSTNESS_SOURCE.threshold - METER_MIN) / (METER_MAX - METER_MIN) * 100}%` }} />
            </div>
            <span className="pr-meter-label">Detection line: {PAPER_ROBUSTNESS_SOURCE.threshold}</span>
          </div>
        })}
      </div>
      <p className="pr-note" data-detection-summary>{summary}</p>
    </div>
    <p className="pr-source">Illustration only · <a href={PAPER_ROBUSTNESS_SOURCE.url} target="_blank" rel="noreferrer">Paper Fig. 5</a> · approximate ToolBench readings, not HSE measurements</p>
  </section>
}
