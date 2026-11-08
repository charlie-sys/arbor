import { useEffect, useState } from 'react'
import { Archive, Download, Pin, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react'
import type { AliMemoryState } from '@shared/ali'
import { Markdown, cx } from '../ui'
import { useUnsavedChanges } from '../unsaved'
import { t } from '@shared/i18n'

interface Props {
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

type Tab = 'self' | 'memory' | 'topics' | 'archive'

export default function AliMemoryPanel({ onClose, notify }: Props): React.JSX.Element {
  const [state, setState] = useState<AliMemoryState | null>(null)
  const [tab, setTab] = useState<Tab>('self')
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [topicDoc, setTopicDoc] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useUnsavedChanges('ali-memory-panel', dirty)

  const load = async (): Promise<void> => {
    try {
      const next = await window.api.ali.memory.get()
      setState(next)
      setDraft(tab === 'self' ? next.self : tab === 'memory' ? next.memory : '')
      setDirty(false)
    } catch (error) {
      notify(t('加载记忆失败：{0}', [(error as Error).message]), 'error')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchTab = (next: Tab): void => {
    if (dirty && !window.confirm(t('当前记忆有未保存修改，放弃并切换？'))) return
    setTab(next)
    setTopicDoc(null)
    setDraft(next === 'self' ? state?.self ?? '' : next === 'memory' ? state?.memory ?? '' : '')
    setDirty(false)
  }

  const openTopic = (doc: string): void => {
    if (dirty && !window.confirm(t('当前记忆有未保存修改，放弃并切换？'))) return
    const topic = state?.topics.find((item) => item.doc === doc)
    setTopicDoc(doc)
    setDraft(topic?.content ?? '')
    setDirty(false)
  }

  const save = async (): Promise<void> => {
    const doc = tab === 'self' ? 'SELF.md' : tab === 'memory' ? 'MEMORY.md' : topicDoc
    if (!doc) return
    setSaving(true)
    try {
      const next = await window.api.ali.memory.save(doc, draft)
      setState(next)
      setDirty(false)
      notify(t('记忆已保存'), 'success')
    } catch (error) {
      notify(t('保存记忆失败：{0}', [(error as Error).message]), 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeTopic = async (doc: string): Promise<void> => {
    if (!window.confirm(t('删除这条主题记忆？'))) return
    try {
      await window.api.ali.memory.remove(doc)
      if (topicDoc === doc) {
        setTopicDoc(null)
        setDraft('')
        setDirty(false)
      }
      await load()
    } catch (error) {
      notify(t('删除失败：{0}', [(error as Error).message]), 'error')
    }
  }

  const togglePin = async (doc: string, pinned: boolean): Promise<void> => {
    try {
      await window.api.ali.memory.pin(doc, pinned)
      await load()
    } catch (error) {
      notify(t('置顶失败：{0}', [(error as Error).message]), 'error')
    }
  }

  const close = (): void => {
    if (dirty && !window.confirm(t('记忆有未保存修改，确定关闭？'))) return
    onClose()
  }

  const clear = async (): Promise<void> => {
    if (!window.confirm(t('清空全部长期记忆？SELF 与 MEMORY 会恢复默认，主题与归档会删除。'))) return
    try {
      await window.api.ali.memory.clear()
      await load()
      notify(t('长期记忆已清空'), 'success')
    } catch (error) {
      notify(t('清空失败：{0}', [(error as Error).message]), 'error')
    }
  }

  const archiveItems = (state?.archive ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^- \[(SELF|MEMORY)\.md\] (.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match, index) => ({ id: index, doc: match[1] as 'SELF.md' | 'MEMORY.md', line: `- ${match[2]}` }))

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal ali-memory-panel" data-testid="ali-memory-panel">
        <div className="modal-head">
          <div>
            <h3>{t('阿栗的记忆')}</h3>
            <p className="muted">{t('记忆保存在本机 Markdown 文件中，可随时编辑或删除。')}</p>
          </div>
          <button className="icon-btn" onClick={close} title={t('关闭')}>
            <X size={18} />
          </button>
        </div>

        <div className="ali-memory-tabs">
          {([
            ['self', t('自我认知')],
            ['memory', t('长期记忆')],
            ['topics', t('主题')],
            ['archive', t('归档')]
          ] as [Tab, string][]).map(([id, label]) => (
            <button key={id} className={cx('ali-memory-tab', tab === id && 'active')} onClick={() => switchTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {state && (
          <div className="ali-memory-usage">
            <span>{t('自我认知')} {state.usage.self.chars}/{state.usage.self.quota}</span>
            <span>{t('长期记忆')} {state.usage.memory.chars}/{state.usage.memory.quota}</span>
          </div>
        )}

        {tab === 'topics' ? (
          <div className="ali-topic-list">
            {state?.topics.length ? (
              state.topics.map((topic) => (
                <div key={topic.doc} className={cx('ali-topic-item', topic.doc === topicDoc && 'active')} onClick={() => openTopic(topic.doc)}>
                  <div>
                    <div className="ali-topic-title">{topic.title}</div>
                    <div className="muted small">{topic.description || topic.doc}</div>
                  </div>
                  <div className="ali-topic-actions">
                    <button className="icon-btn tiny" title={t('置顶')} onClick={(event) => { event.stopPropagation(); void togglePin(topic.doc, !topic.pinned) }}>
                      <Pin size={12} className={topic.pinned ? 'active' : ''} />
                    </button>
                    <button className="icon-btn tiny" title={t('删除')} onClick={(event) => { event.stopPropagation(); void removeTopic(topic.doc) }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">{t('还没有主题记忆。和阿栗多聊聊，它会逐步整理。')}</div>
            )}
          </div>
        ) : tab === 'archive' ? (
          <div className="ali-archive-list">
            {archiveItems.length ? archiveItems.map((item) => (
              <div key={item.id} className="ali-archive-item">
                <span>{item.line}</span>
                <button className="link-btn" onClick={() => {
                  void window.api.ali.memory.restore(item.doc, item.line).then(() => {
                    notify(t('已从归档恢复'), 'success')
                    void load()
                  })
                }}>
                  {t('恢复')}
                </button>
              </div>
            )) : <div className="muted">{t('归档为空。')}</div>}
          </div>
        ) : (
          <>
            <textarea
              className="ali-memory-editor"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setDirty(true) }}
              spellCheck={false}
            />
            <div className="ali-memory-preview">
              <Markdown>{draft}</Markdown>
            </div>
          </>
        )}

        <div className="modal-foot ali-memory-foot">
          <div className="ali-memory-tools">
            <button className="btn ghost small" onClick={() => void window.api.ali.memory.consolidate().then((result) => { notify(result.skipped ? t('记忆未超过配额') : t('记忆已整理'), 'success'); void load() })}>
              <RefreshCw size={13} /> {t('整理')}
            </button>
            <button className="btn ghost small" onClick={() => void window.api.ali.memory.export().then((result) => { if (!result.canceled) notify(t('记忆已导出'), 'success') })}>
              <Download size={13} /> {t('导出')}
            </button>
            <button className="btn ghost small" onClick={() => void window.api.ali.memory.import().then((result) => { if (!result.canceled) { notify(t('已导入 {0} 个记忆文件', [result.imported ?? 0]), 'success'); void load() } })}>
              <Upload size={13} /> {t('导入')}
            </button>
            <button className="btn ghost small danger" onClick={() => void clear()}>
              <Archive size={13} /> {t('清空')}
            </button>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={close}>{t('关闭')}</button>
            {tab !== 'archive' && tab !== 'topics' || topicDoc ? (
              <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>
                <Save size={14} /> {saving ? t('保存中…') : t('保存')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
