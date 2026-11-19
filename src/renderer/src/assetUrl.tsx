import { useEffect, useState, type ImgHTMLAttributes } from 'react'

declare global {
  interface Window {
    __arborAssetResolver?: (url: string) => Promise<string>
  }
}

export function useResolvedAssetUrl(url?: string | null): string {
  const [resolved, setResolved] = useState(url ?? '')
  useEffect(() => {
    let cancelled = false
    if (!url) {
      setResolved('')
      return
    }
    if (!url.startsWith('zotfile:') || !window.__arborAssetResolver) {
      setResolved(url)
      return
    }
    void window.__arborAssetResolver(url)
      .then((next) => {
        if (!cancelled) setResolved(next)
      })
      .catch(() => {
        if (!cancelled) setResolved('')
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return resolved
}

export function ResolvedImage({
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>): React.JSX.Element {
  return <img {...props} src={useResolvedAssetUrl(src)} />
}
