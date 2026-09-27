'use strict';

const statusEl = document.getElementById('status');
const controlsEl = document.getElementById('controls');
const statChars = document.getElementById('stat-chars');
const statLines = document.getElementById('stat-lines');
const statHeadings = document.getElementById('stat-headings');
const optToc = document.getElementById('opt-toc');

const fmt = n => n.toLocaleString('zh-CN');

function renderState(state) {
  statusEl.textContent = `已渲染：${state.title}`;
  statusEl.classList.add('ok');
  controlsEl.hidden = false;

  document.querySelectorAll('[data-view]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === state.view));
  document.querySelectorAll('[data-theme]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.theme === state.theme));

  statChars.textContent = fmt(state.chars);
  statLines.textContent = fmt(state.lines);
  statHeadings.textContent = fmt(state.headings);
  optToc.checked = state.tocAuto !== false;
}

async function sendToTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    return null; // 内容脚本未注入：不是 Markdown 页面
  }
}

(async () => {
  const state = await sendToTab({ type: 'MDV_GET_STATE' });
  if (!state || !state.active) {
    statusEl.textContent = '当前页面不是 Markdown 文件。打开本地或网络上的 .md 文件即可自动渲染。';
    return;
  }
  renderState(state);
})();

document.querySelectorAll('[data-view]').forEach(btn =>
  btn.addEventListener('click', async () => {
    const state = await sendToTab({ type: 'MDV_SET_SETTING', key: 'view', value: btn.dataset.view });
    if (state) renderState(state);
  }));

document.querySelectorAll('[data-theme]').forEach(btn =>
  btn.addEventListener('click', async () => {
    const state = await sendToTab({ type: 'MDV_SET_SETTING', key: 'theme', value: btn.dataset.theme });
    if (state) renderState(state);
  }));

optToc.addEventListener('change', async () => {
  await sendToTab({ type: 'MDV_SET_SETTING', key: 'tocAuto', value: optToc.checked });
});

// 打开本地文件 / 工作区页面（选择动作在工作区页面内完成，保证
// showDirectoryPicker 与文件授权都发生在带用户手势的完整页面里）
const openWorkspace = pick =>
  chrome.tabs.create({ url: chrome.runtime.getURL('workspace/workspace.html') + '?pick=' + pick });

document.getElementById('open-file').addEventListener('click', () => openWorkspace('file'));
document.getElementById('open-folder').addEventListener('click', () => openWorkspace('folder'));
