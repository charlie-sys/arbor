import {
  Eraser,
  Eye,
  EyeOff,
  Highlighter,
  MousePointer2,
  PenLine,
  Redo2,
  StickyNote,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type { StickyColor } from '@shared/types'
import { INK_WIDTHS, STICKY_COLORS } from '../annotations'
import type { AnnotationTool } from './PageAnnotationLayer'
import { t } from '@shared/i18n'

interface Props {
  tool: AnnotationTool
  inkColor: string
  inkColors: { value: string; label: string }[]
  inkWidth: number
  stickyColor: StickyColor
  canUndo: boolean
  canRedo: boolean
  visible: boolean
  onTool(tool: AnnotationTool): void
  onInkColor(color: string): void
  onInkWidth(width: number): void
  onStickyColor(color: StickyColor): void
  onUndo(): void
  onRedo(): void
  onClearPage(): void
  onToggleVisible(): void
  onClose(): void
}

const TOOLS: { id: AnnotationTool; label: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'note', label: '贴纸', icon: StickyNote },
  { id: 'pen', label: '画笔', icon: PenLine },
  { id: 'marker', label: '荧光笔', icon: Highlighter },
  { id: 'eraser', label: '橡皮擦', icon: Eraser }
]

export default function AnnotationToolbar(props: Props): React.JSX.Element {
  const colorMode = props.tool === 'note' ? 'sticky' : 'ink'
  return (
    <div className="annotation-toolbar" role="toolbar" aria-label={t("标注工具")}>
      <div className="annotation-tool-group annotation-tools">
        {TOOLS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              className={`annotation-tool-btn${props.tool === item.id ? ' active' : ''}`}
              title={t(item.label)}
              aria-label={t(item.label)}
              aria-pressed={props.tool === item.id}
              onClick={() => props.onTool(item.id)}
            >
              <Icon size={16} />
            </button>
          )
        })}
      </div>

      <span className="annotation-tool-divider" />

      {colorMode === 'sticky' ? (
        <div className="annotation-swatches" title={t("贴纸颜色")}>
          {STICKY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`annotation-swatch note-${color}${props.stickyColor === color ? ' active' : ''}`}
              title={t("贴纸颜色")}
              onClick={() => props.onStickyColor(color)}
            />
          ))}
        </div>
      ) : (
        <div className="annotation-swatches" title={t("画笔颜色")}>
          {props.inkColors.map((color) => (
            <button
              key={color.value}
              type="button"
              className={`annotation-swatch${props.inkColor === color.value ? ' active' : ''}`}
              style={{ background: color.value }}
              title={t(color.label)}
              onClick={() => props.onInkColor(color.value)}
            />
          ))}
        </div>
      )}

      {(props.tool === 'pen' || props.tool === 'marker') && (
        <>
          <span className="annotation-tool-divider" />
          <div className="annotation-widths" title={t("笔触粗细")}>
            {INK_WIDTHS.map((width) => (
              <button
                key={width.value}
                type="button"
                className={`annotation-width${props.inkWidth === width.value ? ' active' : ''}`}
                title={t(width.label)}
                onClick={() => props.onInkWidth(width.value)}
              >
                <span style={{ width: `${4 + width.value * 800}px`, height: `${4 + width.value * 800}px` }} />
              </button>
            ))}
          </div>
        </>
      )}

      <span className="annotation-tool-divider" />

      <button
        type="button"
        className="annotation-tool-btn"
        title={t("撤销")}
        aria-label={t("撤销")}
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        className="annotation-tool-btn"
        title={t("重做")}
        aria-label={t("重做")}
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <Redo2 size={16} />
      </button>
      <button
        type="button"
        className="annotation-tool-btn"
        title={t("清空本页墨迹")}
        aria-label={t("清空本页墨迹")}
        onClick={props.onClearPage}
      >
        <Trash2 size={16} />
      </button>
      <button
        type="button"
        className="annotation-tool-btn"
        title={props.visible ? t("隐藏标注") : t("显示标注")}
        aria-label={props.visible ? t("隐藏标注") : t("显示标注")}
        onClick={props.onToggleVisible}
      >
        {props.visible ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
      <button type="button" className="annotation-tool-btn close" title={t("退出标注")} aria-label={t("退出标注")} onClick={props.onClose}>
        <X size={16} />
      </button>
    </div>
  )
}
