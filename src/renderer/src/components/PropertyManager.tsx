import { useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Property, PropertyType } from '@shared/types'
import './properties.css'

interface Props {
  properties: Property[]
  onClose(): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

const TYPE_LABEL: Record<PropertyType, string> = {
  text: '文本',
  number: '数字',
  select: '单选',
  multiselect: '多选',
  date: '日期',
  checkbox: '复选框',
  url: 'URL'
}

const TYPES = Object.keys(TYPE_LABEL) as PropertyType[]

function parseOptions(raw: string): string[] {
  return raw
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function PropertyManager({ properties, onClose, onChanged, notify }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [type, setType] = useState<PropertyType>('text')
  const [optionsText, setOptionsText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const needsOptions = type === 'select' || type === 'multiselect'

  const resetForm = (): void => {
    setName('')
    setType('text')
    setOptionsText('')
    setEditingId(null)
  }

  const startEdit = (property: Property): void => {
    setEditingId(property.id)
    setName(property.name)
    setType(property.type)
    setOptionsText((property.options ?? []).map((option) => option.name).join(', '))
  }

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      notify('请填写属性名称', 'error')
      return
    }
    if (needsOptions && parseOptions(optionsText).length === 0) {
      notify('单选/多选属性至少需要一个选项', 'error')
      return
    }
    const duplicated = properties.some(
      (property) => property.name === trimmed && property.id !== editingId
    )
    if (duplicated) {
      notify(`属性「${trimmed}」已存在`, 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: trimmed,
        type,
        options: needsOptions ? parseOptions(optionsText) : []
      }
      if (editingId) {
        await window.api.properties.update(editingId, payload)
        notify(`属性「${trimmed}」已更新`, 'success')
      } else {
        await window.api.properties.add(payload)
        notify(`属性「${trimmed}」已创建`, 'success')
      }
      await onChanged()
      resetForm()
    } catch (err) {
      notify(`保存属性失败：${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (property: Property): Promise<void> => {
    if (
      !window.confirm(
        `删除属性「${property.name}」？文献本身不会被删除，只会移除该属性在文献上的取值。`
      )
    ) {
      return
    }
    try {
      await window.api.properties.remove(property.id)
      if (editingId === property.id) resetForm()
      await onChanged()
      notify(`属性「${property.name}」已删除`, 'success')
    } catch (err) {
      notify(`删除属性失败：${(err as Error).message}`, 'error')
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal property-manager">
        <div className="modal-head">
          <div>
            <h3>属性管理</h3>
            <p className="muted">为文献定义自定义字段，可在文献库中筛选、排序与保存为视图。</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="property-manager-body">
          <div className="property-form">
            <div className="property-form-row">
              <label>
                <span className="muted small">名称</span>
                <input
                  className="property-input"
                  value={name}
                  placeholder="例如：研究方法"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submit()
                  }}
                />
              </label>
              <label>
                <span className="muted small">类型</span>
                <select
                  className="select"
                  value={type}
                  onChange={(event) => setType(event.target.value as PropertyType)}
                >
                  {TYPES.map((item) => (
                    <option key={item} value={item}>
                      {TYPE_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {needsOptions && (
              <label>
                <span className="muted small">选项（逗号或换行分隔）</span>
                <input
                  className="property-input"
                  value={optionsText}
                  placeholder="例如：访谈, 实验, 问卷"
                  onChange={(event) => setOptionsText(event.target.value)}
                />
              </label>
            )}
            <div className="property-form-actions">
              {editingId && (
                <button className="btn ghost" onClick={resetForm}>
                  取消编辑
                </button>
              )}
              <button className="btn primary" onClick={() => void submit()} disabled={saving}>
                {editingId ? <Pencil size={14} /> : <Plus size={14} />}
                {saving ? '保存中…' : editingId ? '保存修改' : '新建属性'}
              </button>
            </div>
          </div>

          <div className="property-list">
            {properties.length === 0 && <div className="collections-empty">还没有属性，先创建一个。</div>}
            {properties.map((property) => (
              <div key={property.id} className="property-item">
                <div className="property-item-main">
                  <div className="property-item-name">{property.name}</div>
                  <div className="muted small">
                    {TYPE_LABEL[property.type]}
                    {property.options?.length
                      ? ` · ${property.options.map((option) => option.name).join(' / ')}`
                      : ''}
                  </div>
                </div>
                <div className="property-item-actions">
                  <button className="btn ghost small" onClick={() => startEdit(property)}>
                    <Pencil size={13} /> 编辑
                  </button>
                  <button className="btn ghost small danger" onClick={() => void remove(property)}>
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <div className="muted small">共 {properties.length} 个属性</div>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
