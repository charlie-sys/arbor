import { HelpCircle, Lightbulb, Save, Sparkles, Trash2, X } from 'lucide-react'
import type { StickyColor, StickyNoteKind } from '@shared/types'
import { STICKY_COLORS } from '../annotations'
import { cx } from '../ui'
import { t } from '@shared/i18n'

interface Props {
  page: number
  isNew: boolean
  kind: StickyNoteKind
  color: StickyColor
  text: string
  resolved: boolean
  position: { left: number; top: number }
  canAskAgent: boolean
  onChange(patch: { kind?: StickyNoteKind; color?: StickyColor; text?: string; resolved?: boolean }): void
  onSave(): void
  onClose(): void
  onDelete(): void
  onAskAgent(): void
}

export default function StickyNoteEditor(props: Props): React.JSX.Element {
  return (
    <div
      className="sticky-note-editor"
      style={{ left: props.position.left, top: props.position.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          props.onClose()
        } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          props.onSave()
        }
      }}
    >
      <div className="sticky-note-head">
        <span className="sticky-note-title">
          {props.kind === 'question' ? <HelpCircle size={14} /> : <Lightbulb size={14} />}
          {t("第")} {props.page} {t("页贴纸")}
        </span>
        <button type="button" className="icon-btn tiny" title={t("关闭")} onClick={props.onClose}>
          <X size={13} />
        </button>
      </div>

      <div className="sticky-note-kinds">
        <button
          type="button"
          className={cx('chip-button', props.kind === 'idea' && 'active')}
          onClick={() => props.onChange({ kind: 'idea' })}
        >
          <Lightbulb size={13} /> {t("想法")}
        </button>
        <button
          type="button"
          className={cx('chip-button', props.kind === 'question' && 'active')}
          onClick={() => props.onChange({ kind: 'question' })}
        >
          <HelpCircle size={13} /> {t("问题")}
        </button>
        {props.kind === 'question' && (
          <label className="sticky-note-resolved">
            <input
              type="checkbox"
              checked={props.resolved}
              onChange={(event) => props.onChange({ resolved: event.target.checked })}
            />
            {t("已解决")}
          </label>
        )}
      </div>

      <div className="sticky-note-swatches">
        {STICKY_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={cx('annotation-swatch', `note-${color}`, props.color === color && 'active')}
            title={t("贴纸颜色")}
            onClick={() => props.onChange({ color })}
          />
        ))}
      </div>

      <textarea
        autoFocus
        className="sticky-note-input"
        rows={5}
        placeholder={t("记录想法或问题…")}
        value={props.text}
        onChange={(event) => props.onChange({ text: event.target.value })}
      />

      <div className="sticky-note-actions">
        <button
          type="button"
          className="btn ghost small danger"
          disabled={props.isNew}
          onClick={props.onDelete}
        >
          <Trash2 size={13} /> {t("删除")}
        </button>
        <div className="sticky-note-actions-right">
          <button
            type="button"
            className="btn ghost small"
            disabled={!props.canAskAgent}
            onClick={props.onAskAgent}
          >
            <Sparkles size={13} /> {t("问 Agent")}
          </button>
          <button type="button" className="btn primary small" onClick={props.onSave}>
            <Save size={13} /> {t("保存")}
          </button>
        </div>
      </div>
    </div>
  )
}
