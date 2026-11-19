# Arbor 多设备登录与实时同步实现指南

> 状态：首版已实现，核心链路已验收
> 适用版本：Arbor 0.1.17 及后续版本
> 最后更新：2026-11-18

## 实现状态

- [x] 本地 SQLite 实体数据库。
- [x] 现有 `library.json` 首次迁移与迁移前备份。
- [x] 本地实体版本、Outbox 和同步元数据。
- [x] 对话与消息拆分。
- [x] 敏感设置与可共享设置分离。
- [x] 启动时优先使用 SQLite，JSON 保留为兼容快照。
- [x] 备份前执行 SQLite WAL checkpoint。
- [x] 账号、设备和单活动 Session 基础服务。
- [x] 新设备登录撤销旧设备及 WebSocket 强退。
- [x] Electron 账户界面、设备列表和加密 Refresh Token。
- [x] 首次实体快照上传与新设备恢复。
- [x] Outbox 增量提交、服务端版本检查和变更日志。
- [x] 活动设备实时变更通知与增量拉取。
- [x] Blob 内容哈希、上传、下载与完整性校验。
- [x] 冲突持久化与“保留本地 / 采用云端”解决界面。
- [x] 基于基线、本地和云端内容的三路字段自动合并。
- [x] 分块快照上传、分页下载和 HTTP 压缩。
- [x] 用户级 Blob 存储配额。
- [x] 本地与 S3/R2/MinIO Blob 存储适配器。
- [x] 未引用 Blob 的定时清理与管理员手动清理。
- [x] 通用 OIDC Authorization Code + PKCE 登录。
- [x] Redis Pub/Sub 跨实例 Session 与同步事件广播。
- [x] 取消客户端冲突处理界面，改为云端最后写入生效。
- [x] Redis 双实例强退与跨实例同步通知验收。
- [x] 每次云端写入前保存快照，默认保留近 7 天，并支持主设备恢复。
- [x] S3 兼容存储上传、下载、哈希校验与去重验收。
- [x] 云端与本机同时存在数据时的持久化合并预览、确认和冲突分流。
- [x] 大批量 Outbox 按字节分批提交，并覆盖文件绑定、恢复与缺失文件回归测试。
- [x] 主设备可靠身份、本机上传审批、登录后强制云端同步门禁与显式主设备转移。

## 1. 目标与边界

本项目采用以下产品语义：

- 同一账号任何时刻只有一个活动设备。
- 只有活动设备可以编辑数据。
- 新设备登录会接管账号，旧设备被撤销并退出编辑界面。
- 活动设备与云端实时双向同步。
- 新设备接管时获取云端最新数据。
- 本地优先：断网时仍可继续编辑，网络恢复后补传。

严格单设备登录时，已经退出的设备不会再接收实时数据。如果未来需要多台设备同时观察变化，应增加“一个可编辑设备 + 多个只读设备”模式，而不是放宽为多个可编辑会话。

## 2. 核心不变量

以下规则不可由客户端单独决定，必须由数据库和服务端共同保证：

1. 一个用户最多有一个 `active` Session。
2. 旧 Session 撤销后，所有旧 Token 和 WebSocket 连接立即失效。
3. 本地实体修改和 Outbox 写入必须在同一个本地事务中完成。
4. 服务端每次只应用版本匹配的变更。
5. 每一条同步操作必须带全局唯一 `opId`，重复提交不得重复生效。
6. 客户端只有收到服务端确认后才能删除 Outbox。
7. 实时通知只负责触发拉取，最终一致性通过增量日志补齐。
8. 大文件不进入 JSON、数据库消息或 WebSocket。

## 3. 总体架构

```text
Electron
├─ Renderer
│   ├─ 登录页
│   ├─ 同步状态
│   ├─ 设备管理
│   ├─ 接管确认
│   └─ 冲突处理
├─ Main Process
│   ├─ AccountService
│   ├─ SessionService
│   ├─ SyncEngine
│   ├─ WebSocketClient
│   ├─ SQLite Repository
│   ├─ Outbox
│   └─ BlobManager
└─ Local Data
    ├─ arbor.db
    ├─ blobs/
    ├─ files/
    └─ backups/

Cloud
├─ Fastify API
├─ PostgreSQL
├─ Redis
├─ WebSocket Gateway
├─ S3 / R2 / MinIO
└─ OAuth / Email Login
```

