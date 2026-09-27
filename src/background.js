/*
 * Markdown Viewer — 后台 Service Worker（MV3，事件驱动，不常驻）
 * 收到探测器的通知后，把渲染所需的库和内容脚本按需注入目标标签页。
 */
'use strict';

const RENDER_SCRIPTS = [
  'lib/marked.min.js',
  'lib/hljs.min.js',
  'lib/katex.min.js',
  'lib/auto-render.min.js',
  'lib/mermaid.min.js',
  'src/content.js'
];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'MDV_RENDER' || !sender.tab || sender.tab.id === undefined) {
    return;
  }

  (async () => {
    const tabId = sender.tab.id;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['styles/viewer.css']
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: RENDER_SCRIPTS
      });
      sendResponse({ ok: true });
    } catch (e) {
      // 常见失败：页面是 chrome:// 或商店页等受保护页面，无法注入
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();

  return true; // 异步 sendResponse
});
