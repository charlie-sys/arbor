import { useEffect, useState } from 'react'
import { Play, Save, X } from 'lucide-react'
import type { AliSettings } from '@shared/ali'
import { t } from '@shared/i18n'

interface Props {
  settings: AliSettings
  onSaved(settings: AliSettings): void
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function AliVoiceSettings({ settings, onSaved, onClose, notify }: Props): React.JSX.Element {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voice, setVoice] = useState(settings.ttsVoice)
  const [rate, setRate] = useState(settings.ttsRate)
  const [volume, setVolume] = useState(settings.ttsVolume)
  const [autoSpeak, setAutoSpeak] = useState(settings.ttsAutoSpeak)
  const [model, setModel] = useState(settings.model)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [auxModel, setAuxModel] = useState(settings.auxModel)
  const [auxBaseUrl, setAuxBaseUrl] = useState(settings.auxBaseUrl)
  const [auxApiKey, setAuxApiKey] = useState(settings.auxApiKey)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = (): void => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const preview = (): void => {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(t('你好，我是阿栗。'))
    utterance.rate = rate
    utterance.volume = volume
    const selected = voices.find((item) => item.name === voice)
    if (selected) utterance.voice = selected
    window.speechSynthesis.speak(utterance)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.api.settings.save({
        ali: {
          ...settings,
          model: model.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          auxModel: auxModel.trim(),
          auxBaseUrl: auxBaseUrl.trim(),
          auxApiKey: auxApiKey.trim(),
          ttsVoice: voice,
          ttsRate: rate,
          ttsVolume: volume,
          ttsAutoSpeak: autoSpeak
        }
      })
      onSaved(saved.ali)
      notify(t('语音设置已保存'), 'success')
      onClose()
    } catch (error) {
      notify(t('保存语音设置失败：{0}', [(error as Error).message]), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal ali-voice-settings" data-testid="ali-voice-settings">
        <div className="modal-head">
          <div>
            <h3>{t('阿栗设置')}</h3>
            <p className="muted">{t('配置对话模型、记忆与摘要模型和系统语音。')}</p>
          </div>
          <button className="icon-btn" onClick={onClose} title={t('关闭')}>
            <X size={18} />
          </button>
        </div>

        <div className="ali-voice-body">
        <label className="ali-voice-row">
          <span>{t('主对话模型')}</span>
          <input
            data-testid="ali-model"
            type="text"
            value={model}
            placeholder={t('留空跟随「AI 对话」模型')}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>

        <label className="ali-voice-row">
          <span>{t('主对话服务地址')}</span>
          <input
            data-testid="ali-base"
            type="text"
            value={baseUrl}
            placeholder={t('留空跟随「AI 对话」服务')}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>

        <label className="ali-voice-row">
          <span>{t('主对话 API Key')}</span>
          <input
            data-testid="ali-key"
            type="password"
            value={apiKey}
            placeholder={t('留空跟随「AI 对话」Key')}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>

        <label className="ali-voice-row">
          <span>{t('记忆与摘要模型')}</span>
          <input
            data-testid="ali-aux-model"
            type="text"
            value={auxModel}
            placeholder={t('留空跟随主对话模型')}
            onChange={(event) => setAuxModel(event.target.value)}
          />
        </label>
        <p className="hint">{t('记忆提炼、摘要与整理使用次要模型；地址和密钥留空时逐项跟随主服务。')}</p>

        <label className="ali-voice-row">
          <span>{t('次要模型服务地址')}</span>
          <input
            data-testid="ali-aux-base"
            type="text"
            value={auxBaseUrl}
            placeholder={t('留空跟随阿栗主服务')}
            onChange={(event) => setAuxBaseUrl(event.target.value)}
          />
        </label>

        <label className="ali-voice-row">
          <span>{t('次要模型 API Key')}</span>
          <input
            data-testid="ali-aux-key"
            type="password"
            value={auxApiKey}
            placeholder={t('留空跟随阿栗主 Key')}
            onChange={(event) => setAuxApiKey(event.target.value)}
          />
        </label>

        <label className="ali-voice-row">
          <span>{t('系统语音')}</span>
          <select data-testid="ali-voice-select" value={voice} onChange={(event) => setVoice(event.target.value)}>
            <option value="">{t('系统默认')}</option>
            {voices.map((item) => (
              <option key={item.name} value={item.name}>{item.name} · {item.lang}</option>
            ))}
          </select>
        </label>

        <label className="ali-voice-row">
          <span>{t('语速')} {rate.toFixed(1)}×</span>
          <input data-testid="ali-voice-rate" type="range" min="0.5" max="2" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} />
        </label>

        <label className="ali-voice-row">
          <span>{t('音量')} {Math.round(volume * 100)}%</span>
          <input data-testid="ali-voice-volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
        </label>

        <label className="ali-voice-check">
          <input data-testid="ali-voice-auto" type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
          <span>{t('自动朗读新回答')}</span>
        </label>
        </div>

        <div className="modal-foot">
          <button className="btn ghost small" onClick={preview}>
            <Play size={13} /> {t('试听')}
          </button>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>{t('取消')}</button>
            <button className="btn primary" data-testid="ali-voice-save" disabled={saving} onClick={() => void save()}>
              <Save size={14} /> {saving ? t('保存中…') : t('保存')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
