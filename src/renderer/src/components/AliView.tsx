import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Send, Sparkles, Square, Trash2, Undo2, Brain, Volume2, VolumeX, Settings2 } from 'lucide-react'
import type { AliMessage, AliSession, AliState } from '@shared/ali'
import { Markdown, cx, formatTime } from '../ui'
import AliHelpModal from './AliHelpModal'
import AliMemoryPanel from './AliMemoryPanel'
import AliVoiceSettings from './AliVoiceSettings'
import { applyChatScale, getChatScale } from '../chatZoom'
import { chunkSpeech } from '../speech'
import { t } from '@shared/i18n'

interface Props {
  visible?: boolean
  compact?: boolean
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

interface StreamState {
  requestId: string
  sessionId: string
  content: string
}

export default function AliView({ notify, compact = false }: Props): React.JSX.Element {
  const [state, setState] = useState<AliState | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [stream, setStream] = useState<StreamState | null>(null)
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<string[] | null>(null)
  const [helpTitle, setHelpTitle] = useState<string | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [zoomBadge, setZoomBadge] = useState<number | null>(null)
  const zoomTimer = useRef<number | null>(null)
  const [ttsOn, setTtsOn] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const settingsRef = useRef<AliState['settings'] | null>(null)
  const ttsOnRef = useRef(false)
  const autoSpeakRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<string | null>(null)

  const sessions = useMemo(
    () => [...(state?.sessions ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [state?.sessions]
  )
  const active = sessions.find((session) => session.id === activeId) ?? null
  activeRef.current = activeId

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.ali.getState()
      setState(next)
      setActiveId((prev) =>
        prev && next.sessions.some((session) => session.id === prev) ? prev : next.sessions[0]?.id ?? null
      )
    } catch (err) {
      notify(t('加载阿栗会话失败：{0}', [(err as Error).message]), 'error')
    }
  }, [notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (state?.settings) setTtsOn(Boolean(state.settings.ttsEnabled))
  }, [state?.settings?.ttsEnabled])

  useEffect(() => {
    settingsRef.current = state?.settings ?? null
    ttsOnRef.current = ttsOn
    autoSpeakRef.current = Boolean(state?.settings.ttsAutoSpeak)
  }, [state?.settings, ttsOn])

  const cancelSpeech = useCallback((): void => {
    window.speechSynthesis.cancel()
    setSpeakingId(null)
  }, [])

  useEffect(() => () => window.speechSynthesis.cancel(), [])

