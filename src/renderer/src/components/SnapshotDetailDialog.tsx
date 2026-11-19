import { FileText, X } from 'lucide-react'
import type { SyncSnapshot, SyncSnapshotDetail } from '@shared/sync'
import { t } from '@shared/i18n'

interface Props {
  snapshot: SyncSnapshot
  detail: SyncSnapshotDetail | null
  loading: boolean
  onClose(): void
}

function changeLabel(change: 'added' | 'updated' | 'removed'): string {
  if (change === 'added') return t('新增变化')
  if (change === 'removed') return t('删除变化')
  return t('修改变化')
}

export default function SnapshotDetailDialog({
  snapshot,
  detail,
  loading,
  onClose
}: Props): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="modal account-snapshot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="snapshot-detail-title"
      >
        <div className="modal-head">
          <div>
            <h3 id="snapshot-detail-title">{t('快照变化详情')}</h3>
            <p className="muted small">
              {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.deviceName}
            </p>
          </div>
          <button className="icon-btn" aria-label={t('关闭')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="account-snapshot-dialog-body">
          {loading ? (
            <div className="account-empty">{t('正在分析快照变化…')}</div>
          ) : !detail ? (
            <div className="account-empty">{t('无法读取快照详情')}</div>
          ) : (
            <>
              <div className="account-snapshot-summary">
                <span>
                  <strong>{detail.files.length}</strong>
                  {t('个文件变化')}
                </span>
                <span>
                  <strong>{detail.totalChanges}</strong>
                  {t('项数据变化')}
                </span>
              </div>
              <section>
                <h4>{t('文件变化')}</h4>
                {detail.files.length ? (
                  <ul className="account-snapshot-files">
                    {detail.files.map((file) => (
                      <li key={`${file.entityId}:${file.change}`}>
                        <FileText size={14} />
                        <span>{file.entityId}</span>
                        <em className={file.change}>{changeLabel(file.change)}</em>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{t('没有文件变化')}</p>
                )}
              </section>
              <section>
                <h4>{t('其他数据变化')}</h4>
                {detail.changes.filter((item) => item.entityType !== 'blob_binding').length ? (
                  <div className="account-snapshot-entity-list">
                    {detail.changes
                      .filter((item) => item.entityType !== 'blob_binding')
                      .map((item) => (
                        <div key={`${item.entityType}:${item.entityId}:${item.change}`}>
                          <span>{item.entityType}</span>
                          <code>{item.entityId}</code>
                          <em className={item.change}>{changeLabel(item.change)}</em>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="muted small">{t('没有其他数据变化')}</p>
                )}
                {detail.hasMore ? (
                  <p className="muted small">{t('仅显示前 300 项变化。')}</p>
                ) : null}
              </section>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            {t('关闭')}
          </button>
        </div>
      </div>
    </div>
  )
}
