/* options.js — 银狐防护设置控制面板逻辑（侧边栏分类版） */
'use strict';

// 360 系统急救箱官方下载直链（绿色版，无需安装）。360 更新版本后此链接可能变动，
// 届时改这里即可，设置页「银狐急救」卡片会同步展示最新直链。
const RESCUE_DOWNLOAD_URL = 'https://dl.360safe.com/360c0mpkill_5.1.64.1289-0701.zip';

// （银狐系统解锁工具已停止维护并下架，此处不再提供下载入口。）

const DEFAULTS = {
  enabledGlobal: true,
  showWarning: true,
  autoBlockDownloads: true,
  notify: true,
  icpApiVerify: true,   // ICP 备案权威核验（只发域名给公开备案接口，且仅在核验有价值时发起）
  sensitivity: 'medium',
  fontMode: 'system',   // 'system' | 'smiley'
  theme: 'dark',        // 'dark' | 'light'（旧字段，兼容升级；新逻辑以 themePalette + themeLight 为准）
  themePalette: 'classic', // 'classic' | 'gold' | 'neon' | 'mist' | 'space' | 'pixel'(隐藏彩蛋)
  pixelUnlocked: false,   // Pixel 主题为隐藏彩蛋，解锁后才在主题网格显示/生效
  material: 'frosted',  // 'frosted'(磨砂玻璃，默认) | 'liquid'(琉声液态玻璃)；Pixel 主题下强制 frosted
  bgImage: '',          // 自定义背景 dataURL（空=使用主题默认背景）
  aiEnabled: true,      // AI 助手悬浮球开关（默认开启，开箱即用）
  aiApiKey: '',         // 兼容旧字段：智谱 GLM API Key（空则使用内置默认免费 Key）
  aiProvider: 'zhipu',  // 当前选中的模型提供商（zhipu/deepseek/openai/moonshot/custom）
  aiModel: 'glm-4.7-flash', // 当前默认模型名称（自由文本）
  aiKeys: {},           // 各 provider 的 Key：{ zhipu:'', deepseek:'sk-..', ... }（zhipu 留空即用内置免费）
  aiBaseUrls: {},       // 各 provider 的自定义基址（仅 custom 需要）：{ custom:'https://..' }
  aiModelRules: [],     // 场景路由规则：[{ scenario:'fallback'|'settings'|'casual', provider, model }]
  localModelEnabled: true, // AI 本地关键词规则引擎（离线、0 延迟、可开关）
  cloudEnhance: false,      // 允许云端增强兜底（默认关，避免频繁消耗云端额度）
  aiMaxMode: false,         // Max 模式：开启后云端模型优先辅助，自动关闭本地引擎与云端增强开关，仅保留云端 AI 模型辅助；云端处理不了时回退本地
  aiCloudWebAnalyse: false, // 子开关「借助云端AI分析网页」（Max 下，后台自动分析网页）
  aiScanFileAnalyse: false, // 子开关「借助云端AI分析扫描文件」（Max 下，银狐扫描可疑文件时发特征摘要给 AI 辅助研判）
  aiTtsEnabled: false,  // AI 语音播报（微软 Edge 神经语音，免费自然，默认关）
  aiTtsVoice: 'female', // 朗读音色 key：female=晓晓女声 / male=云希男声
  aiPersona: 'balanced',   // AI 助手性格档：'balanced' 均衡 | 'efficient' 高效 | 'gentle' 温柔 | 'pro' 严谨 | 'humorous' 幽默
  remindMode: 'normal',    // 扩展整体报毒识别/提醒偏好：'normal' 正常 | 'quiet' 安静（仅危险告警，不弹软提示卡）
  oobeDone: false,         // 首次引导（OOBE）是否已完成
  fontScale: 1,         // 0.85 ~ 1.40，界面字号缩放系数
  reduceMotion: false,  // 减弱动画效果：关闭全部过渡与动画
  enabled: {
    domainImpersonation: true, icpMissing: true, lowQuality: true,
    execDownload: true, cloudDiskDist: true, obfuscatedJs: true, vmDetection: true,
    socialEngineering: true, fakeOfficial: true, redirectIframe: true, domainStructure: true
  },
  allowlist: [], customKeywords: [], customBadDomains: []
};

function $(id) { return document.getElementById(id); }
// 扩展环境才有 chrome.storage；浏览器直接预览时优雅退回默认值，不影响真实行为
function hasStorage() { return (typeof chrome !== 'undefined') && chrome.storage && chrome.storage.sync; }
function hasStorageLocal() { return (typeof chrome !== 'undefined') && chrome.storage && chrome.storage.local; }
function getSettings() {
  if (!hasStorage()) return Promise.resolve(Object.assign({}, DEFAULTS));
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s || {}))));
}

/* 字号弹性弹簧：用 requestAnimationFrame 逐帧把 --sf-scale 逼近目标值，带明显过冲回弹（弹性十足）。
   拖动时目标实时跟随（跟手不滞后），松手 / 重置 / 切换字体时呈现 Q 弹回弹。 */
let _scCur = 1, _scTar = 1, _scVel = 0, _scRAF = null;
const _scRoot = document.documentElement;
function _scTick() {
  const diff = _scTar - _scCur;
  _scVel += diff * 0.16;   // 刚度
  _scVel *= 0.74;          // 阻尼（<1 即欠阻尼，产生过冲回弹）
  _scCur += _scVel;
  if (Math.abs(diff) < 0.0006 && Math.abs(_scVel) < 0.0006) {
    _scCur = _scTar; _scVel = 0;
    _scRoot.style.setProperty('--sf-scale', _scCur.toFixed(4));
    _scRAF = null;
    return;
  }
  _scRoot.style.setProperty('--sf-scale', _scCur.toFixed(4));
  _scRAF = requestAnimationFrame(_scTick);
}
function setScale(target, instant) {
  _scTar = target;
  if (instant) {
    _scCur = target; _scVel = 0;
    if (_scRAF) { cancelAnimationFrame(_scRAF); _scRAF = null; }
    _scRoot.style.setProperty('--sf-scale', target.toFixed(4));
    return;
  }
  if (!_scRAF) _scRAF = requestAnimationFrame(_scTick);
}

/* 立即把字体/主题偏好应用到当前文档（设置页实时预览） */
function applyAppearance(instant) {
  const root = document.documentElement;
  const activeFont = (document.querySelector('.font-opt.active') || {}).dataset;
  const fontMode = (activeFont && activeFont.font) || 'system';
  const themeLight = ($('themeLight') && $('themeLight').checked) || false;
  // 外观主题：经典保持无额外类（沿用 :root 默认配色）；其余调色板挂对应 html.theme-* 类
  const activeTheme = (document.querySelector('.theme-opt.active') || { dataset: {} }).dataset;
  const palette = (activeTheme && activeTheme.palette) || 'classic';
  // 材质与背景从全局设置缓存读取（init 时写入 window.__sfSettings），保证切换主题时也能正确应用
  const settings = (typeof window !== 'undefined' && window.__sfSettings) || {};
  root.classList.toggle('font-smiley', fontMode === 'smiley');
  root.classList.toggle('theme-light', themeLight);
  root.classList.toggle('theme-gold', palette === 'gold');
  root.classList.toggle('theme-neon', palette === 'neon');
  root.classList.toggle('theme-mist', palette === 'mist');
  root.classList.toggle('theme-space', palette === 'space');
  root.classList.toggle('theme-glass', palette === 'glass');
  root.classList.toggle('theme-pixel', palette === 'pixel');
  // 界面材质：默认磨砂玻璃；琉声液态玻璃仅在非 Pixel 主题下生效（Pixel 锁定磨砂玻璃）
  // 优先读 DOM 当前选中（保证切换即时生效），回退到设置缓存
  const matBtn = (document.querySelector('#materialSeg button.active') || { dataset: {} });
  const material = (matBtn && matBtn.dataset && matBtn.dataset.material) || (settings && settings.material) || 'frosted';
  root.classList.toggle('material-liquid', material === 'liquid' && palette !== 'pixel');
  // 自定义背景：写入 body 固定背景层（Pinned 背景，模糊压暗保证文字可读；Pixel 主题下也生效）
  const bg = (settings && settings.bgImage) || '';
  if (bg) {
    document.body.style.backgroundImage = 'linear-gradient(rgba(8,12,24,.55), rgba(8,12,24,.55)), url(' + bg + ')';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  } else {
    document.body.style.backgroundImage = '';
  }
  // 字号缩放：由「字体大小」滑块控制，作用于全部界面文本。
  // 得意黑(SmileySans)字重偏小，内置 110% 基准系数，使其观感与其他字体一致（这是用户实测的最佳值）。
  const fsEl = $('fontScale');
  const fs = (fsEl && parseFloat(fsEl.value)) || 100;
  let scale = fs / 100;
  if (fontMode === 'smiley') scale *= 1.10;
  // 减弱动画效果开启时，字号缩放也跳过弹簧动画（瞬间到位）
  const reduce = document.documentElement.classList.contains('reduce-motion');
  setScale(scale, instant || reduce);
}

/* 主题切换过场：给 <html> 挂 .theme-anim 一阵子（CSS 收尾后自动移除，避免拖累日常交互） */
function flashThemeAnim() {
  if (document.documentElement.classList.contains('reduce-motion')) return;
  const root = document.documentElement;
  root.classList.add('theme-anim');
  clearTimeout(window.__themeAnimT);
  window.__themeAnimT = setTimeout(function () { root.classList.remove('theme-anim'); }, 480);
}

