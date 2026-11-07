import { useEffect, useRef, useState } from 'react'
import { BookOpen, Download, Link2, Maximize2, Minus, Plus, Trash2 } from 'lucide-react'
import type { CanvasEdge, CanvasNode, CanvasNodeKind, LibraryData } from '@shared/types'
import { cx } from '../ui'
import CanvasNameDialog from './CanvasNameDialog'

type CanvasDialog = { kind: 'create' | 'rename' | 'section'; value: string }

interface Props {
  data: LibraryData
  canvasId?: string
  onSelectCanvas(id?: string): void
  onOpenDoc(docId: string, page?: number): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

const CARD_SIZE: Record<CanvasNodeKind, { width: number; height: number }> = {
  document: { width: 260, height: 150 },
  excerpt: { width: 280, height: 170 },
  chat: { width: 300, height: 180 },
  section: { width: 380, height: 260 }
}

const CARD_COLOR: Record<CanvasNodeKind, { bg: string; border: string; text: string }> = {
  document: { bg: '#fffdf9', border: '#e3d9cc', text: '#3f3a33' },
  excerpt: { bg: '#f7ecdd', border: '#e8d3b4', text: '#6b4f33' },
  chat: { bg: '#efe9dd', border: '#d8cbbb', text: '#5d5449' },
  section: { bg: '#edf0e6', border: '#c9d3b8', text: '#4a5a3d' }
}

const MIN_SIZE: Record<CanvasNodeKind, { width: number; height: number }> = {
  document: { width: 160, height: 90 },
  excerpt: { width: 160, height: 90 },
  chat: { width: 160, height: 90 },
  section: { width: 240, height: 160 }
}

const containsNode = (section: CanvasNode, node: CanvasNode): boolean => {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  return cx >= section.x && cx <= section.x + section.width && cy >= section.y && cy <= section.y + section.height
}

const newId = (): string => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

export default function CanvasView({ data, canvasId, onSelectCanvas, onOpenDoc, onChanged, notify }: Props): React.JSX.Element {
  const board = data.canvases.find((item) => item.id === (canvasId ?? data.canvases[0]?.id))
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [edges, setEdges] = useState<CanvasEdge[]>([])
  const [vp, setVp] = useState({ x: 60, y: 60, scale: 1 })
  const [mode, setMode] = useState<'select' | 'connect'>('select')
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    id: string
    dx: number
    dy: number
    group: { id: string; x: number; y: number }[]
  } | null>(null)
  const resize = useRef<{ id: string; startX: number; startY: number; width: number; height: number } | null>(null)
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const nodesRef = useRef<CanvasNode[]>([])
  const edgesRef = useRef<CanvasEdge[]>([])
  const [panning, setPanning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [dialog, setDialog] = useState<CanvasDialog | null>(null)

  useEffect(() => {
    setNodes(board?.nodes ?? [])
    setEdges(board?.edges ?? [])
  }, [board?.id])

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  useEffect(() => {
    const element = surface.current
    if (!element) return
    const handler = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      setVp((prev) => {
        const scale = Math.min(2, Math.max(0.3, prev.scale * (event.deltaY > 0 ? 0.9 : 1.1)))
        const wx = (px - prev.x) / prev.scale
        const wy = (py - prev.y) / prev.scale
        return { x: px - wx * scale, y: py - wy * scale, scale }
      })
    }
    element.addEventListener('wheel', handler, { passive: false })
    return () => element.removeEventListener('wheel', handler)
  }, [board?.id])

  const persist = async (nextNodes: CanvasNode[], nextEdges: CanvasEdge[], name?: string): Promise<void> => {
    if (!board) return
    try {
      await window.api.canvases.update(board.id, { nodes: nextNodes, edges: nextEdges, ...(name ? { name } : {}) })
      await onChanged()
    } catch (err) {
      notify(`保存画布失败：${(err as Error).message}`, 'error')
    }
  }

