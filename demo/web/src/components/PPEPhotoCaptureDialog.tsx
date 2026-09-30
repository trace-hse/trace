import { useEffect, useId, useRef } from 'react'
import { ArrowRight, Camera, Check, X } from 'lucide-react'
import type { PlaybackArm } from '../lib/ppePlayback'
import type { PairedTrajectoryStep } from './PairedWorkflowStrip'
import inspectionPhoto from '../assets/ppe-inspection-photo.png'
import './PPEPhotoCaptureDialog.css'

interface Props {
  source: PlaybackArm
  step: PairedTrajectoryStep
  onClose: () => void
  onOpenWatermarkDemo?: () => void
}

/** A sample capture for the presentation; it does not change the recorded workflow. */
export default function PPEPhotoCaptureDialog({ source, step, onClose, onOpenWatermarkDemo }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const noteId = useId()
  const watermarked = source === 'trace'

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

  return <dialog ref={dialog} className="ppe-photo-capture-dialog" data-photo-capture-source={source}
    aria-labelledby={titleId} aria-describedby={noteId}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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
    <header className="ppc-heading">
      <div>
        <p>{watermarked ? 'Watermarked workflow' : 'Original workflow'}</p>
        <h2 id={titleId}><Camera size={21} aria-hidden="true" />Take photo</h2>
      </div>
      <button type="button" className="ppc-close" onClick={onClose} aria-label="Close photo capture" autoFocus>
        <X size={18} aria-hidden="true" />
      </button>
    </header>
    <figure className="ppc-photo">
      <div className="ppc-photo-frame">
        <img src={inspectionPhoto} alt="Sample inspection photo of a worker wearing a hard hat, long-sleeved shirt, jeans and shoes at a building site" />
        <span className="ppc-sample-label">Sample photo</span>
      </div>
      <figcaption>Illustrative capture · linked to step {step.i + 1}</figcaption>
    </figure>
    <div className="ppc-result" data-watermark-ready={watermarked}>
      {watermarked && <Check size={16} aria-hidden="true" />}
      <strong>{watermarked ? 'Ready to add a photo watermark' : 'No watermark added'}</strong>
    </div>
    <p id={noteId} className="ppc-note">This is a sample photo for the demo, not a photo from the original log.</p>
    {watermarked && onOpenWatermarkDemo && <button type="button" className="ppc-open-demo" onClick={onOpenWatermarkDemo}>
      Open photo watermark demo<ArrowRight size={16} aria-hidden="true" />
    </button>}
  </dialog>
}
