/*
 * Markdown Viewer — 内容脚本（按需注入，非 <all_urls> 常驻）
 *
 * 渲染管线：
 *   提取原始文本 → marked(GFM) 解析 → DOM 清理(去脚本/事件属性)
 *   → highlight.js 代码高亮 → KaTeX 数学公式 → Mermaid 图表
 *   → 标题锚点 + 目录 + 滚动定位
 *
 * 主题：html[data-mdv-theme] 属性驱动（"auto" 由 JS 解析为具体
 * light/dark，保证代码高亮与 Mermaid 同步切换，不依赖媒体查询）。
 */
(() => {
  'use strict';
  if (window.__MDV_READY__) return;
  window.__MDV_READY__ = true;

  // ---------- 存储抽象：扩展环境用 chrome.storage.sync，预览页回退 localStorage ----------
  const DEFAULTS = { theme: 'auto', view: 'rendered', tocAuto: true, zoom: 1 };
  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;

  const store = {
    async get() {
      if (!hasChromeStorage) {
        try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('mdv-settings') || '{}') }; }
        catch (e) { return { ...DEFAULTS }; }
      }
      return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
    },
    async set(patch) {
      if (!hasChromeStorage) {
        localStorage.setItem('mdv-settings', JSON.stringify({ ...settings, ...patch }));
        return;
      }
      return new Promise(resolve => chrome.storage.sync.set(patch, resolve));
    }
  };

  // ---------- 模块状态 ----------
  let RAW = '';
  let settings = { ...DEFAULTS };
  let headings = [];
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);

  const effectiveTheme = () =>
    settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : settings.theme;

  const getArticle = () => $('#mdv-content');
  const getSource = () => $('#mdv-source');

  // ---------- 原始文本提取 ----------
  function extractRaw() {
    const pre = document.body && (document.body.firstElementChild && document.body.firstElementChild.tagName === 'PRE'
      ? document.body.firstElementChild
      : document.body.querySelector('pre'));
    const text = pre ? pre.textContent : (document.body ? document.body.textContent : '');
    return text.replace(/\r\n/g, '\n');
  }

  // ---------- DOM 清理：去掉脚本类标签与事件属性，防外链脚本执行 ----------
  function sanitize(root) {
    root.querySelectorAll('script, style, link, meta, base, object, embed').forEach(n => n.remove());
    root.querySelectorAll('*').forEach(node => {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(attr.value))) {
          node.removeAttribute(attr.name);
        }
      }
    });
  }

  // ---------- 代码高亮（跳过 mermaid 块） ----------
  function highlightCode(root) {
    if (typeof hljs === 'undefined') return;
    hljs.configure({ ignoreUnescapedHTML: true });
    root.querySelectorAll('pre code').forEach(block => {
      if (block.classList.contains('language-mermaid')) return;
      try { hljs.highlightElement(block); } catch (e) { /* 高亮失败按纯文本展示 */ }
    });
  }

  // ---------- 数学公式（KaTeX auto-render） ----------
  function renderMath(root) {
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        throwOnError: false
      });
    } catch (e) { /* 公式解析失败不影响整体渲染 */ }
  }

  // ---------- Mermaid 图表 ----------
  async function renderDiagrams(root, theme) {
    const blocks = root.querySelectorAll('pre code.language-mermaid');
    if (!blocks.length || typeof mermaid === 'undefined') return;

    const nodes = [];
    blocks.forEach(code => {
      const holder = el('div', { className: 'mdv-mermaid' });
      holder.textContent = code.textContent;
      code.closest('pre').replaceWith(holder);
      nodes.push(holder);
    });

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'strict',
        fontFamily: 'inherit'
      });
      await mermaid.run({ nodes, suppressErrors: true });
    } catch (e) {
      nodes.forEach(node => {
        if (!node.querySelector('svg')) node.textContent = '⚠️ Mermaid 图表渲染失败';
      });
    }
  }

  // ---------- 标题锚点（GitHub 风格 slug，保留中日韩文字） ----------
  function slugify(text) {
    return text.toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
      .replace(/ /g, '-');
  }

  function addHeadingAnchors(root) {
    const seen = Object.create(null);
    headings = [];
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
      const text = heading.textContent.trim();
      const base = slugify(text) || 'section';
      let id = base;
      for (let n = 1; id in seen; n++) id = `${base}-${n}`;
      seen[id] = true;
      heading.id = id;

      const anchor = el('a', {
        className: 'mdv-anchor',
        href: `#${id}`,
        textContent: '#',
        title: '跳转到此标题'
      });
      heading.appendChild(anchor);
      headings.push({ level: Number(heading.tagName[1]), id, text });
    });
  }

  // ---------- 目录（栈式嵌套：同级入同一列表，更深层级在上一条目下新开列表） ----------
  function buildToc() {
    const toc = $('#mdv-toc');
    if (!toc) return;
    toc.textContent = '';

    const title = el('div', { className: 'mdv-toc-title', textContent: '目录' });
    const rootList = el('ul');
    const stack = [{ level: 0, list: rootList, item: null }];

    headings.forEach(({ level, id, text }) => {
      while (stack.length > 1 && level <= stack[stack.length - 1].level) stack.pop();
      let top = stack[stack.length - 1];

      if (level > top.level) {
        let nested = top.item
          ? top.item.querySelector(':scope > ul')
          : (top.list.lastElementChild && top.list.lastElementChild.querySelector(':scope > ul'));
        if (!nested) {
          const holder = top.item || top.list.appendChild(el('li'));
          nested = el('ul');
          holder.appendChild(nested);
        }
        top = { level, list: nested, item: null };
        stack.push(top);
      }

      const link = el('a', { href: `#${id}`, textContent: text, title: text });
      link.dataset.target = id;
      const item = el('li');
      item.appendChild(link);
      top.list.appendChild(item);
      top.item = item;
    });

    toc.append(title, rootList);
  }

  // ---------- 滚动定位：高亮当前视口内的标题 ----------
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (document.body.classList.contains('mdv-source')) return;
      let current = null;
      for (const { id } of headings) {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top <= 120) current = id;
        else if (node) break;
      }
      $('#mdv-toc')?.querySelectorAll('a').forEach(link => {
        link.classList.toggle('mdv-active', link.dataset.target === current);
      });
    });
  }

  // ---------- 主渲染 ----------
  async function renderInto(article, raw) {
    const theme = effectiveTheme();
    document.documentElement.setAttribute('data-mdv-theme', theme);

    article.innerHTML = marked.parse(raw, { gfm: true, breaks: false, async: false });
    sanitize(article);
    highlightCode(article);
    renderMath(article);
    await renderDiagrams(article, theme);
    addHeadingAnchors(article);
    buildToc();
    for (const hook of window.__MDV_POST_RENDER || []) {
      try { hook(article, RAW); } catch (e) { /* 钩子失败不影响主渲染 */ }
    }

    // 外部链接在新标签页打开，避免把本地文件视图"导航走"
    article.querySelectorAll('a[href^="http"]').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
  }

  function setTitle() {
    // headings[0].text 不含锚点字符；无标题时回退为文件名
    const firstHeading = headings[0] && headings[0].level === 1 ? headings[0].text : null;
    const name = window.__MDV_DOC_NAME ||
      decodeURIComponent((location.pathname.split('/').pop() || '').replace(/\.(md|markdown|mdown|mkd)$/i, ''));
    const title = firstHeading || name || 'Markdown';
    document.title = title;
    const headerTitle = $('#mdv-title');
    if (headerTitle) {
      headerTitle.textContent = name || title;
      headerTitle.title = `${title}（点击回到页首）`;
    }
  }

  function buildShell() {
    // 重建渲染壳；工作区侧栏的展开状态需保留（其面板节点在下方原样恢复）
    const wsOpen = document.body.classList.contains('mdv-ws-open');
    document.body.className = 'mdv-active' + (wsOpen ? ' mdv-ws-open' : '');
    // 工作区页面会预置带 data-mdv-keep 的常驻 UI，重建时原样保留
    const kept = [...document.body.querySelectorAll('[data-mdv-keep]')];
    document.body.textContent = '';

    // ---- 顶栏：左（菜单/标题） 中（缩放/源码） 右（面板/主题） ----
    const header = el('div', { id: 'mdv-header' });
    const left = el('div', { className: 'mdv-hgroup mdv-hleft' });
    const center = el('div', { className: 'mdv-hgroup mdv-hcenter' });
    const right = el('div', { className: 'mdv-hgroup mdv-hright' });

    const btnToc = el('button', { id: 'mdv-btn-toc', textContent: '☰', title: '目录' });
    const docTitle = el('span', { id: 'mdv-title', className: 'mdv-title', title: '回到页首' });

    const btnZoomOut = el('button', { id: 'mdv-zoom-out', textContent: '−', title: '缩小字号' });
    const zoomLabel = el('button', { id: 'mdv-zoom-label', textContent: '100%', title: '点击重置为 100%' });
    const btnZoomIn = el('button', { id: 'mdv-zoom-in', textContent: '+', title: '放大字号' });
    const sep = el('span', { className: 'mdv-hsep' });
    const btnSrc = el('button', { id: 'mdv-btn-src', textContent: '‹/›', title: '查看原始 Markdown' });

    const btnWs = el('button', { id: 'mdv-btn-ws', textContent: '▤', title: '文件面板' });
    const btnTheme = el('button', { id: 'mdv-btn-theme', textContent: '◐', title: '切换主题' });

    left.append(btnToc, docTitle);
    center.append(btnZoomOut, zoomLabel, btnZoomIn, sep, btnSrc);
    right.append(btnWs, btnTheme);
    header.append(left, center, right);

    const toc = el('aside', { id: 'mdv-toc' });
    const article = el('article', { id: 'mdv-content', className: 'markdown-body' });
    const source = el('pre', { id: 'mdv-source' });

    document.body.append(header, toc, article, source);
    kept.forEach(node => document.body.appendChild(node));

    btnToc.addEventListener('click', () => {
      const open = document.body.classList.toggle('mdv-toc-open');
      btnToc.classList.toggle('mdv-on', open);
      if (open) onScrollForce();
    });
    docTitle.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    btnZoomOut.addEventListener('click', () => adjustZoom(-0.1));
    btnZoomIn.addEventListener('click', () => adjustZoom(0.1));
    zoomLabel.addEventListener('click', () => resetZoom());
    btnSrc.addEventListener('click', () => toggleSource());
    btnWs.addEventListener('click', () => {
      const open = document.body.classList.toggle('mdv-ws-open');
      btnWs.classList.toggle('mdv-on', open);
    });
    btnTheme.addEventListener('click', () => cycleTheme());
  }

  // ---------- 字号缩放 ----------
  function applyZoom() {
    document.documentElement.style.setProperty('--mdv-zoom', String(settings.zoom ?? 1));
    const label = $('#mdv-zoom-label');
    if (label) label.textContent = Math.round((settings.zoom ?? 1) * 100) + '%';
  }

  async function adjustZoom(delta) {
    const cur = settings.zoom ?? 1;
    settings.zoom = Math.min(2, Math.max(0.5, Math.round((cur + delta) * 10) / 10));
    await store.set({ zoom: settings.zoom });
    applyZoom();
  }

  async function resetZoom() {
    settings.zoom = 1;
    await store.set({ zoom: 1 });
    applyZoom();
  }

  function onScrollForce() {
    ticking = false;
    onScroll();
  }

  function toggleSource(force) {
    const toSource = force !== undefined ? force : !document.body.classList.contains('mdv-source');
    document.body.classList.toggle('mdv-source', toSource);
    $('#mdv-btn-src')?.classList.toggle('mdv-on', toSource);
    if (!toSource) onScrollForce();
  }

  const THEME_LABEL = { auto: '跟随系统', light: '浅色', dark: '深色' };

  function applyTheme(rerender) {
    document.documentElement.setAttribute('data-mdv-theme', effectiveTheme());
    const btn = $('#mdv-btn-theme');
    if (btn) btn.title = `主题：${THEME_LABEL[settings.theme]}`;
    if (rerender && RAW) renderInto(getArticle(), RAW);
  }

  async function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
    await store.set({ theme: settings.theme });
    applyTheme(true);
  }

  async function setSetting(key, value) {
    settings[key] = value;
    await store.set({ [key]: value });
    if (key === 'theme') applyTheme(true);
    if (key === 'view') toggleSource(value === 'source');
  }

  function getState() {
    return {
      active: true,
      theme: settings.theme,
      view: document.body.classList.contains('mdv-source') ? 'source' : 'rendered',
      title: document.title,
      chars: RAW.length,
      lines: RAW.split('\n').length,
      headings: headings.length,
      tocOpen: document.body.classList.contains('mdv-toc-open'),
      tocAuto: settings.tocAuto
    };
  }

  // ---------- 消息处理（popup 调用） ----------
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type || msg.type.indexOf('MDV_') !== 0) return;
      (async () => {
        switch (msg.type) {
          case 'MDV_GET_STATE':
            sendResponse(getState());
            break;
          case 'MDV_SET_SETTING':
            await setSetting(msg.key, msg.value);
            sendResponse(getState());
            break;
          case 'MDV_TOGGLE_TOC': {
            $('#mdv-btn-toc')?.click();
            sendResponse(getState());
            break;
          }
          default:
            sendResponse({ error: 'unknown message' });
        }
      })();
      return true;
    });
  }

  // 设置被其他上下文（popup / 其他设备同步）修改时实时跟随
  if (hasChromeStorage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.zoom && changes.zoom.newValue !== settings.zoom) {
        settings.zoom = changes.zoom.newValue;
        applyZoom();
      }
      let structural = false;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key === 'zoom') continue;
        if (key in settings && settings[key] !== newValue) {
          settings[key] = newValue;
          structural = true;
        }
      }
      if (!structural) return;
      applyTheme(false);
      toggleSource(settings.view === 'source');
      if (RAW) renderInto(getArticle(), RAW);
    });
  }

  // 系统主题变化（auto 模式下需要整体重渲染，让 Mermaid 同步换肤）
  mq.addEventListener('change', () => {
    if (settings.theme === 'auto' && RAW) applyTheme(true);
  });

  window.addEventListener('scroll', onScroll, { passive: true });

  // ---------- 启动 ----------
  async function boot(presetRaw) {
    settings = await store.get();
    RAW = presetRaw !== undefined ? presetRaw.replace(/\r\n/g, '\n') : extractRaw();
    if (!RAW.trim()) return;
    buildShell();
    applyZoom();
    getSource().textContent = RAW;
    await renderInto(getArticle(), RAW);
    setTitle();
    if (settings.view === 'source') toggleSource(true);
    if (settings.tocAuto !== false && headings.length) {
      document.body.classList.add('mdv-toc-open');
      $('#mdv-btn-toc')?.classList.add('mdv-on');
    }
  }

  // 供预览页/工作区页调用：boot 重建整个壳，renderFile 仅切换文档内容
  window.__mdvBoot = boot;
  window.__mdvRenderFile = async raw => {
    RAW = String(raw).replace(/\r\n/g, '\n');
    getSource().textContent = RAW;
    await renderInto(getArticle(), RAW);
    setTitle();
  };
  window.__MDV_POST_RENDER = window.__MDV_POST_RENDER || [];

  if (window.__MDV_PREVIEW__) {
    /* 预览环境由页面自身调用 __mdvBoot */
  } else if (document.body && document.body.querySelector('pre')) {
    // 仅当页面是浏览器纯文本包裹（<pre>）时才自动渲染；
    // 工作区等扩展页面由 workspace.js 显式调用 __mdvBoot
    boot();
  }
})();
