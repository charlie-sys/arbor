import { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Laptop,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  UserRound
} from 'lucide-react'
import type {
  AccountDevice,
  AccountState,
  DeviceEnrollment
} from '@shared/account'
import type { SyncSnapshot, SyncSnapshotDetail, SyncStatus } from '@shared/sync'
import { t } from '@shared/i18n'
import ConfirmCodeDialog from './ConfirmCodeDialog'
import SnapshotDetailDialog from './SnapshotDetailDialog'
import './account.css'

interface Props {
  visible: boolean
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
  mode?: 'login' | 'settings'
  embedded?: boolean
}

function statusLabel(status: AccountState['status']): string {
  if (status === 'active') return t('在线')
  if (status === 'offline') return t('离线')
  if (status === 'signingIn') return t('登录中')
  if (status === 'pendingApproval') return t('等待主设备确认')
  if (status === 'revoked') return t('已下线')
  return t('未登录')
}

function deviceTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export default function AccountView({
  visible,
  notify,
  mode = 'settings',
  embedded = false
}: Props): React.JSX.Element {
  const [state, setState] = useState<AccountState | null>(null)
  const [devices, setDevices] = useState<AccountDevice[]>([])
  const [deviceRequests, setDeviceRequests] = useState<DeviceEnrollment[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    status: 'signedOut',
    pending: 0,
    conflicts: 0,
    initialMerge: null,
    initialSyncReady: false,
    lastSyncedAt: null,
    lastError: ''
  })
  const [snapshots, setSnapshots] = useState<SyncSnapshot[]>([])
  const [retentionDays, setRetentionDays] = useState(7)
  const [snapshotDetail, setSnapshotDetail] = useState<{
    snapshot: SyncSnapshot
    detail: SyncSnapshotDetail | null
  } | null>(null)
  const [snapshotDetailLoading, setSnapshotDetailLoading] = useState(false)
  const [confirmation, setConfirmation] = useState<
    | { kind: 'restore'; snapshot: SyncSnapshot }
    | { kind: 'primary'; device: AccountDevice }
    | null
  >(null)
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:4318')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [error, setError] = useState('')

  const refreshDevices = async (): Promise<void> => {
    if (!state || !['active', 'offline'].includes(state.status)) {
      setDevices([])
      return
    }
    setLoadingDevices(true)
    try {
      setDevices(await window.api.account.devices())
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingDevices(false)
    }
  }

  const refreshSync = async (): Promise<void> => {
    try {
      setSyncStatus(await window.api.sync.status())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const refreshSnapshots = async (): Promise<void> => {
    if (!state?.isPrimary || !['active', 'offline'].includes(state.status)) {
      setSnapshots([])
      return
    }
    try {
      const result = await window.api.sync.snapshots()
      setSnapshots(result.snapshots)
      setRetentionDays(result.retentionDays)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const refreshDeviceRequests = async (): Promise<void> => {
    if (!state?.isPrimary || !['active', 'offline'].includes(state.status)) {
      setDeviceRequests([])
      return
    }
    try {
      setDeviceRequests(await window.api.account.deviceRequests())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void window.api.account.state().then((next) => {
      setState(next)
      setServerUrl(next.serverUrl)
      setEmail((current) => current || next.user?.email || '')
    })
    const offChanged = window.api.events.onAccountChanged((next) => {
      setState(next)
      setServerUrl(next.serverUrl)
      setEmail((current) => current || next.user?.email || '')
    })
    const offReplaced = window.api.events.onSessionReplaced((next) => {
      setState(next)
      setDevices([])
    })
    const offSync = window.api.events.onSyncStatus((next) => {
      setSyncStatus(next)
    })
    return () => {
      offChanged()
      offReplaced()
      offSync()
    }
  }, [])

  useEffect(() => {
    if (!visible || !state || !['active', 'offline'].includes(state.status)) return
    void refreshDevices()
    void refreshDeviceRequests()
    void refreshSync()
    void refreshSnapshots()
    return undefined
    // Refresh only when entering the account page or account status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, state?.status, state?.session?.epoch, state?.isPrimary])

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.account.signInDev({
        serverUrl: serverUrl.trim(),
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        intent: 'cloud-first'
      })
      setState(next)
      if (next.status === 'pendingApproval') {
        notify(t('登录请求已发送，等待主设备确认'), 'info')
      } else {
        notify(t('已登录为 {0}', [next.user?.displayName || next.user?.email || '']), 'success')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const signInOidc = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.account.signInOidc(serverUrl.trim(), 'cloud-first')
      setState(next)
      notify(
        t(next.status === 'pendingApproval' ? '登录请求已发送，等待主设备确认' : 'OIDC 登录成功'),
        next.status === 'pendingApproval' ? 'info' : 'success'
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setState(await window.api.account.logout())
      setDevices([])
      notify(t('已退出登录'), 'success')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revokeDevice = async (device: AccountDevice): Promise<void> => {
    if (!window.confirm(t('撤销设备「{0}」的访问权限？', [device.name]))) return
    setBusy(true)
    try {
      setDevices(await window.api.account.revokeDevice(device.id))
      notify(t('设备已撤销'), 'success')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const transferPrimary = async (device: AccountDevice): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setDevices(await window.api.account.transferPrimary(device.id))
      notify(t('主设备身份已转移'), 'success')
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally {
      setBusy(false)
    }
  }

  const resolveDeviceRequest = async (
    request: DeviceEnrollment,
    approve: boolean
  ): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setDeviceRequests(
        approve
          ? await window.api.account.approveDeviceRequest(request.id)
          : await window.api.account.rejectDeviceRequest(request.id)
      )
      notify(
        t(approve ? '已批准设备「{0}」' : '已拒绝设备「{0}」', [
          request.deviceName
        ]),
        'success'
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const showSnapshotDetail = async (snapshot: SyncSnapshot): Promise<void> => {
    setSnapshotDetail({ snapshot, detail: null })
    setSnapshotDetailLoading(true)
    try {
      const detail = await window.api.sync.snapshotChanges(snapshot.id)
      setSnapshotDetail({ snapshot, detail })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSnapshotDetailLoading(false)
    }
  }

  const restoreSnapshot = async (snapshot: SyncSnapshot): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.api.sync.restoreSnapshot(snapshot.id)
      await refreshSnapshots()
      await refreshSync()
      notify(t('云端快照已恢复'), 'success')
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return <div className="account-view"><div className="account-loading">{t('正在读取账户状态…')}</div></div>
  }

  const signedIn =
    Boolean(state.user) &&
    state.status !== 'signedOut' &&
    state.status !== 'pendingApproval'

  return (
    <div
      className={`account-view${embedded ? ' embedded' : ''}${
        mode === 'settings' ? ' account-settings' : ''
      }`}
    >
      <header className="view-head account-head">
        <div>
          <p className="account-eyebrow">
            {t(mode === 'login' ? '账户登录' : '账户与设备')}
          </p>
          <h1>
            {mode === 'login'
              ? t('登录 Arbor 账号')
              : signedIn
                ? state.user?.displayName || state.user?.email
                : t('登录 Arbor 账号')}
          </h1>
          <p className="muted">
            {t('所有设备默认使用云端数据；每次登录会先完成云端同步。')}
          </p>
        </div>
        <span className={`account-status ${state.status}`}>
          {state.status === 'active' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {statusLabel(state.status)}
        </span>
      </header>

      {error || state.lastError ? (
        <div className="account-warning">
          <AlertTriangle size={17} />
          <span>{error || state.lastError}</span>
        </div>
      ) : null}

      {state.status === 'pendingApproval' ? (
        <section className="account-card account-login-card">
          <div className="account-card-title">
            <ShieldCheck size={22} />
            <div>
              <h2>{t('等待主设备确认')}</h2>
              <p>
                {t('登录请求已发送到「{0}」。批准前不会上传本机数据。', [
                  state.pendingApproval?.primaryDeviceName ?? t('主设备')
                ])}
              </p>
            </div>
          </div>
          <p className="hint">
            {t('请在主设备的「账户与设备」页面批准或拒绝这次本地数据上传请求。主设备批准后，本设备会自动继续登录。')}
          </p>
        </section>
      ) : !signedIn || state.status === 'revoked' ? (
        <section className="account-card account-login-card">
          <div className="account-card-title">
            <UserRound size={20} />
            <div>
              <h2>{t('登录账户')}</h2>
              <p>{t('未配置 OIDC 时使用受环境开关保护的开发登录；公网部署请关闭开发登录并使用 OIDC。')}</p>
            </div>
          </div>
          <label>
            <span>{t('同步服务器')}</span>
            <input
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="http://127.0.0.1:4318"
            />
          </label>
          <label>
            <span>{t('邮箱')}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            <span>{t('显示名称')}</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t('可选')}
            />
          </label>
          <p className="hint">
            {t('所有设备默认使用云端数据。登录后会先完成云端同步，完成前不能操作。')}
          </p>
          <button className="btn primary account-primary" disabled={busy} onClick={() => void signIn()}>
            <ShieldCheck size={17} />
            {busy ? t('登录中…') : t('登录并激活此设备')}
          </button>
          <button className="btn ghost account-primary" disabled={busy} onClick={() => void signInOidc()}>
            <ShieldCheck size={17} />
            {t('使用 OIDC 登录')}
          </button>
        </section>
      ) : mode === 'login' ? (
        <section className="account-card account-login-card">
          <div className="account-card-title">
            <CheckCircle2 size={20} />
            <div>
              <h2>{t('已登录')}</h2>
              <p>{t('设备、同步状态和云端快照管理已移至「设置 → 账户与同步」。')}</p>
            </div>
          </div>
          <button
            className="btn ghost danger-text account-primary"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut size={15} />
            {t('退出登录')}
          </button>
        </section>
      ) : (
        <>
          {!syncStatus.initialSyncReady ? (
            <div className="account-warning">
              <RefreshCw size={17} className={syncStatus.status === 'syncing' ? 'spin' : ''} />
              <span>
                {syncStatus.status === 'syncing'
                  ? t('正在从云端同步数据，完成前不能继续操作。')
                  : t('必须先完成云端数据同步，才能继续操作。')}
              </span>
            </div>
          ) : null}
          <section className="account-summary-grid">
            <div className="account-card account-summary-card">
              <UserRound size={20} />
              <span>{t('当前账号')}</span>
              <strong>{state.user?.displayName}</strong>
              <small>
                {state.user?.email}
                {state.isPrimary ? ` · ${t('主设备')}` : ''}
              </small>
            </div>
            <div className="account-card account-summary-card">
              <Laptop size={20} />
              <span>{t('当前设备')}</span>
              <strong>{state.device?.name}</strong>
              <small>{t('会话版本 {0}', [state.session?.epoch ?? '—'])}</small>
            </div>
            <div className="account-card account-summary-card">
              <Monitor size={20} />
              <span>{t('实时连接')}</span>
              <strong>{state.status === 'active' ? t('已连接') : t('等待重连')}</strong>
              <small>{state.serverUrl}</small>
            </div>
          </section>

          <section className="account-card account-sync-card">
            <div className="account-card-title">
              <div>
                <h2>{t('同步状态')}</h2>
                <p>
                  {syncStatus.status === 'syncing'
                    ? t('正在同步更改…')
                    : syncStatus.status === 'error'
                      ? syncStatus.lastError || t('同步暂不可用')
                      : t('所有已确认更改已同步')}
                </p>
              </div>
              <span className={`account-status ${syncStatus.status === 'error' ? 'revoked' : syncStatus.status === 'idle' ? 'active' : ''}`}>
                <ArrowUpCircle size={15} />
                {syncStatus.pending > 0
                  ? t('待同步 {0}', [syncStatus.pending])
                  : t('已同步')}
              </span>
            </div>
            <div className="account-sync-meta">
              <span>{t('上次同步')} {deviceTime(syncStatus.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toISOString() : null)}</span>
              <button className="btn ghost" disabled={busy || state.status !== 'active'} onClick={() => void window.api.sync.now().then(refreshSync).catch((err: Error) => setError(err.message))}>
                <RefreshCw size={14} />{t('立即同步')}
              </button>
            </div>
          </section>

          {state.isPrimary ? (
            <section className="account-card">
              <div className="account-card-title">
                <div>
                  <h2>{t('云端历史快照')}</h2>
                  <p>
                    {t('保留最近 {0} 天的全部云端快照；每次数据写入前自动保存。', [
                      retentionDays
                    ])}
                  </p>
                </div>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void refreshSnapshots()}
                >
                  <RefreshCw size={15} />
                  {t('刷新快照')}
                </button>
              </div>
              <div className="account-device-list account-snapshot-list">
                {snapshots.length === 0 ? (
                  <div className="account-empty">{t('暂无云端快照')}</div>
                ) : (
                  snapshots.map((snapshot) => (
                    <div
                      className="account-device-row account-snapshot-row"
                      key={snapshot.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void showSnapshotDetail(snapshot)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void showSnapshotDetail(snapshot)
                        }
                      }}
                    >
                      <span className="account-device-icon">
                        <RefreshCw size={18} />
                      </span>
                      <div className="account-device-main">
                        <strong>{deviceTime(snapshot.createdAt)}</strong>
                        <small>
                          {snapshot.deviceName} · {snapshot.entityCount} {t('项数据')} ·{' '}
                          {snapshot.reason === 'pre_restore'
                            ? t('恢复前快照')
                            : t('修改前快照')}
                        </small>
                      </div>
                      <div className="account-device-actions">
                        <button
                          className="btn ghost"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation()
                            void showSnapshotDetail(snapshot)
                          }}
                        >
                          <Eye size={14} />
                          {t('查看变化')}
                        </button>
                        <button
                          className="btn ghost"
                          disabled={busy || state.status !== 'active'}
                          onClick={(event) => {
                            event.stopPropagation()
                            setConfirmation({ kind: 'restore', snapshot })
                          }}
                        >
                          {t('恢复此快照')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {state.isPrimary && deviceRequests.length > 0 ? (
            <section className="account-card">
              <div className="account-card-title">
                <div>
                  <h2>{t('待确认的设备')}</h2>
                  <p>{t('这些设备请求把本机数据显示到云端，请核对后批准。')}</p>
                </div>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void refreshDeviceRequests()}
                >
                  <RefreshCw size={15} />
                  {t('刷新请求')}
                </button>
              </div>
              <div className="account-device-list">
                {deviceRequests.map((request) => (
                  <div className="account-device-row" key={request.id}>
                    <span className="account-device-icon">
                      <ShieldCheck size={18} />
                    </span>
                    <div className="account-device-main">
                      <strong>{request.deviceName}</strong>
                      <small>
                        {request.platform || t('未知平台')} ·{' '}
                        {request.intent === 'merge-local'
                          ? t('请求上传本机数据')
                          : t('使用云端数据')}
                      </small>
                    </div>
                    <div className="account-device-actions">
                      <button
                        className="btn ghost danger-text"
                        disabled={busy}
                        onClick={() => void resolveDeviceRequest(request, false)}
                      >
                        {t('拒绝')}
                      </button>
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() => void resolveDeviceRequest(request, true)}
                      >
                        {t('批准')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="account-card">
            <div className="account-card-title">
              <div>
                <h2>{t('已授权设备')}</h2>
                <p>{t('撤销设备会立即使其登录凭据失效。')}</p>
              </div>
              <button className="btn ghost" disabled={loadingDevices} onClick={() => void refreshDevices()}>
                <RefreshCw size={15} className={loadingDevices ? 'spin' : ''} />
                {t('刷新')}
              </button>
            </div>
            <div className="account-device-list">
              {devices.length === 0 ? (
                <div className="account-empty">{loadingDevices ? t('正在加载设备…') : t('暂无设备信息')}</div>
              ) : (
                devices.map((device) => (
                  <div className="account-device-row" key={device.id}>
                    <span className={`account-device-icon${device.active ? ' active' : ''}`}>
                      <Laptop size={18} />
                    </span>
                    <div className="account-device-main">
                      <strong>
                        {device.name}
                        {device.current ? <em>{t('当前设备')}</em> : null}
                        {device.primary ? <em>{t('主设备')}</em> : null}
                      </strong>
                      <small>
                        {device.platform || t('未知平台')} · {t('最近活动')} {deviceTime(device.lastSeenAt)}
                      </small>
                    </div>
                    <span className={`account-device-state${device.active ? ' active' : ''}`}>
                      {device.active ? t('活动') : t('已撤销')}
                    </span>
                    <div className="account-device-actions">
                      {state.isPrimary && !device.current && !device.revokedAt ? (
                        <button className="btn ghost" disabled={busy} onClick={() => setConfirmation({ kind: 'primary', device })}>
                          {t('设为主设备')}
                        </button>
                      ) : null}
                      {state.isPrimary && !device.current && !device.revokedAt ? (
                        <button className="btn ghost danger-text" disabled={busy} onClick={() => void revokeDevice(device)}>
                          {t('撤销设备')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="account-actions">
            <button className="btn ghost" disabled={busy} onClick={() => void refreshDevices()}>
              <RefreshCw size={15} />{t('同步设备状态')}
            </button>
            <button className="btn ghost danger-text" disabled={busy} onClick={() => void logout()}>
              <LogOut size={15} />{t('退出登录')}
            </button>
          </div>
        </>
      )}
      {snapshotDetail ? (
        <SnapshotDetailDialog
          snapshot={snapshotDetail.snapshot}
          detail={snapshotDetail.detail}
          loading={snapshotDetailLoading}
          onClose={() => setSnapshotDetail(null)}
        />
      ) : null}
      {confirmation?.kind === 'restore' ? (
        <ConfirmCodeDialog
          title={t('恢复云端快照')}
          description={
            <p>
              {t('恢复 {0} 的云端快照？当前云端数据会先保存为新的快照。', [
                new Date(confirmation.snapshot.createdAt).toLocaleString()
              ])}
            </p>
          }
          confirmLabel={t('确认恢复')}
          busyLabel={t('恢复中…')}
          onClose={() => setConfirmation(null)}
          onConfirm={() => restoreSnapshot(confirmation.snapshot)}
        />
      ) : null}
      {confirmation?.kind === 'primary' ? (
        <ConfirmCodeDialog
          title={t('转移主设备身份')}
          description={
            <p>
              {t('将主设备身份转移给「{0}」？转移后本设备将失去审批和快照管理权限。', [
                confirmation.device.name
              ])}
            </p>
          }
          confirmLabel={t('确认转移')}
          busyLabel={t('转移中…')}
          onClose={() => setConfirmation(null)}
          onConfirm={() => transferPrimary(confirmation.device)}
        />
      ) : null}
    </div>
  )
}
