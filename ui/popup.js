/* popup.js — 银狐防护弹出面板逻辑 */
'use strict';

const DEFAULTS = {
  enabledGlobal: true,
  showWarning: true,
  autoBlockDownloads: true,
  sensitivity: 'medium',
  enabled: {},
  allowlist: [], customKeywords: [], customBadDomains: []
};

function $(id) { return document.getElementById(id); }

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s || {})));
  });
}

function setSettings(patch) {
  return getSettings().then((s) => {
    const merged = Object.assign({}, s, patch);
    return new Promise((res) => chrome.storage.sync.set(merged, () => res(merged)));
  });
}

function fmtTime(t) {
  try {
    const d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch (e) { return ''; }
}

async function init() {
  const settings = await getSettings();
  const pill = $('globalPill');
  pill.textContent = settings.enabledGlobal ? '防护中' : '已关闭';
  pill.className = 'pill' + (settings.enabledGlobal ? '' : ' off');

  // 统计
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
    const st = r.stats || { warnings: 0, blocks: 0, recent: [] };
    $('statWarn').textContent = st.warnings || 0;
    $('statBlock').textContent = st.blocks || 0;
    const list = $('recentList');
    const recent = (st.recent || []).slice(0, 6);
    if (!recent.length) {
      $('recentWrap').querySelector('.sec-title').textContent = '近期拦截记录';
      list.innerHTML = '<div class="recent-empty">暂无拦截记录，保持警惕 🛡</div>';
    } else {
      list.innerHTML = recent.map((it) =>
        '<li><span class="h">' + escapeHtml(it.hostname) + '</span><span class="s">' + (it.score || '') + ' · ' + fmtTime(it.time) + '</span></li>'
      ).join('');
    }
  });

  // 当前页面状态
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) { setPageStatus(null); return; }
    const url = tab.url || '';
    if (!/^https?:\/\//i.test(url)) { setPageStatus({ analyzed: true, safe: true, note: '非网页环境' }); return; }
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'sf-getStatus' }, (resp) => {
        if (chrome.runtime.lastError || !resp) { setPageStatus({ analyzed: false }); return; }
        setPageStatus(resp);
      });
    } catch (e) { setPageStatus({ analyzed: false }); }
  });

  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function setPageStatus(r) {
  const el = $('pageStatus');
  const scoreEl = $('pageScore');
  if (!r || !r.analyzed) {
    el.textContent = '未能获取';
    el.className = 'value';
    scoreEl.textContent = '—';
    return;
  }
  if (r.allowlisted) { el.textContent = '已加入白名单'; el.className = 'value safe'; scoreEl.textContent = '—'; return; }
  if (r.disabled) { el.textContent = '防护已关闭'; el.className = 'value'; scoreEl.textContent = '—'; return; }
  if (r.detected) {
    el.textContent = '⚠ 风险网站';
    el.className = 'value risk';
    scoreEl.textContent = (r.score || 0) + ' / ' + (r.threshold || '?');
  } else {
    el.textContent = '✓ 未检出风险';
    el.className = 'value safe';
    scoreEl.textContent = (r.score || 0) + ' / ' + (r.threshold || '?');
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

init();
