/*
 * 构建独立预览页 preview.html：
 * 把 sample/demo.md 转义后内嵌为 <pre>，加载与扩展完全相同的
 * 库和 content.js（chrome.* 不可用时自动回退 localStorage），
 * 便于在未安装扩展的情况下验证渲染效果。
 *
 * 用法：node tools/build-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const md = readFileSync(join(root, 'sample/demo.md'), 'utf8');
const scripts = [
  'lib/marked.min.js',
  'lib/hljs.min.js',
  'lib/katex.min.js',
  'lib/auto-render.min.js',
  'lib/mermaid.min.js',
  'src/content.js'
];

const html = `<!DOCTYPE html>
<!-- 本文件由 tools/build-preview.mjs 生成，请勿手改 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Markdown Viewer · 渲染预览</title>
<link rel="stylesheet" href="styles/viewer.css">
</head>
<body>
<pre>${escapeHtml(md)}</pre>
${scripts.map(s => `<script src="${s}"></script>`).join('\n')}
</body>
</html>
`;

writeFileSync(join(root, 'preview.html'), html);
console.log('preview.html built,', html.length, 'bytes');