推荐技术栈：

| 模块 | 推荐方案 |
|---|---|
| 后端 | TypeScript + Fastify |
| 数据库 | PostgreSQL |
| 实时广播 | WebSocket + Redis Pub/Sub |
| 对象存储 | S3、Cloudflare R2 或 MinIO |
| 客户端数据库 | `better-sqlite3` |
| 登录 | OAuth/OIDC 或邮箱魔法链接 |
| Token | 短期 Access Token + 轮换 Refresh Token |
| 本地凭据 | Electron `safeStorage` |

## 4. 当前本地数据层的问题

当前 [store.ts](../../src/main/store.ts) 主要依赖单个 `library.json`，文件、文本、翻译和附件保存在独立目录。

直接同步整个数据目录存在以下风险：

- 两台设备覆盖同一个 JSON 文件。
- 一个标签变化导致整库重新上传。
- 大文件、文本缓存和元数据耦合。
- 元数据已写入、Outbox 或文件尚未写入时崩溃。
- 无法准确定位冲突实体。
- 删除和离线编辑难以可靠重放。

因此必须先引入事务化本地存储和增量同步模型。

## 5. 本地 SQLite 数据层

### 5.1 数据库位置

单账号设备：

```text
%APPDATA%/Arbor/data/arbor.db
```

多账号隔离设备：

```text
%APPDATA%/Arbor/data/accounts/<user-hash>/arbor.db
%APPDATA%/Arbor/data/accounts/<user-hash>/blobs/
```

不同账号不得共用可访问的本地实体数据库。退出账号后，主界面不能继续显示上一个账号的本地内容。

### 5.2 核心表

```sql
CREATE TABLE entities (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(entity_type, entity_id)
);

CREATE TABLE outbox (
  op_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE applied_ops (
  op_id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

建议启用：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

### 5.3 写入事务

所有业务写入必须通过 Repository，禁止 Renderer 直接写文件。

```text
BEGIN IMMEDIATE
  UPDATE entities
  INSERT INTO outbox
COMMIT
→ 通知 Renderer
→ SyncEngine 后台上传
```

数据修改和 Outbox 必须在同一个事务中，否则崩溃后可能出现“本地已修改但永远不会同步”的数据。

### 5.4 实体拆分

| 实体类型 | 说明 |
|---|---|
| `document` | 文献元数据 |
| `collection` | 文件夹 |
| `tag` | 标签 |
| `property` | 自定义属性 |
| `saved_view` | 保存视图 |
| `chat` | 对话元数据 |
| `chat_message` | 单条文献消息 |
| `highlight` | 高亮 |
| `excerpt` | 摘录 |
| `annotation_page` | 单页手写标注 |
| `task` | 任务 |
| `topic` | 研究主题 |
| `canvas` | 主题画布 |
| `translation` | 翻译记录 |
| `inbox` | 灵感条目 |
| `ali_session` | 阿栗会话 |
| `ali_message` | 阿栗消息 |
| `settings` | 可共享设置 |

对话和消息、文献和标注应拆开存储，避免新增一条消息就重传完整对话。

## 6. 大文件与 Blob

PDF、Word、MHTML、图片和附件不得进入实体 JSON 或 WebSocket。

### 6.1 上传流程

1. 客户端计算 SHA-256。
2. 请求服务端创建 Blob 上传任务。
3. 服务端返回预签名上传地址。
4. 客户端直传对象存储。
5. 服务端校验文件大小、MIME 和 SHA-256。
6. 写入 `blobs` 表。
7. 实体只保存 `blobId`。

### 6.2 服务端表

```sql
CREATE TABLE blobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  sha256 TEXT NOT NULL,
  size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, sha256)
);
```

文档提取文本、网页归档和翻译图片也应作为 Blob，而不是放进同步消息。

需要实现：

- 哈希去重。
- 引用计数或定期垃圾回收。
- 文件缺失时按哈希重新下载。
- 单文件大小和用户总配额限制。

## 7. 登录与 Token

### 7.1 推荐登录流程

1. Electron 主进程生成 PKCE 和 `state`。
2. 启动 `127.0.0.1` 临时回调服务器。
3. 用系统浏览器打开 OAuth/OIDC 登录页。
4. 登录完成后回调本地端口。
5. 主进程校验 `state`，用授权码换取 Token。
6. Refresh Token 通过 Electron `safeStorage` 加密保存。

不要：

- 在应用内嵌网页里处理第三方密码。
- 将 Token 暴露给 Renderer。
- 将长期 Token 写入 `library.json` 或 `localStorage`。

### 7.2 Token 内容

Access Token 至少包含：

```json
{
  "sub": "user-id",
  "deviceId": "device-id",
  "sessionId": "session-id",
  "sessionEpoch": 12
}
```

建议：

- Access Token 有效期 10–15 分钟。
- Refresh Token 30 天，轮换使用。
- Refresh Token 在服务端只保存哈希。
- 每次刷新都校验设备状态和 Session 状态。

## 8. 单活动设备会话

### 8.1 服务端表

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email CITEXT UNIQUE,
  display_name TEXT,
  session_epoch BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  epoch BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);
```

