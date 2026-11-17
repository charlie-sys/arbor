export interface WebPageSnapshot {
  url: string
  title: string
  author: string
  text: string
  selection?: string
  visibleText?: string
  images?: { src: string; alt: string; caption: string; visible: boolean }[]
}

export type WebPageSource = 'online' | 'offline'

export interface WebBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WebPageState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string
  source: WebPageSource
  hasArchive: boolean
  readable?: boolean
  visible?: boolean
}

export type WebPageAction = 'back' | 'forward' | 'reload'

export function normalizeWebUrl(input: string): string {
  const value = input.trim()
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      /^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网页地址')
  }
  return url.href
}