  const speak = (text: string, id: string): void => {
    const chunks = chunkSpeech(text)
    if (!chunks.length) return
    window.speechSynthesis.cancel()
    const synth = window.speechSynthesis
    const settings = settingsRef.current
    const voices = synth.getVoices()
    const selected = voices.find((item) => item.name === settings?.ttsVoice)
    const voice =
      selected ||
      voices.find((item) => item.localService && /^zh/i.test(item.lang)) ||
      voices.find((item) => /^zh/i.test(item.lang)) ||
      voices[0]
    let remaining = chunks.length
    const done = (): void => {
      remaining -= 1
      if (remaining <= 0) setSpeakingId(null)
    }
    setSpeakingId(id)
    synth.resume()
    for (const chunk of chunks) {
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.rate = settings?.ttsRate || 1
      utterance.volume = settings?.ttsVolume ?? 1
      utterance.pitch = 1
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      } else {
        utterance.lang = document.documentElement.lang || 'zh-CN'
      }
      utterance.onend = done
      utterance.onerror = done
      synth.speak(utterance)
    }
  }

  const toggleTts = async (): Promise<void> => {
    const next = !ttsOn
    setTtsOn(next)
    if (!next) cancelSpeech()
    if (next && window.speechSynthesis.getVoices().length === 0) {
      notify(t('系统未安装可用语音'), 'info')
    }
    if (!state) return
    try {
      const saved = await window.api.settings.save({ ali: { ...state.settings, ttsEnabled: next } })
      setState((prev) => (prev ? { ...prev, settings: saved.ali } : prev))
    } catch (error) {
      notify(t('保存语音设置失败：{0}', [(error as Error).message]), 'error')
    }
  }

  useEffect(() => {
    const off = window.api.events.onAli((event) => {
      if (event.type === 'delta') {
        if (event.sessionId === activeRef.current) {
          setStream((prev) => ({
            requestId: event.requestId,
            sessionId: event.sessionId,
            content: `${prev?.requestId === event.requestId ? prev.content : ''}${event.delta ?? ''}`
          }))
        }
        return
      }
      if (event.type === 'memory') {
        if (event.sessionId === activeRef.current && event.memory?.lines.length) setUndo(event.memory.lines)
        return
      }
      if (event.type === 'tool') {
        setActiveTool(event.tool?.status === 'running' ? event.tool.name : null)
        return
      }
      if (event.type === 'done' || event.type === 'error') {
        setBusy(false)
        setStream(null)
        setActiveTool(null)
        if (event.type === 'error') setError(event.error || t('阿栗请求失败'))
        if (event.type === 'done' && event.message && ttsOnRef.current && autoSpeakRef.current) {
          speak(event.message.content, event.message.id)
        }
        void refresh()
      }
    })
    return off
  }, [refresh])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      if (!event.deltaY) return
      event.preventDefault()
      const next = applyChatScale(getChatScale() + (event.deltaY < 0 ? 0.1 : -0.1))
      setZoomBadge(next)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
      zoomTimer.current = window.setTimeout(() => {
        zoomTimer.current = null
        setZoomBadge(null)
      }, 1000)
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      list.removeEventListener('wheel', onWheel)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
    }
  }, [activeId])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [active?.messages.length, stream?.content, error])

  const createSession = async (): Promise<void> => {
    try {
      const session = await window.api.ali.createSession()
      await refresh()
      setActiveId(session.id)
      setInput('')
      setError('')
    } catch (err) {
      notify(t('创建阿栗会话失败：{0}', [(err as Error).message]), 'error')
    }
  }

  const deleteSession = async (session: AliSession): Promise<void> => {
    if (!window.confirm(t('删除与阿栗的这个对话？'))) return
    try {
      await window.api.ali.deleteSession(session.id)
      if (activeId === session.id) setActiveId(null)
      await refresh()
    } catch (err) {
      notify(t('删除失败：{0}', [(err as Error).message]), 'error')
    }
  }

  const send = async (): Promise<void> => {
    const content = input.trim()
    if (!content || !activeId || busy) return
    const requestId = crypto.randomUUID()
    const userMessage: AliMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now()
    }
    setInput('')
    setError('')
    setUndo(null)
    cancelSpeech()
    setBusy(true)
    setStream({ requestId, sessionId: activeId, content: '' })
    setState((prev) =>
      prev
        ? {
            ...prev,
            sessions: prev.sessions.map((session) =>
              session.id === activeId
                ? { ...session, messages: [...session.messages, userMessage], updatedAt: Date.now() }
                : session
            )
          }
        : prev
    )
    try {
      await window.api.ali.send({ requestId, sessionId: activeId, content })
    } catch (err) {
      setBusy(false)
      setStream(null)
      setError((err as Error).message || t('发送失败'))
    }
  }

  const stop = (): void => {
    if (stream) void window.api.ali.cancel(stream.requestId)
    cancelSpeech()
    setBusy(false)
    setStream(null)
  }

  const suggestions = [
    t('今天想聊点什么？'),
    t('这个功能怎么用？'),
    t('记住我的阅读习惯'),
    t('帮我查一下最新的资料')
  ]

  const actionButtons = (
    <>
      <button
        className="icon-btn"
        data-testid="ali-voice-settings-button"
        title={t('阿栗设置')}
        onClick={() => setVoiceOpen(true)}
      >
        <Settings2 size={15} />
      </button>
      <button
        className="icon-btn"
        data-testid="ali-voice-toggle"
        aria-pressed={ttsOn}
        title={ttsOn ? t('关闭语音回答') : t('开启语音回答')}
        onClick={() => void toggleTts()}
      >
        {ttsOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>
      <button
        className={compact ? 'icon-btn' : 'btn ghost small'}
        data-testid="ali-memory-button"
        title={t('记忆')}
        onClick={() => setMemoryOpen(true)}
      >
        <Brain size={compact ? 15 : 14} /> {compact ? null : t('记忆')}
      </button>
    </>
  )

  return (
    <div className={cx('view chat-page ali-view', compact && 'compact')} data-testid="ali-view">
      {!compact && (
        <aside className="chat-sessions">
        <div className="sessions-head">
          <div>
            <div className="sessions-title">{t('阿栗')}</div>
            <div className="muted small">{sessions.length} {t('个会话')}</div>
          </div>
          <button className="btn primary small" data-testid="ali-new-session" onClick={() => void createSession()}>
            <Plus size={14} /> {t('新建')}
          </button>
        </div>
        <div className="sessions-list" data-testid="ali-session-list">
          {sessions.length === 0 && (
            <div className="sessions-empty">
              <Sparkles size={22} />
              <span>{t('还没有和阿栗聊过')}</span>
              <button className="btn ghost small" onClick={() => void createSession()}>
                {t('开始聊天')}
              </button>
            </div>
          )}
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cx('session-item', session.id === activeId && 'active')}
              onClick={() => {
                cancelSpeech()
                setActiveId(session.id)
              }}
            >
              <div className="session-title">{session.title || t('新的对话')}</div>
              <div className="session-meta">
                <span>{t('{0} 条消息', [session.messages.length])}</span>
                <span>{formatTime(session.updatedAt)}</span>
              </div>
              <button
                className="icon-btn tiny session-delete"
                title={t('删除对话')}
                onClick={(event) => {
                  event.stopPropagation()
                  void deleteSession(session)
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      )}

      <section className="chat-main">
        {active ? (
          <header className={cx('chat-head', compact && 'ali-compact-head')}>
            <div className="ali-head">
              <img className="ali-avatar" src="./pet/happy/0.png" alt="Ali" />
              <div className="ali-head-text">
                <h2>{active.title || t('和阿栗聊天')}</h2>
                <div className="muted small">
                  {busy ? t('阿栗正在思考…') : t('陪伴聊天 · 软件使用助手')}
                  {' · '}
                  {state?.settings.model || t('跟随对话模型')}
                </div>
              </div>
              {!compact && actionButtons}
            </div>
            {compact && (
              <div className="ali-compact-toolbar">
                <select
                  data-testid="ali-session-select"
                  value={active.id}
                  onChange={(event) => {
                    cancelSpeech()
                    setActiveId(event.target.value)
                  }}
                >
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title || t('新的对话')}
                    </option>
                  ))}
                </select>
                <button className="icon-btn" data-testid="ali-new-session" title={t('新建')} onClick={() => void createSession()}>
                  <Plus size={15} />
                </button>
                {actionButtons}
              </div>
            )}
          </header>
        ) : (
          <div className="empty-state chat-empty-state">
            <div className="empty-icon">
              <img className="ali-avatar large" src="./pet/happy/0.png" alt="Ali" />
            </div>
            <h2>{t('和阿栗聊天')}</h2>
            <p className="muted">{t('阿栗会记住你的偏好，也可以帮你解答 Arbor 的使用问题。')}</p>
            <button className="btn primary" onClick={() => void createSession()}>
              <Plus size={16} /> {t('新建对话')}
            </button>
          </div>
        )}

        {active && (
          <>
            <div className="chat-body">
              <div className="chat-messages" ref={listRef}>
              {active.messages.length === 0 && !stream && (
                <div className="ali-suggestions">
                  <div className="ali-suggestions-title">{t('从一句话开始：')}</div>
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} className="suggestion" onClick={() => setInput(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {active.messages.map((message) => (
                <div key={message.id} className={cx('msg-row', message.role)}>
                  <div className={cx('msg-bubble', message.role === 'user' ? 'user-bubble' : 'assistant-bubble')}>
                    {message.role === 'user' ? (
                      <div className="msg-user-text">{message.content}</div>
                    ) : (
                      <div data-testid="ali-message-assistant">
                        <Markdown>{message.content}</Markdown>
                        {message.toolTraces?.length ? (
                          <div className="ali-tool-list">
                            {message.toolTraces.map((tool) => (
                              <div key={tool.id} className="ali-tool-card" data-testid="ali-tool-card">
                                <span className={cx('ali-tool-dot', tool.status)} />
                                <div>
                                  <div className="ali-tool-name">{tool.name}</div>
                                  <div className="ali-tool-summary">{tool.summary || tool.error || tool.args}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {message.sources?.length ? (
                          <div className="ali-source-list" data-testid="ali-source-list">
                            {message.sources.map((source) => (
                              <a key={source.url} className="ali-source-link" data-testid="ali-source-link" href={source.url} target="_blank" rel="noreferrer">
                                {source.title}
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {message.helpSections?.length ? (
                          <button
                            className="ali-source-badge"
                            data-testid="ali-source-badge"
                            onClick={() => setHelpTitle(message.helpSections![0])}
                          >
                            {t('使用说明 · {0}', [message.helpSections[0]])}
                          </button>
                        ) : null}
                        {ttsOn ? (
                          <button
                            className="ali-speak"
                            data-testid="ali-speak"
                            onClick={() => (speakingId === message.id ? cancelSpeech() : speak(message.content, message.id))}
                          >
                            {speakingId === message.id ? <Square size={12} /> : <Volume2 size={12} />}
                            {speakingId === message.id ? t('停止') : t('朗读')}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {stream && stream.sessionId === active.id && (
                <div className="msg-row assistant">
                  <div className="msg-bubble assistant-bubble">
                    <div data-testid="ali-message-assistant" className="msg-streaming-text">
                      {stream.content ? <Markdown>{stream.content}</Markdown> : t('阿栗正在思考…')}
                    </div>
                  </div>
                </div>
              )}
              {error && <div className="notice">{error}</div>}
              {undo && (
                <div className="ali-memory-undo">
                  <span>{t('已记住：{0}', [undo[0]])}</span>
                  <button
                    className="link-btn"
                    data-testid="ali-memory-undo"
                    onClick={() => {
                      const lines = undo
                      setUndo(null)
                      void window.api.ali.undoMemory(lines).then((removed) => {
                        notify(removed ? t('已撤销这条记忆') : t('记忆已不存在'), 'success')
                      })
                    }}
                  >
                    <Undo2 size={12} /> {t('撤销')}
                  </button>
                </div>
              )}
              </div>
              {zoomBadge !== null && (
                <div className="chat-zoom-badge" role="status">
                  {t('字号')} {Math.round(zoomBadge * 100)}%
                </div>
              )}
            </div>

            <div className="composer">
              <textarea
                data-testid="ali-input"
                value={input}
                rows={2}
                placeholder={t('和阿栗聊点什么…')}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="composer-bar">
                <span className="composer-hint">
                  {activeTool ? (
                    <span className="ali-search-status" data-testid="ali-search-status">
                      {t('阿栗正在使用 {0}…', [activeTool])}
                    </span>
                  ) : (
                    t('Enter 发送 · Shift+Enter 换行 · Ctrl+滚轮 调节字号')
                  )}
                </span>
                <div className="composer-actions">
                  {busy ? (
                    <button className="btn ghost small" data-testid="ali-stop" onClick={stop}>
                      <Square size={13} /> {t('停止')}
                    </button>
                  ) : (
                    <button
                      className="btn primary small"
                      data-testid="ali-send"
                      disabled={!input.trim()}
                      onClick={() => void send()}
                    >
                      {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {t('发送')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      {helpTitle && <AliHelpModal title={helpTitle} onClose={() => setHelpTitle(null)} />}
      {memoryOpen && <AliMemoryPanel onClose={() => setMemoryOpen(false)} notify={notify} />}
      {voiceOpen && state && (
        <AliVoiceSettings
          settings={state.settings}
          onSaved={(settings) => {
            setState((prev) => (prev ? { ...prev, settings } : prev))
            setTtsOn(settings.ttsEnabled)
          }}
          onClose={() => setVoiceOpen(false)}
          notify={notify}
        />
      )}
    </div>
  )
}