/* 通用跳转：把指定 section 设为可见（用于不在侧边栏分类中的页面，如更新日志） */
function gotoSection(id, title, desc) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.querySelectorAll('.sec').forEach((s) => { s.classList.remove('active'); s.classList.remove('sec-in'); });
  const sec = document.getElementById(id);
  if (sec) {
    sec.classList.add('active');
    void sec.offsetWidth;            // 强制回流，确保入场动画重新触发
    sec.classList.add('sec-in');
  }
  const tt = document.getElementById('secTitle'); if (tt) tt.textContent = title || '';
  const td = document.getElementById('secDesc'); if (td) td.textContent = desc || '';
  const bb = document.getElementById('backBtn'); if (bb) bb.hidden = false;
  window.__sfReturnHub = 'about';
}
function showChangelog() { gotoSection('changelog', '更新日志', 'v1.4.7 · 让 AI 能说更省心'); startChangelogShow(); }

/* 更新日志放映控制：手动翻页优先，3 秒无操作自动翻页（轮播）；任一手动操作重置 3 秒计时 */
var __clState = null;
function startChangelogShow() {
  const show = $('clShow'); if (!show) return;
  const track = $('clTrack'); if (!track) return;
  const slides = Array.prototype.slice.call(track.querySelectorAll('.cl-slide'));
  const dotsWrap = $('clDots');
  const idxEl = $('clIdx');
  const prev = $('clPrev'); const next = $('clNext');
  if (!slides.length) return;
  let idx = 0;
  let timer = null;
  const AUTO_MS = 3000;

  // 进度点
  if (dotsWrap) {
    dotsWrap.innerHTML = '';
    slides.forEach(function (_, i) {
      const d = document.createElement('button');
      d.className = 'dot' + (i === 0 ? ' is-on' : '');
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', '第 ' + (i + 1) + ' 页');
      d.addEventListener('click', function () { go(i, true); });
      dotsWrap.appendChild(d);
    });
  }
  function render() {
    slides.forEach(function (s, i) { s.classList.toggle('is-active', i === idx); });
    if (dotsWrap) Array.prototype.forEach.call(dotsWrap.children, function (d, i) { d.classList.toggle('is-on', i === idx); });
    if (idxEl) idxEl.textContent = String(idx + 1);
    var ring = $('clCount') ? $('clCount').querySelector('.cl-count-ring') : null;
    if (ring) ring.style.setProperty('--p', '0%');
    if (idx === 0) playCover();   // 封面：Gemini 标记旋转淡入 → 文字错峰浮现
  }
  // 封面开场序列（稳定轻量版，沿用 v1.4.6 气质）：标记旋转淡入落定 → 文字错峰浮现；不升空、不诡异再现
  function playCover() {
    var wrap = $('clStarWrap'); var cover = $('clShow') ? $('clShow').querySelector('.cl-cover') : null;
    if (!wrap || !cover) return;
    wrap.classList.remove('cl-cover-play');
    cover.classList.remove('cl-cover-text-in');
    void wrap.offsetWidth; void cover.offsetWidth;
    wrap.classList.add('cl-cover-play');                 // Gemini 标记旋转淡入
    // 标记落定后文字浮现
    setTimeout(function () {
      cover.classList.add('cl-cover-text-in');
    }, 560);
  }
  function tickRing() {
    var ring = $('clCount') ? $('clCount').querySelector('.cl-count-ring') : null;
    if (!ring) return;
    var start = Date.now();
    (function step() {
      if (!__clState || __clState.timer == null) return;
      var p = Math.min(100, ((Date.now() - start) / AUTO_MS) * 100);
      ring.style.setProperty('--p', p + '%');
      if (p < 100 && __clState.timer != null) requestAnimationFrame(step);
    })();
  }
  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (__clState) __clState.timer = null;
    timer = setTimeout(function () { go(idx + 1, false); }, AUTO_MS);
    if (__clState) __clState.timer = timer;
    tickRing();
  }
  function go(n, manual) {
    idx = (n + slides.length) % slides.length;
    render();
    if (manual) schedule();   // 手动操作：重置 3 秒计时，继续自动轮播
    else schedule();          // 自动翻页后继续排下一页
  }
  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (__clState) __clState.timer = null;
  }
  // 绑定
  if (prev) prev.addEventListener('click', function () { go(idx - 1, true); });
  if (next) next.addEventListener('click', function () { go(idx + 1, true); });
  show.__clGo = go; show.__clStop = stop;
  // 键盘：仅在更新日志 section 可见时响应
  function onKey(e) {
    var sec = $('changelog');
    if (!sec || !sec.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(idx + 1, true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(idx - 1, true); e.preventDefault(); }
    else if (e.key === 'Home') { go(0, true); e.preventDefault(); }
    else if (e.key === 'End') { go(slides.length - 1, true); e.preventDefault(); }
  }
  document.removeEventListener('keydown', onKey);
  document.addEventListener('keydown', onKey);
  show.__clKey = onKey;
  // 初始化
  __clState = { timer: null };
  render();
  schedule();
}
function stopChangelogShow() {
  var show = $('clShow');
  if (show && show.__clStop) show.__clStop();
  if (show && show.__clKey) { document.removeEventListener('keydown', show.__clKey); }
  __clState = null;
}

/* Pixel 主题彩蛋：默认在主题网格隐藏；连点左上角标志 3 下 → 口令框；口令正确则解锁并显示/应用该主题。
   口令本身不出现在任何界面文案，仅以「Google 类原生安卓英文名」作暗示。 */
function setupPixelEgg() {
  const brand = $('brandEgg');
  const overlay = $('eggOverlay');
  const input = $('eggInput');
  const okEl = $('eggOk');
  const confirmBtn = $('eggConfirm');
  const cancelBtn = $('eggCancel');
  if (!brand || !overlay || !input) return;

  const KEYWORD = 'pixel';
  let clicks = 0, clickT = null;

  function openEgg() {
    overlay.classList.add('show');
    input.value = '';
    input.classList.remove('err');
    okEl.classList.remove('show');
    setTimeout(() => input.focus(), 60);
  }
  function closeEgg() { overlay.classList.remove('show'); }

  function tryUnlock() {
    if ((input.value || '').trim().toLowerCase() === KEYWORD) {
      document.documentElement.classList.add('pixel-unlocked');
      okEl.classList.add('show');
      if (hasStorage()) chrome.storage.sync.set({ pixelUnlocked: true });
      const opt = document.querySelector('.theme-opt[data-palette="pixel"]');
      if (opt) {
        document.querySelectorAll('.theme-opt').forEach((x) => x.classList.remove('active'));
        opt.classList.add('active');
        const tc = $('themeCurrent'); if (tc) tc.textContent = (opt.querySelector('.theme-name') || {}).textContent || 'Pixel';
        applyAppearance();
        flashThemeAnim();
        if (hasStorage()) chrome.storage.sync.set({ themePalette: 'pixel' });
      }
      setTimeout(closeEgg, 700);
    } else {
      input.classList.add('err');
      input.value = '';
      setTimeout(() => input.classList.remove('err'), 360);
    }
  }

  brand.addEventListener('click', () => {
    const now = Date.now();
    if (!clickT || now - clickT > 1200) clicks = 0;
    clickT = now; clicks++;
    if (clicks >= 3) { clicks = 0; openEgg(); }
  });
  brand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); brand.click(); }
  });
  confirmBtn && confirmBtn.addEventListener('click', tryUnlock);
  cancelBtn && cancelBtn.addEventListener('click', closeEgg);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEgg(); });
}

/* 扩展自动更新提示：仅「版本升级」时弹出；首次安装与降级均不弹（修复误弹 bug） */
function setupUpdateToast() {
  const box = $('updToast');
  const close = $('updClose');
  const link = $('updLink');
  if (!box) return;

  function hide() {
    box.classList.add('is-hiding');
    setTimeout(() => { box.hidden = true; box.classList.remove('is-hiding'); }, 280);
  }
  if (close) close.addEventListener('click', hide);
  if (link) link.addEventListener('click', (e) => {
    e.preventDefault();
    hide();
    showChangelog();   // 跳转到更新日志 section（不在侧边栏分类中）
  });

  let curVer = '0';
  try { curVer = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '0'; } catch (e) {}
  const vt = $('updVer'); if (vt) vt.textContent = 'v' + curVer;

  if (!hasStorage()) return;   // 非扩展环境（直接预览）不弹，避免误报
  chrome.storage.local.get({ sfLastVer: '' }, (r) => {
    const last = r.sfLastVer || '';
    if (!last) {
      // 首次安装：记下当前版本，不弹「更新成功」
      chrome.storage.local.set({ sfLastVer: curVer });
      return;
    }
    if (cmpVer(last, curVer) < 0) {
      // 升级：弹出更新成功，并写回新版本
      chrome.storage.local.set({ sfLastVer: curVer });
      setTimeout(() => { box.hidden = false; }, 900);
    }
    // 相等或降级：不弹
  });
}

