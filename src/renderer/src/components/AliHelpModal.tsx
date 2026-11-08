import { useEffect, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import type { AliHelpSection } from '@shared/ali'
import { Markdown } from '../ui'
import { t } from '@shared/i18n'

interface Props {
  title: string
  onClose(): void
}

export default function AliHelpModal({ title, onClose }: Props): React.JSX.Element {
  const [sections, setSections] = useState<AliHelpSection[] | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.ali
      .help()
      .then((items) => {
        if (alive) setSections(items)
      })
      .catch(() => {
        if (alive) setSections([])
      })
    return () => {
      alive = false
    }
  }, [])

  const base = title.replace(/（续 \d+）/g, '').trim()
  const section =
    sections?.find((item) => item.title === title) ??
    sections?.find((item) => item.title === base) ??
    sections?.find((item) => title.includes(item.title) || item.path.includes(base)) ??
    null

  return (
    <div
      className="modal-backdrop"
      data-testid="ali-help-modal"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal ali-help-modal">
        <div className="modal-head">
          <div>
            <h3><BookOpen size={17} /> {t('使用说明')}</h3>
            <p className="muted">{section?.path || base}</p>
          </div>
          <button className="icon-btn" onClick={onClose} title={t('关闭')}>
            <X size={18} />
          </button>
        </div>
        <div className="ali-help-body">
          {sections === null ? (
            <div className="muted">{t('正在加载使用说明…')}</div>
          ) : section ? (
            <Markdown>{section.body}</Markdown>
          ) : (
            <div className="muted">{t('没有找到对应章节，可在完整说明中搜索。')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
