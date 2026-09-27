/*
 * Markdown Viewer — 工作区页面逻辑
 *
 * 三种来源统一抽象为 { kind, name, entries?/getFile? } 句柄：
 *   1. <input type="file"> 选中的单个文件
 *   2. showDirectoryPicker() / 最近记录恢复的 FileSystemDirectoryHandle
 *   3. 拖拽进入的文件/目录（webkitGetAsEntry 包装）
 *
 * 渲染复用 content.js：首个文件走 __mdvBoot（重建渲染壳，data-mdv-keep
 * 节点保留），后续切换走 __mdvRenderFile。渲染后钩子把工作区内的相对
 * 链接改写为文件跳转、相对图片改写为 blob URL。
 */
'use strict';
(() => {
  const MD_EXT_RE = /\.(md|markdown|mdown|mkd)$/i;
  const IMG_EXT_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i;
  const MAX_FILES = 3000;
  const MAX_DEPTH = 8;

  const $ = s => document.querySelector(s);
  const hero = $('#mdv-hero');
  const wsPanel = $('#mdv-ws');
  const tree = $('#ws-tree');

  // ---------- 可见错误提示：任何失败都不能只留在控制台 ----------
  function showBanner(msg) {
    let banner = document.getElementById('mdv-error-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'mdv-error-banner';
      banner.className = 'mdv-error-banner';
      document.body.appendChild(banner);
    }
    banner.textContent = '⚠️ ' + msg;
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.remove(), 10000);
  }

  window.addEventListener('unhandledrejection', e => {
    showBanner('发生错误：' + (e.reason && e.reason.message || e.reason));
  });
  window.addEventListener('error', e => showBanner('发生错误：' + e.message));

  let wsFiles = new Map();   // 工作区相对路径 -> 文件句柄
  let wsCurrent = null;      // 当前文件的工作区相对路径
  let wsLabel = '';          // 面板标题：文件夹名 / 拖入的文件 / 示例工作区
  let wsMode = 'file';       // 'file' | 'folder'
  let booted = false;
  let blobCache = new Map(); // 工作区相对路径 -> objectURL

  // ---------- 主题先行：主屏阶段就应用已存设置，避免闪白 ----------
  (async () => {
    let theme = 'auto';
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        theme = (await new Promise(r => chrome.storage.sync.get({ theme: 'auto' }, r))).theme;
      } else {
        theme = JSON.parse(localStorage.getItem('mdv-settings') || '{}').theme || 'auto';
      }
    } catch (e) { /* 用默认值 */ }
    const effective = theme === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-mdv-theme', effective);
  })();

  // ---------- 路径工具 ----------
  const splitDir = p => { const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); };

  function resolveRel(fromPath, rel) {
    const fromDir = splitDir(fromPath);
    const stack = fromDir ? fromDir.split('/') : [];
    for (const seg of rel.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return stack.join('/');
  }

  function decodeRef(ref) {
    const clean = ref.split('#')[0].split('?')[0];
    try { return decodeURIComponent(clean); } catch (e) { return clean; }
  }

  // ---------- 目录扫描（真实句柄与拖拽包装句柄共用） ----------
  function wrapEntry(entry) {
    if (entry.isFile) {
      return { kind: 'file', name: entry.name, getFile: () => new Promise((res, rej) => entry.file(res, rej)) };
    }
    const reader = entry.createReader();
    return {
      kind: 'directory',
      name: entry.name,
      entries: async function* () {
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) return;
          for (const child of batch) yield [child.name, wrapEntry(child)];
        }
      }
    };
  }

  async function scanHandle(dirHandle, prefix, state) {
    // 手动迭代并逐项容错：单个不可读条目（占位文件/受限目录/失效链接）
    // 不应中断整个扫描
    let iterator;
    try {
      iterator = dirHandle.entries();
    } catch (e) {
      state.errors.push(`${prefix || dirHandle.name}：无法枚举（${e.message || e}）`);
      return;
    }
    for (;;) {
      let step;
      try {
        step = await iterator.next();
      } catch (e) {
        state.errors.push(`${prefix || dirHandle.name}：读取中断（${e.message || e}）`);
        return;
      }
      if (step.done) return;
      const [name, handle] = step.value;
      try {
        if (handle.kind === 'directory') {
          if (name.startsWith('.') || name === 'node_modules') continue;
          if (state.depth >= MAX_DEPTH) continue;
          state.depth++;
          await scanHandle(handle, prefix ? `${prefix}/${name}` : name, state);
          state.depth--;
        } else if (MD_EXT_RE.test(name) || IMG_EXT_RE.test(name)) {
          wsFiles.set(prefix ? `${prefix}/${name}` : name, handle);
          state.count++;
        }
      } catch (e) {
        state.errors.push(`${prefix ? prefix + '/' : ''}${name}：${e.message || e}`);
      }
    }
  }

  function pickDefaultFile() {
    const paths = [...wsFiles.keys()].filter(p => MD_EXT_RE.test(p));
    if (!paths.length) return null;
    return paths.find(p => /^readme\.(md|markdown)$/i.test(p))
      || paths.find(p => /^index\.(md|markdown)$/i.test(p))
      || paths.slice().sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
  }

  // ---------- 文件树 ----------
  function ensureDirChain(dirMap, rootUl, dir) {
    if (dirMap.has(dir)) return dirMap.get(dir);
    const parts = dir.split('/');
    const parentUl = ensureDirChain(dirMap, rootUl, parts.slice(0, -1).join('/'));
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = parts[parts.length - 1] + '/';
    const ul = document.createElement('ul');
    details.append(summary, ul);
    parentUl.appendChild(details);
    dirMap.set(dir, ul);
    return ul;
  }

  function buildTree() {
    tree.textContent = '';
    const rootUl = document.createElement('ul');
    const dirMap = new Map([['', rootUl]]);
    const paths = [...wsFiles.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    for (const path of paths) {
      const dir = splitDir(path);
      const ul = ensureDirChain(dirMap, rootUl, dir);
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'mdv-ws-file';
      a.textContent = path.slice(dir ? dir.length + 1 : 0);
      a.dataset.path = path;
      a.title = path;
      li.appendChild(a);
      ul.appendChild(li);
    }

    tree.appendChild(rootUl);
    tree.onclick = e => {
      const a = e.target.closest('a.mdv-ws-file');
      if (a) openFile(a.dataset.path);
    };
    applyFileFilter();
  }

  // ---------- 文件搜索过滤（保留输入，重建树后自动重放） ----------
  function applyFileFilter() {
    const input = $('#ws-search');
    const q = (input.value || '').trim().toLowerCase();
    tree.querySelectorAll('a.mdv-ws-file').forEach(a => {
      const hit = !q || a.dataset.path.toLowerCase().includes(q);
      a.parentElement.style.display = hit ? '' : 'none';
    });
    tree.querySelectorAll('details').forEach(d => {
      const visible = [...d.querySelectorAll('a.mdv-ws-file')]
        .some(a => a.parentElement.style.display !== 'none');
      d.style.display = visible ? '' : 'none';
      if (q && visible) d.open = true;
    });
  }

  $('#ws-search').addEventListener('input', applyFileFilter);

  function markActive(path) {
    tree.querySelectorAll('a.mdv-ws-file').forEach(a =>
      a.classList.toggle('mdv-active', a.dataset.path === path));
    tree.querySelector('a.mdv-ws-file.mdv-active')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- 相对引用重写（渲染后钩子） ----------
  window.__MDV_POST_RENDER.push(article => rewriteRefs(article));

  async function rewriteRefs(article) {
    for (const a of article.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (/^(https?:|mailto:|#)/i.test(href)) continue;
      const clean = decodeRef(href);
      if (wsCurrent && MD_EXT_RE.test(clean)) {
        const target = resolveRel(wsCurrent, clean);
        if (wsFiles.has(target)) {
          a.dataset.wsPath = target;
          a.href = `#${target}`;
          continue;
        }
      }
      a.classList.add('mdv-ws-missing');
      a.removeAttribute('href');
      a.title = wsCurrent && wsMode === 'folder'
        ? `工作区中不存在：${clean}`
        : '单文件模式无法解析相对链接，可使用「打开文件夹（工作区）」';
    }

    article.onclick = e => {
      const a = e.target.closest('a[data-ws-path]');
      if (a) {
        e.preventDefault();
        openFile(a.dataset.wsPath);
      }
    };

    for (const img of article.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:)/i.test(src)) continue;
      const clean = decodeRef(src);
      const target = wsCurrent ? resolveRel(wsCurrent, clean) : null;
      const handle = target ? wsFiles.get(target) : null;
      if (!handle || !IMG_EXT_RE.test(target)) {
        img.classList.add('mdv-ws-missing');
        if (!img.alt) img.alt = src;
        continue;
      }
      try { img.src = await blobUrlFor(target, handle); }
      catch (e) { img.classList.add('mdv-ws-missing'); }
    }
  }

  async function blobUrlFor(path, handle) {
    if (blobCache.has(path)) return blobCache.get(path);
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    blobCache.set(path, url);
    return url;
  }

  // ---------- 打开与切换 ----------
  async function openFile(path) {
    const handle = wsFiles.get(path);
    if (!handle) return;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      wsCurrent = path;
      window.__MDV_DOC_NAME = path.split('/').pop();
      if (!booted) {
        booted = true;
        hero.hidden = true;
        await window.__mdvBoot(text);
      } else {
        await window.__mdvRenderFile(text);
      }
      markActive(path);
    } catch (e) {
      console.error('MDV workspace:', e);
      window.alert('读取文件失败：' + (e && e.message || e));
    }
  }

  function resetWorkspace() {
    wsFiles = new Map();
    wsCurrent = null;
    blobCache.forEach(url => URL.revokeObjectURL(url));
    blobCache = new Map();
  }

  function showPanel(label) {
    hero.hidden = true;
    wsPanel.hidden = false;
    document.body.classList.add('mdv-ws-open');
    $('#ws-title').textContent = label;
    $('#ws-title').title = label;
  }

  async function openDirectory(dirHandle) {
    resetWorkspace();
    wsMode = 'folder';
    wsLabel = dirHandle.name;
    // 立即给出可见反馈：大文件夹扫描可能持续数秒
    showPanel(dirHandle.name + '（正在扫描…）');
    buildTree();

    const state = { count: 0, depth: 0, errors: [] };
    try {
      await scanHandle(dirHandle, '', state);
    } catch (e) {
      state.errors.push(`扫描失败：${e && e.message || e}`);
    }

    showPanel(dirHandle.name + (state.count ? `（${state.count} 个文件）` : ''));
    buildTree();
    saveRecent(dirHandle);
    await openFirstOrNotice();

    if (state.errors.length) {
      showBanner(
        `已打开，但 ${state.errors.length} 个条目无法读取。第一个：${state.errors[0]}` +
        (state.errors.length > 1 ? '（详见控制台）' : '')
      );
      console.warn('MDV workspace 扫描跳过的条目：', state.errors);
    }
  }

  async function openFirstOrNotice() {
    const first = pickDefaultFile();
    if (first) { await openFile(first); return; }
    const notice = '> 此文件夹中没有找到 Markdown 文件。\n>\n> 支持的扩展名：`.md` `.markdown` `.mdown` `.mkd`\n>\n> 点击左上角 ⇆ 可重新选择。';
    window.__MDV_DOC_NAME = wsLabel;
    if (!booted) { booted = true; await window.__mdvBoot(notice); }
    else await window.__mdvRenderFile(notice);
  }

  // ---------- 入口：选择文件 ----------
  $('#ws-pick-file').addEventListener('click', () => $('#ws-file-input').click());

  $('#ws-file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    resetWorkspace();
    wsFiles.set(file.name, { kind: 'file', name: file.name, getFile: async () => file });
    wsMode = 'file';
    wsPanel.hidden = true;
    document.body.classList.remove('mdv-ws-open');
    await openFile(file.name);
  });

  // ---------- 入口：选择文件夹（主屏按钮与面板内按钮共用） ----------
  async function pickFolder() {
    try {
      const dir = await showDirectoryPicker({ mode: 'read' });
      await openDirectory(dir);
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        console.error('MDV workspace:', e);
        showBanner(`打开文件夹失败：${e && e.message || e}`);
      }
    }
  }

  $('#ws-pick-folder').addEventListener('click', pickFolder);
  $('#ws-open-folder').addEventListener('click', pickFolder);

  // ---------- 最近打开（IndexedDB 保存目录句柄） ----------
  function idbOpen() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('mdv-workspace', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('recents', { keyPath: 'id' });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function saveRecent(handle) {
    idbOpen().then(db => {
      db.transaction('recents', 'readwrite').objectStore('recents').put({ id: handle.name, handle, ts: Date.now() });
    }).catch(() => { /* 仅影响“最近打开” */ });
  }

  async function showRecents() {
    let recents = [];
    try {
      const db = await idbOpen();
      recents = await new Promise((res, rej) => {
        const req = db.transaction('recents').objectStore('recents').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { return; }
    recents.sort((a, b) => b.ts - a.ts).slice(0, 4).forEach(r => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '📁 ' + r.id;
      btn.title = '点击重新打开（可能需要重新授权）';
      btn.addEventListener('click', async () => {
        if (!r.handle) { showBanner('这条最近记录已损坏，请重新选择文件夹'); return; }
        try {
          let perm = await r.handle.queryPermission({ mode: 'read' });
          if (perm !== 'granted') perm = await r.handle.requestPermission({ mode: 'read' });
          if (perm === 'granted') await openDirectory(r.handle);
          else showBanner('未获得文件夹读取权限，请重试或重新选择');
        } catch (e) {
          console.error('MDV workspace:', e);
          showBanner(`打开最近文件夹失败：${e && e.message || e}。可重新选择文件夹。`);
        }
      });
      $('#ws-recent').hidden = false;
      $('#ws-recent-list').appendChild(btn);
    });
  }
  showRecents();

  // ---------- 拖拽导入 ----------
  const dropOverlay = $('#mdv-drop');
  let dragDepth = 0;

  window.addEventListener('dragenter', e => {
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.add('mdv-drag');
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('mdv-drag'); }
  });
  window.addEventListener('drop', async e => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('mdv-drag');
    const entries = [...(e.dataTransfer ? e.dataTransfer.items : [])]
      .map(item => item.webkitGetAsEntry && item.webkitGetAsEntry())
      .filter(Boolean);
    if (!entries.length) return;

    const dirs = entries.filter(en => en.isDirectory);
    if (dirs.length) { await openDirectory(wrapEntry(dirs[0])); return; }

    resetWorkspace();
    for (const en of entries.filter(en => en.isFile)) {
      if (MD_EXT_RE.test(en.name) || IMG_EXT_RE.test(en.name)) {
        wsFiles.set(en.name, wrapEntry(en));
      }
    }
    if (!wsFiles.size) { window.alert('拖入的内容中没有 Markdown 或图片文件'); return; }
    wsMode = 'folder';
    showPanel('拖入的文件');
    buildTree();
    await openFirstOrNotice();
  });

  // ---------- 示例工作区（无本地权限要求，也用于自动化测试） ----------
  async function openDemo() {
    const res = await fetch('../sample/workspace/manifest.json');
    const paths = await res.json();
    resetWorkspace();
    for (const p of paths) {
      const blob = await (await fetch('../' + p)).blob();
      const rel = p.replace(/^sample\/workspace\//, '');
      // 必须带上 MIME 类型，否则 blob URL 里的 SVG 无法作为图片渲染
      wsFiles.set(rel, { kind: 'file', name: rel, getFile: async () => new File([blob], rel, { type: blob.type }) });
    }
    wsMode = 'folder';
    showPanel('示例工作区');
    buildTree();
    await openFirstOrNotice();
  }

  $('#ws-demo').addEventListener('click', e => { e.preventDefault(); openDemo(); });

  // ---------- URL 参数：popup 按钮跳转时高亮建议入口；?demo=1 直接加载示例 ----------
  const pick = new URLSearchParams(location.search).get('pick');
  if (pick === 'file') $('#ws-pick-file').classList.add('mdv-suggested');
  if (pick === 'folder') $('#ws-pick-folder').classList.add('mdv-suggested');
  if (new URLSearchParams(location.search).get('demo') === '1') openDemo();
})();