/* 读取打包内的 sponsors.json 显示鸣谢名单（无名单则隐藏区块） */
function renderSponsors() {
  const wrap = $('sponsorList');
  const ul = $('sponsorNames');
  if (!wrap || !ul) return;
  if (!chrome.runtime || !chrome.runtime.getURL) { wrap.hidden = true; return; }
  fetch(chrome.runtime.getURL('sponsors.json'))
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      if (!Array.isArray(list) || !list.length) { wrap.hidden = true; return; }
      ul.textContent = '';
      list.forEach(function (s) {
        const name = (typeof s === 'string') ? s : (s && s.name) || '';
        if (!name) return;
        const li = document.createElement('li');
        li.textContent = name;   // 用 textContent 防 XSS，名单即使被改也只是纯文本
        ul.appendChild(li);
      });
      wrap.hidden = false;
    })
    .catch(function () { wrap.hidden = true; });
}

/* 版本号比较：a<b 返回 -1，a>b 返回 1，相等返回 0（逢11进一规则下逐段比较即可） */
function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/* 侧边栏导航：点击分类切换右侧内容，并更新标题/描述 */
function setupNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const secTitle = $('secTitle');
  const secDesc = $('secDesc');

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const target = item.dataset.target;
      navItems.forEach((n) => n.classList.toggle('active', n === item));
      document.querySelectorAll('.sec').forEach((s) => { s.classList.remove('active'); s.classList.remove('sec-in'); });
      const targetSec = document.getElementById(target);
      if (targetSec) {
        targetSec.classList.add('active');
        void targetSec.offsetWidth;            // 强制回流，确保入场动画重新触发
        targetSec.classList.add('sec-in');
      }
      secTitle.textContent = item.dataset.title || '';
      secDesc.textContent = item.dataset.desc || '';
      const bb = $('backBtn'); if (bb) bb.hidden = true;   // 切到一级分类时退出子页面
    });

    // 鼠标悬停追踪光晕
    item.addEventListener('mousemove', (e) => {
      const r = item.getBoundingClientRect();
      item.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      item.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
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
  $('notify').checked = !!settings.notify;
  if ($('icpApiVerify')) $('icpApiVerify').checked = settings.icpApiVerify !== false;

  // 灵敏度分段（带滑动药丸动画）
  const seg = $('sensitivity');
  function updateSegGlider() {
    const active = seg.querySelector('button.active') || seg.querySelector('button');
    const glider = seg.querySelector('.seg-glider');
    if (!active || !glider) return;
    const segRect = seg.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();
    glider.style.width = btnRect.width + 'px';
    glider.style.transform = `translateX(${btnRect.left - segRect.left}px)`;
  }
  seg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === settings.sensitivity);
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      updateSegGlider();
      // 同步缓存，确保 AI 改过灵敏度后用户手动改、再保存时缓存与 DOM 一致
      if (window.__sfSettings) window.__sfSettings.sensitivity = b.dataset.v;
    });
  });
  // 初始化与窗口变化时重新定位（延迟等待字体/缩放渲染）
  requestAnimationFrame(updateSegGlider);
  let segResizeTimer;
  window.addEventListener('resize', () => { clearTimeout(segResizeTimer); segResizeTimer = setTimeout(updateSegGlider, 100); });

  $('allowlist').value = (settings.allowlist || []).join('\n');
  $('customKeywords').value = (settings.customKeywords || []).join('\n');
  $('customBadDomains').value = (settings.customBadDomains || []).join('\n');

  // 个性化：字体 + 深浅色（即时保存 + 实时预览）
  const fontOpts = document.querySelectorAll('.font-opt');
  const fold = document.getElementById('fontFold');
  fontOpts.forEach((b) => {
    b.classList.toggle('active', (b.dataset.font || 'system') === settings.fontMode);
    b.addEventListener('click', () => {
      fontOpts.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      applyAppearance();
      if (hasStorage()) chrome.storage.sync.set({ fontMode: b.dataset.font });
      if (fold) fold.removeAttribute('open');   // 选中后自动收起折叠列表
    });
  });

  const themeSw = $('themeLight');
  if (themeSw) {
    themeSw.checked = settings.theme === 'light';
    themeSw.addEventListener('change', (e) => {
      if (hasStorage()) chrome.storage.sync.set({ theme: e.target.checked ? 'light' : 'dark' });
      applyAppearance();
    });
  }

  // 外观主题：色卡选择（即时保存 + 实时预览）。经典=默认主题，不挂额外类。
  const themeGrid = $('themeGrid');
  const themeOpts = document.querySelectorAll('.theme-opt');
  const themeCurrent = $('themeCurrent');
  function refreshThemeCurrent() {
    if (!themeCurrent) return;
    const active = document.querySelector('.theme-opt.active');
    const name = active ? ((active.querySelector('.theme-name') || {}).textContent || '经典') : '经典';
    themeCurrent.textContent = name;
  }
  if (themeGrid) {
    const pal = settings.themePalette || 'classic';
    themeOpts.forEach((b) => b.classList.toggle('active', (b.dataset.palette || 'classic') === pal));
    refreshThemeCurrent();
    themeOpts.forEach((b) => {
      b.addEventListener('click', () => {
        themeOpts.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        refreshThemeCurrent();
        applyAppearance();
        flashThemeAnim();
        if (hasStorage()) chrome.storage.sync.set({ themePalette: b.dataset.palette || 'classic' });
      });
    });
  }

  // 字体大小滑块（实时预览 + 即时保存）
  const fsEl = $('fontScale');
  const fsVal = $('fontScaleVal');
  const fsReset = $('fontScaleReset');
  // 蓝填充：根据当前值计算从左往右的填充比例，驱动滑块轨道的渐变
  function updateSliderFill() {
    if (!fsEl) return;
    const min = parseFloat(fsEl.min), max = parseFloat(fsEl.max), val = parseFloat(fsEl.value);
    const pct = ((val - min) / (max - min)) * 100;
    fsEl.style.setProperty('--pct', pct + '%');
  }
  if (fsEl) {
    const initPct = Math.round((typeof settings.fontScale === 'number' ? settings.fontScale : 1) * 100);
    fsEl.value = initPct;
    if (fsVal) fsVal.textContent = initPct + '%';
    updateSliderFill();
    fsEl.addEventListener('input', () => {
      if (fsVal) fsVal.textContent = fsEl.value + '%';
      updateSliderFill();
      applyAppearance();   // spring 跟手 + 弹性（用户决定保留弹簧动画，滑块手感不再调整）
      if (hasStorage()) chrome.storage.sync.set({ fontScale: parseFloat(fsEl.value) / 100 });
    });
    if (fsReset) {
      fsReset.addEventListener('click', () => {
        fsEl.value = 100;
        if (fsVal) fsVal.textContent = '100%';
        updateSliderFill();
        applyAppearance();   // animate 回弹（弹性十足）
        if (hasStorage()) chrome.storage.sync.set({ fontScale: 1 });
      });
    }
  }

  // 减弱动画效果（默认关闭；开启时弹确认框，确认后全局关闭所有动画，可再次关闭恢复）
  const rmSw = $('reduceMotion');
  const rmModal = $('rmModal');
  const rmConfirm = $('rmConfirm');
  const rmCancel = $('rmCancel');
  function applyReduceMotion(on) {
    document.documentElement.classList.toggle('reduce-motion', on);
  }
  if (rmSw) {
    rmSw.checked = !!settings.reduceMotion;
    applyReduceMotion(rmSw.checked);   // 若此前已开启，首屏即生效
    rmSw.addEventListener('change', (e) => {
      if (e.target.checked) {
        // 用户想把开关打开 → 弹确认提示（取消则保持关闭）
        if (rmModal) rmModal.classList.add('show');
      } else {
        // 关闭：立即恢复全部动画，无需确认
        applyReduceMotion(false);
        if (hasStorage()) chrome.storage.sync.set({ reduceMotion: false });
      }
    });
    if (rmCancel) {
      rmCancel.addEventListener('click', () => {
        if (rmModal) rmModal.classList.remove('show');
        rmSw.checked = false;   // 取消 → 保持关闭
      });
    }
    if (rmConfirm) {
      rmConfirm.addEventListener('click', () => {
        if (rmModal) rmModal.classList.remove('show');
        rmSw.checked = true;
        applyReduceMotion(true);
        applyAppearance();   // 字号缩放瞬间到位（弹簧被减弱动画抑制）
        if (hasStorage()) chrome.storage.sync.set({ reduceMotion: true });
      });
    }
  }

  // 界面材质分段（磨砂玻璃 / 琉声液态玻璃；Pixel 主题下强制磨砂玻璃，不显示切换结果）
  const matSeg = $('materialSeg');
  if (matSeg) {
    const matBtns = matSeg.querySelectorAll('button');
    function refreshMatGlider() {
      const active = matSeg.querySelector('button.active') || matSeg.querySelector('button');
      const glider = matSeg.querySelector('.seg-glider');
      if (!active || !glider) return;
      const segRect = matSeg.getBoundingClientRect();
      const btnRect = active.getBoundingClientRect();
      glider.style.width = btnRect.width + 'px';
      glider.style.transform = `translateX(${btnRect.left - segRect.left}px)`;
    }
    matBtns.forEach((b) => {
      b.classList.toggle('active', (b.dataset.material || 'frosted') === settings.material);
      b.addEventListener('click', () => {
        // Pixel 主题下不允许切换材质
        if (document.documentElement.classList.contains('theme-pixel')) {
          showToast(); return;
        }
        matBtns.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        refreshMatGlider();
        applyAppearance();
        flashThemeAnim();
        if (hasStorage()) chrome.storage.sync.set({ material: b.dataset.material || 'frosted' });
      });
    });
    requestAnimationFrame(refreshMatGlider);
    let matTimer;
    window.addEventListener('resize', () => { clearTimeout(matTimer); matTimer = setTimeout(refreshMatGlider, 100); });
  }

  // 自定义背景：上传 / 预览 / 清除
  const bgBtn = $('bgUploadBtn');
  const bgFile = $('bgFile');
  const bgPrev = $('bgPreview');
  const bgClear = $('bgClearBtn');
  function showBgThumb(dataUrl) {
    if (!bgPrev) return;
    if (dataUrl) { bgPrev.style.backgroundImage = 'url(' + dataUrl + ')'; bgPrev.hidden = false; if (bgClear) bgClear.hidden = false; }
    else { bgPrev.hidden = true; bgPrev.style.backgroundImage = ''; if (bgClear) bgClear.hidden = true; }
  }
  if (bgBtn && bgFile) {
    bgBtn.addEventListener('click', () => bgFile.click());
    bgFile.addEventListener('change', () => {
      const f = bgFile.files && bgFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        // 压缩：限制最长边 1280px、质量 0.82，避免 dataURL 过大撑爆 storage
        const img = new Image();
        img.onload = () => {
          const max = 1280;
          let { width: w, height: h } = img;
          if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = cv.toDataURL('image/jpeg', 0.82);
          if (hasStorage()) chrome.storage.local.set({ sfBgImage: dataUrl });
          if (window.__sfSettings) window.__sfSettings.bgImage = dataUrl;
          showBgThumb(dataUrl);
          applyAppearance();
          showToast();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
      bgFile.value = '';
    });
  }
  if (bgClear) {
    bgClear.addEventListener('click', () => {
      if (hasStorage()) chrome.storage.local.remove('sfBgImage');
      if (window.__sfSettings) window.__sfSettings.bgImage = '';
      showBgThumb('');
      applyAppearance();
      showToast();
    });
  }
  showBgThumb(settings.bgImage || '');

  // AI 助手：开关 + 密钥（悬浮球逻辑在 ai.js，这里只管设置项与悬浮球显隐）
  const aiSw = $('aiEnabled');
  if (aiSw) {
    aiSw.checked = !!settings.aiEnabled;
    aiSw.addEventListener('change', (e) => {
      if (hasStorage()) chrome.storage.sync.set({ aiEnabled: e.target.checked });
      if (window.SilverFoxAI) window.SilverFoxAI.setVisible(e.target.checked);
      if (!e.target.checked && window.SilverFoxAI) window.SilverFoxAI.close();
    });
  }
  /* ====== AI 模型选择器：提供商下拉 + 自由输入模型 + 重置默认 + 场景路由规则 ====== */
  const PROVIDER_DEFAULTS = {
    zhipu:    { label: '智谱 GLM（默认免费）', defaultModel: 'glm-4.7-flash', showBaseUrl: false },
    deepseek: { label: 'DeepSeek', defaultModel: 'deepseek-chat', showBaseUrl: false },
    openai:   { label: 'OpenAI 兼容', defaultModel: 'gpt-4o-mini', showBaseUrl: false },
    moonshot: { label: 'Kimi / Moonshot', defaultModel: 'moonshot-v1-8k', showBaseUrl: false },
    custom:   { label: '自定义（OpenAI 兼容）', defaultModel: '', showBaseUrl: true }
  };
  const SCENARIOS = [
    { v: 'fallback', t: '兜底对话（本地未命中）' },
    { v: 'settings', t: '设置 / 操作解答' },
    { v: 'casual', t: '闲聊问候' }
  ];
  const aiProviderPicker = $('aiProviderPicker');
  const aiProviderTrigger = $('aiProviderTrigger');
  const aiProviderPop = $('aiProviderPop');
  const provTriggerIc = $('provTriggerIc');
  const provTriggerLabel = $('provTriggerLabel');
  const aiModel = $('aiModel');
  const aiApiKey = $('aiApiKey');
  const aiBaseUrl = $('aiBaseUrl');
  const aiBaseUrlWrap = $('aiBaseUrlWrap');
  const aiModelHint = $('aiModelHint');
  const aiModelReset = $('aiModelReset');
  const aiKeyToggle = $('aiKeyToggle');
  const aiRules = $('aiRules');
  const aiRuleAdd = $('aiRuleAdd');
  const entryProvIc = $('entryProvIc');
  const entryModelSummary = $('entryModelSummary');

  // provider -> 图标 symbol id（与 options.html 内 <symbol> 对应）
  const PROVIDER_ICON = {
    zhipu: '#prov-zhipu', deepseek: '#prov-deepseek', openai: '#prov-openai',
    moonshot: '#prov-moonshot', custom: '#prov-custom'
  };
  function setUseHref(svgEl, href) { if (svgEl) { const u = svgEl.querySelector('use'); if (u) u.setAttribute('href', href); } }

  // 把当前 UI 里「选中 provider」对应的 key / baseUrl / model 落盘
  let currentProvider = settings.aiProvider || 'zhipu';
  function persistModelState() {
    if (!hasStorage()) return;
    const provider = currentProvider;
    const keys = Object.assign({}, settings.aiKeys || {});
    const baseUrls = Object.assign({}, settings.aiBaseUrls || {});
    if (aiApiKey) keys[provider] = aiApiKey.value.trim();
    if (aiBaseUrl) baseUrls.custom = aiBaseUrl.value.trim();
    chrome.storage.sync.set({
      aiProvider: provider,
      aiModel: aiModel ? aiModel.value.trim() : settings.aiModel,
      aiApiKey: (provider === 'zhipu') ? (aiApiKey ? aiApiKey.value.trim() : '') : (aiApiKey ? aiApiKey.value.trim() : ''),
      aiKeys: keys,
      aiBaseUrls: baseUrls
    });
    // 实时同步给 AI 悬浮球
    if (window.SilverFoxAI && window.SilverFoxAI.setConfig) {
      window.SilverFoxAI.setConfig({
        provider: provider,
        model: aiModel ? aiModel.value.trim() : settings.aiModel,
        keys: keys,
        baseUrls: baseUrls
      });
    }
  }

  // 切换 provider：联动模型占位、密钥、基址可见性（不覆盖用户已自定义且非上一 provider 默认值的模型名）
  function applyProvider(provider, fromUser) {
    currentProvider = provider;
    const def = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
    const prevProvider = settings.aiProvider || 'zhipu';
    const prevDef = (PROVIDER_DEFAULTS[prevProvider] || PROVIDER_DEFAULTS.custom).defaultModel;
    const keys = settings.aiKeys || {};
    const baseUrls = settings.aiBaseUrls || {};
    if (aiModel) {
      const cur = aiModel.value.trim();
      // 仅当模型框为空，或仍是「上一个 provider 的默认模型」时，自动补成新 provider 的默认模型
      if (!cur || cur === prevDef) aiModel.value = def.defaultModel || '';
      aiModel.placeholder = '模型名称，如 ' + (def.defaultModel || 'your-model');
    }
    if (aiApiKey) {
      aiApiKey.value = keys[provider] || '';
      aiApiKey.placeholder = (provider === 'zhipu') ? '留空即用内置免费 Key' : ('填写「' + def.label + '」的 API Key');
    }
    if (aiBaseUrlWrap) aiBaseUrlWrap.hidden = !def.showBaseUrl;
    if (aiBaseUrl) aiBaseUrl.value = baseUrls.custom || '';
    if (aiModelHint) {
      aiModelHint.textContent = (provider === 'zhipu')
        ? '当前：内置免费模型 GLM-4.7-Flash，无需密钥即可使用。'
        : ('当前：' + def.label + (def.defaultModel ? '，默认模型 ' + def.defaultModel : '') + '，需填写自己的 Key。');
    }
    // 触发器显示：图标 + 名称
    setUseHref(provTriggerIc, PROVIDER_ICON[provider] || '#prov-custom');
    if (provTriggerLabel) provTriggerLabel.textContent = def.label;
    // 同步弹层选中态
    if (aiProviderPop) {
      aiProviderPop.querySelectorAll('.prov-opt').forEach((el) => {
        el.classList.toggle('sel', el.dataset.provider === provider);
      });
    }
    settings.aiProvider = provider;
    updateEntrySummary();
    persistModelState();
    // 实时同步给 AI 悬浮球，避免「切换别家模型仍是免费模型」
    if (window.SilverFoxAI && window.SilverFoxAI.setConfig) {
      window.SilverFoxAI.setConfig({
        provider: provider,
        model: aiModel ? aiModel.value.trim() : settings.aiModel,
        keys: settings.aiKeys || {},
        baseUrls: settings.aiBaseUrls || {}
      });
    }
  }

  // 渲染提供商下拉弹层（带图标）
  function renderProviderPop() {
    if (!aiProviderPop) return;
    aiProviderPop.innerHTML = '';
    Object.keys(PROVIDER_DEFAULTS).forEach((k) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'prov-opt' + (k === currentProvider ? ' sel' : '');
      item.dataset.provider = k;
      item.setAttribute('role', 'option');
      const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ic.setAttribute('class', 'prov-ic');
      const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      u.setAttribute('href', PROVIDER_ICON[k] || '#prov-custom');
      ic.appendChild(u);
      const lab = document.createElement('span');
      lab.className = 'prov-opt-label';
      lab.textContent = PROVIDER_DEFAULTS[k].label;
      item.appendChild(ic); item.appendChild(lab);
      item.addEventListener('click', () => {
        applyProvider(k, true);
        closeProviderPop();
      });
      aiProviderPop.appendChild(item);
    });
  }
  function openProviderPop() { if (aiProviderPop) { renderProviderPop(); aiProviderPop.hidden = false; aiProviderPicker.classList.add('open'); } }
  function closeProviderPop() { if (aiProviderPop) { aiProviderPop.hidden = true; aiProviderPicker.classList.remove('open'); } }

  function updateEntrySummary() {
    const def = PROVIDER_DEFAULTS[currentProvider] || PROVIDER_DEFAULTS.custom;
    const model = (aiModel && aiModel.value.trim()) || def.defaultModel || '（未指定）';
    const free = currentProvider === 'zhipu';
    if (entryProvIc) setUseHref(entryProvIc, PROVIDER_ICON[currentProvider] || '#prov-custom');
    if (entryModelSummary) {
      entryModelSummary.textContent = '默认模型：' + def.label + ' · ' + model + (free ? '（内置免费）' : '（需自带 Key）');
    }
  }

  // 初始填充 + 绑定（自定义下拉）
  if (aiProviderTrigger) {
    applyProvider(settings.aiProvider || 'zhipu', false);
    aiProviderTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (aiProviderPop && aiProviderPop.hidden) openProviderPop(); else closeProviderPop();
    });
    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (aiProviderPicker && !aiProviderPicker.contains(e.target)) closeProviderPop();
    });
  }
  if (aiModel) aiModel.addEventListener('input', () => { updateEntrySummary(); persistModelState(); });
  if (aiApiKey) aiApiKey.addEventListener('input', persistModelState);
  if (aiBaseUrl) aiBaseUrl.addEventListener('input', persistModelState);

  // 重置默认：恢复内置免费模型（智谱 GLM-4.7-Flash），清空自定义 Key / 基址
  if (aiModelReset) {
    aiModelReset.addEventListener('click', () => {
      applyProvider('zhipu', true);
      if (aiModel) { aiModel.value = 'glm-4.7-flash'; aiModel.placeholder = '模型名称，如 glm-4.7-flash'; }
      if (aiApiKey) { aiApiKey.value = ''; aiApiKey.placeholder = '留空即用内置免费 Key'; }
      if (aiBaseUrlWrap) aiBaseUrlWrap.hidden = true;
      if (aiBaseUrl) aiBaseUrl.value = '';
      if (aiModelHint) aiModelHint.textContent = '已恢复默认：内置免费模型 GLM-4.7-Flash，无需密钥即可使用。';
      if (hasStorage()) {
        const keys = Object.assign({}, settings.aiKeys || {});
        delete keys.zhipu;
        chrome.storage.sync.set({ aiProvider: 'zhipu', aiModel: 'glm-4.7-flash', aiKeys: keys, aiBaseUrls: {} });
        settings.aiProvider = 'zhipu';
        settings.aiModel = 'glm-4.7-flash';
        settings.aiKeys = keys;
        settings.aiBaseUrls = {};
      }
      updateEntrySummary();
      showToast();
    });
  }
  if (aiKeyToggle && aiApiKey) {
    aiKeyToggle.addEventListener('click', () => {
      const showing = aiApiKey.type === 'text';
      aiApiKey.type = showing ? 'password' : 'text';
      aiKeyToggle.textContent = showing ? '显示' : '隐藏';
    });
  }

  // 场景路由规则：动态渲染 + 增删（每行前面带提供商图标）
  function renderRuleRow(rule, idx) {
    const row = document.createElement('div');
    row.className = 'ai-rule';
    // 行首提供商图标
    const rowIc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    rowIc.setAttribute('class', 'prov-ic rule-prov-ic');
    const rowUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    rowUse.setAttribute('href', PROVIDER_ICON[(rule && rule.provider) || 'zhipu']);
    rowIc.appendChild(rowUse);
    row.appendChild(rowIc);

    const scen = document.createElement('select');
    scen.className = 'sf-select rule-scenario';
    SCENARIOS.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.v; o.textContent = s.t;
      if (rule && rule.scenario === s.v) o.selected = true;
      scen.appendChild(o);
    });
    // 自定义 provider 下拉（带图标）
    const provPicker = document.createElement('div');
    provPicker.className = 'ai-prov-picker rule-prov-picker';
    const provTrigger = document.createElement('button');
    provTrigger.type = 'button';
    provTrigger.className = 'prov-trigger sf-select rule-prov-trigger';
    const pIc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pIc.setAttribute('class', 'prov-ic');
    const pUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    pUse.setAttribute('href', PROVIDER_ICON[(rule && rule.provider) || 'zhipu']);
    pIc.appendChild(pUse);
    const pLab = document.createElement('span');
    pLab.className = 'prov-label';
    pLab.textContent = (PROVIDER_DEFAULTS[(rule && rule.provider) || 'zhipu'] || PROVIDER_DEFAULTS.custom).label;
    const pCaret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pCaret.setAttribute('class', 'prov-caret');
    pCaret.setAttribute('viewBox', '0 0 12 12');
    pCaret.innerHTML = '<path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
    provTrigger.appendChild(pIc); provTrigger.appendChild(pLab); provTrigger.appendChild(pCaret);
    const provPop = document.createElement('div');
    provPop.className = 'prov-pop';
    provPop.hidden = true;
    provPicker.appendChild(provTrigger); provPicker.appendChild(provPop);

    const model = document.createElement('input');
    model.className = 'sf-input rule-model';
    model.placeholder = '模型名称，如 glm-4.7-flash';
    model.value = (rule && rule.model) || '';
    model.spellcheck = false;
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn btn-ghost rule-del'; del.textContent = '删除';

    // provider 弹层渲染
    function renderRuleProvPop() {
      provPop.innerHTML = '';
      Object.keys(PROVIDER_DEFAULTS).forEach((k) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'prov-opt' + (k === ((rule && rule.provider) || 'zhipu') ? ' sel' : '');
        item.dataset.provider = k;
        const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ic.setAttribute('class', 'prov-ic');
        const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        u.setAttribute('href', PROVIDER_ICON[k] || '#prov-custom');
        ic.appendChild(u);
        const lab = document.createElement('span');
        lab.className = 'prov-opt-label';
        lab.textContent = PROVIDER_DEFAULTS[k].label;
        item.appendChild(ic); item.appendChild(lab);
        item.addEventListener('click', () => {
          if (rule) rule.provider = k;
          pUse.setAttribute('href', PROVIDER_ICON[k] || '#prov-custom');
          rowUse.setAttribute('href', PROVIDER_ICON[k] || '#prov-custom');
          pLab.textContent = PROVIDER_DEFAULTS[k].label;
          provPop.querySelectorAll('.prov-opt').forEach((x) => x.classList.toggle('sel', x.dataset.provider === k));
          closeRuleProvPop();
          collectAndSaveRules();
        });
        provPop.appendChild(item);
      });
    }
    function openRuleProvPop() { renderRuleProvPop(); provPop.hidden = false; provPicker.classList.add('open'); }
    function closeRuleProvPop() {
      if (!provPop || provPop.hidden) return;
      provPop.hidden = true; provPicker.classList.remove('open');
      document.removeEventListener('click', onRuleProvOutside);
      document.removeEventListener('keydown', onRuleProvEsc);
    }
    function onRuleProvOutside(e) { if (!provPicker.contains(e.target)) closeRuleProvPop(); }
    function onRuleProvEsc(e) { if (e.key === 'Escape') closeRuleProvPop(); }
    provTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (provPop.hidden) {
        // 先关掉其他可能展开的规则行弹层，避免多个同时开着
        document.querySelectorAll('.rule-prov-picker.open').forEach((p) => {
          if (p !== provPicker) { p.classList.remove('open'); const pp = p.querySelector('.prov-pop'); if (pp) pp.hidden = true; }
        });
        openRuleProvPop();
        // 延迟到下一帧再挂全局监听，避免本次 click 立即触发 outside 关闭
        setTimeout(() => {
          document.addEventListener('click', onRuleProvOutside);
          document.addEventListener('keydown', onRuleProvEsc);
        }, 0);
      } else {
        closeRuleProvPop();
      }
    });

    [scen, model].forEach((el) => el.addEventListener('change', collectAndSaveRules));
    model.addEventListener('input', collectAndSaveRules);
    del.addEventListener('click', () => { closeRuleProvPop(); row.remove(); collectAndSaveRules(); });
    row.appendChild(scen); row.appendChild(provPicker); row.appendChild(model); row.appendChild(del);
    return row;
  }
  function collectAndSaveRules() {
    const rules = [];
    if (aiRules) {
      aiRules.querySelectorAll('.ai-rule').forEach((row) => {
        const scenario = row.querySelector('.rule-scenario').value;
        const provOpt = row.querySelector('.rule-prov-picker .prov-opt.sel');
        const provider = (provOpt && provOpt.dataset.provider) || 'zhipu';
        const model = row.querySelector('.rule-model').value.trim();
        if (model) rules.push({ scenario: scenario, provider: provider, model: model });
      });
    }
    settings.aiModelRules = rules;
    if (hasStorage()) chrome.storage.sync.set({ aiModelRules: rules });
  }
  if (aiRules) {
    (settings.aiModelRules || []).forEach((r) => aiRules.appendChild(renderRuleRow(r)));
  }
  if (aiRuleAdd) {
    aiRuleAdd.addEventListener('click', () => {
      if (!aiRules) return;
      const existing = Array.from(aiRules.querySelectorAll('.rule-scenario')).map((s) => s.value);
      const next = SCENARIOS.find((s) => !existing.includes(s.v)) || SCENARIOS[0];
      const row = renderRuleRow({ scenario: next.v, provider: 'zhipu', model: '' });
      aiRules.appendChild(row);
      collectAndSaveRules();
    });
  }

  const localMdl = $('localModelEnabled');
  if (localMdl) {
    localMdl.checked = settings.localModelEnabled !== false;
    localMdl.addEventListener('change', (e) => {
      if (hasStorage()) chrome.storage.sync.set({ localModelEnabled: e.target.checked });
    });
  }
  const cloudEnh = $('cloudEnhance');
  if (cloudEnh) {
    cloudEnh.checked = settings.cloudEnhance === true;
    cloudEnh.addEventListener('change', (e) => {
      if (hasStorage()) chrome.storage.sync.set({ cloudEnhance: e.target.checked });
    });
  }
  // Max 模式：开启后自动关闭本地引擎与云端增强，仅保留云端 AI 模型辅助；关闭则恢复本地引擎默认开
  const maxMode = $('aiMaxMode');
  const maxSub = $('maxModeSub');
  const maxModal = $('maxModal');
  const maxConfirm = $('maxConfirm');
  const maxCancel = $('maxCancel');
  const cw = $('aiCloudWebAnalyse');
  const sf = $('aiScanFileAnalyse');
  const maxModeFileSub = $('maxModeFileSub');
  const applyMaxMode = (on) => {
    if (maxSub) maxSub.classList.toggle('collapsed', !on);   // 用 class 控制显隐，带非线性过渡动画
    if (maxModeFileSub) maxModeFileSub.classList.toggle('collapsed', !on);
    if (on) {
      if (localMdl) { localMdl.checked = false; if (hasStorage()) chrome.storage.sync.set({ localModelEnabled: false }); }
      if (cloudEnh) { cloudEnh.checked = false; if (hasStorage()) chrome.storage.sync.set({ cloudEnhance: false }); }
    } else {
      // 关闭 Max：子开关强制关 + 隐藏
      if (cw) { cw.checked = false; if (hasStorage()) chrome.storage.sync.set({ aiCloudWebAnalyse: false }); }
      if (sf) { sf.checked = false; if (hasStorage()) chrome.storage.sync.set({ aiScanFileAnalyse: false }); }
      if (localMdl) { localMdl.checked = true; if (hasStorage()) chrome.storage.sync.set({ localModelEnabled: true }); }
    }
    if (window.__sfSettings) window.__sfSettings.localModelEnabled = !on;
    if (window.__sfSettings) window.__sfSettings.cloudEnhance = false;
    if (window.__sfSettings) window.__sfSettings.aiCloudWebAnalyse = on && !!(cw && cw.checked);
    if (window.__sfSettings) window.__sfSettings.aiScanFileAnalyse = on && !!(sf && sf.checked);
    if (window.SilverFoxAI) window.SilverFoxAI.setConfig({
      maxMode: on,
      localModelEnabled: !on,
      cloudEnhance: false,
      cloudWebAnalyse: on && !!(cw && cw.checked)
    });
  };
  if (cw) {
    cw.checked = settings.aiCloudWebAnalyse === true;
    cw.addEventListener('change', (e) => {
      const on = e.target.checked;
      if (hasStorage()) chrome.storage.sync.set({ aiCloudWebAnalyse: on });
      if (window.__sfSettings) window.__sfSettings.aiCloudWebAnalyse = on;
      if (window.SilverFoxAI) window.SilverFoxAI.setConfig({ cloudWebAnalyse: on });
    });
  }
  if (sf) {
    sf.checked = settings.aiScanFileAnalyse === true;
    sf.addEventListener('change', (e) => {
      const on = e.target.checked;
      if (hasStorage()) chrome.storage.sync.set({ aiScanFileAnalyse: on });
      if (window.__sfSettings) window.__sfSettings.aiScanFileAnalyse = on;
    });
  }
  if (maxMode) {
    maxMode.checked = settings.aiMaxMode === true;
    if (maxSub) maxSub.classList.toggle('collapsed', !(settings.aiMaxMode === true));
    if (maxModeFileSub) maxModeFileSub.classList.toggle('collapsed', !(settings.aiMaxMode === true));
    maxMode.addEventListener('change', (e) => {
      if (e.target.checked) {
        // 开启 → 先弹确认框（提示可能增加 token 消耗），确认才真正开启，取消则回退开关
        if (maxModal) maxModal.classList.add('show');
      } else {
        // 关闭 → 直接生效，无需确认
        if (hasStorage()) chrome.storage.sync.set({ aiMaxMode: false });
        if (window.__sfSettings) window.__sfSettings.aiMaxMode = false;
        applyMaxMode(false);
      }
    });
    if (maxCancel) {
      maxCancel.addEventListener('click', () => {
        if (maxModal) maxModal.classList.remove('show');
        maxMode.checked = false;   // 取消 → 保持关闭
      });
    }
    if (maxConfirm) {
      maxConfirm.addEventListener('click', () => {
        if (maxModal) maxModal.classList.remove('show');
        maxMode.checked = true;
        if (hasStorage()) chrome.storage.sync.set({ aiMaxMode: true });
        if (window.__sfSettings) window.__sfSettings.aiMaxMode = true;
        applyMaxMode(true);
      });
    }
  }

  // AI 语音播报（免费 TTS）：默认关闭；开启后可在音色列表选择并试听，AI 回复时朗读
  const ttsEn = $('aiTtsEnabled');
  const ttsSub = $('ttsSub');
  const ttsVoice = $('ttsVoice');
  const ttsPreview = $('ttsPreview');

  // 仅两个精挑音色：女生（晓晓）/ 男生（云希），与 ai.js 的 TTS_VOICES 对应
  function populateTtsVoices() {
    if (!ttsVoice) return;
    ttsVoice.innerHTML = '';
    const items = [
      { value: 'female', text: '女生 · 晓晓（温柔自然）' },
      { value: 'male', text: '男生 · 云希（清亮自然）' }
    ];
    items.forEach((it) => {
      const o = document.createElement('option');
      o.value = it.value; o.textContent = it.text;
      ttsVoice.appendChild(o);
    });
    const saved = (window.__sfSettings && window.__sfSettings.aiTtsVoice) || 'female';
    ttsVoice.value = ['female', 'male'].indexOf(saved) !== -1 ? saved : 'female';
  }
  // 试听走 Edge 神经语音（与 ai.js 同源），返回 MP3 Blob URL 后播放
  function previewTts(voiceKey) {
    if (!(window.SilverFoxAI && window.SilverFoxAI.previewTTS)) return;
    if (ttsPreview) { ttsPreview.disabled = true; ttsPreview.textContent = '合成中…'; }
    window.SilverFoxAI.previewTTS(voiceKey).then((url) => {
      if (!url) return;
      const a = new Audio(); a.src = url;
      a.play().catch(() => {});
      a.onended = () => { try { URL.revokeObjectURL(url); } catch (e) {} };
    }).catch((err) => {
      // 失败不再静默：在按钮上短暂显示原因，便于区分「GEC 过期 / 连接被拒 / 网络不通」
      const msg = (err && err.message) || String(err || '未知错误');
      const hint = msg.indexOf('403') !== -1 ? 'GEC版本过期'
        : msg.indexOf('close code') !== -1 ? '连接被拒'
        : msg.indexOf('connect error') !== -1 ? '连不上服务'
        : '网络/服务';
      if (ttsPreview) { ttsPreview.textContent = '失败：' + hint; }
      console.warn('[银狐] TTS 试听失败：', msg);
    }).finally(() => {
      if (ttsPreview) setTimeout(() => { ttsPreview.disabled = false; ttsPreview.textContent = '试听'; }, 2200);
    });
  }

  if (ttsEn) {
    ttsEn.checked = settings.aiTtsEnabled === true;
    if (ttsSub) ttsSub.classList.toggle('collapsed', !ttsEn.checked);
    ttsEn.addEventListener('change', (e) => {
      const on = e.target.checked;
      if (hasStorage()) chrome.storage.sync.set({ aiTtsEnabled: on });
      if (window.__sfSettings) window.__sfSettings.aiTtsEnabled = on;
      if (ttsSub) ttsSub.classList.toggle('collapsed', !on);
      if (window.SilverFoxAI) window.SilverFoxAI.setConfig({ ttsEnabled: on });
    });
  }
  if (ttsVoice) {
    ttsVoice.addEventListener('change', (e) => {
      const v = e.target.value;
      if (hasStorage()) chrome.storage.sync.set({ aiTtsVoice: v });
      if (window.__sfSettings) window.__sfSettings.aiTtsVoice = v;
      if (window.SilverFoxAI) window.SilverFoxAI.setConfig({ ttsVoice: v });
    });
  }
  if (ttsPreview) {
    ttsPreview.addEventListener('click', () => { previewTts(ttsVoice ? ttsVoice.value : ''); });
  }
  populateTtsVoices();

  // 首屏按已存偏好即时渲染（instant，避免加载瞬间"弹一下"）；后续交互动画由 JS spring 接管
  applyAppearance(true);
}

