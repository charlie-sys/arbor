# Arbor 独立 Web 应用实现指南

## 目标

Web 版是浏览器中独立运行的 Arbor，不依赖正在运行的桌面主机。它直接复用桌面端的 React 页面、共享类型和交互，同时提供适合浏览器的持久化、同步和文件处理实现。

## 目录与入口

- `web/src/main.tsx`：Web 入口；普通页面加载主应用，`panelDoc` 参数加载独立阅读面板。
- `web/src/browserApi.ts`：实现桌面版 `window.api` 的浏览器等价层。
- `web/src/librarySync.ts`：在 `LibraryData` 与服务端实体之间转换。
- `web/src/browserStorage.ts`：IndexedDB 文件与备份存储。
- `web/src/zip.ts`：浏览器端 ZIP 导出。
- `server/src/index.ts`：账户、同步、Blob、网页抓取及 Web 静态托管。

## 启动

```powershell
npm install
npm --prefix server install
npm run web:typecheck
npm run web:build
npm --prefix server run build
```

开发模式使用两个进程：

```powershell
npm run sync:server
npm run web:dev
```

打开 `http://127.0.0.1:5174`。Vite 会将 `/v1` 代理到 `http://127.0.0.1:4318`。

生产模式可由同步服务直接托管构建产物：

```powershell
npm run web:build
npm --prefix server run build
npm --prefix server start
```

默认读取 `web/dist`，可通过 `WEB_DIST_DIR` 指定其他目录。部署时必须使用 HTTPS/WSS；只有 `localhost` 可以使用 HTTP。

## 账户与单设备

1. 首台登录设备由服务端自动设为主设备。
2. 普通登录不会转移主设备身份。
3. 新设备激活后，旧 Access Token、Refresh Token、HTTP Session 与 WebSocket 立即失效。
4. 主设备可批准另一台设备上传本地数据、撤销设备或显式转移主设备身份。
5. 主设备转移与快照恢复继续使用六位随机数字确认。
6. Web 端 OIDC 使用 Authorization Code + PKCE；服务端仅接受回环地址或 `WEB_ORIGIN` 对应的同源回调。
7. Web 按“服务器地址 + 账号邮箱”保存设备 ID；同一浏览器切换账号不会复用其他账号的设备身份。若服务端仍返回 `DEVICE_CONFLICT`，客户端会自动生成新设备 ID 并重试一次。

开发登录只在服务端显式设置 `AUTH_DEV_MODE=true` 时可用，生产环境必须关闭并配置 OIDC。

## 数据同步

Web 与桌面共用实体粒度的服务端数据格式，而不是把整个文献库塞进单个对象：

- `document`、`collection`、`highlight`、`excerpt`、`inbox`、`task`
- `translation`、`research_topic`、`canvas`、`tag`、`property`、`saved_view`
- `chat`、`chat_message`、`settings`、`reading_plan`、`usage_record`
- `blob_binding`
- `ali_session`、`ali_memory` 保存阿栗会话与长期记忆

同步流程：

1. 登录后先下载完整云端快照并覆盖本地显示数据。
2. 本地修改以实体差异提交，每批最多 400 个操作且约 512 KB。
3. 文件按 SHA-256 内容寻址上传到 `/v1/blobs/*`。
4. 其他浏览器按 `blob_binding` 中的哈希按需下载文件，并写入 IndexedDB。
5. 文档文件同时兼容桌面历史路径 `files/<文档ID>.<扩展名>` 与 Web 路径 `files/<文档ID>/<文件名>`，避免跨端恢复后出现“文献文件尚未载入”。
6. WebSocket 的 `sync.changed` 触发重新拉取；断线后自动指数退避重连。
7. 服务端继续使用最后写入生效，并在每次提交前保存完整快照。

桌面端每 5 秒调用一次 `/v1/session/heartbeat`。即使 WebSocket 或跨实例 Redis 通知暂时异常，旧设备也会在下一次心跳收到 `SESSION_REPLACED`，并立即锁住界面、阿栗形象与阿栗会话。

主模型与阿栗模型的接口地址、模型名、温度、上下文上限、系统提示词和全部 API Key 保持在当前设备。界面字号、宠物设置、阅读计划、用量记录与其余业务设置会同步。

阿栗的跨端能力由 `src/shared/aliAgent.ts` 统一协议：两端使用相同的使用说明解析与检索、记忆主题检索、工具定义和多轮工具调用流程。桌面端从应用目录读取 `docs/使用说明.md`；Web 构建时直接打包同一份说明文档，因此 Web 不依赖桌面主机，也不会因为说明书缺失而退化为通用聊天。Web 的 Exa/SearXNG 与 GitHub 搜索经 `/v1/ali/search-web`、`/v1/ali/search-github` 代理，网页正文使用 `/v1/web/fetch`，从而避免浏览器 CORS 差异。

## 本地存储

- 文献元数据和结构化数据：`localStorage` 工作副本。
- PDF、Word、文本索引、标注 JSON、附件、翻译图片：IndexedDB。
- 同一 SHA-256 内容只保存一份。
- 浏览器备份保存在 IndexedDB；云端历史快照仍由主设备管理。

清理站点数据会删除当前浏览器的本地缓存，但云端数据不受影响；重新登录后会从云端恢复。

## 浏览器等价能力

| 桌面能力 | Web 实现 |
|---|---|
| PDF 阅读、高亮、标注 | PDF.js、IndexedDB Blob、同一标注数据格式 |
| Word/Markdown/TXT | `mammoth` 解析 DOCX，TXT/Markdown 直接读取 |
| Word/Markdown 导出 | 浏览器生成 DOCX 或 Markdown 下载 |
| 对话附件 | IndexedDB + 云端 Blob，按需恢复图片和文件 |
| 独立阅读面板 | 同源弹出窗口 + `BroadcastChannel` 同步页码、大纲和引用 |
| 网页导入与阅读 | 服务端受限抓取正文，保存离线文本与 HTML 文件 |
| 截图翻译 | `getDisplayMedia` 截取当前画面，视觉模型翻译后保存 |
| 阿栗使用说明、记忆与工具 | 打包同一份使用说明；使用共享检索与工具协议，网页正文经服务端受限抓取 |
| 自动更新 | Web 随服务器部署更新；PWA Service Worker 缓存应用壳 |
| 桌面托盘/悬浮宠物 | 不属于浏览器安全模型；保留主应用内阿栗能力 |

旧版二进制 `.doc` 无法由浏览器端可靠解析，应另存为 `.docx` 或 PDF 后导入。受第三方网站 CSP、登录和跨域限制影响，网页问答以服务端抓取的正文为主；需要完整交互时可通过“用浏览器打开”进入原站。

## 部署检查

- 反向代理同时转发 `/v1`、`/healthz`、WebSocket 与静态资源。
- 设置随机 `JWT_SECRET`、`WEB_ORIGIN` 和托管 PostgreSQL。
- 多实例必须配置共享 Redis。
- 文件存储可使用本地磁盘或 S3/R2/MinIO；生产环境建议使用 S3。
- 配置 OIDC 时，`OIDC_REDIRECT_URI` 指向同步服务的 `/v1/auth/oidc/callback`，`WEB_ORIGIN` 必须与浏览器实际访问源完全一致。
- 不提交 `web/dist`、`server/dist`、`.env`、用户资料、Blob 或数据库文件。
