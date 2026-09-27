# Markdown Viewer

一个 Chrome / Edge（Manifest V3）浏览器扩展：打开 Markdown 文件时，自动将其渲染为精美的阅读页面。完全本地处理，无任何网络请求。

浏览器原生打开 `.md` 文件是等宽纯文本——标题与正文混淆、表格变成竖线、代码没有高亮。本扩展在检测到浏览器以纯文本展示 Markdown 文件时自动介入，将其渲染为带目录导航的阅读页面，并且可以像文档站一样浏览本地文件夹中的全部文档。

## ✨ 功能特性

- **自动检测渲染**：打开 `.md` / `.markdown` / `.mdown` / `.mkd` 文件（网络链接或本地 `file://`）时自动渲染；普通网页完全不介入
- **GFM 语法**：表格、任务列表、删除线、自动链接、嵌套列表（[marked](https://github.com/markedjs/marked)）
- **代码高亮**：40+ 常用语言，GitHub 亮/暗配色（[highlight.js](https://highlightjs.org/)）
- **数学公式**：`$行内$` 与 `$$块级$$` LaTeX 公式（[KaTeX](https://katex.org/)，含全部字体，离线可用）
- **图表**：` ```mermaid ` 代码块渲染为流程图 / 时序图等（[Mermaid](https://mermaid.js.org/)），主题切换时同步换肤
- **目录导航**：按标题层级嵌套的侧边目录，滚动时自动高亮当前位置，点击跳转
- **标题锚点**：悬停标题显示 `#` 锚点链接（GitHub 风格 slug，保留中日韩文字）
- **工作区**：从弹窗打开本地文件或整个文件夹，在文件树中切换浏览；相对链接可直接跳转、相对图片正常显示；支持拖拽导入与最近文件夹记忆
- **主题**：浅色 / 深色 / 跟随系统，顶栏一键循环或弹窗选择
- **字号缩放**：50%–200%，缩放偏好自动记忆
- **源码视图**：一键在渲染结果与原始 Markdown 之间切换
- **安全**：渲染前过滤 `<script>`、事件属性与 `javascript:` 链接；Mermaid 以 `securityLevel: strict` 运行
- **隐私**：所有解析渲染均在本地完成，扩展自身不发起任何网络请求，不收集任何数据

## 📦 安装（开发者模式）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本仓库根目录
4. 阅读本地磁盘上的 `.md` 文件：在扩展详情页打开 **允许访问文件网址**
5. 拖入任意 `.md` 文件即可体验（可用 `sample/demo.md` 查看全部特性）

## 🚀 使用

| 操作 | 方式 |
| --- | --- |
| 打开本地文件 / 文件夹 | 扩展弹窗 → 📄 打开文件 / 📁 打开工作区 |
| 打开/关闭目录 | 顶栏 `☰` 按钮（左侧目录栏） |
| 字号缩放 | 顶栏 `−` / `100%` / `+`（50%–200%，点击 100% 重置） |
| 文件面板（工作区） | 顶栏 `▤` 按钮（右侧文件树 + 搜索框） |
| 渲染/源码切换 | 顶栏 `‹/›` 按钮，或扩展弹窗 |
| 切换主题 | 顶栏 `◐` 按钮循环：跟随系统 → 浅色 → 深色 |
| 跳转章节 | 点击目录条目或标题锚点 |

设置（主题、视图、目录行为）通过 `chrome.storage.sync` 保存。

### 工作区说明

- 选择文件夹后递归扫描（跳过 `.git`、`node_modules` 与隐藏目录，上限 3000 个文件 / 8 层），左侧文件树按目录分组
- 工作区内相对链接（如 `[说明](notes.md)`、`[返回](../index.md)`）可直接跳转；相对图片改写为 blob URL 显示
- 「最近打开」把文件夹句柄存入 IndexedDB，下次点击后浏览器会请求重新授权
- 个别条目无法读取（如 OneDrive 按需占位文件、受限目录）时会跳过，并在页面底部红条中提示原因
- 文件面板标题栏：📂 直接打开其他文件夹（无需回主屏）；需要选择单文件或查看最近列表时，从扩展弹窗重新进入
- 文件夹内容变更不会自动刷新，重新选择即可刷新

### 故障排查

- **本地文件无反应**：确认已在 `chrome://extensions` → 扩展详情 → 打开「允许访问文件网址」
- **修改代码后不生效**：`chrome://extensions` 中点击该扩展的刷新按钮，并刷新已打开的标签页
- **打开报错**：页面底部会出现红色错误条，包含具体原因（`F12` 控制台有更详细的日志）

## 🧩 目录结构

```
markdown-viewer/
├── manifest.json          # MV3 清单
├── src/
│   ├── detector.js        # 内容探测器：注入所有页面但仅 ~2KB，识别 .md 纯文本页
│   ├── background.js      # Service Worker：按需向目标标签页注入渲染脚本
│   └── content.js         # 渲染器：marked → 清理 → 高亮 → KaTeX → Mermaid → 目录
├── lib/                   # 打包的开源库（均为 MIT/BSD 许可）
├── styles/
│   ├── viewer.css         # 合并产物：github-markdown-css + KaTeX + 高亮主题 + UI
│   ├── ui.css             # 扩展自身 UI 样式（编辑后需重新合并）
│   ├── theme-override.css # 手动主题切换用的变量重作用域（构建生成）
│   ├── hljs-scoped.css    # 亮/暗高亮主题，按 html[data-mdv-theme] 作用域化
│   └── fonts/             # KaTeX 字体
├── popup/                 # 扩展弹窗（状态、视图、主题、统计、打开入口）
├── workspace/             # 工作区页面（选择文件/文件夹、文件树、相对路径重写）
├── icons/                 # 扩展图标
├── sample/                # demo.md 功能演示；workspace/ 为示例工作区
├── docs/article.md        # 实现思路整理（技术文章）
├── store-assets/          # 商店提交材料：文案、隐私政策、截图
├── tools/                 # 打包与预览构建脚本
└── preview.html           # 独立预览页（无需安装扩展即可验证渲染）
```

### 关键设计

- **按需注入**：探测器只有 ~2KB，注入所有页面做廉价判断；命中后由 background 用 `chrome.scripting` 注入 3.8MB 的渲染栈，普通网页零开销
- **检测标准**：`document.contentType` 含 `markdown`，或 `text/plain` 且扩展名为 md 系，且页面为 Chrome 纯文本包裹结构（单一 `<pre>`）；自带渲染的网页（`text/html`）不会误触发
- **渲染管线**：marked 解析 → DOM 清理 → highlight.js → KaTeX → Mermaid → 锚点/目录，工序顺序有讲究（如 KaTeX 必须在 Mermaid 块替换之前，且 `ignoredTags` 含 `pre/code`）
- **主题机制**：`html[data-mdv-theme]` 属性驱动；`auto` 由 JS 解析为具体亮/暗并监听系统变化，保证代码高亮与 Mermaid 同步换肤；切换主题时整页重渲染是让图表同步换肤的最短路径
- **失败可见化**：页面内错误条 + 全局 `unhandledrejection` 兜底，任何失败都不静默

## 🛠 本地开发与测试

无需安装扩展即可联调渲染管线：

```bash
# 修改 sample/demo.md 后重新生成独立预览页（内嵌文档内容，双击即可打开）
node tools/build-preview.mjs

# 或起一个静态服务器访问 preview.html / workspace/workspace.html?demo=1
```

- `preview.html`：加载与扩展完全相同的库和 `content.js`，直接渲染 `sample/demo.md`
- `workspace/workspace.html?demo=1`：加载 `sample/workspace/` 示例工作区，验证文件树、跨文件跳转、相对图片
- `workspace.html` 内置与扩展页一致的 CSP meta，可等价验证 MV3 扩展页的 CSP 行为

修改 `styles/ui.css` 后需重新合并样式：

```bash
cat styles/github-markdown.css styles/theme-override.css styles/katex.min.css styles/hljs-scoped.css styles/ui.css > styles/viewer.css
```

## 🏪 发布到 Chrome Web Store

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1 -Version 1.0.1
```

生成 `dist/markdown-viewer-chrome-v<版本>.zip`（排除开发文件、条目使用正斜杠分隔符——`Compress-Archive` 在 Windows PowerShell 下生成反斜杠条目，商店会解析失败）。

商店描述文案、权限理由、数据披露话术见 `store-assets/listing.md`；隐私政策模板见 `store-assets/PRIVACY.md`；1280×800 截图见 `store-assets/screenshot-*.png`。

## 📄 许可

- 第三方库：marked (MIT)、highlight.js (BSD-3-Clause)、KaTeX (MIT)、Mermaid (MIT)、github-markdown-css (MIT)，均随本仓库分发
- 本项目代码的许可证在发布前请自行确定（如 MIT）并添加 LICENSE 文件