function updateMasterPill(on) {
  const p = $('masterPill');
  if (!p) return;
  p.textContent = on ? '防护中' : '已关闭';
  p.className = 'mini-pill ' + (on ? 'on' : 'off');
}

// 「银狐急救」分类：展示官方直链 + 点击按钮直接下载 360 系统急救箱
/* 下钻导航：枢纽页卡片 → 独立子页面，返回时回到来源枢纽页（规则白名单 + 个性化主题共用） */
function setupSubNav() {
  const backBtn = $('backBtn');
  const secTitle = $('secTitle');
  const secDesc = $('secDesc');
  let returnHubId = 'rules';

  document.querySelectorAll('[data-sub]').forEach((card) => {
    card.addEventListener('click', () => {
      const sub = $(card.dataset.sub);
      if (!sub) return;
      const hubSec = card.closest('.sec');
      returnHubId = hubSec ? hubSec.id : 'rules';
      document.querySelectorAll('.sec').forEach((s) => s.classList.remove('active'));
      sub.classList.add('active');
      const t = card.dataset.subTitle || ((card.querySelector('.rc-t') || {}).textContent || '');
      const d = card.dataset.subDesc || ((card.querySelector('.rc-d') || {}).textContent || '');
      secTitle.textContent = t;
      secDesc.textContent = d;
      if (backBtn) backBtn.hidden = false;
      /* 银狐扫描子页面：首次进入时挂载扫描界面并绑定按钮 */
      if (sub.id === 'scanner-main' && window.SFScanner) {
        var ctrl = window.SFScanner.mount(document.getElementById('scannerRoot'));
        if (!window.__sfScannerBound) {
          window.__sfScannerBound = true;
          var scFiles = document.getElementById('scScanFiles');
          var scDir = document.getElementById('scScanDir');
          if (scFiles && ctrl) scFiles.addEventListener('click', function(){ ctrl.scanFiles(); });
          if (scDir && ctrl) scDir.addEventListener('click', function(){ ctrl.scanDir(); });
        }
      }
      if (sub.id === 'ai-learn-sub') loadLearnPanel();
    });
  });

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (typeof stopChangelogShow === 'function') stopChangelogShow();
      const hub = window.__sfReturnHub || returnHubId;
      window.__sfReturnHub = null;
      document.querySelectorAll('.sec').forEach((s) => s.classList.remove('active'));
      const h = $(hub);
      if (h) h.classList.add('active');
      const hubNav = document.querySelector('.nav-item[data-target="' + hub + '"]');
      if (hubNav) hubNav.classList.add('active');
      secTitle.textContent = (hubNav && hubNav.dataset.title) || '';
      secDesc.textContent = (hubNav && hubNav.dataset.desc) || '';
      backBtn.hidden = true;
    });
  }
}

