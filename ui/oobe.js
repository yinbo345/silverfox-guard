/* oobe.js — 银狐防护首次引导向导（OOBE）逻辑
   步骤：0 欢迎 → 1 灵敏度 → 2 外观 → 3 AI 助手 → 4 完成
   每步可「跳过此项」，右上角「一键跳过」全部用默认；完成后写入设置并跳转设置页。
   字段 remindMode = 扩展整体报毒识别/提醒偏好（'normal' 正常 | 'quiet' 安静）。 */
'use strict';

// 本页用到的设置项与默认值（须与 background/options/popup 的 DEFAULTS 保持一致）
const DEFAULTS = {
  sensitivity: 'medium',
  themePalette: 'classic',
  theme: 'dark',
  fontMode: 'system',
  material: 'frosted',
  fontScale: 1,
  aiPersona: 'balanced',
  remindMode: 'normal',   // 扩展整体报毒识别/提醒偏好：'normal' 正常 | 'quiet' 安静
  aiMaxMode: false,
  cloudEnhance: false
};

// 各步骤负责的设置字段（用于「跳过此项」重置为默认）
const STEP_FIELDS = {
  1: ['sensitivity'],
  2: ['themePalette', 'theme', 'fontMode', 'material', 'fontScale'],
  3: ['aiPersona', 'remindMode', 'aiMaxMode', 'cloudEnhance']
};

const TOTAL = 4; // 步骤索引上限（0..4）
let selections = Object.assign({}, DEFAULTS);
let current = 0;
let maxVisited = 0; // 已访问过的最大步骤（用于侧栏可回跳）

const $ = (id) => document.getElementById(id);

/* ---------- 预览：把选择实时套用到本页外观 ---------- */
function applyPreview() {
  const root = document.documentElement;
  const s = selections;
  root.classList.toggle('theme-light', s.theme === 'light');
  ['classic', 'gold', 'neon', 'mist', 'space', 'pixel'].forEach((p) =>
    root.classList.toggle('theme-' + p, s.themePalette === p));
  root.classList.toggle('material-liquid', s.material === 'liquid' && s.themePalette !== 'pixel');
  root.classList.toggle('font-smiley', s.fontMode === 'smiley');
  const sc = (typeof s.fontScale === 'number') ? s.fontScale : 1;
  root.style.setProperty('--sf-scale', String(sc * (s.fontMode === 'smiley' ? 1.10 : 1)));
  // 预览小窗字号随滑块缩放
  const px = (18 * sc * (s.fontMode === 'smiley' ? 1.10 : 1));
  ['mockSample', 'mockSample2'].forEach((id) => { const el = $(id); if (el) el.style.fontSize = px.toFixed(1) + 'px'; });
}

/* ---------- 分段控件滑动药丸定位 ---------- */
function positionGlider(seg, instant) {
  const glider = seg.querySelector('.seg-glider');
  const active = seg.querySelector('button.active');
  if (!glider || !active) return;
  const w = active.offsetWidth + 'px';
  const l = active.offsetLeft + 'px';
  if (instant || !glider.style.left || glider.style.left === '0px') {
    // 首次定位（或左缘还在 0）直接落位，避免「从左边滑进来」的突兀感
    const prev = glider.style.transition;
    glider.style.transition = 'none';
    glider.style.width = w; glider.style.left = l;
    void glider.offsetWidth;          // 强制回流，让无过渡的落位先生效
    glider.style.transition = prev;
  } else {
    glider.style.width = w; glider.style.left = l;
  }
}

/* ---------- 字段激活态同步 ---------- */
function setActive(field, val) {
  const group = document.querySelector('[data-field="' + field + '"]');
  if (!group) return;
  let match = val;
  if (field === 'aiMaxMode' || field === 'cloudEnhance') match = val ? 'on' : 'off';
  group.querySelectorAll('button[data-val]').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === match);
  });
}

