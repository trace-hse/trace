import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Check, Cpu, Download, History, Loader2, RefreshCw } from 'lucide-react'
import Logo from '../components/Logo'
import { STUDIO_COPY as C } from './content'
import { explainReport, probeStudio, studioDirectUrl, studioOpenUrl } from '../lib/studioProbe'
import type { PortReport, StudioFound } from '../lib/studioProbe'
import { STUDIO_DOWNLOAD_URL, STUDIO_REPROBE_MS } from '../lib/studioConfig'

export type CustomPhase = 'checking' | 'found' | 'starting' | 'notfound'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen font-sans text-slate-800">
      <header className="backdrop-blur-xl bg-white/70 ring-1 ring-slate-900/[0.05]">
        <div className="mx-auto max-w-5xl h-14 px-5 sm:px-8 flex items-center gap-3">
          <a href="#/" className="flex items-center gap-2.5 shrink-0" aria-label={C.back}>
            <div className="bezel p-1"><div className="bezel-core grid place-items-center w-8 h-8 bg-gradient-to-br from-l1-50 to-white"><Logo size={22} /></div></div>
            <span className="font-display font-extrabold text-[15px] tracking-[-0.02em] text-l1-500">TRACE</span>
          </a>
          <a href="#/" className="ml-auto text-[13px] text-slate-500 hover:text-slate-800">{C.back}</a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 sm:px-8 py-12 sm:py-20">{children}</main>
    </div>
  )
}

function ChoiceCard({ href, icon, title, body, cta, tag, accent }: {
  href: string; icon: ReactNode; title: string; body: string; cta: string; tag?: string; accent?: boolean
}) {
  return (
    <a href={href} className="group bezel block">
      <div className="bezel-core h-full p-7 sm:p-8 flex flex-col transition-shadow duration-500 group-hover:shadow-lift">
        <div className="flex items-center justify-between">
          <span className={`grid place-items-center w-11 h-11 rounded-xl ${accent ? 'bg-l2-50 text-l2-600' : 'bg-l1-50 text-l1-600'}`}>{icon}</span>
          {tag && <span className="chip bg-slate-100 text-slate-500">{tag}</span>}
        </div>
        <h2 className="mt-6 font-display font-bold text-[22px] tracking-[-0.02em] text-slate-900">{title}</h2>
        <p className="mt-3 text-[14.5px] leading-[1.7] text-slate-600 flex-1">{body}</p>
        <span className="mt-7 inline-flex items-center gap-1.5 text-[14px] font-semibold text-l1-600">
          {cta}<ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </a>
  )
}

export function DemoChooserView() {
  const c = C.chooser
  return (
    <Shell>
      <div className="max-w-2xl">
        <div className="eyebrow">{c.eyebrow}</div>
        <h1 className="mt-4 font-display font-extrabold tracking-[-0.03em] text-slate-900 text-[30px] sm:text-[40px] leading-[1.1]">{c.title}</h1>
        <p className="mt-4 text-[16px] leading-[1.7] text-slate-600">{c.lede}</p>
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <ChoiceCard href="#/demo?scenario=hse" icon={<History size={22} />} title={c.existingTitle}
          body={c.existingBody} cta={c.existingCta} />
        <ChoiceCard href="#/demo/custom" icon={<Cpu size={22} />} title={c.customTitle}
          body={c.customBody} cta={c.customCta} tag={c.customTag} accent />
      </div>
    </Shell>
  )
}

export function DemoChooser() {
  return <DemoChooserView />
}

