import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Cpu, History } from 'lucide-react'
import Logo from '../components/Logo'
import { STUDIO_COPY as C } from './content'
import { STUDIO_ONLINE_URL } from '../lib/studioConfig'

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
        <ChoiceCard href={STUDIO_ONLINE_URL} icon={<Cpu size={22} />} title={c.customTitle}
          body={c.customBody} cta={c.customCta} tag={c.customTag} accent />
      </div>
    </Shell>
  )
}

export function DemoChooser() {
  return <DemoChooserView />
}

export default function CustomDemo() {
  useEffect(() => {
    window.location.replace(STUDIO_ONLINE_URL)
  }, [])

  return (
    <main>
      <h1>Opening the online version...</h1>
      <a href={STUDIO_ONLINE_URL}>Open the online version</a>
    </main>
  )
}
