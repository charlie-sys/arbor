# Arbor

**文献阅读、知识整理与 AI 研究工坊。**

Arbor 是一款本地优先的桌面文献研究工具。它把 PDF、Word、Markdown 与 TXT 文献阅读、可追溯的 AI 对话、高亮摘录、灵感收集、研究主题、截图翻译、阅读计划与主题画布放进同一个安静的空间。数据保存在本机，AI 结论尽量回到原文页码。

![Arbor 文献库](docs/assets/screens/library.png)

> 五套可切换主题（暖砂 / 澄蓝 / 柔光 / 暖夜 / 深空）· Windows 10/11

## 功能

- **可拖拽文献列表**：列表整体宽度与列宽都可用鼠标拖动，双击列边界恢复默认。
- **可溯源的 AI 对话**：回答附带原文片段与页码，点击引用回到 PDF；支持「第2—3页」「第1、4页」等页码范围。
- **对话字号与提问导航**：对话内按 `Ctrl + 滚轮` 缩放正文字号（80%–200%，重启后保留）；问题导航条展示每个提问的位置，悬停预览、点击跳转并高亮定位。独立成行的公式自动按块级公式排版。
- **独立阅读面板**：助手、信息、笔记、高亮、大纲、摘录与任务面板可脱离主窗口，独立窗口支持置顶跟随，页码与大纲同步。
- **阅读器工作台**：支持 PDF、Word（docx/doc）、Markdown、TXT 导入；PDF 缩放翻页，文本文献自动分页阅读，统一提供大纲、高亮、摘录、文献信息、笔记与任务。
- **对话附件与文件交付**：对话可附带图片与文件；AI 可直接生成图片、图表、PDF、表格等交付文件，支持预览、用系统应用打开与另存。
- **用量仪表盘**：统计输入/输出 Token、缓存命中率、首字延迟与生成速度，按模型与功能分类展示调用趋势，并按可调单价估算费用。
- **多主题外观**：内置暖砂、澄蓝、柔光三套浅色与暖夜、深空两套深色主题；在命令面板搜索「主题」即可切换，主窗口与独立阅读面板实时同步。
- **应用内更新**：启动与切换回窗口时检查 GitHub Releases，设置页可下载并校验安装包，完成后直接启动安装。
- **灵感收集**：快速接住文字、链接、摘录与待办，并提供 AI 归类建议。
- **研究主题**：聚合成员文献、建议问题与摘录，进入主题内对话。
- **截图翻译**：全局快捷键框选，保留原图、结构化译文与纯文本。
- **主题阅读计划**：按学习目标生成阅读顺序、关注点与问题清单。
- **主题画布**：文献、摘录与问答卡片连线、分区容器、尺寸调整、画布内文献拖入、缩放与 PNG 导出。
- **本地安全**：API Key 以 Windows DPAPI 加密落盘，界面不回显明文；自动备份保留最近 7 份。

## 下载与在线体验

- **桌面版下载**：请在仓库右侧 **Releases** 中下载最新的 Windows 安装包。
- **在线产品页**：GitHub Pages 首页（功能、截图、使用说明、下载入口）。
- **在线交互 Demo**：`demo.html`，使用模拟数据展示主要界面与交互，不连接真实 AI、不读取本地文件。
- **用户体验问卷**：已迁移至 [腾讯文档收集表](https://docs.qq.com/form/page/DREh5UExreEdxTm5t)，10 题、约 2 分钟、匿名；`questionnaire.html` 保留为跳转页。

## 快速开始

### 使用安装包

1. 从 Releases 下载 `Arbor-Setup-x.y.z.exe` 并安装。
2. 打开 Arbor，在「设置」中填写 OpenAI 兼容接口的 Base URL、API Key 与模型名。
3. 点击「测试连接」，保存后导入 PDF、Word、Markdown 或 TXT 即可开始阅读与提问。
4. 后续版本可在「设置 → 关于与更新」中检查并安装，无需手动重新下载安装包。

### 从源码运行

```bash
npm install
npm run dev      # 开发模式
npm run build    # 构建
npm run dist     # 生成 Windows NSIS 安装包到 release/
```

要求：Node.js 20+、Windows 10/11。

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl + O` | 全局搜索 |
| `Ctrl + K` | 命令面板（含主题切换） |
| `Ctrl + N` | 快速收集灵感 |
| `Ctrl + Shift + T` | 截图翻译 |
| `Ctrl + Enter` | 发送对话 |
| `Ctrl + 滚轮` | 缩放对话字号 |
| `Esc` | 关闭浮层 |

## 数据与隐私

- 文献、笔记、摘录、对话、聊天附件、翻译、截图与 Token 用量记录保存在本机数据目录（默认 `%APPDATA%/Arbor/data`）。
- API Key 通过 Electron `safeStorage`（Windows DPAPI）加密后写入配置，界面始终以密码形式显示。
- AI 请求只会发送到你配置的模型服务；Arbor 不会把文献库上传到自有服务器。
- 首次从旧版 `ZotAgent` 启动时，会自动把旧数据目录迁移到 `Arbor`。

## 技术栈

Electron + React + TypeScript + Vite，PDF.js、react-markdown、KaTeX、lucide-react，mammoth / word-extractor 解析 Word 文献。产品展示站为零依赖静态 HTML/CSS/JS，发布在 GitHub Pages。

## 目录结构

```
src/main          Electron 主进程、IPC、存储、AI、MCP、备份
src/preload       预加载桥接
src/renderer      React 界面
src/shared        共享类型与 IPC 定义
docs/             GitHub Pages 产品站、在线 Demo、问卷与截图
scripts/          构建、进度审计与截图工具
```

## License

[MIT](LICENSE)
