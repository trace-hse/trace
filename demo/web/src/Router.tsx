import { useEffect, useState } from 'react'
import App from './App'
import Landing from './site/Landing'
import AcrossDomains from './story/AcrossDomains'
import CustomDemo, { DemoChooser } from './site/DemoEntry'


function useHashRoute() {
  const [route, setRoute] = useState(() => ({ path: window.location.hash.replace(/^#/, '') || '/', revision: 0 }))
  useEffect(() => {


    const on = () => setRoute(previous => ({ path: window.location.hash.replace(/^#/, '') || '/', revision: previous.revision + 1 }))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function navigate(to: string) {
  window.location.hash = to
  window.scrollTo({ top: 0 })
}

export default function Router() {
  const { path: hash, revision } = useHashRoute()
  const route = hash.split('?')[0]
  if (route.startsWith('/across-domains')) return <AcrossDomains />
  if (route.startsWith('/demo/custom')) return <CustomDemo />
  // Bare `#/demo` is the chooser; any deep link (scenario / case / game / api) goes straight into the recorded demo.
  if (route === '/demo' && !['scenario', 'case', 'game', 'api'].some(k => new URLSearchParams(hash.split('?')[1] ?? '').has(k))) return <DemoChooser />
  return route.startsWith('/demo') ? <App key={`${revision}:${hash}`} /> : <Landing />
}