function syncUI() {
  ['sensitivity', 'themePalette', 'theme', 'fontMode', 'material',
   'aiPersona', 'remindMode', 'aiMaxMode', 'cloudEnhance'].forEach((f) => setActive(f, selections[f]));
  const fs = $('fontScale');
  if (fs) { fs.value = selections.fontScale; }
  $('fsVal').textContent = Math.round(selections.fontScale * 100) + '%';
  updateSensHint();
}

/* ---------- 写入单个字段 ---------- */
function setField(field, val) {
  if (field === 'aiMaxMode' || field === 'cloudEnhance') {
    selections[field] = (val === 'on');
    if (field === 'aiMaxMode' && val === 'on') { selections.cloudEnhance = false; setActive('cloudEnhance', false); }
  } else if (field === 'fontScale') {
    selections.fontScale = parseFloat(val);
  } else {
    selections[field] = val;
  }
  applyPreview();
  if (field === 'sensitivity') updateSensHint();
  if (field === 'fontScale') $('fsVal').textContent = Math.round(selections.fontScale * 100) + '%';
}

function updateSensHint() {
  const map = {
    low: '低：仅拦高置信危险，最不打扰，适合老练用户。',
    medium: '中：均衡档，默认推荐，误报与漏报折中。',
    high: '高：更易触发警告，防护更严，适合谨慎场景。'
  };
  const el = $('sensitivityHint');
  if (el) el.textContent = map[selections.sensitivity] || '';
}

/* ---------- 百分比数字滚动 ---------- */
function animatePct(to) {
  const el = $('pct');
  if (!el) return;
  const from = parseInt(el.textContent, 10) || 0;
  el.classList.add('bump');
  const dur = 420; let start = null;
  function tick(t) {
    if (start === null) start = t;
    const p = Math.min(1, (t - start) / dur);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    el.textContent = v + '%';
    if (p < 1) requestAnimationFrame(tick);
    else { el.textContent = to + '%'; setTimeout(() => el.classList.remove('bump'), 280); }
  }
  requestAnimationFrame(tick);
}

/* ---------- 步骤切换 ---------- */
function showStep(n) {
  current = Math.max(0, Math.min(TOTAL, n));
  if (current > maxVisited) maxVisited = current;
  document.querySelectorAll('.pane').forEach((p) =>
    p.classList.toggle('show', Number(p.dataset.pane) === current));
  // 侧栏步骤状态
  document.querySelectorAll('.stp').forEach((d) => {
    const i = Number(d.dataset.step);
    d.classList.toggle('active', i === current);
    d.classList.toggle('done', i < current);
    d.classList.toggle('clickable', i <= maxVisited);
  });
  // 进度条（伪元素 ::after 高度 = 进度 0~1 × 轨道可用高度）与百分比
  const stepper = $('stepper');
  if (stepper) stepper.style.setProperty('--progress', String(current / TOTAL));
  animatePct(Math.round(current / TOTAL * 100));
  $('prevBtn').style.visibility = current === 0 ? 'hidden' : 'visible';
  $('nextBtn').textContent = current === TOTAL ? '完成并进入设置' : '下一步';
  // 定位当前步骤内分段控件的滑动药丸（隐藏面板 offsetWidth=0，须在显示后定位）
  const pane = document.querySelector('.pane[data-pane="' + current + '"]');
  if (pane) pane.querySelectorAll('.seg').forEach(positionGlider);
  if (current === TOTAL) renderSummary();
}

