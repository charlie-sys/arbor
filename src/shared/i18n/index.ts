import * as OpenCC from 'opencc-js/cn2t'
import { EN } from './en'

export type Locale = 'zh-CN' | 'zh-TW' | 'en'

export interface LocaleMeta {
  id: Locale
  label: string
  nativeLabel: string
}

export const LOCALES: LocaleMeta[] = [
  { id: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
  { id: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文' },
  { id: 'en', label: 'English', nativeLabel: 'English' }
]

const STORED_LOCALES = new Set<string>(LOCALES.map((item) => item.id))

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && STORED_LOCALES.has(value)
}

/** 将系统语言标签映射为应用语言；未知语言回退到英文。 */
export function localeFromSystemTag(tag?: string | null): Locale {
  const value = (tag ?? '').toLowerCase().replace(/_/g, '-')
  if (value.startsWith('zh')) {
    if (value.includes('hant') || /-(tw|hk|mo)\b/.test(value)) return 'zh-TW'
    return 'zh-CN'
  }
  return 'en'
}

/** 已保存的设置只接受精确的语言 ID，缺失或损坏时保持简体中文。 */
export function localeFromStored(value?: string | null): Locale {
  return isLocale(value) ? value : 'zh-CN'
}

/** AI 输出应使用的语言名称（用于提示词）。 */
export function outputLanguageName(): string {
  if (currentLocale === 'en') return 'English'
  if (currentLocale === 'zh-TW') return '繁體中文'
  return '简体中文'
}

/** 翻译任务中“原文已是目标语言”时的回退语言名称。 */
export function alternateLanguageName(): string {
  return currentLocale === 'en' ? 'Simplified Chinese' : '英文'
}

export function localeTag(locale: Locale = currentLocale): string {
  if (locale === 'zh-TW') return 'zh-HK'
  if (locale === 'en') return 'en'
  return 'zh-CN'
}

let currentLocale: Locale = 'zh-CN'
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return
  currentLocale = next
  for (const listener of listeners) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type MessageParams = Record<string, unknown> | unknown[]

function interpolate(text: string, params?: MessageParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Array.isArray(params)) {
      const index = Number(key)
      return Number.isInteger(index) && index >= 0 && index < params.length ? String(params[index] ?? '') : match
    }
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key] ?? '') : match
  })
}

// OpenCC 的繁體中文词组词典尚不完整，这里补齐应用内高频的繁體中文用词。
// 顺序很重要：先处理更长的词组，且“文件→檔案”必须先于“文檔→文件”。
const HK_TERMS: [string, string][] = [
  ['應用程式內', '應用程式內'],
  ['應用內', '應用程式內'],
  ['應用程序', '應用程式'],
  ['應用主題', '套用主題'],
  ['應用更改', '套用變更'],
  ['應用設置', '套用設定'],
  ['文件夾', '資料夾'],
  ['文件', '檔案'],
  ['文檔', '文件'],
  ['設置', '設定'],
  ['信息', '資訊'],
  ['默認', '預設'],
  ['支持', '支援'],
  ['界面', '介面'],
  ['接口', '介面'],
  ['文本', '文字'],
  ['字符', '字元'],
  ['字節', '位元組'],
  ['數據庫', '資料庫'],
  ['模塊', '模組'],
  ['彈窗', '彈出視窗'],
  ['標籤頁', '分頁'],
  ['鏈接', '連結'],
  ['視圖', '檢視'],
  ['儀表盤', '儀表板'],
  ['星標', '星號'],
  ['字號', '字級'],
  ['列寬', '欄寬'],
  ['跳轉', '跳至'],
  ['導航', '導覽'],
  ['生成', '產生'],
  ['高亮', '標示'],
  ['閲', '閱'],
  ['視頻', '影片'],
  ['音頻', '音訊'],
  ['屏幕', '螢幕'],
  ['內存', '記憶體'],
  ['緩存', '快取'],
  ['硬盤', '硬碟'],
  ['光標', '游標'],
  ['鼠標', '滑鼠'],
  ['登錄', '登入'],
  ['創建', '建立'],
  ['新建', '新增'],
  ['添加', '新增'],
  ['保存', '儲存'],
  ['加載', '載入'],
  ['粘貼', '貼上'],
  ['剪貼板', '剪貼簿'],
  ['菜單', '選單'],
  ['在線', '線上'],
  ['離線', '離線'],
  ['質量', '質素'],
  ['查找', '尋找'],
  ['賬户', '帳戶'],
  ['帳户', '帳戶'],
  ['用户', '用戶'],
  ['賬號', '帳號'],
  ['温度', '溫度'],
  ['説', '說'],
  ['啓', '啟'],
  ['禁用', '停用'],
  ['導入', '匯入'],
  ['導出', '匯出'],
  ['上傳', '上載'],
  ['下載', '下載'],
  ['撤銷', '復原'],
  ['滾動', '捲動'],
  ['拖拽', '拖曳'],
  ['拖動', '拖曳'],
  ['刷新', '重新整理'],
  ['重命名', '重新命名'],
  ['全屏', '全螢幕'],
  ['分辨率', '解析度'],
  ['內置', '內建'],
  ['兼容', '相容'],
  ['密鑰', '金鑰'],
  ['示例', '範例'],
  ['字段', '欄位'],
  ['側欄', '側邊欄'],
  ['回車', 'Enter'],
  ['複選框', '核取方塊']
]

const hkConverter = OpenCC.Converter({ from: 'cn', to: 'hkp' })
const hkCache = new Map<string, string>()

function toHongKong(source: string): string {
  const cached = hkCache.get(source)
  if (cached !== undefined) return cached
  let text = hkConverter(source)
  for (const [from, to] of HK_TERMS) {
    if (text.includes(from)) text = text.split(from).join(to)
  }
  if (hkCache.size < 8000) hkCache.set(source, text)
  return text
}

/** 各语言下“新建对话”的默认标题，用于识别尚未改名的会话。 */
const DEFAULT_CHAT_TITLES = new Set(['新的对话', '新的對話', 'New chat'])

export function isDefaultChatTitle(title?: string | null): boolean {
  return !title || DEFAULT_CHAT_TITLES.has(title.trim())
}

/**
 * 以简体中文源码文案为键翻译界面文字。
 * - 简体中文：原样返回
 * - 繁體中文：OpenCC 繁體中文转换 + 用词覆盖
 * - English：查询英文词典，缺失时回退原文
 * 插值占位符支持 {0} 与 {name}。
 */
export function t(source: string, params?: MessageParams): string {
  if (!source) return source
  if (currentLocale === 'zh-TW') return interpolate(toHongKong(source), params)
  if (currentLocale === 'en') return interpolate(EN[source] ?? source, params)
  return interpolate(source, params)
}
