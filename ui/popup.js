/* popup.js — 银狐防护弹出面板逻辑 */
'use strict';

const DEFAULTS = {
  enabledGlobal: true,
  showWarning: true,
  autoBlockDownloads: true,
  sensitivity: 'medium',
  fontMode: 'system',
  theme: 'dark',
  themePalette: 'classic', // 'classic' | 'gold' | 'neon' | 'mist' | 'space' | 'pixel'
  material: 'frosted',     // 'frosted' | 'liquid'
  bgImage: '',             // 自定义背景 dataURL
  enabled: {},
  allowlist: [], customKeywords: [], customBadDomains: [],
  aiPersona: 'balanced',   // AI 助手性格档
  remindMode: 'normal',    // 扩展整体报毒识别/提醒偏好：'normal' 正常 | 'quiet' 安静（仅危险告警）
  fontScale: 1          // 0.85 ~ 1.40，界面字号缩放系数
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

  // 应用字体、深浅色、外观主题、材质、自定义背景（与设置页完全一致）
  const root = document.documentElement;
  root.classList.toggle('font-smiley', settings.fontMode === 'smiley');
  root.classList.toggle('theme-light', settings.theme === 'light');
  // 外观主题：经典保持无额外类；其余调色板挂对应 html.theme-* 类
  const pal = settings.themePalette || 'classic';
  root.classList.toggle('theme-gold', pal === 'gold');
  root.classList.toggle('theme-neon', pal === 'neon');
  root.classList.toggle('theme-mist', pal === 'mist');
  root.classList.toggle('theme-space', pal === 'space');
  root.classList.toggle('theme-pixel', pal === 'pixel');
  // 界面材质：默认磨砂玻璃；琉声液态玻璃仅在非 Pixel 主题下生效
  const material = settings.material || 'frosted';
  root.classList.toggle('material-liquid', material === 'liquid' && pal !== 'pixel');
  if (typeof settings.fontScale === 'number') {
    // 得意黑内置 110% 基准系数（用户实测最佳）；跟随系统仍按滑块原值
    let s = settings.fontScale;
    if (settings.fontMode === 'smiley') s *= 1.10;
    root.style.setProperty('--sf-scale', s.toFixed(3));
  }
  // 自定义背景（仅在非 Pixel 主题下生效，保持 Pixel 扁平实色）
  if (settings.bgImage && pal !== 'pixel') {
    root.style.setProperty('--sf-bg-image', 'url(' + settings.bgImage + ')');
  } else {
    root.style.removeProperty('--sf-bg-image');
  }

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