function bindRescue() {
  const urlEl = $('rescueUrl');
  if (urlEl) {
    urlEl.textContent = RESCUE_DOWNLOAD_URL;
    urlEl.title = '点击复制';
    urlEl.addEventListener('click', () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(RESCUE_DOWNLOAD_URL).then(() => showToast(), () => showToast());
        } else { showToast(); }
      } catch (e) { showToast(); }
    });
  }

  const btn = $('rescueBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // 优先用扩展下载 API 直接拉取直链；无权限或失败时降级为打开直链
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: RESCUE_DOWNLOAD_URL,
        filename: '360系统急救箱.zip',
        conflictAction: 'uniquify'
      }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          window.open(RESCUE_DOWNLOAD_URL, '_blank', 'noopener');
        }
      });
    } else {
      window.open(RESCUE_DOWNLOAD_URL, '_blank', 'noopener');
    }
  });
}

function collectSettings() {
  const enabled = {};
  document.querySelectorAll('input[data-cat]').forEach((cb) => { enabled[cb.dataset.cat] = cb.checked; });
  const sensBtn = document.querySelector('#sensitivity button.active');
  const activeFont = (document.querySelector('.font-opt.active') || { dataset: {} }).dataset;
  return {
    enabledGlobal: $('enabledGlobal').checked,
    showWarning: $('showWarning').checked,
    autoBlockDownloads: $('autoBlockDownloads').checked,
    notify: $('notify').checked,
    icpApiVerify: ($('icpApiVerify') ? $('icpApiVerify').checked : true),
    sensitivity: sensBtn ? sensBtn.dataset.v : 'medium',
    fontMode: (activeFont && activeFont.font) || 'system',
    theme: ($('themeLight') && $('themeLight').checked) ? 'light' : 'dark',
    themePalette: ((document.querySelector('.theme-opt.active') || { dataset: {} }).dataset.palette) || 'classic',
    material: ((document.querySelector('#materialSeg button.active') || { dataset: {} }).dataset.material) || 'frosted',
    aiEnabled: ($('aiEnabled') ? $('aiEnabled').checked : false),
    // 注意：设置页没有 id="aiProvider"/"aiModel" 的静态元素（provider 是自定义下拉），
    // 故这两个字段以缓存 window.__sfSettings 为准；其余状态类控件一律读 DOM，保证「AI 改→手动改→保存」链路一致。
    aiProvider: ($('aiProvider') ? $('aiProvider').value : ((window.__sfSettings && window.__sfSettings.aiProvider) || 'zhipu')),
    aiModel: ($('aiModel') ? $('aiModel').value.trim() : ((window.__sfSettings && window.__sfSettings.aiModel) || 'glm-4.7-flash')),
    // API Key / 基址：优先取当前 input 里用户手填的值（provider 切换或保存时都会落到 input），
    // 再与缓存的 keys 对象合并，避免「填了 key 直接保存却没生效」。
    aiKeys: (function () {
      const keys = Object.assign({}, (window.__sfSettings && window.__sfSettings.aiKeys) || {});
      const prov = ($('aiProvider') ? $('aiProvider').value : ((window.__sfSettings && window.__sfSettings.aiProvider) || 'zhipu'));
      if ($('aiApiKey') && $('aiApiKey').value.trim()) keys[prov] = $('aiApiKey').value.trim();
      return keys;
    })(),
    aiBaseUrls: (function () {
      const bu = Object.assign({}, (window.__sfSettings && window.__sfSettings.aiBaseUrls) || {});
      if ($('aiBaseUrl') && $('aiBaseUrl').value.trim()) bu.custom = $('aiBaseUrl').value.trim();
      return bu;
    })(),
    aiApiKey: ($('aiApiKey') ? $('aiApiKey').value.trim() : ((window.__sfSettings && window.__sfSettings.aiApiKey) || '')),
    aiModelRules: ((window.__sfSettings && window.__sfSettings.aiModelRules) || []),
    localModelEnabled: ($('localModelEnabled') ? $('localModelEnabled').checked : true),
    cloudEnhance: ($('cloudEnhance') ? $('cloudEnhance').checked : false),
    aiMaxMode: ($('aiMaxMode') ? $('aiMaxMode').checked : false),
    aiCloudWebAnalyse: ($('aiCloudWebAnalyse') ? $('aiCloudWebAnalyse').checked : false),
    aiScanFileAnalyse: ($('aiScanFileAnalyse') ? $('aiScanFileAnalyse').checked : false),
    aiTtsEnabled: ($('aiTtsEnabled') ? $('aiTtsEnabled').checked : false),
    aiTtsVoice: ($('ttsVoice') ? $('ttsVoice').value : ''),
    fontScale: ($('fontScale') ? parseFloat($('fontScale').value) / 100 : 1),
    reduceMotion: ($('reduceMotion') ? $('reduceMotion').checked : false),
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
  if (!hasStorage()) { $('stWarn').textContent = 0; $('stBlock').textContent = 0; return; }
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
    const st = r.stats || { warnings: 0, blocks: 0 };
    $('stWarn').textContent = st.warnings || 0;
    $('stBlock').textContent = st.blocks || 0;
  });
}