/* ---------- 完成摘要 ---------- */
const LABELS = {
  sensitivity: { low: '低', medium: '中', high: '高' },
  themePalette: { classic: '经典', gold: '暖金国风', neon: '赛博霓虹', mist: '极简雾灰', space: '暗夜深空', pixel: '像素蓝紫' },
  theme: { dark: '深色', light: '浅色' },
  fontMode: { system: '系统字体', smiley: '得意黑' },
  material: { frosted: '磨砂玻璃', liquid: '琉声液态' },
  aiPersona: { balanced: '均衡', efficient: '高效', gentle: '温柔', pro: '严谨', humorous: '幽默' },
  remindMode: { normal: '正常提醒', quiet: '安静模式' }
};
function renderSummary() {
  const s = selections;
  const chips = [];
  chips.push('灵敏度：' + (LABELS.sensitivity[s.sensitivity] || s.sensitivity));
  chips.push('主题：' + (LABELS.themePalette[s.themePalette] || s.themePalette) + '·' + (LABELS.theme[s.theme] || s.theme));
  chips.push('字体：' + (LABELS.fontMode[s.fontMode] || s.fontMode));
  chips.push('材质：' + (LABELS.material[s.material] || s.material));
  chips.push('字号：' + Math.round(s.fontScale * 100) + '%');
  chips.push('AI 性格：' + (LABELS.aiPersona[s.aiPersona] || s.aiPersona));
  chips.push('报毒识别提醒：' + (LABELS.remindMode[s.remindMode] || s.remindMode));
  chips.push('Max 模式：' + (s.aiMaxMode ? '开' : '关'));
  if (!s.aiMaxMode) chips.push('云端增强：' + (s.cloudEnhance ? '开' : '关'));
  const box = $('summary');
  box.innerHTML = '';
  chips.forEach((t) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = t;
    box.appendChild(c);
  });
}

/* ---------- 完成 / 跳过 ---------- */
function finish() {
  const patch = Object.assign({}, selections, { oobeDone: true });
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set(patch, () => {
      location.replace(chrome.runtime.getURL('ui/options.html'));
    });
  } else {
    location.replace(chrome.runtime.getURL('ui/options.html'));
  }
}
function skipStep() {
  if (current === TOTAL) { finish(); return; }
  (STEP_FIELDS[current] || []).forEach((f) => { selections[f] = DEFAULTS[f]; });
  syncUI(); applyPreview();
  showStep(current + 1);
}

/* ---------- 事件绑定 ---------- */
function bind() {
  // 分段 / 网格字段点击
  document.querySelectorAll('[data-field]').forEach((group) => {
    const field = group.dataset.field;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-val]');
      if (!btn) return;
      group.querySelectorAll('button[data-val]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (group.classList.contains('seg')) positionGlider(group);
      setField(field, btn.dataset.val);
    });
  });
  // 字号滑块
  const fs = $('fontScale');
  if (fs) fs.addEventListener('input', () => setField('fontScale', fs.value));
  // 欢迎页「开始设置」
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => showStep(current + 1)));
  // 底部导航
  $('nextBtn').addEventListener('click', () => { if (current < TOTAL) showStep(current + 1); else finish(); });
  $('prevBtn').addEventListener('click', () => { if (current > 0) showStep(current - 1); });
  $('skipStep').addEventListener('click', skipStep);
  $('skipAll').addEventListener('click', () => { selections = Object.assign({}, DEFAULTS); finish(); });
  // 侧栏步骤可点击回跳已访问过的步骤
  document.querySelectorAll('.stp').forEach((d) => {
    d.addEventListener('click', () => {
      const i = Number(d.dataset.step);
      if (i <= maxVisited) showStep(i);
    });
  });
  // 窗口尺寸变化重定位滑动药丸
  window.addEventListener('resize', () => {
    const pane = document.querySelector('.pane[data-pane="' + current + '"]');
    if (pane) pane.querySelectorAll('.seg').forEach(positionGlider);
  });
}

/* ---------- 字段错峰延迟（统一控制，避免 CSS nth-of-type 在嵌套结构下错位） ---------- */
function staggerFields() {
  document.querySelectorAll('.pane .field').forEach((el, i) => {
    el.style.animationDelay = (0.05 + (i % 3) * 0.07).toFixed(2) + 's';
  });
}

/* ---------- 启动 ---------- */
function init() {
  staggerFields();
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      selections = Object.assign({}, DEFAULTS, s || {});
      bind();
      syncUI();
      applyPreview();
      const link = $('introLink');
      if (link) link.href = chrome.runtime.getURL('ui/welcome.html');
      showStep(0);
    });
  } else {
    bind(); syncUI(); applyPreview(); showStep(0);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
