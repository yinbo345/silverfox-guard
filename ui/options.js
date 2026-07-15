/* options.js — 银狐防护设置控制面板逻辑 */
'use strict';

const DEFAULTS = {
  enabledGlobal: true,
  showWarning: true,
  autoBlockDownloads: true,
  sensitivity: 'medium',
  enabled: {
    domainImpersonation: true, icpMissing: true, lowQuality: true,
    execDownload: true, cloudDiskDist: true, obfuscatedJs: true, vmDetection: true,
    socialEngineering: true, fakeOfficial: true, redirectIframe: true, domainStructure: true
  },
  allowlist: [], customKeywords: [], customBadDomains: []
};

// 维度说明直接使用 analyzer 的 CATEGORIES.desc，无需在此重复定义

function $(id) { return document.getElementById(id); }
function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s || {}))));
}

function renderCategories(settings) {
  const list = $('catList');
  const cats = (window.SF_ANALYZER && window.SF_ANALYZER.CATEGORIES) || [];
  list.innerHTML = cats.map((c) => {
    const on = settings.enabled[c.id] !== false;
    return '<div class="row">' +
      '<div class="rl"><div class="rt">' + c.label + '<span class="weight">权重 ' + c.weight + '</span></div>' +
      '<div class="rd">' + (c.desc || '') + '</div></div>' +
      '<label class="switch"><input type="checkbox" data-cat="' + c.id + '"' + (on ? ' checked' : '') + '><span class="slider"></span></label>' +
      '</div>';
  }).join('');
}

function bindControls(settings) {
  $('enabledGlobal').checked = !!settings.enabledGlobal;
  updateMasterPill(settings.enabledGlobal);
  $('enabledGlobal').addEventListener('change', (e) => updateMasterPill(e.target.checked));

  $('showWarning').checked = !!settings.showWarning;
  $('autoBlockDownloads').checked = !!settings.autoBlockDownloads;

  // 灵敏度分段
  const seg = $('sensitivity');
  seg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === settings.sensitivity);
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  $('allowlist').value = (settings.allowlist || []).join('\n');
  $('customKeywords').value = (settings.customKeywords || []).join('\n');
  $('customBadDomains').value = (settings.customBadDomains || []).join('\n');
}

function updateMasterPill(on) {
  const p = $('masterPill');
  p.textContent = on ? '防护中' : '已关闭';
  p.className = 'mini-pill ' + (on ? 'on' : 'off');
}

function collectSettings() {
  const enabled = {};
  document.querySelectorAll('input[data-cat]').forEach((cb) => { enabled[cb.dataset.cat] = cb.checked; });
  const sensBtn = document.querySelector('#sensitivity button.active');
  return {
    enabledGlobal: $('enabledGlobal').checked,
    showWarning: $('showWarning').checked,
    autoBlockDownloads: $('autoBlockDownloads').checked,
    sensitivity: sensBtn ? sensBtn.dataset.v : 'medium',
    enabled,
    allowlist: splitLines($('allowlist').value),
    customKeywords: splitLines($('customKeywords').value),
    customBadDomains: splitLines($('customBadDomains').value)
  };
}

function splitLines(s) {
  return String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
}

function showToast() {
  const t = $('toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1600);
}

function loadStats() {
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
    const st = r.stats || { warnings: 0, blocks: 0 };
    $('stWarn').textContent = st.warnings || 0;
    $('stBlock').textContent = st.blocks || 0;
  });
}

async function init() {
  const settings = await getSettings();
  renderCategories(settings);
  bindControls(settings);
  loadStats();

  $('saveBtn').addEventListener('click', () => {
    const patch = collectSettings();
    chrome.storage.sync.set(patch, () => { showToast(); loadStats(); });
  });

  $('resetBtn').addEventListener('click', () => {
    if (!confirm('确定要清空拦截统计吗？白名单与规则设置不会受影响。')) return;
    chrome.storage.local.set({ stats: { warnings: 0, blocks: 0, recent: [] } }, () => { loadStats(); showToast(); });
  });
}

init();
