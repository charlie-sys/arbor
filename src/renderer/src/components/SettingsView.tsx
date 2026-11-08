import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  XCircle
} from 'lucide-react'
import type { AppSettings, BackupInfo } from '@shared/types'
import type { AppInfo, TestResult, UpdateInfo, UpdateProgress } from '@shared/api'
import { useUnsavedChanges } from '../unsaved'
import { cx } from '../ui'

interface Props {
  settings: AppSettings
  onSaved(settings: AppSettings): void
  updateInfo: UpdateInfo | null
  updateBusy: boolean
  updateProgress: UpdateProgress | null
  updateReady: boolean
  onCheckUpdate(): Promise<void>
  onUpdate(): Promise<void>
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
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

export default function SettingsView({
  settings,
  onSaved,
  updateInfo,
  updateBusy,
  updateProgress,
  updateReady,
  onCheckUpdate,
  onUpdate,
  notify
}: Props): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.apiBaseUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [chatModel, setChatModel] = useState(settings.chatModel)
  const [visionModel, setVisionModel] = useState(settings.visionModel)
  const [temperature, setTemperature] = useState(String(settings.temperature))
  const [maxContextChars, setMaxContextChars] = useState(
    settings.maxContextChars > 0 ? String(settings.maxContextChars) : ''
  )
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const settingsDirty =
    baseUrl !== settings.apiBaseUrl ||
    apiKey !== settings.apiKey ||
    chatModel !== settings.chatModel ||
    visionModel !== settings.visionModel ||
    temperature !== String(settings.temperature) ||
    (Number(maxContextChars) || 0) !== settings.maxContextChars ||
    systemPrompt !== settings.systemPrompt
  useUnsavedChanges('settings-editor', settingsDirty)

  const updatePhase = updateProgress?.phase
  const downloadPercent =
    updatePhase === 'downloading'
      ? updateProgress?.percent ?? 0
      : updatePhase && updatePhase !== 'error'
        ? 100
        : 0
  const updateState = updateInfo?.error
    ? 'bad'
    : updateInfo?.hasUpdate
      ? 'new'
      : updateInfo
        ? 'ok'
        : 'checking'
  const updateStatusText =
    updateState === 'bad'
      ? '检查失败'
      : updateState === 'new'
        ? '有新版本'
        : updateState === 'ok'
          ? '已是最新'
          : '检查中…'
  const updateButtonLabel =
    updatePhase === 'downloading'
      ? `下载中 ${downloadPercent}%`
      : updatePhase === 'verifying'
        ? '校验安装包…'
        : updatePhase === 'installing'
          ? '正在启动安装…'
          : updateReady
            ? `安装 v${updateInfo?.latestVersion ?? ''}`
            : `更新到 v${updateInfo?.latestVersion ?? ''}`
  const showProgress =
    updateBusy && (updatePhase === 'downloading' || updatePhase === 'verifying' || updatePhase === 'installing')

  useEffect(() => {
    void window.api.settings.info().then(setInfo)
  }, [])

  useEffect(() => {
    void window.api.backup.list().then(setBackups).catch(() => undefined)
  }, [])

  const backupNow = async (): Promise<void> => {
    setBackingUp(true)
    try {
      await window.api.backup.run()
      setBackups(await window.api.backup.list())
      notify('备份完成', 'success')
    } catch (err) {
      notify(`备份失败：${(err as Error).message}`, 'error')
    } finally {
      setBackingUp(false)
    }
  }