/* ===== 自动学习的下载黑名单：展示 / 逐条删除 / 一键清空 =====
   条目由后台在真正取消一次可疑下载时自动写入（键为载荷域名的注册域名）。
   这里给用户完整的可见性与撤销能力——万一某个正规下载源被误记，删掉即可立刻恢复下载。 */
function sendBg(msg) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
    try { chrome.runtime.sendMessage(msg, (r) => resolve(r || null)); } catch (e) { resolve(null); }
  });
}
function fmtDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function loadDlBlacklist() {
  const box = $('dlBlList');
  if (!box) return;
  const r = await sendBg({ type: 'sf-dl-bl-list' });
  const items = (r && r.items) || [];
  if ($('dlBlCount')) $('dlBlCount').textContent = '共 ' + items.length + ' 条';
  box.textContent = '';
  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'dlbl-empty';
    e.textContent = '暂无记录';
    box.appendChild(e);
    return;
  }
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'dlbl-item';
    const d = document.createElement('div');
    d.className = 'd';
    const dn = document.createElement('div');
    dn.className = 'dn';
    dn.textContent = it.domain;
    const dm = document.createElement('div');
    dm.className = 'dm';
    const bits = [];
    bits.push('拦截 ' + (it.hits || 1) + ' 次');
    if (it.last) bits.push('最近 ' + fmtDay(it.last));
    if (it.from) bits.push('来源页 ' + it.from);
    if (it.sample) bits.push('文件 ' + it.sample);
    dm.textContent = bits.join(' · ');
    d.appendChild(dn); d.appendChild(dm);
    const x = document.createElement('button');
    x.className = 'dx';
    x.type = 'button';
    x.textContent = '移除';
    x.addEventListener('click', async () => {
      await sendBg({ type: 'sf-dl-bl-remove', domain: it.domain });
      loadDlBlacklist();
      showToast();
    });
    row.appendChild(d); row.appendChild(x);
    box.appendChild(row);
  });
}
function bindDlBlacklist() {
  const btn = $('dlBlClear');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!confirm('确定清空自动学习的下载黑名单吗？清空后这些域名将不再被自动拦截，需要重新学习。')) return;
    await sendBg({ type: 'sf-dl-bl-clear' });
    loadDlBlacklist();
    showToast();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
