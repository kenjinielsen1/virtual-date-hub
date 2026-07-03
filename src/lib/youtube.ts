// Minimal YouTube IFrame API loader + URL parsing.
// We only type the bits of the player we actually use.

export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  loadVideoById(videoId: string): void
  destroy(): void
}

interface YTPlayerCtor {
  new (
    el: HTMLElement | string,
    opts: {
      videoId?: string
      host?: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, unknown>
      events?: {
        onReady?: (e: { target: YTPlayer }) => void
        onStateChange?: (e: { data: number; target: YTPlayer }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ): YTPlayer
}

interface YTNamespace {
  Player: YTPlayerCtor
  PlayerState: {
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

// Loads the IFrame API once and resolves with the YT namespace.
export function loadYouTubeAPI(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT as YTNamespace)
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    // Fires if the script is blocked (ad-blocker) or fails to download.
    tag.onerror = () => {
      apiPromise = null
      reject(new Error('Failed to load the YouTube IFrame API script.'))
    }
    document.head.appendChild(tag)
  })
  return apiPromise
}

// Accepts full watch URLs, youtu.be links, /embed, /shorts, or a bare 11-char id.
export function extractVideoId(input: string): string | null {
  const raw = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw
  try {
    const url = new URL(raw)
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1)
      return id.length === 11 ? id : null
    }
    const v = url.searchParams.get('v')
    if (v && v.length === 11) return v
    const parts = url.pathname.split('/')
    const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts')
    if (idx >= 0 && parts[idx + 1]?.length === 11) return parts[idx + 1]
    return null
  } catch {
    return null
  }
}
