import { Check } from 'lucide-react'
import type { DocumentToneId } from '@shared/types'
import { DOCUMENT_TONES } from '../documentTone'
import { cx } from '../ui'
import { t } from '@shared/i18n'

interface Props {
  tone: DocumentToneId
  onSelect(tone: DocumentToneId): void
  onClose(): void
}

export default function DocumentToneMenu(props: Props): React.JSX.Element {
  return (
    <div
      className="reader-popover document-tone-menu"
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
      aria-label={t("文献色调")}
    >
      <div className="reader-popover-head">{t("文献色调")}</div>
      {DOCUMENT_TONES.map((tone) => (
        <button
          key={tone.id}
          type="button"
          className={cx('document-tone-item', props.tone === tone.id && 'active')}
          onClick={() => {
            props.onSelect(tone.id)
            props.onClose()
          }}
          role="menuitemradio"
          aria-checked={props.tone === tone.id}
        >
          <span className="document-tone-swatch" aria-hidden="true">
            <i style={{ background: tone.swatches[0] }} />
            <i style={{ background: tone.swatches[1] }} />
          </span>
          <span className="document-tone-copy">
            <strong>{t(tone.label)}</strong>
            <small>{t(tone.description)}</small>
          </span>
          {props.tone === tone.id && <Check size={15} className="document-tone-check" />}
        </button>
      ))}
    </div>
  )
}
