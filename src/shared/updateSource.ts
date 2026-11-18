/** Mirrors must publish v<version>/<filename>; release metadata always comes from GitHub. */
export function normalizeUpdateSource(value: unknown): string {
  if (value === '' || value === undefined) return ''
  if (typeof value !== 'string') throw new Error('下载源必须是 HTTPS 地址')
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('下载源必须是无账号、参数和片段的 HTTPS 地址')
  }
  return url.toString().replace(/\/+$/, '')
}
