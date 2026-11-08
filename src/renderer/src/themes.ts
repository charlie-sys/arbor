export type ThemeId = 'light' | 'corporate' | 'soft' | 'dark' | 'midnight'

export interface ThemeMeta {
  id: ThemeId
  name: string
  latin: string
  description: string
  dark: boolean
  swatches: [string, string, string, string]
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'light',
    name: '暖砂',
    latin: 'Natural',
    description: '原始自然有机风格，暖纸色与鼠尾草绿',
    dark: false,
    swatches: ['#faf6f1', '#fffdf9', '#8b9d77', '#3f342d']
  },
  {
    id: 'corporate',
    name: '澄蓝',
    latin: 'Corporate',
    description: '企业级清爽界面，蓝色主色与中性灰层级',
    dark: false,
    swatches: ['#f8fafc', '#ffffff', '#2563eb', '#0f172a']
  },
  {
    id: 'soft',
    name: '柔光',
    latin: 'Soft',
    description: '柔和圆润的靛紫界面，轻盈彩色投影',
    dark: false,
    swatches: ['#f8f7ff', '#ffffff', '#6366f1', '#312e81']
  },
  {
    id: 'dark',
    name: '暖夜',
    latin: 'Espresso',
    description: '自带暖咖啡深色主题，低对比更护眼',
    dark: true,
    swatches: ['#241f1b', '#2d2621', '#a3b18a', '#f0e7da']
  },
  {
    id: 'midnight',
    name: '深空',
    latin: 'Midnight',
    description: '专业石板深色界面，蓝色高光与发光边框',
    dark: true,
    swatches: ['#0f172a', '#1e293b', '#3b82f6', '#e2e8f0']
  }
]

const STORAGE_KEY = 'zotagent-theme'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function readTheme(): ThemeId {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isThemeId(stored) ? stored : 'light'
}

export function themeById(id: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}

export function applyTheme(id: ThemeId): void {
  const meta = themeById(id)
  const root = document.documentElement
  root.dataset.theme = id
  if (meta.dark) root.dataset.dark = 'true'
  else delete root.dataset.dark
  root.style.colorScheme = meta.dark ? 'dark' : 'light'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', meta.swatches[0])
}

export function persistTheme(id: ThemeId): void {
  window.localStorage.setItem(STORAGE_KEY, id)
}
