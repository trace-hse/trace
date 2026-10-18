// Where to get the TRACE Studio desktop app. Empty while the app is a private
// build: the custom page then shows "ask the authors" and no Download button.
export const STUDIO_DOWNLOAD_URL = ''

// Local ports the app may listen on (it takes the first free one from 8765).
export const STUDIO_PORTS = Array.from({ length: 21 }, (_, i) => 8765 + i)
export const STUDIO_HELLO_PATH = '/api/studio/hello'
export const STUDIO_PROBE_TIMEOUT_MS = 1500
export const STUDIO_REPROBE_MS = 2000