  const createBoard = (): void => {
    setDialog({ kind: 'create', value: '研究画布' })
  }

  const renameBoard = (): void => {
    if (!board) return
    setDialog({ kind: 'rename', value: board.name })
  }

  const confirmDialog = async (name: string): Promise<void> => {
    const current = dialog
    if (!current) return
    setDialog(null)
    if (current.kind === 'create') {
      try {
        const created = await window.api.canvases.add(name)
        await onChanged()
        onSelectCanvas(created.id)
      } catch (err) {
        notify(`新建画布失败：${(err as Error).message}`, 'error')
      }
      return
    }
    if (current.kind === 'rename') {
      await persist(nodesRef.current, edgesRef.current, name)
      return
    }
    await addNode({ kind: 'section', title: name, color: '#edf0e6' })
  }

  const removeBoard = async (): Promise<void> => {
    if (!board) return
    if (!window.confirm(`删除画布「${board.name}」？画布内容会一并删除，文献与摘录不受影响。`)) return
    try {
      await window.api.canvases.remove(board.id)
      await onChanged()
      onSelectCanvas(undefined)
    } catch (err) {
      notify(`删除画布失败：${(err as Error).message}`, 'error')
    }
  }

  const addNode = async (
    partial: Omit<CanvasNode, 'id' | 'x' | 'y' | 'width' | 'height' | 'createdAt'>,
    at?: { x: number; y: number }
  ): Promise<void> => {
    const rect = surface.current?.getBoundingClientRect()
    const size = CARD_SIZE[partial.kind]
    const offset = (nodesRef.current.length % 6) * 26
    const x = at ? at.x - size.width / 2 : ((rect ? rect.width / 2 : 400) - vp.x) / vp.scale - size.width / 2 + offset
    const y = at ? at.y - size.height / 2 : ((rect ? rect.height / 2 : 260) - vp.y) / vp.scale - size.height / 2 + offset
    const next = [...nodesRef.current, { ...partial, ...size, id: newId(), x, y, createdAt: Date.now() }]
    nodesRef.current = next
    setNodes(next)
    await persist(next, edgesRef.current)
  }

  const addDocumentCard = (doc: LibraryData['documents'][number], at?: { x: number; y: number }): Promise<void> =>
    addNode(
      {
        kind: 'document',
        title: doc.title,
        text: [doc.authors, doc.year, doc.journal].filter(Boolean).join(' · '),
        docId: doc.id
      },
      at
    )

  const handleAdd = (value: string): void => {
    if (!value || !board) return
    if (value === '__section') {
      setDialog({ kind: 'section', value: '新分区' })
      return
    }
    if (value.startsWith('doc:')) {
      const doc = data.documents.find((item) => item.id === value.slice(4))
      if (!doc) return
      void addDocumentCard(doc)
      return
    }
    if (value.startsWith('excerpt:')) {
      const excerpt = data.excerpts.find((item) => item.id === value.slice(8))
      if (!excerpt) return
      void addNode({
        kind: 'excerpt',
        title: `摘录 · ${excerpt.docTitle}`,
        text: excerpt.answer.slice(0, 220),
        docId: excerpt.docId ?? undefined,
        excerptId: excerpt.id
      })
      return
    }
    if (value.startsWith('chat:')) {
      const [chatId, messageId] = value.slice(5).split('|')
      const chat = data.chats.find((item) => item.id === chatId)
      const message = chat?.messages.find((item) => item.id === messageId)
      if (!chat || !message) return
      void addNode({
        kind: 'chat',
        title: `问答 · ${chat.title}`,
        text: message.content.slice(0, 240),
        chatId: chat.id,
        messageId: message.id,
        docId: chat.docIds[0]
      })
    }
  }

  const removeNode = async (id: string): Promise<void> => {
    const nextNodes = nodes.filter((node) => node.id !== id)
    const nextEdges = edges.filter((edge) => edge.from !== id && edge.to !== id)
    setNodes(nextNodes)
    setEdges(nextEdges)
    await persist(nextNodes, nextEdges)
  }