  const restore = async (backup: BackupInfo): Promise<void> => {
    const label = new Date(backup.createdAt).toLocaleString('zh-CN')
    if (!window.confirm(`恢复到 ${label} 的备份？当前数据会先保存一份安全副本，随后应用将重新加载。`)) return
    setRestoring(backup.name)
    try {
      await window.api.backup.restore(backup.name)
      window.location.reload()
    } catch (err) {
      notify(`恢复失败：${(err as Error).message}`, 'error')
    } finally {
      setRestoring(null)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const updated = await window.api.settings.save({
        apiBaseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        chatModel: chatModel.trim(),
        visionModel: visionModel.trim(),
        temperature: Number(temperature) || 0,
        maxContextChars: Number(maxContextChars) || 0,
        systemPrompt
      })
      onSaved(updated)
      setBaseUrl(updated.apiBaseUrl)
      setApiKey(updated.apiKey)
      setChatModel(updated.chatModel)
      setVisionModel(updated.visionModel)
      setTemperature(String(updated.temperature))
      setMaxContextChars(updated.maxContextChars > 0 ? String(updated.maxContextChars) : '')
      setSystemPrompt(updated.systemPrompt)
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
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
            />
            <small className="hint key-hint">
              <Lock size={12} /> 密钥仅以 Windows DPAPI 加密形式保存在本机，界面不提供明文回显。
            </small>
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
                min={0}
                max={200000}
                step={1000}
                placeholder="留空表示不限制"
                value={maxContextChars}
                onChange={(event) => setMaxContextChars(event.target.value)}
              />
              <small className="hint">默认不限制；填写 0 也表示不限制，非 0 时最少 4000。</small>
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

        <section className="card update-card">
          <div className="update-card-head">
            <h2>关于与更新</h2>
            <span className={cx('update-state', updateState)}>{updateStatusText}</span>
          </div>
          <div className="update-version">
            <strong>Arbor v{updateInfo?.currentVersion ?? info?.version ?? '—'}</strong>
            <span className="muted small">版本信息来自 GitHub Releases</span>
          </div>
          <p className="update-summary">
            {updateInfo?.error
              ? `检查更新失败：${updateInfo.error}`
              : updateInfo?.hasUpdate
                ? `发现新版本 v${updateInfo.latestVersion}，当前版本 v${updateInfo.currentVersion}。`
                : updateInfo
                  ? '当前使用的已是最新版本。'
                  : '正在向 GitHub 查询最新版本…'}
            {updateInfo?.checkedAt && (
              <span className="muted small">
                {' '}
                · 上次检查 {new Date(updateInfo.checkedAt).toLocaleTimeString('zh-CN')}
              </span>
            )}
          </p>

          {showProgress && (
            <div className="update-progress">
              <div className="update-progress-bar" style={{ width: `${downloadPercent}%` }} />
            </div>
          )}
          {updateBusy && updateProgress?.phase === 'downloading' && (
            <p className="hint">
              正在下载安装包：{formatSize(updateProgress.received)} / {formatSize(updateProgress.total)}
            </p>
          )}
          {updateProgress?.phase === 'ready' && (
            <p className="hint">{updateProgress.message ?? '安装包已下载完成，可立即安装。'}</p>
          )}

          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void onCheckUpdate()} disabled={updateBusy}>
              <RefreshCw size={15} /> 检查更新
            </button>
            {updateInfo?.hasUpdate && (
              <button className="btn primary" onClick={() => void onUpdate()} disabled={updateBusy}>
                {updateBusy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {updateButtonLabel}
              </button>
            )}
            <button className="btn ghost" onClick={() => void window.api.updates.openRelease()}>
              <ExternalLink size={15} /> 发布说明
            </button>
          </div>

          {updateInfo?.notes && (
            <details className="update-notes-wrap">
              <summary>更新内容</summary>
              <div className="update-notes">{updateInfo.notes}</div>
            </details>
          )}
        </section>

        <section className="card">
          <h2>自动备份</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            每天首次启动时自动快照数据目录，保留最近 7 份；恢复前会为当前数据保留一份安全副本。
          </p>
          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void backupNow()} disabled={backingUp}>
              {backingUp ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {backingUp ? '备份中…' : '立即备份'}
            </button>
          </div>
          {backups.length === 0 ? (
            <p className="hint">还没有备份。</p>
          ) : (
            <div className="kv-list">
              {backups.map((backup) => (
                <div className="kv" key={backup.name}>
                  <span>
                    {new Date(backup.createdAt).toLocaleString('zh-CN')}
                    <span className="muted small"> · {(backup.size / 1024 / 1024).toFixed(1)} MB</span>
                  </span>
                  <button className="btn ghost" onClick={() => void restore(backup)} disabled={!!restoring}>
                    {restoring === backup.name ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                    恢复
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