`status` 取值：

- `pending`
- `active`
- `draining`
- `revoked`

### 8.2 数据库级互斥

```sql
CREATE UNIQUE INDEX one_active_session_per_user
ON sessions(user_id)
WHERE status = 'active';
```

该索引保证即使两个登录请求并发到达，也不可能出现两个活动 Session。

### 8.3 会话验证

每个同步请求和 WebSocket 握手都验证：

1. Token 签名和过期时间。
2. 用户存在且未被禁用。
3. 设备未被撤销。
4. Session 是 `active` 或 `draining`。
5. Token 的 `sessionEpoch` 等于用户当前 epoch。

失败返回：

```json
{
  "code": "SESSION_REPLACED",
  "message": "账号已在另一台设备登录"
}
```

旧设备收到后必须：

- 停止所有新写入。
- 关闭 WebSocket。
- 清除内存 Token。
- 关闭敏感编辑界面。
- 跳转登录页或“查看未同步修改”页。

## 9. 新设备接管流程

### 9.1 标准接管

1. 新设备完成登录并注册设备。
2. 新设备请求激活账号。
3. 服务端找到旧活动 Session，将其标记为 `draining`。
4. 服务端通过 WebSocket 通知旧设备 `HANDOFF_REQUESTED`。
5. 旧设备锁定编辑界面。
6. 旧设备在最多 20 秒内提交 Outbox。
7. 旧设备调用 `handoff-ready`。
8. 服务端在数据库事务中：
   - 撤销旧 Session。
   - 用户 `session_epoch` 加一。
   - 创建新活动 Session。
9. 新设备获取快照或增量。
10. 新设备进入主界面。

### 9.2 旧设备离线

- 新设备默认等待 15 秒。
- 之后提供“立即切换”按钮。
- 明确提示旧设备可能存在未上传的离线修改。
- 强制切换后，旧设备的过期写入会被服务端拒绝。
- 旧设备再次上线时只能查看和导出本地未同步修改。

### 9.3 `draining` 权限

旧设备进入 `draining` 后：

- 允许提交已有 Outbox。
- 允许上传已有 Blob。
- 禁止创建新的用户编辑操作。
- 禁止继续接收其他设备的数据更新。

## 10. 服务端同步模型

### 10.1 实体表

```sql
CREATE TABLE entities (
  user_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  payload JSONB NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  updated_by_device UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);
```

### 10.2 变更日志

```sql
CREATE TABLE changes (
  server_seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  op_id UUID NOT NULL,
  device_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_version BIGINT NOT NULL,
  version BIGINT NOT NULL,
  operation TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, op_id)
);
```

`server_seq` 用于全局排序和断线补拉；`op_id` 用于幂等重试。

## 11. 增量提交

```http
POST /v1/sync/commit
```

请求：

```json
{
  "operations": [
    {
      "opId": "5f35e57e-6aaa-4ca2-89b3-3c4e2a5b2c11",
      "entityType": "document",
      "entityId": "doc-123",
      "baseVersion": 7,
      "operation": "patch",
      "payload": {
        "readingStatus": "read"
      }
    }
  ]
}
```

服务端处理步骤：

1. 验证 Session 和 epoch。
2. 在事务中锁定用户或使用用户级 advisory lock。
3. 逐条检查 `opId` 是否已处理。
4. 查询并锁定当前实体。
5. 比较 `baseVersion` 与实体版本。
6. 应用修改。
7. 实体版本加一。
8. 写入 `changes` 并分配 `server_seq`。
9. 提交事务。
10. 广播有变化的 `server_seq`。

