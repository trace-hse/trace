import { STUDIO_HELLO_PATH, STUDIO_PORTS, STUDIO_PROBE_TIMEOUT_MS } from './studioConfig'

export interface StudioHello { app: 'TRACE Studio'; version: string; ready: boolean; model: string }
export interface StudioFound { hello: StudioHello; origin: string; port: number | null }

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; json: () => Promise<unknown>; status?: number }>

/** What happened on one port. 'unreachable' is the one error a browser gives both for "nothing listens" and "blocked by a setting". */
export type PortOutcome = 'ok' | 'unreachable' | 'timeout' | 'http-error' | 'not-studio'
export interface PortReport {
  port: number | null
  outcome: PortOutcome
  status?: number
  /** Set by the second look (a no-cors request): the port DID answer, but the browser would not hand the reply to this page. */
  answered?: boolean
}

export interface ProbeOptions {
  fetchImpl?: FetchLike
  /** location.origin of the page; a loopback origin means the site is served by the app itself. */
  pageOrigin?: string
  ports?: number[]
  timeoutMs?: number
  /** Called once when nothing was found, with what each port did (so the page can say why instead of just "not found"). */
  onReport?: (report: PortReport[]) => void
}

/** Accept only the exact TRACE Studio hello shape; anything else is "not found". */
export function parseHello(body: unknown): StudioHello | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.app !== 'TRACE Studio') return null
  return {
    app: 'TRACE Studio',
    version: typeof b.version === 'string' ? b.version : '',
    ready: b.ready === true,
    model: typeof b.model === 'string' ? b.model : '',
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    return (protocol === 'http:' || protocol === 'https:')
      && ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
  } catch { return false }
}

interface UrlResult { hello: StudioHello | null; outcome: PortOutcome; status?: number }

async function probeUrl(
  fetchImpl: FetchLike, url: string, timeoutMs: number, outer?: AbortSignal, extraInit: object = {},
): Promise<UrlResult> {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeoutMs)
  const onOuter = () => ctl.abort()
  outer?.addEventListener('abort', onOuter)
  try {
    const r = await fetchImpl(url, { mode: 'cors', credentials: 'omit', signal: ctl.signal, ...extraInit })
    if (!r.ok) return { hello: null, outcome: 'http-error', status: r.status }
    const hello = parseHello(await r.json())
    return hello ? { hello, outcome: 'ok' } : { hello: null, outcome: 'not-studio' }
  } catch {
    return { hello: null, outcome: timedOut ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

/** Resolves with the first port that answers as TRACE Studio (or null plus what every port did). Never rejects. */
async function scanPorts(
  fetchImpl: FetchLike, ports: number[], timeoutMs: number, extraInit: object, signal?: AbortSignal,
): Promise<{ found: StudioFound | null; report: PortReport[] }> {
  const stop = new AbortController()
  const onOuter = () => stop.abort()
  signal?.addEventListener('abort', onOuter)
  const report: PortReport[] = []
  try {
    const found = await new Promise<StudioFound | null>((resolve) => {
      let pending = ports.length
      if (!pending) resolve(null)
      for (const port of ports) {
        const origin = `http://127.0.0.1:${port}`
        probeUrl(fetchImpl, origin + STUDIO_HELLO_PATH, timeoutMs, stop.signal, extraInit).then((r) => {
          report.push({ port, outcome: r.outcome, status: r.status })
          if (r.hello) resolve({ hello: r.hello, origin, port })
          else if (--pending === 0) resolve(null)
        })
      }
    })
    return { found, report }
  } finally {
    stop.abort()
    signal?.removeEventListener('abort', onOuter)
  }
}

/**
 * Second look at ports that failed with the browser's generic network error: a no-cors request resolves (opaque) whenever the port
 * accepted the connection, whatever the CORS headers say. So "answered" separates "the browser hid a reply" from "nothing listens".
 */
async function secondLook(fetchImpl: FetchLike, report: PortReport[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  await Promise.all(report.filter((r) => r.outcome === 'unreachable' && r.port != null).map(async (r) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const onOuter = () => ctl.abort()
    signal?.addEventListener('abort', onOuter)
    try {
      await fetchImpl(`http://127.0.0.1:${r.port}${STUDIO_HELLO_PATH}`, { mode: 'no-cors', credentials: 'omit', signal: ctl.signal })
      r.answered = true
    } catch { /* nothing listens (or the browser blocks even this) */ } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuter)
    }
  }))
}

