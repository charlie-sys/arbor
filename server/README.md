# Arbor Sync Server

Arbor 多设备账户与单活动 Session 服务端。当前阶段包含：

- 受环境开关保护的本机开发登录。
- PostgreSQL 用户、设备和 Session。
- 数据库级单活动 Session 约束。
- 新设备登录撤销旧设备。
- 本机数据上传需当前主设备批准；普通登录不会自动成为主设备。
- 主设备身份只能由当前主设备主动转移。
- Access Token 自动刷新所需的 Refresh Token 轮换。
- 短期 WebSocket ticket 和旧设备强制下线通知。
- 设备列表与设备撤销。
- 首次实体快照上传与新设备恢复。
- Outbox 批量提交、服务端版本检查与变更日志。
- 活动设备 `sync.changed` 通知和增量拉取。
- 内容寻址的文件上传、下载与 SHA-256 校验。
- 实体粒度最后写入生效，每次提交前保存完整云端快照。
- 分块快照上传、分页下载和 HTTP 压缩。
- 本地磁盘与 S3/R2/MinIO 可切换的 Blob 存储适配器。
- 孤立 Blob 定时清理和管理员手动清理接口。
- 通用 OIDC Authorization Code + PKCE 登录。
- Redis Pub/Sub 跨实例广播 Session 撤销和同步通知。
- 受限公网网页抓取接口，阻断本机、局域网和云元数据地址。
- Web 阿栗搜索代理：Exa/SearXNG 与 GitHub 搜索由已认证的同步服务转发，规避浏览器 CORS 限制。
- `web/dist` 同源静态托管与可配置 CORS。

完整的后续同步设计见 [多设备登录与实时同步实现指南](../docs/architecture/multi-device-sync.md)。

## 本地启动

```powershell
docker compose up -d postgres redis
$env:AUTH_DEV_MODE='true'
npm run dev
```

服务端默认监听 `http://127.0.0.1:4318`。

从仓库根目录也可以运行：

```powershell
npm run sync:db
npm run sync:server
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串；多实例部署必需 |
| `PORT` | 服务端端口，默认 `4318` |
| `HOST` | 监听地址，默认 `127.0.0.1` |
| `WEB_ORIGIN` | 独立 Web 的来源，例如 `https://arbor.example.com`；用于 CORS 和 OIDC 回调 |
| `WEB_DIST_DIR` | Web 构建目录，默认相对于服务端工作目录的 `../web/dist` |
| `JWT_SECRET` | Access Token 签名密钥，生产环境至少 32 字符 |
| `AUTH_DEV_MODE` | 是否启用 `/v1/auth/dev-login` |
| `OIDC_ISSUER` | OIDC Issuer |
| `OIDC_CLIENT_ID` | OIDC Client ID |
| `OIDC_CLIENT_SECRET` | OIDC Client Secret |
| `OIDC_REDIRECT_URI` | 服务端 OIDC Callback 地址 |
| `BLOB_DIR` | 本地 Blob 存储目录，默认 `server/data/blobs` |
| `BLOB_USER_QUOTA` | 单用户 Blob 总配额，默认 5 GiB |
| `BLOB_STORAGE` | `local` 或 `s3` |
| `S3_BUCKET` | S3/R2/MinIO Bucket |
| `S3_REGION` | S3 区域，R2 通常使用 `auto` |
| `S3_ENDPOINT` | 兼容 S3 服务的自定义 Endpoint |
| `S3_FORCE_PATH_STYLE` | 是否使用 Path Style，默认 `true` |
| `ADMIN_TOKEN` | Blob GC 管理员接口令牌 |
| `BLOB_GC_ENABLED` | 是否启用每日 GC，默认启用 |
| `BLOB_GC_GRACE_HOURS` | 未引用 Blob 的保护期，默认 24 小时 |

`AUTH_DEV_MODE=true` 仅用于本机开发和验收，不应在公网生产环境启用。

生产环境需要关闭开发登录，并接入 OIDC/OAuth。

## Redis 多实例验收

启动两个使用不同 `PORT`、但连接同一 PostgreSQL 与 Redis 的服务实例后运行：

```powershell
$env:ARBOR_A_URL='http://127.0.0.1:4318'
$env:ARBOR_B_URL='http://127.0.0.1:4319'
npm run test:redis
```

该脚本验证新设备在实例 B 登录后，实例 A 上的旧 WebSocket 收到
`session.revoked` 并以 `4001` 关闭；旧 Refresh Token 返回
`SESSION_REPLACED`；实例 B 的提交会通过 Redis 向实例 A 广播
`sync.changed`。

主设备身份和转移验收：

```powershell
npm run test:device-enrollment
```

脚本验证普通云端优先登录不会自动成为主设备、非主设备不能转移身份，
以及主设备可以把身份显式转移给其他已信任设备。

## 云端快照验收

```powershell
npm run test:snapshots
```

该脚本验证每次提交前保存快照、最后写入生效、非主设备不能访问快照、
主设备可以恢复历史快照，以及恢复前状态会再保存一份快照。

## S3 兼容存储验收

将 `BLOB_STORAGE` 设为 `s3`，配置好 S3、R2 或 MinIO 的 Bucket 与凭据，
然后执行：

```powershell
$env:ARBOR_SYNC_URL='http://127.0.0.1:4319'
npm run test:s3
```

该脚本验证上传、下载、Content-Type、SHA-256 完整性以及相同内容去重。

## 当前接口

```text
POST   /v1/auth/dev-login
POST   /v1/auth/oidc/start
GET    /v1/auth/oidc/callback
POST   /v1/auth/oidc/exchange
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/device-requests/:id/claim
GET    /v1/account
GET    /v1/devices
DELETE /v1/devices/:id
POST   /v1/devices/:id/primary
GET    /v1/device-requests
POST   /v1/device-requests/:id/approve
POST   /v1/device-requests/:id/reject
POST   /v1/session/socket-ticket
WS     /v1/session/socket?ticket=...
POST   /v1/session/heartbeat
POST   /v1/sync/bootstrap
POST   /v1/sync/bootstrap/begin
POST   /v1/sync/bootstrap/chunk
POST   /v1/sync/bootstrap/complete
GET    /v1/sync/snapshot
POST   /v1/sync/commit
GET    /v1/sync/changes?after=...
POST   /v1/blobs/prepare
PUT    /v1/blobs/upload/:id
GET    /v1/blobs/:sha256
POST   /v1/web/fetch
POST   /v1/ali/search-web
POST   /v1/ali/search-github
POST   /v1/admin/blobs/gc
GET    /healthz
```

## 单设备约束

数据库使用部分唯一索引：

```sql
CREATE UNIQUE INDEX one_active_session_per_user
ON sessions(user_id)
WHERE status = 'active';
```

登录事务会先撤销该用户现有 Session，再增加 `session_epoch` 并创建新 Session。旧 Access Token、Refresh Token 和 WebSocket 都会失效。

## 部署注意

- 配置 `REDIS_URL` 后，Session 撤销和同步通知可跨多个服务实例广播。
- 默认 Blob 写入本地磁盘；设置 `BLOB_STORAGE=s3` 后可切换 S3、R2 或 MinIO。
- 当前单个 Blob 最大 250 MB，用户总配额可通过 `BLOB_USER_QUOTA` 配置。
- S3/R2 适配器使用标准 AWS S3 API 和默认 AWS 凭据链。
- 生产环境必须使用 HTTPS/WSS、随机 `JWT_SECRET` 和托管 PostgreSQL。
- API Key 等模型凭据不得进入用户同步数据。
