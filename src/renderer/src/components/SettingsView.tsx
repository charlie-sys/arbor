import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, FolderOpen, Loader2, Plug, Save, XCircle } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import type { AppInfo, TestResult } from '@shared/api'

interface Props {
  settings: AppSettings
  onSaved(settings: AppSettings): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

const PRESETS = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    chatModel: 'deepseek-chat',
    visionModel: ''
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatModel: 'qwen-plus',
    visionModel: 'qwen-vl-plus'
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o'
  },
  {
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    chatModel: 'moonshot-v1-8k',
    visionModel: ''
  }
]

export default function SettingsView({ settings, onSaved, notify }: Props): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.apiBaseUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [chatModel, setChatModel] = useState(settings.chatModel)
  const [visionModel, setVisionModel] = useState(settings.visionModel)
  const [temperature, setTemperature] = useState(String(settings.temperature))
  const [maxContextChars, setMaxContextChars] = useState(String(settings.maxContextChars))
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.api.settings.info().then(setInfo)
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const updated = await window.api.settings.save({
        apiBaseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        chatModel: chatModel.trim(),
        visionModel: visionModel.trim(),
        temperature: Number(temperature) || 0,
        maxContextChars: Number(maxContextChars) || 24000,
        systemPrompt
      })
      onSaved(updated)
      notify('设置已保存', 'success')
    } catch (err) {
      notify(`保存失败：${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.settings.test()
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const applyPreset = (preset: (typeof PRESETS)[number]): void => {
    setBaseUrl(preset.baseUrl)
    setChatModel(preset.chatModel)
    setVisionModel(preset.visionModel)
    setTestResult(null)
  }

  return (
    <div className="view settings-view">
      <header className="view-head">
        <div>
          <h1>设置</h1>
          <p className="muted">模型通过 OpenAI 兼容接口接入；所有文献与笔记保存在本机。</p>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          {saving ? '保存中…' : '保存设置'}
        </button>
      </header>

      <div className="settings-grid">
        <section className="card">
          <h2>模型服务</h2>
          <div className="preset-row">
            {PRESETS.map((preset) => (
              <button key={preset.name} className="preset" onClick={() => applyPreset(preset)} title="填入服务地址与模型名">
                {preset.name}
              </button>
            ))}
          </div>

          <label className="field">
            <span>API Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.deepseek.com/v1" />
            <small className="hint">需包含 /v1，例如 https://api.deepseek.com/v1；兼容任意 OpenAI 接口服务。</small>
          </label>

          <label className="field">
            <span>API Key</span>
            <div className="input-with-action">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
              />
              <button className="icon-btn" onClick={() => setShowKey((value) => !value)} title={showKey ? '隐藏' : '显示'}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <small className="hint">使用 Windows 系统加密（DPAPI）保存在本机配置中。</small>
          </label>

          <div className="field-row">
            <label className="field">
              <span>对话模型</span>
              <input value={chatModel} onChange={(event) => setChatModel(event.target.value)} placeholder="deepseek-chat" />
            </label>
            <label className="field">
              <span>视觉模型（截图翻译）</span>
              <input value={visionModel} onChange={(event) => setVisionModel(event.target.value)} placeholder="留空则使用对话模型" />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>温度（0–2）</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </label>
            <label className="field">
              <span>文献上下文上限（字符）</span>
              <input
                type="number"
                min={4000}
                max={200000}
                step={1000}
                value={maxContextChars}
                onChange={(event) => setMaxContextChars(event.target.value)}
              />
            </label>
          </div>

          <div className="settings-actions">
            <button className="btn" onClick={() => void test()} disabled={testing || !apiKey.trim()}>
              {testing ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <div className={testResult.ok ? 'test-result ok' : 'test-result bad'}>
                {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Agent 行为</h2>
          <label className="field">
            <span>系统提示词</span>
            <textarea rows={9} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
            <small className="hint">
              Agent 会自动附加检索到的文献原文片段（含页码），要求基于原文回答并标注引用。
            </small>
          </label>
        </section>

        <section className="card">
          <h2>数据与快捷键</h2>
          <div className="kv-list">
            <div className="kv">
              <span>数据目录</span>
              <code>{info?.dataDir ?? '加载中…'}</code>
            </div>
            <div className="kv">
              <span>版本</span>
              <span>{info?.version ?? '-'}</span>
            </div>
            <div className="kv">
              <span>截图翻译快捷键</span>
              <kbd>{info?.shortcut ?? 'Ctrl + Shift + T'}</kbd>
            </div>
          </div>
          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void window.api.settings.openDataDir()}>
              <FolderOpen size={15} /> 打开数据目录
            </button>
          </div>
          <p className="hint">
            数据目录包含文献 PDF、全文缓存、对话记录与翻译截图。迁移或备份时复制整个目录即可；API Key
            受系统加密保护，迁移到其他电脑后需要重新填写。
          </p>
        </section>
      </div>
    </div>
  )
}
