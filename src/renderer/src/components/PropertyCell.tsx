import type { Property, PropertyValue } from '@shared/types'
import './properties.css'

interface Props {
  property: Property
  value?: PropertyValue
  onChange(value: PropertyValue): void
}

function optionName(property: Property, id: string): string {
  return property.options?.find((option) => option.id === id)?.name ?? id
}

export default function PropertyCell({ property, value, onChange }: Props): React.JSX.Element {
  const stop = (event: React.MouseEvent): void => event.stopPropagation()

  if (property.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onClick={stop}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }

  if (property.type === 'select') {
    return (
      <select
        className="select small"
        value={typeof value === 'string' ? value : ''}
        onClick={stop}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">—</option>
        {(property.options ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    )
  }

  if (property.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    const toggle = (id: string): void => {
      onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
    }
    return (
      <details className="prop-multi" onClick={stop}>
        <summary>{selected.length ? selected.map((id) => optionName(property, id)).join('、') : '—'}</summary>
        <div className="prop-multi-menu">
          {(property.options ?? []).map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
              />
              {option.name}
            </label>
          ))}
          {(property.options ?? []).length === 0 && <span className="muted small">未配置选项</span>}
        </div>
      </details>
    )
  }

  const raw = value === null || value === undefined ? '' : String(value)
  return (
    <input
      className="prop-cell-input"
      type={property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'}
      defaultValue={raw}
      placeholder="—"
      onClick={stop}
      onBlur={(event) => {
        const text = event.target.value.trim()
        if (!text) {
          onChange(null)
        } else if (property.type === 'number') {
          const num = Number(text)
          onChange(Number.isNaN(num) ? null : num)
        } else {
          onChange(text)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.currentTarget.value = raw
          event.currentTarget.blur()
        }
      }}
    />
  )
}
