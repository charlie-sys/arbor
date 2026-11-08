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
import { LOCALES, localeTag, setLocale, t, type Locale } from '@shared/i18n'
import { isDefaultSystemPrompt } from '@shared/i18n/defaults'

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
  const [petEnabled, setPetEnabled] = useState(settings.petEnabled)
  const [petBubbles, setPetBubbles] = useState(settings.petBubbles)
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
      ? t("检查失败")
      : updateState === 'new'
        ? t("有新版本")
        : updateState === 'ok'
          ? t("已是最新")
          : t("检查中…")
  const updateButtonLabel =
    updatePhase === 'downloading'
      ? t("下载中 {0}%", [downloadPercent])
      : updatePhase === 'verifying'
        ? t("校验安装包…")
        : updatePhase === 'installing'
          ? t("正在启动安装…")
          : updateReady
            ? t("安装 v{0}", [updateInfo?.latestVersion ?? ''])
            : t("更新到 v{0}", [updateInfo?.latestVersion ?? ''])
  const showProgress =
    updateBusy && (updatePhase === 'downloading' || updatePhase === 'verifying' || updatePhase === 'installing')

  useEffect(() => {
    void window.api.settings.info().then(setInfo)
  }, [])

  useEffect(() => {
    void window.api.backup.list().then(setBackups).catch(() => undefined)
  }, [])

  useEffect(() => {
    setPetEnabled(settings.petEnabled)
    setPetBubbles(settings.petBubbles)
  }, [settings.petEnabled, settings.petBubbles])

  const updatePet = async (patch: { petEnabled?: boolean; petBubbles?: boolean }): Promise<void> => {
    if (typeof patch.petEnabled === 'boolean') setPetEnabled(patch.petEnabled)
    if (typeof patch.petBubbles === 'boolean') setPetBubbles(patch.petBubbles)
    try {
      const updated = await window.api.settings.save(patch)
      onSaved(updated)
    } catch (err) {
      notify(t("宠物设置保存失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const backupNow = async (): Promise<void> => {
    setBackingUp(true)
    try {
      await window.api.backup.run()
      setBackups(await window.api.backup.list())
      notify(t("备份完成"), 'success')
    } catch (err) {
      notify(t("备份失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setBackingUp(false)
    }
  }

  const restore = async (backup: BackupInfo): Promise<void> => {
    const label = new Date(backup.createdAt).toLocaleString(localeTag())
    if (!window.confirm(t("恢复到 {0} 的备份？当前数据会先保存一份安全副本，随后应用将重新加载。", [label]))) return
    setRestoring(backup.name)
    try {
      await window.api.backup.restore(backup.name)
      window.location.reload()
    } catch (err) {
      notify(t("恢复失败：{0}", [(err as Error).message]), 'error')
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
      notify(t("设置已保存"), 'success')
    } catch (err) {
      notify(t("保存失败：{0}", [(err as Error).message]), 'error')
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

  const changeLanguage = async (language: Locale): Promise<void> => {
    if (language === settings.language) return
    try {
      const updated = await window.api.settings.save({ language })
      onSaved(updated)
      setLocale(updated.language)
      if (isDefaultSystemPrompt(systemPrompt)) setSystemPrompt(updated.systemPrompt)
      // 等旧语言提示清空后再用新语言确认，避免 Toast 堆叠时混用语言
      window.setTimeout(() => notify(t("界面语言已切换"), 'success'), 180)
    } catch (err) {
      notify(t("语言切换失败：{0}", [(err as Error).message]), 'error')
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
          <h1>{t("设置")}</h1>
          <p className="muted">{t("模型通过 OpenAI 兼容接口接入；所有文献与笔记保存在本机。")}</p>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          {saving ? t("保存中…") : t("保存设置")}
        </button>
      </header>

      <div className="settings-grid">
        <section className="card">
          <h2>{t("界面语言")}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {' '}{t("切换后界面、系统对话框与 AI 回答语言会立即更新，并保存到本机。")}{' '}</p>
          <div className="preset-row">
            {LOCALES.map((item) => (
              <button
                key={item.id}
                className={cx('preset', settings.language === item.id && 'active')}
                onClick={() => void changeLanguage(item.id)}
                title={item.label}
              >
                {item.nativeLabel}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>{t("模型服务")}</h2>
          <div className="preset-row">
            {PRESETS.map((preset) => (
              <button key={preset.name} className="preset" onClick={() => applyPreset(preset)} title={t("填入服务地址与模型名")}>
                {t(preset.name)}
              </button>
            ))}
          </div>

          <label className="field">
            <span>API Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.deepseek.com/v1" />
            <small className="hint">{t("需包含 /v1，例如 https://api.deepseek.com/v1；兼容任意 OpenAI 接口服务。")}</small>
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
              <Lock size={12} /> {' '}{t("密钥仅以 Windows DPAPI 加密形式保存在本机，界面不提供明文回显。")}{' '}</small>
          </label>

          <div className="field-row">
            <label className="field">
              <span>{t("对话模型")}</span>
              <input value={chatModel} onChange={(event) => setChatModel(event.target.value)} placeholder="deepseek-chat" />
            </label>
            <label className="field">
              <span>{t("视觉模型（截图翻译）")}</span>
              <input value={visionModel} onChange={(event) => setVisionModel(event.target.value)} placeholder={t("留空则使用对话模型")} />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>{t("温度（0–2）")}</span>
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
              <span>{t("文献上下文上限（字符）")}</span>
              <input
                type="number"
                min={0}
                max={200000}
                step={1000}
                placeholder={t("留空表示不限制")}
                value={maxContextChars}
                onChange={(event) => setMaxContextChars(event.target.value)}
              />
              <small className="hint">{t("默认不限制；填写 0 也表示不限制，非 0 时最少 4000。")}</small>
            </label>
          </div>

          <div className="settings-actions">
            <button className="btn" onClick={() => void test()} disabled={testing || !apiKey.trim()}>
              {testing ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
              {testing ? t("测试中…") : t("测试连接")}
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
          <h2>{t("Agent 行为")}</h2>
          <label className="field">
            <span>{t("系统提示词")}</span>
            <textarea rows={9} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
            <small className="hint">
              {' '}{t("Agent 会自动附加检索到的文献原文片段（含页码），要求基于原文回答并标注引用。")}{' '}</small>
          </label>
        </section>

        <section className="card">
          <h2>{t("桌面伙伴")}</h2>
          <p className="hint">
            {' '}{t("哈士奇「阿栗」住在桌面右下角，会用动作回应你的写作、阅读、思考与摸鱼。状态只依据输入节奏和当前页面，不读取任何内容。")}{' '}</p>
          <div className="settings-toggles">
            <label className="settings-toggle">
              <span>
                <strong>{t("显示桌面伙伴")}</strong>
                <small>{t("关闭后阿栗会回到小窝，随时可以从命令面板唤回")}</small>
              </span>
              <input
                type="checkbox"
                checked={petEnabled}
                onChange={(event) => void updatePet({ petEnabled: event.target.checked })}
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>{t("允许说话气泡")}</strong>
                <small>{t("状态变化时冒出一两句评论；右键阿栗也可以临时静音")}</small>
              </span>
              <input
                type="checkbox"
                checked={petBubbles}
                onChange={(event) => void updatePet({ petBubbles: event.target.checked })}
              />
            </label>
          </div>
          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void window.api.pet.window.reset()}>
              {' '}{t("把阿栗放回右下角")}{' '}</button>
          </div>
        </section>

        <section className="card">
          <h2>{t("数据与快捷键")}</h2>
          <div className="kv-list">
            <div className="kv">
              <span>{t("数据目录")}</span>
              <code>{info?.dataDir ?? t("加载中…")}</code>
            </div>
            <div className="kv">
              <span>{t("截图翻译快捷键")}</span>
              <kbd>{info?.shortcut ?? 'Ctrl + Shift + T'}</kbd>
            </div>
          </div>
          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void window.api.settings.openDataDir()}>
              <FolderOpen size={15} /> {' '}{t("打开数据目录")}{' '}</button>
          </div>
          <p className="hint">
            {' '}{t("数据目录包含文献 PDF、全文缓存、对话记录与翻译截图。迁移或备份时复制整个目录即可；API Key 受系统加密保护，迁移到其他电脑后需要重新填写。")}{' '}</p>
        </section>

        <section className="card update-card">
          <div className="update-card-head">
            <h2>{t("关于与更新")}</h2>
            <span className={cx('update-state', updateState)}>{updateStatusText}</span>
          </div>
          <div className="update-version">
            <strong>Arbor v{updateInfo?.currentVersion ?? info?.version ?? '—'}</strong>
            <span className="muted small">{t("版本信息来自 GitHub Releases")}</span>
          </div>
          <p className="update-summary">
            {updateInfo?.error
              ? t("检查更新失败：{0}", [updateInfo.error])
              : updateInfo?.hasUpdate
                ? t("发现新版本 v{0}，当前版本 v{1}。", [updateInfo.latestVersion, updateInfo.currentVersion])
                : updateInfo
                  ? t("当前使用的已是最新版本。")
                  : t("正在向 GitHub 查询最新版本…")}
            {updateInfo?.checkedAt && (
              <span className="muted small">
                {' '}
                {' '}{t("· 上次检查")}{' '}{new Date(updateInfo.checkedAt).toLocaleTimeString(localeTag())}
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
              {' '}{t("正在下载安装包：")}{formatSize(updateProgress.received)} / {formatSize(updateProgress.total)}
            </p>
          )}
          {updateProgress?.phase === 'ready' && (
            <p className="hint">{updateProgress.message ?? t("安装包已下载完成，可立即安装。")}</p>
          )}

          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void onCheckUpdate()} disabled={updateBusy}>
              <RefreshCw size={15} /> {' '}{t("检查更新")}{' '}</button>
            {updateInfo?.hasUpdate && (
              <button className="btn primary" onClick={() => void onUpdate()} disabled={updateBusy}>
                {updateBusy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {updateButtonLabel}
              </button>
            )}
            <button className="btn ghost" onClick={() => void window.api.updates.openRelease()}>
              <ExternalLink size={15} /> {' '}{t("发布说明")}{' '}</button>
          </div>

          {updateInfo?.notes && (
            <details className="update-notes-wrap">
              <summary>{t("更新内容")}</summary>
              <div className="update-notes">{updateInfo.notes}</div>
            </details>
          )}
        </section>

        <section className="card">
          <h2>{t("自动备份")}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {' '}{t("每天首次启动时自动快照数据目录，保留最近 7 份；恢复前会为当前数据保留一份安全副本。")}{' '}</p>
          <div className="settings-actions">
            <button className="btn ghost" onClick={() => void backupNow()} disabled={backingUp}>
              {backingUp ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {backingUp ? t("备份中…") : t("立即备份")}
            </button>
          </div>
          {backups.length === 0 ? (
            <p className="hint">{t("还没有备份。")}</p>
          ) : (
            <div className="kv-list">
              {backups.map((backup) => (
                <div className="kv" key={backup.name}>
                  <span>
                    {new Date(backup.createdAt).toLocaleString(localeTag())}
                    <span className="muted small"> · {(backup.size / 1024 / 1024).toFixed(1)} MB</span>
                  </span>
                  <button className="btn ghost" onClick={() => void restore(backup)} disabled={!!restoring}>
                    {restoring === backup.name ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                    {' '}{t("恢复")}{' '}</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