async function loadLearnPanel() {
  if (!hasStorageLocal()) return;
  const d = await new Promise((res) => chrome.storage.local.get({
    sfLearnEnabled: true,
    sfLearnedRules: [],
    sfLearnedWords: {},
    sfLearnLog: [],
    sfLearnMeta: { learnedRuleCount: 0, learnedWordCount: 0 }
  }, res));
  const rules = Array.isArray(d.sfLearnedRules) ? d.sfLearnedRules.length : 0;
  const words = Object.values(d.sfLearnedWords || {}).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0);
  const logs = Array.isArray(d.sfLearnLog) ? d.sfLearnLog.length : 0;
  const enabled = d.sfLearnEnabled !== false;
  const summary = document.getElementById('entryLearnSummary');
  if (summary) summary.textContent = '已学规则 ' + rules + ' 条 · 口语词 ' + words + ' 个';
  const sw = document.getElementById('learnEnabled');
  if (sw) sw.checked = enabled;
  const rc = document.getElementById('learnRuleCount'); if (rc) rc.textContent = String(rules);
  const wc = document.getElementById('learnWordCount'); if (wc) wc.textContent = String(words);
  const lc = document.getElementById('learnLogCount'); if (lc) lc.textContent = String(logs);
  const recent = document.getElementById('learnRecent');
  if (recent) {
    const logArr = (Array.isArray(d.sfLearnLog) ? d.sfLearnLog : []).slice(-5).reverse();
    const title = '<div class="lr-title">最近学习</div>';
    if (!logArr.length) {
      recent.innerHTML = title + '<div class="lr-empty">暂无记录，多与 AI 助手对话即可自动生成。</div>';
    } else {
      const items = logArr.map((e) => {
        const tag = e.hit ? (e.cloud ? '云端命中' : '本地命中') : '未命中';
        const q = (e.q || '').slice(0, 40) + ((e.q || '').length > 40 ? '…' : '');
        return '<div class="lr-item"><div class="lr-q">' + escapeHtml(q) + '</div><div class="lr-meta">' + tag + (e.scenario ? ' · ' + e.scenario : '') + '</div></div>';
      }).join('');
      recent.innerHTML = title + items;
    }
  }
}
function bindLearnPanel() {
  const sw = document.getElementById('learnEnabled');
  if (sw) {
    sw.addEventListener('change', () => {
      if (hasStorageLocal()) chrome.storage.local.set({ sfLearnEnabled: sw.checked });
      const summary = document.getElementById('entryLearnSummary');
      if (summary) summary.textContent = (sw.checked ? '已启用' : '已暂停') + '，进入查看详情';
    });
  }
  const clearBtn = document.getElementById('learnClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('确定清空本地自学习数据吗？这将删除所有自动学习的规则、口语词和学习记录，且无法恢复。')) return;
      if (hasStorageLocal()) {
        await new Promise((res) => chrome.storage.local.remove([
          'sfLearnLog', 'sfLearnedRules', 'sfLearnedWords', 'sfRuleStats', 'sfLearnMeta'
        ], res));
      }
      loadLearnPanel();
      showToast('已清空本地自学习数据');
    });
  }
}

