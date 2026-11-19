import { installBrowserApi } from './browserApi'
import '@renderer/polyfills'

installBrowserApi()
void import('@renderer/blindBox').catch((error) => {
  const root = document.getElementById('root')
  if (root) {
    root.textContent = `摸鱼盲盒加载失败：${(error as Error).message}`
  }
})
