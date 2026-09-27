/*
 * Markdown Viewer — 内容探测器
 * 以 <all_urls> 注入，但体积极小（无任何依赖）。
 * 判定当前页面是"浏览器当作纯文本展示的 Markdown 文件"后，
 * 通知 background 按需注入完整的渲染脚本，避免在普通网页上
 * 加载 3MB+ 的库。
 */
(() => {
  'use strict';
  // 只处理顶层页面，忽略 iframe
  if (window !== window.top) return;
  // 防止重复判定（扩展自身二次注入、bfcache 恢复等）
  if (window.__MDV_DETECTED__ !== undefined) return;

  const MD_EXT_RE = /\.(md|markdown|mdown|mkd)(?:$)/i;

  function detect() {
    // document.contentType 反映服务器返回的 Content-Type。
    // Chrome 会把 text/plain 页面包进 <body><pre>…</pre></body> 展示。
    const ct = (document.contentType || '').toLowerCase();

    const pre = document.body &&
      document.body.children.length === 1 &&
      document.body.firstElementChild &&
      document.body.firstElementChild.tagName === 'PRE'
      ? document.body.firstElementChild
      : null;

    if (!pre) return false; // 是完整 HTML 页面（如 GitHub 的 .md 浏览页）则不处理

    const looksLikeHtml = /^\s*(<!doctype\s+html|<html[\s>])/i.test(pre.textContent.slice(0, 256));
    if (looksLikeHtml) return false; // 内容本身是 HTML 文档，交给浏览器按文本展示

    if (ct.indexOf('markdown') !== -1) return true;          // text/markdown 等
    if (ct === 'text/plain' && MD_EXT_RE.test(location.pathname)) return true; // 服务器以纯文本返回的 .md

    return false;
  }

  const isMd = detect();
  window.__MDV_DETECTED__ = isMd;
  if (!isMd) return;

  try {
    chrome.runtime.sendMessage({ type: 'MDV_RENDER' }, () => void chrome.runtime.lastError);
  } catch (e) {
    /* 扩展上下文失效（例如刚被更新）时静默放弃 */
  }
})();
