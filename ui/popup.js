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
  // 守护态：驱动 logo 呼吸辉光（见 popup.css .app.guarding .logo）
  const appEl = document.querySelector('.app');
  if (appEl) appEl.classList.toggle('guarding', !!settings.enabledGlobal);

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
    setupReport(tab);
    setupAllowlist(tab);
  });

  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function setPageStatus(r) {
  const el = $('pageStatus');
  const scoreEl = $('pageScore');
  let text, cls, score = '—';
  if (!r || !r.analyzed) {
    text = '未能获取'; cls = '';
  } else if (r.allowlisted) {
    text = '已加入白名单'; cls = ' safe';
  } else if (r.disabled) {
    text = '防护已关闭'; cls = '';
  } else if (r.detected) {
    text = '⚠ 风险网站'; cls = ' risk';
    score = (r.score || 0) + ' / ' + (r.threshold || '?');
  } else {
    text = '✓ 未检出风险'; cls = ' safe';
    score = (r.score || 0) + ' / ' + (r.threshold || '?');
  }
  // 仅当文本真正变化时才更新并触发高亮 pop（避免初始渲染 / 同值轮询重复闪动）
  if (el.textContent !== text || el.className !== ('value' + cls)) {
    el.textContent = text;
    el.className = 'value' + cls;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    }
  }
  scoreEl.textContent = score;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

init();

// ============ 一键加入白名单 ============
function setupAllowlist(tab) {
  const btn = $('addAllow');
  const status = $('allowStatus');
  if (!btn) return;
  let domain = '';
  try {
    const u = new URL((tab && tab.url) || '');
    domain = u.hostname.replace(/^www\./i, '');
  } catch (e) { domain = ''; }
  if (!domain) {
    btn.disabled = true;
    if (status) { status.textContent = '当前页面不是网页，无法获取域名'; status.className = 'allow-status warn'; }
    return;
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const s = await getSettings();
    const list = Array.isArray(s.allowlist) ? s.allowlist.slice() : [];
    if (list.indexOf(domain) !== -1) {
      if (status) status.textContent = domain + ' 已在白名单';
      return;
    }
    list.push(domain);
    try { await setSettings({ allowlist: list }); } catch (e) { btn.disabled = false; return; }
    if (status) status.textContent = '已加入白名单 ✓ ' + domain;
  });
}

// ============ 一键上报 ============
function setupReport(tab) {
  const openBtn = $('openReport');
  const menu = $('reportMenu');
  const statusEl = $('reportStatus');
  const cancelBtn = $('reportCancel');
  if (!openBtn || !menu) return;

  let domain = '';
  try {
    const u = new URL((tab && tab.url) || '');
    domain = u.hostname.replace(/^www\./i, '');
  } catch (e) { domain = ''; }

  openBtn.addEventListener('click', function () {
    if (!domain) { alert('当前页面不是网页，无法获取域名进行上报'); return; }
    menu.hidden = !menu.hidden;
    statusEl.textContent = '当前域名：' + domain;
  });

  if (cancelBtn) cancelBtn.addEventListener('click', function () { menu.hidden = true; });

  const items = menu.querySelectorAll('.report-item');
  items.forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const type = btn.getAttribute('data-type');
      btn.disabled = true; if (cancelBtn) cancelBtn.disabled = true;
      statusEl.textContent = '上报中…';
      try {
        const resp = await sendReport(type, domain);
        if (resp && resp.success) {
          statusEl.textContent = '已上报，感谢反馈 ✓';
          setTimeout(function () { menu.hidden = true; }, 1500);
        } else if (resp && resp.fallback) {
          // Worker 未配置 → 打开 GitHub 预填 issue 页（直达 Issues）
          openPrefillIssue(type, domain);
          statusEl.textContent = '已打开 GitHub 上报页';
          menu.hidden = true;
        } else {
          // Worker 已部署但调用失败 → 显示错误，不自动跳转
          const err = (resp && resp.error) || '未知错误';
          statusEl.textContent = '上报失败：' + err + '（可点按钮重试）';
        }
      } catch (e) {
        statusEl.textContent = '上报失败：' + (e && e.message ? e.message : '未知错误') + '（可点按钮重试）';
      } finally {
        btn.disabled = false; if (cancelBtn) cancelBtn.disabled = false;
      }
    });
  });
}

function sendReport(type, domain) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(
      { type: 'sf-submitReport', payload: { reportType: type, domain: domain, note: '' } },
      function (r) {
        if (chrome.runtime.lastError) return resolve({ success: false, error: chrome.runtime.lastError.message });
        resolve(r || { success: false });
      }
    );
  });
}

function openPrefillIssue(type, domain) {
  const label = type === 'false_positive' ? 'false-positive' : 'confirmed-phish';
  const title = (type === 'false_positive' ? '[误报反馈] ' : '[恶意站点举报] ') + domain;
  const body = '## 上报信息\n\n| 字段 | 值 |\n|------|----|\n'
    + '| 类型 | ' + (type === 'false_positive' ? '误报反馈（正常站点被拦截）' : '恶意 / 钓鱼站点举报') + ' |\n'
    + '| 域名 | `' + domain + '` |\n';
  const url = 'https://github.com/yinbo345/silverfox-guard/issues/new?title='
    + encodeURIComponent(title) + '&body=' + encodeURIComponent(body) + '&labels=' + encodeURIComponent(label);
  chrome.tabs.create({ url: url });
}
