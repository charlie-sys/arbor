import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, FileDown, FileText, Image as ImageIcon, Loader2, ScanLine, Trash2, X } from 'lucide-react'
import type { TranslationRecord } from '@shared/types'
import type { TranslateEvent } from '@shared/api'
import { Markdown, cx, formatFullDate, formatTime } from '../ui'
import { t } from '@shared/i18n'

interface Props {
  records: TranslationRecord[]
  selectedId?: string
  status: TranslateEvent | null
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function TranslationsView({ records, selectedId, status, onChanged, notify }: Props): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(selectedId ?? records[0]?.id ?? null)
  const [tab, setTab] = useState<'structured' | 'plain'>('structured')
  const [lightbox, setLightbox] = useState(false)
  const [imageMode, setImageMode] = useState<'translated' | 'original'>('original')

  useEffect(() => {
    if (selectedId) setActiveId(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!activeId && records.length) setActiveId(records[0].id)
    if (activeId && !records.some((record) => record.id === activeId)) {
      setActiveId(records[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.map((record) => record.id).join(','), selectedId])

  const active = useMemo(() => records.find((record) => record.id === activeId) ?? null, [records, activeId])
  const showingTranslated = imageMode === 'translated' && !!active?.translatedImageFile
  const imageUrl = active
    ? showingTranslated
      ? `zotfile://translations/${active.translatedImageFile}`
      : `zotfile://translations/${active.imageFile}`
    : ''
  const busy = status?.status === 'selecting' || status?.status === 'capturing' || status?.status === 'translating'

  useEffect(() => {
    setImageMode(active?.translatedImageFile ? 'translated' : 'original')
    setLightbox(false)
  }, [active?.id, active?.translatedImageFile])

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      notify(t("已复制{0}", [label]), 'success')
    } catch {
      notify(t("复制失败"), 'error')
    }
  }

  const exportRecord = async (format: 'docx' | 'md'): Promise<void> => {
    if (!active) return
    const title = t("截图翻译 {0}", [formatFullDate(active.createdAt)])
    try {
      const result = await window.api.documents.exportMarkdown(title, active.structured, format)
      if (!result.canceled && result.filePath) notify(t("已导出：{0}", [result.filePath]), 'success')
    } catch (err) {
      notify(t("导出失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const exportImage = async (): Promise<void> => {
    if (!active) return
    try {
      const variant = showingTranslated ? 'translated' : 'original'
      const result = await window.api.translate.exportImage(active.id, variant)
      if (!result.canceled && result.filePath) {
        notify(t("图片已保存：{0}", [result.filePath]), 'success')
      }
    } catch (err) {
      notify(t("保存图片失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const remove = async (): Promise<void> => {
    if (!active) return
    if (!window.confirm(t("删除这条翻译记录及其截图？"))) return
    try {
      await window.api.translate.delete(active.id)
      setActiveId(null)
      await onChanged()
      notify(t("翻译记录已删除"), 'success')
    } catch (err) {
      notify(t("删除失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const startCapture = async (): Promise<void> => {
    const result = await window.api.translate.start()
    if (!result.ok && result.reason) notify(result.reason, 'info')
  }

  return (
    <div className="view translate-page">
      <header className="view-head">
        <div>
          <h1>{t("截图翻译")}</h1>
          <p className="muted">
            {' '}{t("框选截图后，译文会按原版式回绘到截图上（字体替换为系统字体），同时保留原图、结构化译文与纯文本。")}{' '}</p>
        </div>
        <button className="btn primary" onClick={() => void startCapture()} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <ScanLine size={16} />}
          {busy ? t("处理中…") : t("开始截图")}
        </button>
      </header>

      {busy && (
        <div className="translate-status">
          <Loader2 size={16} className="spin" />
          <span>
            {status?.status === 'selecting' && t("请在屏幕上拖拽选择需要翻译的区域（Esc 取消）")}
            {status?.status === 'capturing' && t("正在截取画面…")}
            {status?.status === 'translating' && (status.message || t("正在调用视觉模型识别并翻译…"))}
          </span>
        </div>
      )}

      {records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <ScanLine size={28} />
          </div>
          <h2>{t("截取屏幕上的外文内容")}</h2>
          <p className="muted">{t("适合翻译论文图表、扫描版 PDF 或任何窗口中的文字。翻译结果可保留原版式或输出纯文本。")}</p>
          <button className="btn primary" onClick={() => void startCapture()} disabled={busy}>
            <ScanLine size={16} /> {' '}{t("框选截图")}{' '}</button>
        </div>
      ) : (
        <div className="translate-body">
          <aside className="translate-list">
            {records.map((record) => (
              <div
                key={record.id}
                className={cx('translate-item', record.id === activeId && 'active')}
                onClick={() => {
                  setActiveId(record.id)
                  setTab('structured')
                }}
              >
                <img src={`zotfile://translations/${record.imageFile}`} alt="" loading="lazy" />
                <div className="translate-item-main">
                  <div className="translate-item-preview">
                    {record.structured.replace(/[#>*`|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || t("翻译记录")}
                  </div>
                  <div className="translate-item-meta">
                    <span>{formatTime(record.createdAt)}</span>
                    <span>{record.model}</span>
                  </div>
                </div>
              </div>
            ))}
          </aside>

          <section className="translate-detail">
            {active && (
              <>
                <div className="translate-detail-head">
                  <div>
                    <div className="translate-time">{formatFullDate(active.createdAt)}</div>
                    <div className="muted small">{t("模型：")}{active.model}</div>
                  </div>
                  <div className="translate-actions">
                    <button className="btn ghost small" onClick={() => void exportRecord('md')}>
                      <FileText size={14} /> Markdown
                    </button>
                    <button className="btn ghost small" onClick={() => void exportRecord('docx')}>
                      <FileDown size={14} /> Word
                    </button>
                    <button className="icon-btn" onClick={() => void remove()} title={t("删除记录")}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="image-mode-row">
                  <div className="image-mode-tabs">
                    <button
                      className={cx('image-mode-tab', showingTranslated && 'active')}
                      onClick={() => setImageMode('translated')}
                      disabled={!active.translatedImageFile}
                      title={active.translatedImageFile ? t("在原图版式上重绘的译文图") : t("未生成译文图")}
                    >
                      {' '}{t("译文图")}{' '}</button>
                    <button
                      className={cx('image-mode-tab', !showingTranslated && 'active')}
                      onClick={() => setImageMode('original')}
                    >
                      {' '}{t("原图")}{' '}</button>
                  </div>
                  <button className="btn ghost small" onClick={() => void exportImage()}>
                    <Download size={14} /> {' '}{t("导出当前图片")}{' '}</button>
                </div>
                {!active.translatedImageFile && (
                  <div className="image-note">
                    {' '}{t("未能生成译文图（系统 OCR 或排版翻译不可用）；原图与文字译文均已保存。")}{' '}</div>
                )}
                <div className="translate-image" onClick={() => setLightbox(true)} title={t("点击查看大图")}>
                  <img src={imageUrl} alt={showingTranslated ? t("译文截图") : t("截图原文")} />
                  <div className="image-hint">
                    <ImageIcon size={13} /> {showingTranslated ? t("译文图（系统字体）") : t("原文截图")}
                  </div>
                </div>

                <div className="translate-tabs">
                  <button className={cx('translate-tab', tab === 'structured' && 'active')} onClick={() => setTab('structured')}>
                    {' '}{t("保留结构译文")}{' '}</button>
                  <button className={cx('translate-tab', tab === 'plain' && 'active')} onClick={() => setTab('plain')}>
                    {' '}{t("纯文本译文")}{' '}</button>
                  <button
                    className="btn ghost small copy-tab"
                    onClick={() => void copy(tab === 'structured' ? active.structured : active.plain, tab === 'structured' ? t("结构化译文") : t("纯文本译文"))}
                  >
                    <Copy size={14} /> {' '}{t("复制当前译文")}{' '}</button>
                </div>

                <div className="translate-content">
                  {tab === 'structured' ? <Markdown>{active.structured}</Markdown> : <div className="plain-text">{active.plain}</div>}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {lightbox && active && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <button className="lightbox-close" onClick={() => setLightbox(false)} title={t("关闭")}>
            <X size={20} />
          </button>
          <img src={imageUrl} alt={t("截图原文")} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