返回：

```json
{
  "accepted": ["5f35e57e-6aaa-4ca2-89b3-3c4e2a5b2c11"],
  "conflicts": [],
  "latestSeq": 10482
}
```

客户端只有收到 `accepted` 后才删除对应 Outbox。

## 12. 增量拉取

```http
GET /v1/sync/changes?after=10420&limit=500
```

返回：

```json
{
  "changes": [],
  "nextSeq": 10482,
  "hasMore": false
}
```

客户端规则：

- 按 `server_seq` 升序应用。
- 在一个 SQLite 事务中应用整批。
- 应用完成后再更新 `lastAppliedSeq`。
- 中途失败时保留原游标，下次重试。
- 服务端快照已压缩时返回 `410 SNAPSHOT_REQUIRED`。

## 13. WebSocket 实时通知

```text
wss://sync.example.com/v1/socket
```

服务端只推送轻量通知：

```json
{
  "type": "change",
  "seq": 10483
}
```

客户端收到后：

1. 若序号连续，主动拉取变更。
2. 若发现缺口，通过增量接口补齐。
3. 应用变更。
4. 更新游标。
5. 通知所有 Arbor 窗口刷新。

断线重连采用指数退避和随机抖动：

```text
1s → 2s → 4s → 8s → 15s → 30s
```

WebSocket 负责降低延迟，HTTP 增量接口负责最终可靠性。

## 14. 首次同步与快照

新设备首次同步：

1. 请求快照游标。
2. 分页下载实体。
3. 下载缺失 Blob。
4. 写入 SQLite。
5. 保存 `snapshotSeq`。
6. 拉取 `snapshotSeq` 之后的变更。
7. 建立 WebSocket。

接口：

```http
GET /v1/sync/snapshot
GET /v1/sync/snapshot/entities?cursor=...
```

快照必须对应一个确定的 `serverSeq`。快照生成期间产生的新变化通过增量接口补齐。

当历史变更过多时：

- 服务端生成压缩快照。
- 快照保存到对象存储。
- 旧变更日志按安全窗口归档或清理。

## 15. 冲突规则

即使采用单活动设备，也可能遇到：

- 旧设备离线修改。
- 强制接管后的迟到写入。
- 同一设备多个窗口同时编辑。
- 网络重试。

建议规则：

| 数据 | 策略 |
|---|---|
| 单条消息 | 只追加，不覆盖 |
| PDF 和附件 | 内容哈希，不可变 |
| 标签、分类 | 版本检查 |
| 阅读状态 | 后提交者优先 |
| 摘录、任务 | 字段级 Patch |
| 长笔记 | 冲突提示，保留两个版本 |
| 删除 | 写 Tombstone |

服务端不能静默覆盖长笔记。冲突记录至少应保留：

- 本地版本
- 服务端版本
- 共同基线版本

## 16. 客户端模块

建议新增：

```text
src/main/account/accountService.ts
src/main/account/authClient.ts
src/main/account/tokenStore.ts
src/main/sync/syncEngine.ts
src/main/sync/syncClient.ts
src/main/sync/socketClient.ts
src/main/sync/outbox.ts
src/main/sync/conflictStore.ts
src/main/blob/blobManager.ts
src/main/db/database.ts
src/main/db/migrations.ts
src/main/repository/
src/shared/account.ts
src/shared/sync.ts
```

Renderer 建议新增：

```text
LoginView
AccountView
DeviceListView
SyncStatusIndicator
TakeoverDialog
ConflictDialog
```

建议 IPC：

```ts
account.login(): Promise<LoginResult>
account.logout(): Promise<void>
account.state(): Promise<AccountState>
account.devices(): Promise<DeviceInfo[]>
account.revokeDevice(id: string): Promise<void>

sync.now(): Promise<void>
sync.status(): Promise<SyncStatus>
sync.retryFailed(): Promise<void>

events.onSyncChanged(callback): () => void
events.onSessionReplaced(callback): () => void
```

Token 和网络请求只能存在于主进程。

## 17. 数据同步范围

同步：