export function CustomDemoView({ phase, found, onRetry, report }: {
  phase: CustomPhase; found: StudioFound | null; onRetry: () => void; report?: PortReport[] | null
}) {
  const c = C.custom
  const btn = 'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold transition-colors'
  const steps = [c.step1, c.step2, c.step3]
  return (
    <Shell>
      <div className="max-w-xl mx-auto">
        <div className="bezel"><div className="bezel-core p-7 sm:p-9" aria-live="polite" data-phase={phase}>
          {phase === 'checking' && (
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 size={20} className="animate-spin text-l1-500" /><span className="text-[15px]">{c.checking}</span>
            </div>
          )}

          {(phase === 'found' || phase === 'starting') && found && (
            <>
              <div className="flex items-center gap-3">
                <span className={`grid place-items-center w-9 h-9 rounded-full ${phase === 'found' ? 'bg-emerald-50 text-emerald-600' : 'bg-l1-50 text-l1-600'}`}>
                  {phase === 'found' ? <Check size={18} /> : <Loader2 size={18} className="animate-spin" />}
                </span>
                <h1 className="font-display font-bold text-[20px] tracking-[-0.02em] text-slate-900">
                  {(phase === 'found' ? c.found : c.starting)}
                </h1>
              </div>
              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-1 text-[13.5px] text-slate-600">
                {found.hello.version && <div className="flex gap-2"><dt className="text-slate-400">{c.version}</dt><dd className="font-mono">{found.hello.version}</dd></div>}
                {found.hello.model && <div className="flex gap-2"><dt className="text-slate-400">{c.model}</dt><dd className="font-mono">{found.hello.model}</dd></div>}
              </dl>
              {phase === 'found' ? (
                <>
                  <a href={studioOpenUrl(found)} className={`${btn} mt-7 bg-l1-600 text-white hover:bg-l1-700`}>
                    {c.open}<ArrowRight size={16} />
                  </a>
                  <p className="mt-4 text-[12.5px] leading-[1.6] text-slate-400">{c.openNote}</p>
                </>
              ) : <p className="mt-5 text-[13px] text-slate-400">{c.startingNote}</p>}
            </>
          )}

          {phase === 'notfound' && (
            <>
              <h1 className="font-display font-bold text-[20px] tracking-[-0.02em] text-slate-900">{c.notFoundTitle}</h1>
              <ol className="mt-5 space-y-3.5">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[14.5px] leading-[1.6] text-slate-700">
                    <span className="grid place-items-center shrink-0 w-6 h-6 rounded-full bg-l1-50 text-l1-700 text-[12px] font-bold">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-7 flex flex-wrap gap-3">
                <button onClick={onRetry} className={`${btn} bg-l1-600 text-white hover:bg-l1-700`}>
                  <RefreshCw size={15} />{c.checkAgain}
                </button>
                <a href={studioDirectUrl()} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>
                  {c.openDirect}<ArrowRight size={15} />
                </a>
                {STUDIO_DOWNLOAD_URL && (
                  <a href={STUDIO_DOWNLOAD_URL} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>
                    <Download size={15} />{c.download}
                  </a>
                )}
              </div>
              <p className="mt-5 text-[12.5px] leading-[1.6] text-slate-400">{c.blocked}</p>
              {report && report.length > 0 && (() => {
                const why = explainReport(report)
                return (
                  <details className="mt-3 text-[12.5px] leading-[1.6] text-slate-500" data-testid="probe-details">
                    <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700">{c.detailsTitle}</summary>
                    <p className="mt-2">{why.summary}</p>
                    {why.lines.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-slate-500">
                        {why.lines.map((l) => <li key={l}>{l}</li>)}
                      </ul>
                    )}
                  </details>
                )
              })()}
            </>
          )}
        </div></div>
        <a href="#/demo?scenario=hse" className="mt-6 inline-block text-[13.5px] text-l1-600 hover:text-l1-700">
          ← {c.backExisting}
        </a>
      </div>
    </Shell>
  )
}

export default function CustomDemo() {
  const [phase, setPhase] = useState<CustomPhase>('checking')
  const [found, setFound] = useState<StudioFound | null>(null)
  const [report, setReport] = useState<PortReport[] | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async (previous: StudioFound | null) => {
      // Re-probes ask only the app that already answered; the first probe scans everything.
      const sameOrigin = previous?.origin === window.location.origin
      const ports = previous ? (previous.port && !sameOrigin ? [previous.port] : []) : undefined
      const hit = await probeStudio({ ...(ports ? { ports } : {}), onReport: (r) => { if (!ctl.signal.aborted) setReport(r) } }, ctl.signal)
      if (ctl.signal.aborted) return
      setFound(hit)
      if (!hit) { setPhase('notfound'); return }
      if (hit.hello.ready) { setPhase('found'); return }
      setPhase('starting')
      timer = setTimeout(() => run(hit), STUDIO_REPROBE_MS)
    }
    setPhase('checking')
    setReport(null)
    run(null)
    return () => { ctl.abort(); if (timer) clearTimeout(timer) }
  }, [nonce])

  return <CustomDemoView phase={phase} found={found} report={report}
    onRetry={() => setNonce((n) => n + 1)} />
}