  const removeEdge = async (id: string): Promise<void> => {
    if (!window.confirm('删除这条连线？')) return
    const next = edges.filter((edge) => edge.id !== id)
    setEdges(next)
    await persist(nodes, next)
  }

  const connectTo = (id: string): void => {
    if (!connectFrom) {
      setConnectFrom(id)
      return
    }
    if (connectFrom === id) {
      setConnectFrom(null)
      return
    }
    const next = [...edges, { id: newId(), from: connectFrom, to: id }]
    setEdges(next)
    setConnectFrom(null)
    void persist(nodesRef.current, next)
  }

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode): void => {
    event.stopPropagation()
    if (mode === 'connect') {
      connectTo(node.id)
      return
    }
    setSelected(node.id)
    const rect = surface.current?.getBoundingClientRect()
    const px = event.clientX - (rect?.left ?? 0)
    const py = event.clientY - (rect?.top ?? 0)
    const group =
      node.kind === 'section'
        ? nodes.filter((item) => item.id === node.id || (item.kind !== 'section' && containsNode(node, item)))
        : [node]
    drag.current = {
      id: node.id,
      dx: (px - vp.x) / vp.scale - node.x,
      dy: (py - vp.y) / vp.scale - node.y,
      group: group.map((item) => ({ id: item.id, x: item.x, y: item.y }))
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state) return
    const rect = surface.current?.getBoundingClientRect()
    const px = event.clientX - (rect?.left ?? 0)
    const py = event.clientY - (rect?.top ?? 0)
    const base = state.group.find((item) => item.id === state.id)
    if (!base) return
    const deltaX = (px - vp.x) / vp.scale - state.dx - base.x
    const deltaY = (py - vp.y) / vp.scale - state.dy - base.y
    setNodes((prev) => {
      const next = prev.map((node) => {
        const member = state.group.find((item) => item.id === node.id)
        return member ? { ...node, x: member.x + deltaX, y: member.y + deltaY } : node
      })
      nodesRef.current = next
      return next
    })
  }

  const endDrag = (): void => {
    if (!drag.current) return
    drag.current = null
    void persist(nodesRef.current, edgesRef.current)
  }

  const beginResize = (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode): void => {
    event.stopPropagation()
    resize.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      width: node.width,
      height: node.height
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = resize.current
    if (!state) return
    const node = nodesRef.current.find((item) => item.id === state.id)
    if (!node) return
    const min = MIN_SIZE[node.kind]
    const width = Math.max(min.width, state.width + (event.clientX - state.startX) / vp.scale)
    const height = Math.max(min.height, state.height + (event.clientY - state.startY) / vp.scale)
    setNodes((prev) => {
      const next = prev.map((item) => (item.id === state.id ? { ...item, width, height } : item))
      nodesRef.current = next
      return next
    })
  }

  const endResize = (): void => {
    if (!resize.current) return
    resize.current = null
    void persist(nodesRef.current, edgesRef.current)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes('application/x-arbor-doc')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) setDragOver(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOver(false)
    const docId = event.dataTransfer.getData('application/x-arbor-doc') || event.dataTransfer.getData('text/plain')
    const doc = data.documents.find((item) => item.id === docId)
    if (!doc) return
    const rect = surface.current?.getBoundingClientRect()
    const x = (event.clientX - (rect?.left ?? 0) - vp.x) / vp.scale
    const y = (event.clientY - (rect?.top ?? 0) - vp.y) / vp.scale
    void addDocumentCard(doc, { x, y })
  }

  const beginPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    pan.current = { sx: event.clientX, sy: event.clientY, ox: vp.x, oy: vp.y }
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const movePan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!pan.current) return
    const start = pan.current
    setVp((prev) => ({ ...prev, x: start.ox + event.clientX - start.sx, y: start.oy + event.clientY - start.sy }))
  }

  const endPan = (): void => {
    pan.current = null
    setPanning(false)
  }

  const exportPng = (): void => {
    if (!board) return
    if (!nodes.length) {
      notify('画布还没有内容', 'info')
      return
    }
    const minX = Math.min(...nodes.map((node) => node.x)) - 40
    const minY = Math.min(...nodes.map((node) => node.y)) - 40
    const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + 40
    const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + 40
    const ratio = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((maxX - minX) * ratio))
    canvas.height = Math.max(1, Math.round((maxY - minY) * ratio))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.translate(-minX, -minY)
    ctx.fillStyle = '#faf6f1'
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY)
    ctx.strokeStyle = '#a1958a'
    ctx.lineWidth = 1.5
    for (const edge of edges) {
      const from = nodes.find((node) => node.id === edge.from)
      const to = nodes.find((node) => node.id === edge.to)
      if (!from || !to) continue
      ctx.beginPath()
      ctx.moveTo(from.x + from.width / 2, from.y + from.height / 2)
      ctx.lineTo(to.x + to.width / 2, to.y + to.height / 2)
      ctx.stroke()
    }
    const sorted = [...nodes].sort((a, b) => (a.kind === 'section' ? 0 : 1) - (b.kind === 'section' ? 0 : 1))
    const drawText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): void => {
      let line = ''
      let lines = 0
      for (const char of text) {
        if (ctx.measureText(line + char).width > maxWidth) {
          ctx.fillText(line, x, y + lines * lineHeight)
          lines += 1
          line = char
          if (lines >= maxLines) return
        } else {
          line += char
        }
      }
      if (line) ctx.fillText(line, x, y + lines * lineHeight)
    }
    for (const node of sorted) {
      const palette = CARD_COLOR[node.kind]
      ctx.fillStyle = palette.bg
      ctx.strokeStyle = palette.border
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(node.x, node.y, node.width, node.height, 12)
      else ctx.rect(node.x, node.y, node.width, node.height)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = palette.text
      ctx.font = '600 13px system-ui, sans-serif'
      drawText(node.title, node.x + 14, node.y + 24, node.width - 28, 18, 2)
      if (node.text) {
        ctx.font = '12px system-ui, sans-serif'
        drawText(node.text, node.x + 14, node.y + 50, node.width - 28, 17, node.kind === 'section' ? 10 : 6)
      }
    }
    const link = document.createElement('a')
    link.download = `${board.name || 'canvas'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    notify('画布已导出 PNG', 'success')
  }

  return (
    <div className="view canvas-view" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header className="view-head">
        <div>
          <h1>主题画布</h1>
          <p className="muted">文献、摘录与问答卡片，支持分区、连线、缩放、拖入文献与 PNG 导出</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="select" value={board?.id ?? ''} onChange={(event) => onSelectCanvas(event.target.value || undefined)}>
            {data.canvases.length === 0 && <option value="">暂无画布</option>}
            {data.canvases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button className="btn" data-canvas-new onClick={() => void createBoard()}>
            <Plus size={14} /> 新建画布
          </button>
          {board && (
            <button className="btn ghost" onClick={() => void renameBoard()}>
              重命名
            </button>
          )}
          {board && (
            <button className="btn ghost" onClick={() => void removeBoard()}>
              <Trash2 size={14} /> 删除
            </button>
          )}
        </div>
      </header>

      {!board ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Link2 size={28} />
          </div>
          <h2>还没有画布</h2>
          <p className="muted">创建画布后，可把文献、摘录与问答卡片放到同一张无限画布上；打开“文献”面板还能把文献直接拖到画布。</p>
          <button className="btn primary" onClick={() => void createBoard()}>
            <Plus size={16} /> 新建画布
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="select" data-canvas-add value="" onChange={(event) => handleAdd(event.target.value)}>
              <option value="">＋ 添加卡片</option>
              <option value="__section">新建分区</option>
              <optgroup label="文献">
                {data.documents.map((doc) => (
                  <option key={doc.id} value={`doc:${doc.id}`}>
                    {doc.title}
                  </option>
                ))}
              </optgroup>
              <optgroup label="摘录">
                {data.excerpts.map((excerpt) => (
                  <option key={excerpt.id} value={`excerpt:${excerpt.id}`}>
                    {excerpt.docTitle} · {excerpt.answer.slice(0, 30)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="问答">
                {data.chats.flatMap((chat) =>
                  chat.messages
                    .filter((message) => message.role === 'assistant')
                    .map((message) => (
                      <option key={`${chat.id}|${message.id}`} value={`chat:${chat.id}|${message.id}`}>
                        {chat.title} · {message.content.slice(0, 24)}
                      </option>
                    ))
                )}
              </optgroup>
            </select>
            <button
              className={cx('btn ghost', docsOpen && 'active')}
              data-canvas-docs
              onClick={() => setDocsOpen((value) => !value)}
            >
              <BookOpen size={14} /> 文献
            </button>
            <button
              className={cx('btn ghost', mode === 'connect' && 'active')}
              data-canvas-connect
              onClick={() => {
                setMode(mode === 'connect' ? 'select' : 'connect')
                setConnectFrom(null)
              }}
            >
              <Link2 size={14} /> {mode === 'connect' ? '点选两张卡片连线' : '连线'}
            </button>
            <button className="btn ghost" title="缩小" data-canvas-zoom-out onClick={() => setVp((prev) => ({ ...prev, scale: Math.max(0.3, prev.scale / 1.2) }))}>
              <Minus size={14} />
            </button>
            <span className="muted small" data-canvas-zoom style={{ minWidth: 46, textAlign: 'center' }}>
              {Math.round(vp.scale * 100)}%
            </span>
            <button className="btn ghost" title="放大" data-canvas-zoom-in onClick={() => setVp((prev) => ({ ...prev, scale: Math.min(2, prev.scale * 1.2) }))}>
              <Plus size={14} />
            </button>
            <button className="btn ghost" title="重置视图" data-canvas-zoom-reset onClick={() => setVp({ x: 60, y: 60, scale: 1 })}>
              <Maximize2 size={14} />
            </button>
            <button className="btn" data-canvas-export onClick={exportPng}>
              <Download size={14} /> 导出 PNG
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 520, minWidth: 0 }}>
            {docsOpen && (
              <aside
                data-canvas-doc-panel
                style={{
                  width: 230,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: 10,
                  border: '1px solid #e3d9cc',
                  borderRadius: 'var(--radius)',
                  background: '#fffdf9',
                  overflowY: 'auto'
                }}
              >
                <div className="muted small" style={{ padding: '0 2px 4px' }}>
                  拖拽文献到画布，或点击 + 添加
                </div>
                {data.documents.length === 0 && <div className="muted small">文献库为空</div>}
                {data.documents.map((doc) => (
                  <div
                    key={doc.id}
                    draggable
                    data-canvas-doc-source={doc.id}
                    title="拖到画布"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-arbor-doc', doc.id)
                      event.dataTransfer.setData('text/plain', doc.id)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      border: '1px solid #efe4d6',
                      borderRadius: 10,
                      background: '#fffdf9',
                      cursor: 'grab'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.title}
                      </div>
                      <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[doc.authors, doc.year, doc.journal].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <button className="icon-btn tiny" title="添加到画布" onClick={() => void addDocumentCard(doc)}>
                      <Plus size={12} />
                    </button>
                  </div>
                ))}
              </aside>
            )}
          <div
            ref={surface}
            data-canvas-surface
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 520,
              minWidth: 0,
              overflow: 'hidden',
              borderRadius: 'var(--radius)',
              border: '1px solid #e3d9cc',
              background: 'radial-gradient(circle, #e3d9cc 1px, transparent 1px) 0 0 / 24px 24px, #f8f2e9',
              cursor: panning ? 'grabbing' : 'grab',
              touchAction: 'none',
              outline: dragOver ? '2px dashed #5f7150' : 'none',
              outlineOffset: -4
            }}
          >
            <div
              data-canvas-world
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 0,
                height: 0,
                transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`,
                transformOrigin: '0 0'
              }}
            >
              <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
                {edges.map((edge) => {
                  const from = nodes.find((node) => node.id === edge.from)
                  const to = nodes.find((node) => node.id === edge.to)
                  if (!from || !to) return null
                  const x1 = from.x + from.width / 2
                  const y1 = from.y + from.height / 2
                  const x2 = to.x + to.width / 2
                  const y2 = to.y + to.height / 2
                  return (
                    <g key={edge.id} data-canvas-edge={edge.id}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8b7f70" strokeWidth={1.5} />
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onClick={() => void removeEdge(edge.id)}
                      />
                    </g>
                  )
                })}
              </svg>
              {[...nodes]
                .sort((a, b) => (a.kind === 'section' ? 0 : 1) - (b.kind === 'section' ? 0 : 1))
                .map((node) => {
                  const palette = CARD_COLOR[node.kind]
                  return (
                    <div
                      key={node.id}
                      data-canvas-node={node.id}
                      data-node-kind={node.kind}
                      onPointerDown={(event) => beginDrag(event, node)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      style={{
                        position: 'absolute',
                        left: node.x,
                        top: node.y,
                        width: node.width,
                        height: node.height,
                        background: palette.bg,
                        border: `1px ${node.kind === 'section' ? 'dashed' : 'solid'} ${palette.border}`,
                        borderRadius: '1.25rem 1rem 1.25rem 1.1rem',
                        padding: node.kind === 'section' ? 12 : 14,
                        color: palette.text,
                        boxShadow: node.kind === 'section' ? 'none' : '0 6px 18px rgba(84,65,48,0.08)',
                        cursor: mode === 'connect' ? 'crosshair' : 'grab',
                        pointerEvents: 'auto',
                        outline: selected === node.id ? '2px solid #5f7150' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        overflow: 'hidden',
                        userSelect: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <strong style={{ fontSize: 13, fontFamily: 'var(--font-serif)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {node.title}
                        </strong>
                        <button
                          className="icon-btn tiny"
                          title="删除卡片"
                          style={{ opacity: 0.55 }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            void removeNode(node.id)
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {node.text && (
                        <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85, overflow: 'hidden' }}>{node.text}</div>
                      )}
                      {node.docId && node.kind !== 'section' && (
                        <button
                          className="btn ghost"
                          style={{ marginTop: 'auto', alignSelf: 'flex-start', padding: '2px 8px', fontSize: 11, opacity: 0.8 }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenDoc(node.docId as string)
                          }}
                        >
                          打开原文
                        </button>
                      )}
                      <div
                        data-canvas-resize
                        title="拖动调整大小"
                        onPointerDown={(event) => beginResize(event, node)}
                        onPointerMove={moveResize}
                        onPointerUp={endResize}
                        onPointerCancel={endResize}
                        style={{
                          position: 'absolute',
                          right: 6,
                          bottom: 6,
                          width: 16,
                          height: 16,
                          display: 'flex',
                          alignItems: 'flex-end',
                          justifyContent: 'flex-end',
                          cursor: 'nwse-resize',
                          opacity: 0.45,
                          touchAction: 'none'
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M11 1 1 11M11 6 6 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
          </div>
        </>
      )}
      {dialog && (
        <CanvasNameDialog
          title={dialog.kind === 'create' ? '新建画布' : dialog.kind === 'rename' ? '重命名画布' : '新建分区'}
          initialValue={dialog.value}
          placeholder={dialog.kind === 'section' ? '分区名称' : '画布名称'}
          confirmLabel={dialog.kind === 'rename' ? '保存' : '创建'}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => void confirmDialog(name)}
        />
      )}
    </div>
  )
}
