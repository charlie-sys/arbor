import { useEffect, useState } from 'react'
import { CalendarRange, Loader2, Trash2 } from 'lucide-react'
import type { DocumentMeta, ReadingPlan } from '@shared/types'
import { localeTag, t } from '@shared/i18n'

interface Props {
  documents: DocumentMeta[]
  onOpenDoc(docId: string): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

const STORAGE_KEY = 'zotagent-reading-plans'

function loadPlans(): ReadingPlan[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as ReadingPlan[]) : []
  } catch {
    return []
  }
}

export default function ReadingPlanView({ documents, onOpenDoc, notify }: Props): React.JSX.Element {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [plans, setPlans] = useState<ReadingPlan[]>(() => loadPlans())

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans))
  }, [plans])

  const generate = async (): Promise<void> => {
    const value = goal.trim()
    if (!value) {
      notify(t("请先填写学习目标"), 'info')
      return
    }
    setBusy(true)
    try {
      const plan = await window.api.readingPlan.generate(value)
      setPlans((prev) => [plan, ...prev])
      setGoal('')
      notify(t("已生成 {0} 篇文献的阅读计划", [plan.items.length]), 'success')
    } catch (err) {
      notify(t("生成阅读计划失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setBusy(false)
    }
  }

  const removePlan = (id: string): void => {
    if (!window.confirm(t("删除这份阅读计划？"))) return
    setPlans((prev) => prev.filter((plan) => plan.id !== id))
  }

  const byId = new Map(documents.map((doc) => [doc.id, doc]))

  return (
    <div className="view reading-plan-view">
      <header className="view-head">
        <div>
          <h1>{t("主题阅读计划")}</h1>
          <p className="muted">{t("输入学习目标，基于库内文献生成阅读顺序、关注点与问题清单")}</p>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 18 }}>
        <textarea
          className="input"
          value={goal}
          rows={3}
          placeholder={t("例如：系统掌握因果推断在观察性研究中的应用，重点关注双重差分与工具变量")}
          onChange={(event) => setGoal(event.target.value)}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button className="btn primary" onClick={() => void generate()} disabled={busy || !goal.trim()}>
          {busy ? <Loader2 size={16} className="spin" /> : <CalendarRange size={16} />}
          {busy ? t("生成中…") : t("生成阅读计划")}
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <CalendarRange size={28} />
          </div>
          <h2>{t("还没有阅读计划")}</h2>
          <p className="muted">{t("填写学习目标后生成计划，计划会保存在本机，重启后仍可查看。")}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {plans.map((plan) => (
            <section key={plan.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, background: 'var(--panel)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 16, margin: 0 }}>{plan.goal}</h2>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    {new Date(plan.createdAt).toLocaleString(localeTag())}
                    {plan.model ? ` · ${plan.model}` : ''} · {plan.items.length} {' '}{t("篇文献")}{' '}</p>
                </div>
                <button className="icon-btn" title={t("删除计划")} onClick={() => removePlan(plan.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
              <ol style={{ margin: '14px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[...plan.items]
                  .sort((a, b) => a.order - b.order)
                  .map((item, index) => {
                    const doc = byId.get(item.docId)
                    return (
                      <li key={`${plan.id}-${item.docId}`}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13.5 }}>{doc ? doc.title : t("文献已删除")}</strong>
                          <span className="muted small">
                            {index + 1}.
                            {doc ? t(" {0}{1}", [doc.authors || '未知作者', doc.year ? ` · ${doc.year}` : '']) : ''}
                          </span>
                          {doc && (
                            <button className="btn ghost" style={{ padding: '1px 8px', fontSize: 11 }} onClick={() => onOpenDoc(doc.id)}>
                              {' '}{t("开始阅读")}{' '}</button>
                          )}
                        </div>
                        {item.focus && <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>{item.focus}</p>}
                        {item.questions.length > 0 && (
                          <ul className="muted small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                            {item.questions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