- 文献元数据、分类、标签和属性。
- PDF、Word、MHTML、图片和附件。
- 文档提取文本缓存。
- 对话和消息。
- 高亮、摘录、贴纸和手写标注。
- 阅读计划、任务、研究主题和画布。
- 阿栗会话、长期记忆与记忆归档。
- 用量 dashboard 的调用记录与设备偏好设置。

默认不同步：

- 大模型接口地址、模型名、温度、上下文上限和系统提示词。
- API Key、搜索密钥和其他模型凭据。
- 窗口临时位置、本地缓存和崩溃报告。
- 本地缓存、日志和崩溃报告。
- 最近摸鱼卡片。
- 设备本地临时文件。

API Key 如果需要跨设备，必须使用独立 KMS 或专用加密方案，不能明文进入同步实体。

## 18. 备份与恢复

本地备份需要包含：

- SQLite 数据库。
- Blob 和文件目录。
- 迁移版本。
- 同步游标。
- 未完成 Outbox。

备份 SQLite 前执行：

```sql
PRAGMA wal_checkpoint(FULL);
```

恢复流程：

1. 停止同步循环。
2. 关闭数据库。
3. 恢复数据库和 Blob。
4. 重新打开数据库。
5. 执行迁移检查。
6. 重新校验 Session。
7. 从本地游标补齐云端变更。

服务端需要 PostgreSQL 自动备份、时间点恢复和对象存储生命周期策略。

## 19. 安全要求

- 全链路 TLS。
- 所有数据库查询强制带 `user_id`。
- PostgreSQL 行级安全或服务层强校验。
- Refresh Token 轮换并只保存哈希。
- Token 使用 `safeStorage`。
- WebSocket 与 HTTP 使用相同 Session 校验。
- Blob 使用短时预签名 URL。
- 限制文件大小、用户配额、同步频率和重试次数。
- 登录和刷新接口限流。
- 不把敏感凭据同步到云端。
- 定期执行备份恢复演练。

## 20. 测试与验收

### 20.1 会话

- 两个设备并发登录，只能有一个成为 active。
- 新设备接管后旧 Token 返回 `SESSION_REPLACED`。
- 旧 WebSocket 被立即关闭。
- 强制接管后旧设备迟到写入被拒绝。

### 20.2 本地一致性

- 本地实体修改与 Outbox 同事务提交。
- 应用在提交后崩溃，重启能继续同步。
- SQLite 损坏或迁移失败时可从备份恢复。

### 20.3 同步

- 重复提交同一 `opId` 不重复生效。
- WebSocket 丢消息后可通过 `server_seq` 补齐。
- 网络中断后继续从原游标拉取。
- 快照与增量边界不丢数据。
- 大规模历史变更能触发快照。

### 20.4 文件

- 同样文件只上传一次。
- 上传中断可续传或重试。
- 本地 Blob 缺失时可重新下载。
- 删除引用后对象被安全回收。

### 20.5 冲突

- 旧版本写入返回冲突。
- 冲突不会静默丢失笔记。
- 删除通过 Tombstone 传播到活动设备。

## 21. 实施阶段

### 阶段一：本地可同步数据层

- 引入 SQLite、Repository、Outbox。
- 迁移现有 `library.json`。
- 保持现有功能不变。
- 更新本地备份与恢复。

### 阶段二：账号和单设备会话

- OAuth/OIDC 登录。
- 设备注册。
- 唯一活动 Session。
- 新设备接管、旧设备退出。
- 设备管理页面。

### 阶段三：首次全量同步

- 实体快照。
- Blob 上传和下载。
- 新设备本地恢复。
- 手动“立即同步”。

### 阶段四：实时增量同步

- 变更日志。
- Outbox 批量提交。
- WebSocket 通知。
- 断线重连和补齐。

### 阶段五：冲突与生产保障

- 冲突界面。
- 快照压缩。
- Blob 垃圾回收。
- 监控、告警、限流。
- 备份恢复演练。

## 22. 首版上线建议

首个可发布版本建议限制为：

- 单活动设备。
- 最多 2–3 台已授权设备。
- 文本实体实时增量同步。
- 文件后台同步。
- 新设备登录时接管旧设备。
- 暂不支持多设备协同编辑。
- 暂不跨设备同步 API Key。

最关键的基础是 **事务化 SQLite + Outbox + 服务端单活动 Session**。在完成这三项之前，不应直接同步现有 JSON 目录。