async function init() {
  // 首次引导（OOBE）未完成 → 跳转向导页（完成向导后会写 oobeDone 再回来，不会死循环）
  try {
    const ob = await new Promise((res) => chrome.storage.sync.get({ oobeDone: false }, res));
    if (!ob.oobeDone) { location.replace(chrome.runtime.getURL('ui/oobe.html')); return; }
  } catch (e) {}

  // 动态写入版本号（取自 manifest，避免硬编码遗漏导致内部页面版本滞后）
  try {
    const ver = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '1.3.5';
    const vt = document.getElementById('verTop'); if (vt) vt.textContent = 'v' + ver;
    const va = document.getElementById('verAbout'); if (va) va.textContent = 'v' + ver;
  } catch (e) {}
  const settings = await getSettings();
  // 自定义背景图单独存 chrome.storage.local（dataURL 大，避免占 sync 配额），
  // 这里读回并合并进 settings.bgImage，使 applyAppearance / showBgThumb 走统一字段，退出重进不再丢失。
  if (hasStorageLocal()) {
    try {
      const bgRes = await new Promise((res) => chrome.storage.local.get({ sfBgImage: '' }, res));
      if (bgRes && bgRes.sfBgImage) settings.bgImage = bgRes.sfBgImage;
    } catch (e) {}
  }
  window.__sfSettings = settings;   // 缓存供 applyAppearance / 材质 / 背景读取
  if (settings.pixelUnlocked) document.documentElement.classList.add('pixel-unlocked');
  renderCategories(settings);
  bindControls(settings);
  loadStats();
  setupNav();
  setupSubNav();

  // AI 浮球 / 其他页面通过 #sec=<id> 锚点打开对应子页面（如 #sec=rescue / #sec=changelog）
  (function jumpFromHash() {
    try {
      const h = (location.hash || '').replace(/^#/, '');
      if (!h) return;
      const m = h.match(/sec=([^&]+)/);
      if (!m) return;
      const id = decodeURIComponent(m[1]);
      // 等 DOM / 导航就绪后再跳转，确保 section 元素与 nav 已绑定
      const doJump = function () {
        if (id === 'changelog') { if (typeof showChangelog === 'function') showChangelog(); return; }
        const sec = document.getElementById(id);
        const navItem = document.querySelector('.nav-item[data-target="' + id + '"]');
        if (sec && navItem && typeof navItem.click === 'function') {
          navItem.click();
        } else if (sec) {
          // 兜底直接切（含 data-sub 子页面返回态）
          const card = document.querySelector('[data-sub="' + id + '"]');
          document.querySelectorAll('.sec').forEach((s) => { s.classList.remove('active'); s.classList.remove('sec-in'); });
          sec.classList.add('active'); void sec.offsetWidth; sec.classList.add('sec-in');
          if (navItem) navItem.classList.add('active');
          const bb = document.getElementById('backBtn'); if (bb) bb.hidden = !card;
        }
      };
      if (document.readyState === 'complete') setTimeout(doJump, 60);
      else window.addEventListener('load', function () { setTimeout(doJump, 60); });
    } catch (e) {}
  })();

  bindRescue();
  bindDlBlacklist();
  loadDlBlacklist();
  bindLearnPanel();
  loadLearnPanel();

  // 更新日志入口（关于页链接 + 更新成功弹窗跳转）—— 更新日志不在左侧分类导航
  const ac = $('aboutChangelog');
  if (ac) ac.addEventListener('click', (e) => { e.preventDefault(); showChangelog(); });

  setupPixelEgg();
  setupUpdateToast();
  renderSponsors();

  // AI 助手悬浮球：传入设置（多模型选择 / 场景路由 / 开关 / 版本号供提示词上下文）
  if (window.SilverFoxAI) {
    window.SilverFoxAI.init({
      enabled: !!settings.aiEnabled,
      apiKey: settings.aiApiKey || '',
      version: (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '',
      localModelEnabled: settings.localModelEnabled !== false,
      cloudEnhance: settings.cloudEnhance === true,
      maxMode: settings.aiMaxMode === true,
      cloudWebAnalyse: settings.aiCloudWebAnalyse === true,
      scanFileAnalyse: settings.aiScanFileAnalyse === true,
      ttsEnabled: settings.aiTtsEnabled === true,
      ttsVoice: settings.aiTtsVoice || '',
      provider: settings.aiProvider || 'zhipu',
      model: settings.aiModel || 'glm-4.7-flash',
      keys: settings.aiKeys || {},
      baseUrls: settings.aiBaseUrls || {},
      rules: settings.aiModelRules || [],
      aiPersona: settings.aiPersona || 'balanced',
      remindMode: settings.remindMode || 'normal'
    });
  }

  $('saveBtn').addEventListener('click', () => {
    const patch = collectSettings();
    // 保存成功后同步回写缓存，保证 window.__sfSettings 与已落盘的 sync 一致，
    // 避免后续 applyAppearance / collectSettings 回退分支读到陈旧值。
    if (window.__sfSettings) Object.assign(window.__sfSettings, patch);
    if (hasStorage()) {
      chrome.storage.sync.set(patch, () => { showToast(); loadStats(); });
    } else {
      showToast();
    }
  });

  $('resetBtn').addEventListener('click', () => {
    if (!confirm('确定要清空拦截统计吗？白名单与规则设置不会改动。')) return;
    if (hasStorage()) {
      chrome.storage.local.set({ stats: { warnings: 0, blocks: 0, recent: [] } }, () => { loadStats(); showToast(); });
    } else {
      showToast();
    }
  });
}

init();