export async function probeStudio(opts: ProbeOptions = {}, signal?: AbortSignal): Promise<StudioFound | null> {
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const timeoutMs = opts.timeoutMs ?? STUDIO_PROBE_TIMEOUT_MS
  const pageOrigin = opts.pageOrigin ?? (typeof location !== 'undefined' ? location.origin : '')
  // Site served by the app itself: same-origin first (relative URL, no CORS).
  if (isLoopbackOrigin(pageOrigin)) {
    const r = await probeUrl(fetchImpl, STUDIO_HELLO_PATH, timeoutMs, signal)
    if (r.hello) return { hello: r.hello, origin: pageOrigin, port: Number(new URL(pageOrigin).port) || null }
  }
  if (signal?.aborted) return null
  // From a public page, Chromium's Local Network Access wants the target address space spelled out (other browsers ignore it).
  const extraInit = isLoopbackOrigin(pageOrigin) ? {} : { targetAddressSpace: 'loopback' }
  const { found, report } = await scanPorts(fetchImpl, opts.ports ?? STUDIO_PORTS, timeoutMs, extraInit, signal)
  if (found || signal?.aborted) return found
  await secondLook(fetchImpl, report, timeoutMs, signal)
  if (!signal?.aborted) opts.onReport?.(report.sort((a, b) => (a.port ?? 0) - (b.port ?? 0)))
  return null
}

export function studioOpenUrl(found: StudioFound): string {
  return `${found.origin}/#/?from=site`
}

/** Where to send the visitor when nothing was detected but the app might still be running (a plain link needs no CORS). */
export function studioDirectUrl(): string {
  return `http://127.0.0.1:${STUDIO_PORTS[0]}/#/?from=site`
}

/** Plain-English reading of a failed probe. */
export function explainReport(report: PortReport[] | null | undefined): { summary: string; lines: string[] } {
  const list = report ?? []
  const lo = STUDIO_PORTS[0]
  const hi = STUDIO_PORTS[STUDIO_PORTS.length - 1]
  if (!list.length) return { summary: 'No check has finished yet.', lines: [] }
  const odd = list.filter((r) => r.outcome !== 'unreachable' || r.answered)
  const lines = odd.slice(0, 6).map((r) => {
    const where = `127.0.0.1:${r.port}`
    if (r.outcome === 'http-error') return `${where}: answered with HTTP ${r.status ?? '?'}, not TRACE Studio`
    if (r.outcome === 'not-studio') return `${where}: answered, but not as TRACE Studio`
    if (r.outcome === 'timeout') return `${where}: no answer within the time limit`
    return `${where}: accepted the connection, but the browser would not share the reply with this page`
  })
  if (odd.some((r) => r.answered || r.outcome === 'not-studio' || r.outcome === 'http-error')) {
    return {
      summary: 'Something answers on this computer, but not as TRACE Studio, or your browser hid its reply. If TRACE Studio is running, use “Open TRACE Studio directly”.',
      lines,
    }
  }
  if (odd.length) {
    return { summary: `Some ports did not answer in time. TRACE Studio may still be starting: press “Check again” in a few seconds.`, lines }
  }
  return {
    summary: `No connection could be made to 127.0.0.1 on ports ${lo}–${hi}. TRACE Studio is not running, or your browser or an extension blocks connections to this computer.`,
    lines: [],
  }
}
