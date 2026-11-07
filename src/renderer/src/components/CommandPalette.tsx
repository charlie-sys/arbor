import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Folder, Loader2, MessageSquare, Quote, Search, StickyNote } from 'lucide-react'
import type { SearchResult, SearchResultType } from '@shared/types'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  keywords?: string
  disabled?: boolean
  run(): void | Promise<void>
}

interface Props {
  mode: 'search' | 'command'
  commands: PaletteCommand[]
  onClose(): void
  onOpenResult(result: SearchResult, locate: boolean): void
  onCreateCollection(name: string): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

const TYPE_LABEL: Record<SearchResultType, string> = {
  document: '文献',
  note: '笔记',
  chat: '对话',
  message: '消息',
  excerpt: '摘录',
  collection: '分类'
}

function ResultIcon({ type }: { type: SearchResultType }): React.JSX.Element {
  const size = 15
  if (type === 'document' || type === 'note') return <StickyNote size={size} />
  if (type === 'chat' || type === 'message') return <MessageSquare size={size} />
  if (type === 'excerpt') return <Quote size={size} />
  if (type === 'collection') return <Folder size={size} />
  return <FileText size={size} />
}

export default function CommandPalette({
  mode,
  commands,
  onClose,
  onOpenResult,
  onCreateCollection,
  notify
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const [promptKind, setPromptKind] = useState<'collection' | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [mode, promptKind])

  useEffect(() => {
    if (promptKind) promptRef.current?.focus()
  }, [promptKind])

  useEffect(() => {
    if (mode !== 'search' || promptKind) return
    let alive = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      void window.api.search
        .global(query)
        .then((rows) => {
          if (!alive) return
          setResults(rows)
          setSelected(0)
        })
        .catch((err: Error) => {
          if (alive) notify(`搜索失败：${err.message}`, 'error')
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 140)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, mode, promptKind, notify])

  const filteredCommands = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return commands
    return commands.filter(
      (command) => command.label.toLowerCase().includes(keyword) || (command.keywords ?? '').toLowerCase().includes(keyword)
    )
  }, [commands, query])

  const items: { key: string; run(): void }[] = useMemo(() => {
    if (mode === 'search') {
      return results.map((result) => ({
        key: result.id,
        run: () => onOpenResult(result, false)
      }))
    }
    return filteredCommands.map((command) => ({
      key: command.id,
      run: () => {
        if (command.disabled) return
        if (command.id === 'new-collection') {
          setPromptKind('collection')
          setPromptValue('')
          return
        }
        void command.run()
        onClose()
      }
    }))
  }, [mode, results, filteredCommands, onOpenResult, onClose])

  const submitPrompt = async (): Promise<void> => {
    const name = promptValue.trim()
    if (!name) {
      notify('分类名称不能为空', 'error')
      return
    }
    try {
      await onCreateCollection(name)
      onClose()
    } catch (err) {
      notify(`创建分类失败：${(err as Error).message}`, 'error')
    }
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (promptKind) setPromptKind(null)
      else onClose()
      return
    }
    if (promptKind) {
      if (event.key === 'Enter') {
        event.preventDefault()
        void submitPrompt()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((value) => (items.length ? (value + 1) % items.length : 0))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((value) => (items.length ? (value - 1 + items.length) % items.length : 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[selected]
      if (!item) return
      if (mode === 'search') {
        const result = results[selected]
        if (!result) return
        onOpenResult(result, event.ctrlKey || event.metaKey)
        onClose()
        return
      }
      item.run()
    }
  }

  const activeResult = mode === 'search' ? results[selected] : undefined

  return (
    <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" onKeyDown={onKeyDown}>
        <div className="palette-input-row">
          {mode === 'search' ? <Search size={17} /> : <FileText size={17} />}
          <input
            ref={inputRef}
            value={promptKind ? promptValue : query}
            onChange={(event) => (promptKind ? setPromptValue(event.target.value) : setQuery(event.target.value))}
            placeholder={
              promptKind
                ? '输入分类名称，回车创建'
                : mode === 'search'
                  ? '搜索文献、全文、对话、笔记、摘录、分类…'
                  : '输入命令，例如：导入、分类、设置…'
            }
            autoFocus
          />
          {loading && mode === 'search' && <Loader2 size={15} className="spin" />}
          <span className="palette-kbd">{mode === 'search' ? 'Ctrl+O' : 'Ctrl+K'}</span>
        </div>

        {promptKind ? (
          <div className="palette-list">
            <button className="palette-item active" onClick={() => void submitPrompt()}>
              <span className="palette-item-icon">
                <Folder size={15} />
              </span>
              <span className="palette-item-main">
                <span className="palette-item-title">创建分类「{promptValue.trim() || '…'}」</span>
                <span className="palette-item-sub">回车确认，Esc 返回</span>
              </span>
            </button>
          </div>
        ) : (
          <div className="palette-list">
            {mode === 'search' && !query.trim() && <div className="palette-section">最近文献与对话</div>}
            {mode === 'search' &&
              results.map((result, index) => (
                <button
                  key={result.id}
                  className={`palette-item${index === selected ? ' active' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => {
                    onOpenResult(result, false)
                    onClose()
                  }}
                >
                  <span className="palette-item-icon">
                    <ResultIcon type={result.type} />
                  </span>
                  <span className="palette-item-main">
                    <span className="palette-item-title">
                      {result.title}
                      <span className="palette-tag">{TYPE_LABEL[result.type]}</span>
                      {result.page ? <span className="palette-page">第 {result.page} 页</span> : null}
                      {result.docMissing ? <span className="palette-page">来源已删除</span> : null}
                    </span>
                    <span className="palette-item-sub">{result.snippet}</span>
                  </span>
                </button>
              ))}
            {mode === 'command' &&
              filteredCommands.map((command, index) => (
                <button
                  key={command.id}
                  className={`palette-item${index === selected ? ' active' : ''}${command.disabled ? ' disabled' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => items[index]?.run()}
                >
                  <span className="palette-item-icon">
                    <Search size={15} />
                  </span>
                  <span className="palette-item-main">
                    <span className="palette-item-title">{command.label}</span>
                    {command.hint && <span className="palette-item-sub">{command.hint}</span>}
                  </span>
                </button>
              ))}
            {!loading && !items.length && (
              <div className="palette-empty">{mode === 'search' ? '没有找到匹配内容' : '没有匹配的命令'}</div>
            )}
          </div>
        )}

        <div className="palette-foot">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          {mode === 'search' && <span>Ctrl+Enter 定位到命中页</span>}
          <span>Esc 关闭</span>
          {activeResult && mode === 'search' && <span className="palette-foot-path">{TYPE_LABEL[activeResult.type]}</span>}
        </div>
      </div>
    </div>
  )
}
