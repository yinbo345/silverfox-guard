/* options.js — 银狐防护设置控制面板逻辑（侧边栏分类版） */
'use strict';

// 360 系统急救箱官方下载直链（绿色版，无需安装）。360 更新版本后此链接可能变动，
// 届时改这里即可，设置页「银狐急救」卡片会同步展示最新直链。
const RESCUE_DOWNLOAD_URL = 'https://dl.360safe.com/360c0mpkill_5.1.64.1289-0701.zip';

// 火绒专杀工具（无签名版）官方下载直链。该工具可解除银狐木马对常规杀毒软件的打开限制；
// 因无签名，Windows Defender 与安全下载检测会拦截——属正常现象，用户放行即可。
// 有签名版同样会被银狐类病毒拦截，故只提供无签名版。360 / 火绒更新版本后此链接可能变动，届时改这里即可。
const HRKILL_DOWNLOAD_URL = 'https://down7.huorong.cn/hrkill/hrkill_unsign-1.0.0.172.exe';

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
  sidebar: 'attached',   // 'attached'(贴合) | 'floating'(浮空)；自定义主题可携带，用户后续可切换
  control: 'normal',     // 'normal'(普通) | 'skeuomorphic'(拟物)
  bgType: 'gradient',    // 'gradient' | 'solid' | 'image'（背景类型，自定义主题与背景设置共享）
  customThemes: [],     // 用户导入的自定义主题数组 [{id,name,theme}]
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
  customTheme: null,    // 用户导入的自定义主题：{ name, theme:{ bgPrimary,bgSecondary,accent,accent2,text,surface,border,material,sidebar,control } }
  reduceMotion: false,  // 减弱动画效果：关闭全部过渡与动画
  layout: 'new',        // 设置页布局：'new'(新版 8 项分组导航，默认) | 'old'(旧版 11 项平铺导航)
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
  let themeLight = ($('themeLight') && $('themeLight').checked) || false;
  // 外观主题：经典保持无额外类（沿用 :root 默认配色）；其余调色板挂对应 html.theme-* 类
  const activeTheme = (document.querySelector('.theme-opt.active') || { dataset: {} }).dataset;
  const palette = (activeTheme && activeTheme.palette) || 'classic';
  // 材质与背景从全局设置缓存读取（init 时写入 window.__sfSettings），保证切换主题时也能正确应用
  const settings = (typeof window !== 'undefined' && window.__sfSettings) || {};
  // 自定义主题：用户导入，支持多主题（themePalette 形如 'custom:<id>'）
  const customMatch = typeof palette === 'string' && palette.startsWith('custom:') ? palette.slice(7) : '';
  const customThemes = Array.isArray(settings.customThemes) ? settings.customThemes : (settings.customTheme ? [settings.customTheme] : []);
  const customTheme = customMatch ? customThemes.find(function (x) { return String(x.id) === customMatch; }) : null;
  const ct = (customTheme && customTheme.theme) ? customTheme.theme : null;
  root.classList.toggle('font-smiley', fontMode === 'smiley');
  root.classList.toggle('theme-light', themeLight || (ct && !!ct.themeLight));
  root.classList.toggle('theme-gold', palette === 'gold');
  root.classList.toggle('theme-neon', palette === 'neon');
  root.classList.toggle('theme-mist', palette === 'mist');
  root.classList.toggle('theme-space', palette === 'space');
  root.classList.toggle('theme-glass', palette === 'glass');
  root.classList.toggle('theme-pixel', palette === 'pixel');
  // 界面材质：默认磨砂玻璃；琉声液态玻璃仅在非 Pixel 主题下生效（Pixel 锁定磨砂玻璃）。
  // 自定义主题不再锁死材质——material 统一从 settings 读取（导入时已写入），用户后期可在 UI 自由切换。
  const matBtn = (document.querySelector('#materialSeg button.active') || { dataset: {} });
  const material = (matBtn && matBtn.dataset && matBtn.dataset.material) || (settings && settings.material) || (ct && ct.material) || 'frosted';
  root.classList.toggle('material-liquid', material === 'liquid' && palette !== 'pixel');
  root.classList.toggle('material-flat', material === 'flat');
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
  const effectiveFontMode = fontMode;
  if (effectiveFontMode === 'smiley') scale *= 1.10;
  // 自定义主题：仅注入「配色」变量（accent/bgPrimary 等无独立 UI 入口，由主题携带，保持主题观感）；
  // 材质 / 侧边栏 / 控件 / 背景图片 一律从 settings 读取（导入时已一次性写入，用户后续可在 UI 自由修改，不锁死）。
  if (ct) {
    root.classList.add('theme-custom');
    root.style.setProperty('--sf-accent', ct.accent);
    root.style.setProperty('--sf-accent-2', ct.accent2);
    root.style.setProperty('--sf-text', ct.text);
    root.style.setProperty('--sf-surface-solid', ct.surface);
    root.style.setProperty('--sf-border', ct.border);
    root.style.setProperty('--sf-accent-grad-soft', hexToRgbaSoft(ct.accent));
    // 背景：优先用用户后期设置的图片背景（settings.bgImage），否则回退主题自带渐变/纯色
    if (!bg) {
      const bgType = ct.bgType || 'gradient';
      if (bgType === 'solid') {
        document.body.style.background = ct.bgSolid || ct.bgPrimary;
      } else {
        document.body.style.background = 'linear-gradient(' + (ct.bgDirection || '160deg') + ', ' + ct.bgPrimary + ', ' + ct.bgSecondary + ')';
      }
    }
    // 侧边栏 / 控件：从 settings 读取，不再硬读主题
    const sidebar = (settings && settings.sidebar) || ct.sidebar || 'attached';
    root.classList.toggle('sidebar-floating', sidebar === 'floating');
    root.classList.toggle('sidebar-attached', sidebar === 'attached');
    const control = (settings && settings.control) || ct.control || 'normal';
    root.classList.toggle('control-skeuo', control === 'skeuomorphic');
  } else {
    root.classList.remove('theme-custom', 'material-flat', 'sidebar-floating', 'sidebar-attached', 'control-skeuo');
    ['--sf-accent', '--sf-accent-2', '--sf-text', '--sf-surface-solid', '--sf-border', '--sf-accent-grad-soft']
      .forEach(function (p) { root.style.removeProperty(p); });
    if (!settings.bgImage) document.body.style.background = '';
  }
  const reduce = document.documentElement.classList.contains('reduce-motion');
  setScale(scale, instant || reduce);
}

// 将 hex 颜色转成带透明度的 rgba（用于自定义主题的 accent-grad-soft 软底色）
function hexToRgbaSoft(hex) {
  hex = (hex || '').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
  const n = parseInt(hex, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.16)';
}

// 在主题网格中重建所有「自定义」主题卡片（位于导入卡片之前）。selectId 传入时选中对应主题。
function ensureCustomThemeCards(selectId) {
  const grid = $('themeGrid'); if (!grid) return;
  grid.querySelectorAll('.theme-opt.theme-custom').forEach(function (n) { n.remove(); });
  const settings = window.__sfSettings || {};
  let list = Array.isArray(settings.customThemes) ? settings.customThemes : (settings.customTheme ? [settings.customTheme] : []);
  const imp = $('themeImportCard');
  list.forEach(function (ct) {
    if (!ct || !ct.theme) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-opt theme-custom';
    btn.dataset.palette = 'custom:' + ct.id;
    btn.dataset.cid = ct.id;
    const a = ct.theme.accent || '#7db4ff';
    const a2 = ct.theme.accent2 || '#a08cff';
    // 重名时显示序号，避免两张同名卡无法区分（底层仍以唯一 id 操作，不会只留一个）
    const nm = ct.name || '自定义主题';
    const same = list.filter(function (x) { return (x.name || '自定义主题') === nm; });
    const label = same.length > 1 ? nm + ' (' + (same.indexOf(ct) + 1) + ')' : nm;
    btn.innerHTML = '<span class="theme-swatch" style="background:linear-gradient(135deg,' + a + ',' + a2 + ')"></span>' +
                    '<span class="theme-name">' + label + '</span>';
    if (imp) grid.insertBefore(btn, imp); else grid.appendChild(btn);
  });
  if (selectId) {
    grid.querySelectorAll('.theme-opt').forEach(function (x) { x.classList.remove('active'); });
    const target = grid.querySelector('.theme-opt[data-palette="custom:' + selectId + '"]');
    if (target) target.classList.add('active');
  }
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
function showChangelog() {
  let v = '';
  try { v = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''; } catch (e) {}
  gotoSection('changelog', '更新日志', (v ? 'v' + v + ' · ' : '') + '扫描算法重构 · 误报率大幅下降 · 官网白名单大幅扩容');
  startChangelogShow();
}

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

/* ===== 自动更新检查 =====
   打开设置页自动拉官网 version.json 比对；有更新且未被「稍后提醒」忽略才弹底部小弹窗（无更新/网络失败一律安静）。
   关于页「检查更新」按钮触发手动检查：带「检查中…」加载态，结果弹窗或「已是最新」提示。
   数据来源：https://silverfoxguard.dpdns.org/version.json（含 version / releaseNotes / downloadUrl / releaseUrl） */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function checkUpdate(manual) {
  var box = $('updateCheckToast');
  if (!box) return;
  var curVer = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '0';
  var VER_URL = 'https://silverfoxguard.dpdns.org/version.json';

  function hideBox() {
    box.classList.add('is-hiding');
    setTimeout(function () { box.hidden = true; box.classList.remove('is-hiding'); }, 280);
  }
  function finishSpin() {
    var btn = $('manualCheckUpdate'), spin = $('updChecking');
    if (btn) btn.disabled = false;
    if (spin) spin.hidden = true;
  }
  function showUpdate(latest, data) {
    box.classList.remove('is-latest');
    $('uctTitle').innerHTML = '发现新版本 <b id="uctVer">v' + latest + '</b>';
    var notes = $('uctNotes');
    var arr = Array.isArray(data.releaseNotes) ? data.releaseNotes
      : (data.releaseNotes ? String(data.releaseNotes).split('\n').filter(Boolean) : []);
    if (arr.length) { notes.innerHTML = arr.slice(0, 4).map(function (h) { return '<div>· ' + escHtml(h) + '</div>'; }).join(''); notes.hidden = false; }
    else { notes.innerHTML = ''; notes.hidden = true; }
    var acts = box.querySelector('.uc-actions'); if (acts) acts.hidden = false;
    var dl = $('uctDownload'); if (dl) dl.href = data.downloadUrl || 'https://silverfoxguard.dpdns.org/';
    var rel = $('uctRelease'); if (rel) rel.href = data.releaseUrl || ('https://github.com/yinbo345/silverfox-guard/releases/tag/v' + latest);
    box.hidden = false;
  }
  function showLatest() {
    box.classList.add('is-latest');
    $('uctTitle').innerHTML = '已是最新版本 <b>✓</b>';
    var notes = $('uctNotes'); if (notes) { notes.innerHTML = ''; notes.hidden = true; }
    var acts = box.querySelector('.uc-actions'); if (acts) acts.hidden = true;
    box.hidden = false;
    setTimeout(hideBox, 2200);
  }

  if (manual) {
    var btn = $('manualCheckUpdate'), spin = $('updChecking');
    if (btn) btn.disabled = true;
    if (spin) spin.hidden = false;
  }

  fetch(VER_URL, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
    .then(function (data) {
      var latest = data.version || '0';
      if (cmpVer(latest, curVer) > 0) {
        if (!manual) {
          chrome.storage.local.get({ sfUpdateDismissed: '' }, function (r) {
            if (r.sfUpdateDismissed === latest) { finishSpin(); return; }
            showUpdate(latest, data); finishSpin();
          });
        } else {
          showUpdate(latest, data); finishSpin();
        }
      } else {
        if (manual) showLatest();
        finishSpin();
      }
    })
    .catch(function () { finishSpin(); });
}

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
  const cv = $('clVerBig'); if (cv) cv.textContent = 'v' + curVer;
  // 本次更新要点（发布新版时更新此数组；第三人称客观语气，禁止提及用户）
  const UPD_HIGHLIGHTS = [
    '扫描算法重构，误报率大幅下降，知名官网不再被误拦',
    '官网白名单扩容至千余条法人站点，下载站与论坛社区免于误报',
    '扩展性能优化，大页面扫描耗时不升反降',
    '压缩包解压扫描修复，自解压包内木马投递物可被识别',
    '新增一键加入白名单，误拦站点可即时拉黑放行'
  ];
  const ul = $('updPoints');
  if (ul) ul.innerHTML = UPD_HIGHLIGHTS.map(function (h) { return '<li>' + h + '</li>'; }).join('');

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

/* ================= 设置页双布局导航（新版 8 项分组 / 旧版 11 项平铺） =================
   默认新版；切换入口在「个性化」→「界面布局」。切换动画：旧项自然分离（淡出+右滑+塌缩），
   新项自然融合（错峰淡入+左滑+展开）。仅重绘 #nav 内部，不改任何 section 结构。 */
const NAV_ICONS = {
  gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 7 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 0 1 4 0v.1A1.7 1.7 0 0 0 17 4.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" opacity=".9"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6l-8-3Z"/><path d="M9 12l2 2 4-4" stroke-width="2" fill="none"/>',
  doc: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h8M8 7h4" stroke-width="1.8" fill="none"/>',
  chart: '<path d="M5 19V5M5 19h14M9 15v-4M13 15V8M17 15v-7"/>',
  cross: '<path d="M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6l-8-3Z"/><path d="M12 8v8M8 12h8" stroke-width="2" fill="none" stroke-linecap="round"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5l5 5" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke-width="1.8" stroke-linecap="round"/>',
  ai: '<path d="M12 2.5 4 5.2v6.3c0 4.8 3.1 8.3 8 9.4 4.9-1.1 8-4.6 8-9.4V5.2L12 2.5Z"/><path d="M8.2 12.2l2.5 2.5 4.9-5.1" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  globe: '<path d="M12 3a9 9 0 0 0 0 18c1.7 0 2-1.3 1.2-2.2-.8-.9-.3-2.1.9-2.1H15a3 3 0 0 0 0-6h-1.9c-1.2 0-1.7-1.4-.9-2.1.8-.9.5-2.2-1.2-2.2Z" opacity=".9"/><circle cx="12" cy="12" r="9" fill="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01" stroke-width="2" fill="none" stroke-linecap="round"/>'
};
// 旧版（11 项平铺，保持历史行为）
const NAV_OLD = [
  { targets: ['general'], label: '常规',     title: '常规',     desc: '总开关与检测灵敏度',       icon: 'gear' },
  { targets: ['detect'],  label: '检测维度', title: '检测维度', desc: '独立评分的检测项，可逐项开关', icon: 'grid' },
  { targets: ['behavior'], label: '拦截行为',title: '拦截行为', desc: '命中风险时如何提醒与处置',   icon: 'shield' },
  { targets: ['rules'],   label: '规则白名单',title: '规则与白名单', desc: '信任域名、自定义关键词与黑名单', icon: 'doc' },
  { targets: ['stats'],   label: '防护统计', title: '防护统计', desc: '已拦截风险与下载次数',       icon: 'chart' },
  { targets: ['rescue'],  label: '银狐急救', title: '银狐急救', desc: '中招后的下载与查杀引导',     icon: 'cross' },
  { targets: ['scanner'], label: '银狐扫描', title: '银狐扫描', desc: '上传样本做静态检测',         icon: 'upload' },
  { targets: ['envscan'], label: '环境检测', title: '环境检测', desc: '联动本地银狐环境检测程序',   icon: 'shield' },
  { targets: ['ai'],      label: 'AI 设置',  title: 'AI 设置',  desc: 'AI 助手悬浮球与增强开关',    icon: 'ai' },
  { targets: ['personal'],label: '个性化',   title: '个性化',   desc: '字体与深浅色外观',           icon: 'globe' },
  { targets: ['about'],   label: '关于',     title: '关于',     desc: '版本信息与说明',             icon: 'info' }
];
// 新版（8 项分组导航，默认）：同类合并、语义归类
const NAV_NEW_GROUPS = [
  {
    label: '防护', items: [
      { targets: ['general'],            label: '防护总览', title: '防护总览', desc: '防护状态与服务总开关', icon: 'gear' },
      { targets: ['detect', 'behavior'], label: '检测拦截', title: '检测与拦截', desc: '检测维度与命中后的处置方式', icon: 'shield' },
      { targets: ['rules'],              label: '规则白名单', title: '规则与白名单', desc: '信任域名、关键词与黑名单', icon: 'doc' },
      { targets: ['stats'],              label: '防护统计', title: '防护统计', desc: '已拦截风险与下载次数', icon: 'chart' }
    ]
  },
  {
    label: '工具', items: [
      { targets: ['tools'], label: '急救与工具', title: '急救与工具', desc: '急救引导、样本扫描与本机环境检测', icon: 'cross' }
    ]
  },
  {
    label: '设置', items: [
      { targets: ['ai'],       label: 'AI 设置',  title: 'AI 设置',  desc: 'AI 助手悬浮球与增强开关', icon: 'ai' },
      { targets: ['personal'], label: '个性化',   title: '个性化',   desc: '界面布局、字体与深浅色外观', icon: 'globe' },
      { targets: ['about'],    label: '关于',     title: '关于',     desc: '版本信息与说明',           icon: 'info' }
    ]
  }
];

function renderNav(layout) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const old = layout === 'old';
  let html = '';
  if (old) {
    NAV_OLD.forEach(function (it) {
      html += '<button class="nav-item" data-targets="' + it.targets.join(' ') + '" data-title="' + it.title + '" data-desc="' + it.desc + '">' +
        '<svg viewBox="0 0 24 24">' + NAV_ICONS[it.icon] + '</svg><span>' + it.label + '</span></button>';
    });
  } else {
    NAV_NEW_GROUPS.forEach(function (g) {
      html += '<div class="nav-group-label">' + g.label + '</div>';
      g.items.forEach(function (it) {
        html += '<button class="nav-item" data-targets="' + it.targets.join(' ') + '" data-title="' + it.title + '" data-desc="' + it.desc + '">' +
          '<svg viewBox="0 0 24 24">' + NAV_ICONS[it.icon] + '</svg><span>' + it.label + '</span></button>';
      });
    });
  }
  nav.innerHTML = html;
  nav.setAttribute('data-layout', old ? 'old' : 'new');
  // 恢复当前激活项高亮（重建后没有 active，侧边栏会失去高亮；跟随当前显示的 section）
  const curSec = document.querySelector('.sec.active');
  const curId = curSec ? curSec.id : 'general';
  const curNav = findNavForTarget(curId);
  if (curNav) curNav.classList.add('active');
  else {
    const first = nav.querySelector('.nav-item');
    if (first) first.classList.add('active');
  }
}

/* ================= 布局切换「非线性重组动画」 =================
   ① 分离：旧导航全部项向整体质心收拢（塌缩式汇聚，非线性 easing），像被吸回一点再消失；
   ② 融合：渲染新导航后，每个新项从质心弹出、非线性地飞回自己的位置铺展开来（错峰 stagger）。
   整体观感是「旧布局溶解 → 新布局从同一点重组长出来」。 */
function applyLayout(layout, animate) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const reduce = document.documentElement.classList.contains('reduce-motion');
  const curLayout = nav.getAttribute('data-layout');
  if (!animate || reduce || curLayout === layout || (curLayout !== 'new' && curLayout !== 'old')) {
    renderNav(layout); setupNav(); return;
  }
  // ========== ① 分离：旧项向质心收拢 ==========
  const items = Array.prototype.slice.call(nav.querySelectorAll('.nav-item, .nav-group-label'));
  if (!items.length) { renderNav(layout); setupNav(); return; }
  const rects = items.map(function (it) { return it.getBoundingClientRect(); });
  // 质心 = 全部导航项包围盒中心（重组锚点）
  let minL = 1e9, minT = 1e9, maxR = -1e9, maxB = -1e9;
  rects.forEach(function (r) {
    minL = Math.min(minL, r.left); minT = Math.min(minT, r.top);
    maxR = Math.max(maxR, r.right); maxB = Math.max(maxB, r.bottom);
  });
  const cx = (minL + maxR) / 2, cy = (minT + maxB) / 2;
  const leave = items.map(function (it, i) {
    const r = rects[i];
    const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
    return it.animate([
      { opacity: 1, transform: 'translate(0,0) scale(1)' },
      { opacity: 0, transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.6)' }
    ], { duration: 320, easing: 'cubic-bezier(.6,0,.8,.4)', delay: i * 10, fill: 'forwards' });
  });
  Promise.all(leave.map(function (a) { return a.finished.catch(function () {}); })).then(function () {
    // ========== ② 融合：新项从质心弹出、飞回原位铺展 ==========
    renderNav(layout);
    setupNav();
    const fresh = Array.prototype.slice.call(nav.querySelectorAll('.nav-item, .nav-group-label'));
    fresh.forEach(function (el, i) {
      const r = el.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      el.animate([
        { opacity: 0, transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.5)' },
        { opacity: 1, transform: 'translate(0,0) scale(1)' }
      ], { duration: 500, easing: 'cubic-bezier(.24,1.4,.36,1)', delay: i * 34, fill: 'backwards' });
    });
  });
}

// 「个性化 → 界面布局」切换控件初始化（即时生效并持久化）
function bindLayoutSwitch() {
  const seg = document.getElementById('layoutSeg');
  if (!seg) return;
  const cur = (window.__sfSettings && window.__sfSettings.layout) || 'new';
  seg.querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.layout === cur);
  });
  // 初始渲染导航（默认新版）
  renderNav(cur);

  // seg 滑块定位（与灵敏度 seg 同款）
  function layoutGlider() {
    const active = seg.querySelector('button.active') || seg.querySelector('button');
    const glider = seg.querySelector('.seg-glider');
    if (!active || !glider) return;
    const sg = seg.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    glider.style.width = ar.width + 'px';
    glider.style.transform = 'translateX(' + (ar.left - sg.left) + 'px)';
  }
  requestAnimationFrame(layoutGlider);
  let lzTimer;
  window.addEventListener('resize', function () { clearTimeout(lzTimer); lzTimer = setTimeout(layoutGlider, 100); });

  seg.addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (!btn || btn.classList.contains('active')) return;
    seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
    btn.classList.add('active');
    layoutGlider();
    const layout = btn.dataset.layout;
    if (window.__sfSettings) window.__sfSettings.layout = layout;
    if (hasStorage()) chrome.storage.sync.set({ layout: layout });
    applyLayout(layout, true);
  });
}

/* 按 section id 找到对应导航项：兼容新版 data-targets（"rescue scanner envscan"）与旧版 data-target */
function findNavForTarget(id) {
  if (!id) return null;
  const items = document.querySelectorAll('.nav-item');
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const list = ((it.dataset.targets || '') + ' ' + (it.dataset.target || '')).trim().split(/\s+/);
    if (list.indexOf(id) >= 0) return it;
  }
  return null;
}

/* 侧边栏导航：点击分类切换右侧内容，并更新标题/描述 */
function setupNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const secTitle = $('secTitle');
  const secDesc = $('secDesc');

  // 侧边栏滑动指示：高亮块跟随 active 项丝滑滑动（不是瞬间跳变）
  function moveNavIndicator(item, showNow) {
    const nav = document.getElementById('nav');
    if (!nav || !item) return;
    let ind = nav.querySelector('.nav-indicator');
    if (!ind) {
      ind = document.createElement('span');
      ind.className = 'nav-indicator';
      ind.setAttribute('aria-hidden', 'true');
      nav.insertBefore(ind, nav.firstChild);
    }
    const navRect = nav.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    ind.style.height = r.height + 'px';
    ind.style.transform = 'translateY(' + (r.top - navRect.top) + 'px)';
    if (showNow !== false) {
      ind.classList.add('show');
      clearTimeout(nav.__indT);
      nav.__indT = setTimeout(function () { ind.classList.remove('show'); }, 620);
    }
  }

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      // 新版导航一个入口可能对应多个 section（data-targets="detect behavior"）；
      // 旧版为单个（data-target="envscan"），统一按空格拆分取第一个作主区。
      const targets = (item.dataset.targets || item.dataset.target || '').trim().split(/\s+/).filter(Boolean);
      navItems.forEach((n) => n.classList.toggle('active', n === item));
      document.querySelectorAll('.sec').forEach((s) => { s.classList.remove('active'); s.classList.remove('sec-in'); });
      let firstSec = null;
      targets.forEach((t, i) => {
        const sec = document.getElementById(t);
        if (sec) {
          sec.classList.add('active');
          if (i === 0) { void sec.offsetWidth; sec.classList.add('sec-in'); }
          if (!firstSec) firstSec = sec;
        }
      });
      secTitle.textContent = item.dataset.title || '';
      secDesc.textContent = item.dataset.desc || '';
      const bb = $('backBtn'); if (bb) bb.hidden = true;   // 切到一级分类时退出子页面
      moveNavIndicator(item);
      // 环境检测端口联动：激活的 section 含 envscan 时打开原生消息端口，否则断开
      if (window.__sfEnvscanPort) window.__sfEnvscanPort(targets.indexOf('envscan') >= 0);
    });

    // 鼠标悬停追踪光晕
    item.addEventListener('mousemove', (e) => {
      const r = item.getBoundingClientRect();
      item.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      item.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  // 初始定位到默认 active 项（静默归位，不闪现）
  const defItem = document.querySelector('.nav-item.active');
  if (defItem) moveNavIndicator(defItem, false);
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
  ensureCustomThemeCards();   // 若已导入自定义主题，先重建其卡片（位于导入卡片之前）
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
    themeGrid.addEventListener('click', function (e) {
      const b = e.target.closest('.theme-opt');
      if (!b) return;
      themeOpts.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      refreshThemeCurrent();
      applyAppearance();
      flashThemeAnim();
      if (hasStorage()) chrome.storage.sync.set({ themePalette: b.dataset.palette || 'classic' });
    });
  }

  // 自定义主题：右键删除（仅自定义卡弹菜单，预设卡不弹）
  function deleteCustomTheme(cid) {
    let list = (Array.isArray(settings.customThemes) ? settings.customThemes : []).slice();
    list = list.filter(function (x) { return String(x.id) !== String(cid); });
    settings.customThemes = list;
    if (hasStorageLocal()) chrome.storage.local.set({ sfCustomThemes: list });
    const cur = settings.themePalette || 'classic';
    let next = cur;
    if (cur === 'custom:' + cid) {
      next = list.length ? 'custom:' + list[0].id : 'classic';
      settings.themePalette = next;
      if (hasStorage()) chrome.storage.sync.set({ themePalette: next });
    }
    ensureCustomThemeCards(next.indexOf('custom:') === 0 ? next.replace('custom:', '') : null);
    const grid2 = $('themeGrid');
    if (grid2) grid2.querySelectorAll('.theme-opt').forEach(function (x) { x.classList.toggle('active', (x.dataset.palette || 'classic') === next); });
    refreshThemeCurrent();
    applyAppearance();
  }
  themeGrid.addEventListener('contextmenu', function (e) {
    const card = e.target.closest('.theme-opt.theme-custom');
    if (!card) return; // 预设卡（classic/gold/…）不弹菜单
    e.preventDefault();
    const menu = $('themeCtx');
    if (!menu) return;
    menu.dataset.cid = card.dataset.cid;
    // 先显示但不可见，拿到真实尺寸后再定位，避免 display:none 时 offset=0 导致被推到右下角
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const rect = card.getBoundingClientRect();
    let x = e.clientX, y = e.clientY;
    // 优先显示在鼠标右下；如果超界则反向
    if (x + mw > window.innerWidth - 6) x = Math.max(6, x - mw - 6);
    if (y + mh > window.innerHeight - 6) y = Math.max(6, y - mh - 6);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.visibility = 'visible';
  });
  document.addEventListener('click', function () { const m = $('themeCtx'); if (m) m.style.display = 'none'; });
  document.addEventListener('scroll', function () { const m = $('themeCtx'); if (m) m.style.display = 'none'; }, true);
  const ctxMenu = $('themeCtx');
  if (ctxMenu) {
    ctxMenu.addEventListener('click', function (e) {
      const item = e.target.closest('[data-act]');
      if (!item) return;
      const cid = ctxMenu.dataset.cid;
      if (item.dataset.act === 'delete') {
        if (confirm('删除这个自定义主题？')) deleteCustomTheme(cid);
      }
      ctxMenu.style.display = 'none';
    });
  }

  // 自定义主题：导入入口（点击虚线卡片 → 选 JSON → 解析 → 追加到数组 → 重建卡片并应用）
  const themeImportCard = $('themeImportCard');
  const themeImportFile = $('themeImportFile');
  if (themeImportCard) themeImportCard.addEventListener('click', function () { if (themeImportFile) themeImportFile.click(); });
  if (themeImportFile) {
    themeImportFile.addEventListener('change', function () {
      const f = this.files && this.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const d = JSON.parse(reader.result);
          if (d.type !== 'custom-theme' || !d.theme) throw new Error('bad');
          const list = Array.isArray(settings.customThemes) ? settings.customThemes : (settings.customTheme ? [settings.customTheme] : []);
          const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const ct = { id: newId, name: d.name || '导入的主题', theme: d.theme };
          list.push(ct);
          settings.customThemes = list;
          if (settings.customTheme) settings.customTheme = null; // 迁移到数组
          // —— 一次性应用：把主题可调属性灌入 settings + 同步 UI 控件（仅此一次，之后用户可在 UI 自由修改，不锁死）——
          const t = d.theme;
          settings.material = t.material || settings.material || 'frosted';
          settings.sidebar = t.sidebar || settings.sidebar || 'attached';
          settings.control = t.control || settings.control || 'normal';
          settings.fontMode = t.fontMode || settings.fontMode || 'system';
          // 编辑器导出的主题用百分比(85~140)存 fontScale，扩展内部用系数(0.85~1.40)。>5 视为百分比，换算为系数
          let _impFs = t.fontScale;
          if (typeof _impFs === 'number' && _impFs > 5) _impFs = _impFs / 100;
          settings.fontScale = (_impFs || settings.fontScale || 1);
          settings.bgType = t.bgType || 'gradient';
          settings.bgImage = (t.bgType === 'image') ? (t.bgImage || '') : '';
          settings.theme = t.themeLight ? 'light' : 'dark';
          // 同步 UI 控件，使 applyAppearance 从 DOM 读到主题值、用户后续改动立即生效
          if ($('themeLight')) $('themeLight').checked = !!t.themeLight;
          document.querySelectorAll('.font-opt').forEach(function (x) { x.classList.toggle('active', (x.dataset.font || 'system') === settings.fontMode); });
          if ($('fontScale')) { $('fontScale').value = Math.round(settings.fontScale * 100); if (typeof updateSliderFill === 'function') updateSliderFill(); }
          document.querySelectorAll('#materialSeg button').forEach(function (x) { x.classList.toggle('active', (x.dataset.material || 'frosted') === settings.material); });
          // 自定义主题数组可能含 base64 背景图，体积易超 chrome.storage.sync 单条 8192 字节上限，
          // 会导致整条 set 静默失败（错误仅存于 chrome.runtime.lastError），刷新后主题从 storage 读不到而消失。
          // 故 customThemes 改存 chrome.storage.local（配额大），由 init 读回合并，彻底根治该问题。
          if (hasStorageLocal()) chrome.storage.local.set({ sfCustomThemes: list });
          if (hasStorage()) chrome.storage.sync.set({
            customTheme: null,
            material: settings.material, sidebar: settings.sidebar, control: settings.control,
            fontMode: settings.fontMode, fontScale: settings.fontScale,
            bgType: settings.bgType, theme: settings.theme
          });
          // 导入主题自带背景图时也走 local（与手动上传背景同一通道），避免大字段拖垮 sync
          if (settings.bgImage && settings.bgType === 'image') {
            if (hasStorageLocal()) chrome.storage.local.set({ sfBgImage: settings.bgImage });
          } else {
            if (hasStorageLocal()) chrome.storage.local.remove('sfBgImage');
          }
          ensureCustomThemeCards(newId);
          refreshThemeCurrent();
          applyAppearance();
          flashThemeAnim();
          if (hasStorage()) chrome.storage.sync.set({ themePalette: 'custom:' + newId });
          showToast();
        } catch (e) {
          alert('文件解析失败，请确认是主题编辑器导出的 JSON 配置。');
        } finally { themeImportFile.value = ''; }
      };
      reader.readAsText(f);
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
  function setUseHref(svgEl, href, animate) {
    if (!svgEl) return;
    const u = svgEl.querySelector('use');
    if (!u) return;
    if (!animate) { u.setAttribute('href', href); return; }
    // 两个 SVG 之间的丝滑过渡：旧图标缩没淡出 → 换 href → 新图标弹性淡入
    svgEl.classList.add('prov-swap');
    setTimeout(function () {
      u.setAttribute('href', href);
      void svgEl.offsetWidth;            // 强制回流，确保过渡重新触发
      svgEl.classList.remove('prov-swap');
    }, 200);
  }

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
    setUseHref(provTriggerIc, PROVIDER_ICON[provider] || '#prov-custom', fromUser);
    if (provTriggerLabel) provTriggerLabel.textContent = def.label;
    // 同步弹层选中态
    if (aiProviderPop) {
      aiProviderPop.querySelectorAll('.prov-opt').forEach((el) => {
        el.classList.toggle('sel', el.dataset.provider === provider);
      });
    }
    settings.aiProvider = provider;
    updateEntrySummary(fromUser);
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

  function updateEntrySummary(animate) {
    const def = PROVIDER_DEFAULTS[currentProvider] || PROVIDER_DEFAULTS.custom;
    const model = (aiModel && aiModel.value.trim()) || def.defaultModel || '（未指定）';
    const free = currentProvider === 'zhipu';
    if (entryProvIc) setUseHref(entryProvIc, PROVIDER_ICON[currentProvider] || '#prov-custom', animate);
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

// ===== 常规页 · 卡巴式防护状态总览（2026-09-13）=====
// 只装扩展（未装主防程序 SilverFoxEnvScan）→「防护不完全」；
// 扩展 + 主防程序都就绪 →「你已受到完全防护」。
const KAV_NM_HOST = 'com.silverfox.envscan';
let kavSysChecked = false;   // 是否已探测过主防程序（避免每次渲染重复探测）
let kavSysInstalled = false; // 探测结果缓存
const KAV_DOWNLOAD_URL = 'https://github.com/yinbo345/silverfox-guard/releases';

// 探测主防程序是否安装：尝试一次原生消息连接，能收到应答即视为已安装。
function probeSystemInstalled() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connectNative) { resolve(false); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const to = setTimeout(() => finish(false), 1200);
    let port;
    try {
      port = chrome.runtime.connectNative(KAV_NM_HOST);
    } catch (e) { clearTimeout(to); finish(false); return; }
    port.onMessage.addListener(() => { clearTimeout(to); finish(true); });
    port.onDisconnect.addListener(() => { clearTimeout(to); finish(false); });
    try { port.postMessage({ type: 'status' }); } catch (e) { /* postMessage 失败也会触发断开回调 */ }
    setTimeout(() => { try { port.disconnect(); } catch (e) {} }, 1300);
  });
}

// 用当前状态刷新总览 hero 与组件网格
function refreshKavGeneral() {
  const hero = $('kavHero');
  const title = $('kavTitle');
  const sub = $('kavSub');
  const installBtn = $('kavInstallBtn');
  if (!hero || !title) return;
  const extOn = !!($('enabledGlobal') && $('enabledGlobal').checked);
  const sys = kavSysInstalled;

  // hero 状态
  hero.classList.remove('protected', 'partial');
  if (!extOn) {
    hero.classList.add('partial');
    title.textContent = '防护已关闭';
    sub.textContent = '扩展总开关已关闭，正在浏览的网页将不再进行分析与拦截。请在下方重新开启。';
    if (installBtn) installBtn.hidden = true;
  } else if (sys) {
    hero.classList.add('protected');
    title.textContent = '你已受到完全防护';
    sub.textContent = '浏览器扩展与本机主防程序（银狐环境检测）均已就绪：网页仿冒钓鱼拦截 + 常驻系统扫描双重防护。';
    if (installBtn) installBtn.hidden = true;
  } else {
    hero.classList.add('partial');
    title.textContent = '防护不完全';
    sub.textContent = '仅安装浏览器扩展，未检测到本机主防程序（SilverFoxEnvScan）。缺少常驻系统级扫描与一键清除能力，建议立即安装。';
    if (installBtn) { installBtn.hidden = false; installBtn.onclick = () => window.open(KAV_DOWNLOAD_URL, '_blank'); }
  }

  // 本机环境检测模块状态（唯一防护组件卡：网页防护/下载防护由扩展本体承担，不再单列卡片）
  const sysSt = $('kavModSysSt');
  const sysStEl = document.getElementById('kavModSys');
  if (sysSt) {
    sysSt.textContent = sys ? '已连接' : '未安装';
    sysSt.className = 'kav-mod-st ' + (sys ? 'ok' : 'warn');
    if (sysStEl) { sysStEl.classList.remove('on', 'off'); sysStEl.classList.add(sys ? 'on' : 'off'); }
  }
}

// 初始化卡巴式总览：探测主防程序 → 刷新状态
async function initKavGeneral() {
  if (!kavSysChecked) {
    kavSysChecked = true;
    kavSysInstalled = await probeSystemInstalled();
  }
  refreshKavGeneral();
  const extToggle = $('enabledGlobal');
  const dlToggle = $('autoBlockDownloads');
  if (extToggle) extToggle.addEventListener('change', refreshKavGeneral);
  if (dlToggle) dlToggle.addEventListener('change', refreshKavGeneral);
  // 环境检测页可能已有自己的 NM 连接，这里仅做一次性探测不冲突
  setTimeout(refreshKavGeneral, 100);
}

// 「银狐急救」分类：展示官方直链 + 点击按钮直接下载 360 系统急救箱
/* 下钻导航：枢纽页卡片 → 独立子页面，返回时回到来源枢纽页（规则白名单 + 工具中心 + 个性化主题共用）。
   支持多级嵌套返回（工具中心 → 样本扫描 → 扫描器子页），栈记录每层「从哪进来」。 */
function setupSubNav() {
  const backBtn = $('backBtn');
  const secTitle = $('secTitle');
  const secDesc = $('secDesc');
  // 子页导航栈：每个元素 { hub, title, desc } —— hub 为上一级页面 id
  window.__sfSubStack = [];

  function pushEntry(hubId, title, desc) {
    window.__sfSubStack.push({ hub: hubId, title: title, desc: desc });
  }

  // 依据当前唯一 active 的 section 同步环境检测端口（进入 envscan 开、离开关）
  function syncEnvPortByActive() {
    if (!window.__sfEnvscanPort) return;
    const act = document.querySelector('.sec.active');
    window.__sfEnvscanPort(!!act && act.id === 'envscan');
  }

  document.querySelectorAll('[data-sub]').forEach((card) => {
    card.addEventListener('click', () => {
      const sub = $(card.dataset.sub);
      if (!sub) return;
      const hubSec = card.closest('.sec');
      // 记录「当前所在页」作为返回目标（进 scanner-main 时记录 scanner，返回可逐级退到工具中心）
      pushEntry(hubSec ? hubSec.id : 'rules', secTitle.textContent, secDesc.textContent);
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
      syncEnvPortByActive();
    });
  });

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (typeof stopChangelogShow === 'function') stopChangelogShow();
      window.__sfReturnHub = null;
      const stack = window.__sfSubStack;
      if (!stack || !stack.length) { backBtn.hidden = true; return; }
      const last = stack.pop();
      const hub = last.hub;
      const hubNav = findNavForTarget(hub);
      if (hubNav) {
        // 返回一级导航项：模拟点击统一处理分组高亮 + envscan 端口联动，返回即退出子页模式
        hubNav.click();
        backBtn.hidden = true;
        stack.length = 0;   // 已回到一级分类，清空残留栈
      } else {
        // 中间层级（如 scanner 自身也是工具中心的子页）：继续留在子页模式，还可再返回
        document.querySelectorAll('.sec').forEach((s) => s.classList.remove('active'));
        const h = $(hub);
        if (h) h.classList.add('active');
        secTitle.textContent = last.title || '';
        secDesc.textContent = last.desc || '';
        backBtn.hidden = stack.length === 0;
      }
      syncEnvPortByActive();
    });
  }
}

// 打开一个子页（#sec= 直达时）：找到对应 data-sub 卡片模拟点击，走统一子页激活逻辑
function openSubById(id) {
  const sec = document.getElementById(id);
  const card = document.querySelector('[data-sub="' + id + '"]');
  if (!sec) return false;
  if (card && typeof card.click === 'function') { card.click(); return true; }
  return false;
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

  // 火绒专杀工具（无签名版）：可解除银狐对杀毒软件的打开限制
  const hkUrl = $('hrkillUrl');
  if (hkUrl) {
    hkUrl.textContent = HRKILL_DOWNLOAD_URL;
    hkUrl.title = '点击复制';
    hkUrl.addEventListener('click', () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(HRKILL_DOWNLOAD_URL).then(() => showToast(), () => showToast());
        } else { showToast(); }
      } catch (e) { showToast(); }
    });
  }

  const hkBtn = $('hrkillBtn');
  if (hkBtn) {
    hkBtn.addEventListener('click', () => {
      // 优先用扩展下载 API 直接拉取直链；无权限或失败时降级为打开直链
      if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download({
          url: HRKILL_DOWNLOAD_URL,
          filename: 'hrkill_unsign-1.0.0.172.exe',
          conflictAction: 'uniquify'
        }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            window.open(HRKILL_DOWNLOAD_URL, '_blank', 'noopener');
          }
        });
      } else {
        window.open(HRKILL_DOWNLOAD_URL, '_blank', 'noopener');
      }
    });
  }
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
    sidebar: ((window.__sfSettings && window.__sfSettings.sidebar) || 'attached'),
    control: ((window.__sfSettings && window.__sfSettings.control) || 'normal'),
    bgType: ((window.__sfSettings && window.__sfSettings.bgType) || 'gradient'),
    // customThemes 已单独存 chrome.storage.local（见 save 处理），此处不再写入 sync 以免超 8KB 配额静默失败
    customTheme: null, // 旧单主题字段已废弃，显式清空
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
    layout: ((window.__sfSettings && window.__sfSettings.layout) || 'new'),   // 双布局：new(新版默认)/old(旧版)
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

function timeAgo(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
  try { return new Date(ts).toLocaleDateString(); } catch (e) { return ''; }
}
const LEVEL_LABEL = { danger: '高危', warn: '警告', safe: '放行' };
const LEVEL_COLOR = { danger: '#ff4d6d', warn: '#ffae42', safe: '#4be38b' };
function loadStats() {
  if (!hasStorage()) { if ($('stWarn')) $('stWarn').textContent = 0; if ($('stBlock')) $('stBlock').textContent = 0; return; }
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
    const st = r.stats || { warnings: 0, blocks: 0, recent: [] };
    if ($('stWarn')) $('stWarn').textContent = st.warnings || 0;
    if ($('stBlock')) $('stBlock').textContent = st.blocks || 0;
    const recent = Array.isArray(st.recent) ? st.recent : [];
    const counts = {};
    recent.forEach((x) => { const k = x.level || 'safe'; counts[k] = (counts[k] || 0) + 1; });
    const total = recent.length;
    const bar = $('dlBar');
    if (bar) {
      if (!total) bar.innerHTML = '<span class="dl-empty">暂无记录</span>';
      else {
        bar.innerHTML = '';
        Object.keys(counts).forEach((k) => {
          const seg = document.createElement('span');
          seg.className = 'dl-seg';
          seg.style.width = (counts[k] / total * 100) + '%';
          seg.style.background = LEVEL_COLOR[k] || '#888';
          seg.title = (LEVEL_LABEL[k] || k) + '：' + counts[k];
          bar.appendChild(seg);
        });
      }
    }
    const legend = $('dlLegend');
    if (legend) {
      const items = Object.keys(LEVEL_LABEL).filter((k) => counts[k]).map((k) =>
        '<span class="dl-lg"><i style="background:' + (LEVEL_COLOR[k] || '#888') + '"></i>' + LEVEL_LABEL[k] + ' ' + (counts[k] || 0) + '</span>'
      );
      legend.innerHTML = items.join('') || '<span class="dl-empty">暂无记录</span>';
    }
    const rl = $('dlRecent');
    if (rl) {
      if (!total) { rl.innerHTML = '<div class="dl-empty">暂无记录</div>'; }
      else {
        rl.innerHTML = '';
        recent.slice(0, 12).forEach((x) => {
          const lv = x.level || 'safe';
          const item = document.createElement('div');
          item.className = 'dl-item';
          const dot = document.createElement('span'); dot.className = 'dl-dot'; dot.style.background = LEVEL_COLOR[lv] || '#888';
          const host = document.createElement('span'); host.className = 'dl-host'; host.textContent = x.hostname || '未知域名';
          const lev = document.createElement('span'); lev.className = 'dl-lev'; lev.textContent = LEVEL_LABEL[lv] || lv;
          const time = document.createElement('span'); time.className = 'dl-time'; time.textContent = timeAgo(x.time);
          item.append(dot, host, lev, time);
          rl.appendChild(item);
        });
      }
    }
  });
}

// 白名单 / 规则 导入导出（JSON）
function bindRulesIO() {
  const expBtn = $('rulesExport');
  const impBtn = $('rulesImport');
  const impFile = $('rulesImportFile');
  if (expBtn) expBtn.addEventListener('click', () => {
    if (!hasStorage()) return;
    chrome.storage.sync.get({ allowlist: [], customKeywords: [], customBadDomains: [] }, (s) => {
      const payload = { app: 'silverfox-guard', type: 'rules', version: '1.5.3', exportedAt: Date.now(),
        allowlist: s.allowlist || [], customKeywords: s.customKeywords || [], customBadDomains: s.customBadDomains || [] };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'silverfox-rules-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  });
  if (impBtn && impFile) {
    impBtn.addEventListener('click', () => impFile.click());
    impFile.addEventListener('change', () => {
      const file = impFile.files && impFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const patch = {};
          if (Array.isArray(data.allowlist)) patch.allowlist = data.allowlist;
          if (Array.isArray(data.customKeywords)) patch.customKeywords = data.customKeywords;
          if (Array.isArray(data.customBadDomains)) patch.customBadDomains = data.customBadDomains;
          if (!Object.keys(patch).length) { alert('文件中没有可导入的白名单 / 规则数据。'); return; }
          if (!confirm('导入将覆盖当前「信任域名白名单 / 自定义风险关键词 / 自定义恶意域名黑名单」三项内容，确定继续？')) return;
          if (hasStorage()) chrome.storage.sync.set(patch, () => {
            if (window.__sfSettings) Object.assign(window.__sfSettings, patch);
            // 同步回填到对应文本框（若当前在编辑态）
            if ($('allowlist') && Array.isArray(patch.allowlist)) $('allowlist').value = patch.allowlist.join('\n');
            if ($('customKeywords') && Array.isArray(patch.customKeywords)) $('customKeywords').value = patch.customKeywords.join('\n');
            if ($('customBadDomains') && Array.isArray(patch.customBadDomains)) $('customBadDomains').value = patch.customBadDomains.join('\n');
            showToast();
          });
        } catch (e) {
          alert('文件解析失败，请确认是银狐防护导出的 JSON 配置。');
        } finally {
          impFile.value = '';
        }
      };
      reader.readAsText(file);
    });
  }
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
  // —— 自定义主题存储策略 ——
  // 早期版本将自定义主题存 chrome.storage.sync，而主题常含 base64 背景图，易超 sync 单条 8192 字节上限，
  // 导致整条 set 静默失败（错误仅存于 chrome.runtime.lastError），刷新后主题从 storage 读不到而「消失」。
  // 现统一改存 chrome.storage.local（配额约 5MB，足以容纳背景图），init 启动时读回合并，彻底根治该问题。
  // 兼容迁移：sync 里残留的旧单主题 customTheme / 旧数组 customThemes 归一化后并入 local。
  if (hasStorageLocal()) {
    const ctRes = await new Promise((res) => chrome.storage.local.get({ sfCustomThemes: [] }, res));
    let merged = (ctRes && Array.isArray(ctRes.sfCustomThemes)) ? ctRes.sfCustomThemes.slice() : [];
    if (settings.customTheme && !Array.isArray(settings.customThemes)) {
      merged.push({ id: 'mig_' + Date.now().toString(36), name: settings.customTheme.name || '自定义主题', theme: settings.customTheme.theme });
      settings.customTheme = null;
    }
    if (Array.isArray(settings.customThemes)) {
      merged = merged.concat(settings.customThemes.filter(function (x) {
        return !merged.some(function (y) { return String(y.id) === String(x.id); });
      }));
    }
    if (merged.length) {
      settings.customThemes = merged;
      chrome.storage.local.set({ sfCustomThemes: merged });
    }
    if (settings.themePalette === 'custom' && merged.length) {
      settings.themePalette = 'custom:' + merged[0].id;
    }
  }
  if (settings.customTheme) settings.customTheme = null; // 旧单主题字段废弃
  if (hasStorage()) chrome.storage.sync.set({ customTheme: null });
  window.__sfSettings = settings;   // 缓存供 applyAppearance / 材质 / 背景读取
  if (settings.pixelUnlocked) document.documentElement.classList.add('pixel-unlocked');
  renderCategories(settings);
  bindControls(settings);
  loadStats();
  bindLayoutSwitch();   // 先渲染导航（默认新版），再绑定点击
  setupNav();
  setupSubNav();
  initKavGeneral();   // 常规页卡巴式防护状态总览（主防程序探测）

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
        const navItem = findNavForTarget(id);
        if (sec && navItem && typeof navItem.click === 'function') {
          navItem.click();
        } else if (openSubById(id)) {
          // 新版布局下 rescue/scanner/envscan 等子页无独立导航项，走卡片激活（含返回栈）
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
  bindRulesIO();
  loadDlBlacklist();
  bindLearnPanel();
  loadLearnPanel();

  // 更新日志入口（关于页链接 + 更新成功弹窗跳转）—— 更新日志不在左侧分类导航
  const ac = $('aboutChangelog');
  if (ac) ac.addEventListener('click', (e) => { e.preventDefault(); showChangelog(); });

  setupPixelEgg();
  setupUpdateToast();

  // 自动更新检查：打开设置页自动查官网版本（有更新才提示）；关于页「检查更新」手动触发
  (function bindUpdateCheck() {
    var mcu = $('manualCheckUpdate');
    if (mcu) mcu.addEventListener('click', function () { checkUpdate(true); });
    var close = $('uctClose');
    if (close) close.addEventListener('click', function () {
      var b = $('updateCheckToast'); if (!b) return;
      b.classList.add('is-hiding'); setTimeout(function () { b.hidden = true; b.classList.remove('is-hiding'); }, 280);
    });
    var later = $('uctLater');
    if (later) later.addEventListener('click', function () {
      var b = $('updateCheckToast'); if (!b) return;
      b.classList.add('is-hiding'); setTimeout(function () { b.hidden = true; b.classList.remove('is-hiding'); }, 280);
      var vEl = $('uctVer'); var v = vEl ? vEl.textContent.replace(/^v/, '') : '';
      if (v && hasStorageLocal()) chrome.storage.local.set({ sfUpdateDismissed: v });
    });
    if (hasStorage()) checkUpdate(false);
  })();

  // 关于页：云端官网库状态展示 + 手动检查更新（纯前端：直接 fetch CDN 公开名单 + 读 storage.local）
  (function bindCloudLib() {
    var info = $('cloudLibInfo');
    var btn = $('cloudLibRefresh');
    var spin = $('cloudLibChecking');
    var CACHE_KEY = 'sf_cloud_official';
    var DATA_URL = 'https://site-directory-cache.pages.dev/official-domains.json';

    function fmtMeta(meta) {
      if (!meta) return '未知';
      // 公开数据无版本号时，以「条数」与「数据更新日期」作为状态标识
      var cnt = (typeof meta.count === 'number' && meta.count > 0) ? ('共 ' + meta.count + ' 条') : '';
      var upd = meta.updated ? ('数据更新于 ' + meta.updated) : '';
      var parts = [cnt, upd].filter(Boolean);
      return parts.length ? parts.join('，') : '暂无数据';
    }
    // 优先从本地缓存秒级展示（设置页打开即见，无需联网、不碰后台消息端口）
    function showFromCache() {
      try {
        chrome.storage.local.get(CACHE_KEY, function (res) {
          var d = res && res[CACHE_KEY];
          if (info) info.textContent = fmtMeta(d ? { count: d.domains ? d.domains.length : 0, updated: d.updated || null } : null);
        });
      } catch (e) {}
    }
    // 纯前端刷新：直接拉 CDN 公开名单，落 storage.local；后台经 storage.onChanged 自动同步内存 Set
    function refresh() {
      if (spin) spin.hidden = false;
      if (btn) btn.disabled = true;
      fetch(DATA_URL, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var et = r.headers.get('etag'); // GET 响应头自带 ETag，一并写入以便后台增量比对一致
          return r.json().then(function (j) { return { j: j, et: et }; });
        })
        .then(function (o) {
          var j = o.j, et = o.et;
          var arr = (j && j.domains) || [];
          if (!Array.isArray(arr)) throw new Error('bad payload');
          try {
            chrome.storage.local.set({ [CACHE_KEY]: { version: (j && j.version) || null, domains: arr, updated: (j && j.updated) || null, etag: et || null, cachedAt: Date.now() } });
          } catch (e) {}
          if (info) info.textContent = fmtMeta({ count: arr.length, updated: (j && j.updated) || null });
        })
        .catch(function () {
          if (info) info.textContent = '刷新失败，请检查网络后重试';
        })
        .then(function () {
          if (spin) spin.hidden = true;
          if (btn) btn.disabled = false;
        });
    }
    if (btn) btn.addEventListener('click', refresh);
    showFromCache();
  })();

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
    // 自定义主题可能含大体积背景图，单独存 chrome.storage.local，避免 sync 8KB 配额静默失败
    if (hasStorageLocal()) chrome.storage.local.set({ sfCustomThemes: (window.__sfSettings && Array.isArray(window.__sfSettings.customThemes)) ? window.__sfSettings.customThemes : [] });
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

// ===== 环境检测（联动本地银狐环境检测程序 · 原生消息 Native Messaging）=====
// 检测程序以 Windows 服务常驻后台（无托盘、无独立页面），经私有管道与扩展安全联动。
// 不经过任何本地端口，银狐无法劫持；扩展仅读取结果，绝不上报任何用户数据。
(function () {
  const NM_HOST = 'com.silverfox.envscan';
  // 单独下载地址：发布检测程序后请更新此常量（建议挂在银狐防护 GitHub Release 或官网）。
  const DOWNLOAD_URL = 'https://github.com/yinbo345/silverfox-guard/releases';
  const statusEl = document.getElementById('envscanStatus');
  const findingsEl = document.getElementById('envscanFindings');
  const hintEl = document.getElementById('envscanHint');
  const dlBtn = document.getElementById('envscanDownload');
  const checkBtn = document.getElementById('envscanCheck');
  const shieldEl = document.getElementById('envscanShield');
  const historyEl = document.getElementById('envscanHistory');
  const historyCard = document.getElementById('envscanHistoryCard');
  let port = null;
  let timer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sevClass(s) { return s === '高' ? 'sev-high' : s === '中' ? 'sev-mid' : s === '警告' ? 'sev-warn' : 'sev-low'; }
  // 三态：normal=环境正常（绿）/ warning=预警（黄）/ infected=疑似中银狐（红）
  function statusClass(st) {
    if (st === 'infected') return 'st-infected';
    if (st === 'warning') return 'st-suspicious';
    return 'st-normal';
  }
  function statusText(st) {
    if (st === 'infected') return '高危：疑似感染银狐';
    if (st === 'warning') return '预警：检测到可疑迹象';
    return '环境正常';
  }

  function setShield(st) {
    if (!shieldEl) return;
    let cls = 'shield-normal';
    if (st === 'infected') cls = 'shield-infected';
    else if (st === 'warning') cls = 'shield-suspicious';
    else if (st === 'offline') cls = 'shield-offline';
    shieldEl.className = 'rescue-ico ' + cls;
  }

  // 清除记录：按处理结果分类渲染（deleted/deferred/failed/skipped + 进程/连坐 DLL 统计）
  function renderHistory(records) {
    if (!historyEl || !historyCard) return;
    historyCard.hidden = false;
    if (!records || !records.length) {
      historyEl.innerHTML = '<div class="hst-empty">暂无清除记录</div>';
      return;
    }
    const ACTION_LABEL = { deleted: '已删除', deferred: '重启删除', failed: '失败', skipped: '自保跳过' };
    const ACTION_CLS   = { deleted: 'ok',   deferred: 'mid',   failed: 'bad',   skipped: 'off' };
    const html = records.map(function (r) {
      const mode = r.mode === 'advanced' ? '高级清除' : '普通清除';
      const modeCls = r.mode === 'advanced' ? 'adv' : 'norm';
      // 分类计数（deleted 里已含 extraDlls 的路径？extraDlls 是数量，路径不在 items 时仅计数）
      const byAction = {};
      (r.items || []).forEach(function (it) {
        const a = it.action || 'deleted';
        (byAction[a] = byAction[a] || []).push(it);
      });
      let chips = '';
      Object.keys(byAction).forEach(function (a) {
        const cls = ACTION_CLS[a] || 'off';
        chips += '<span class="hst-chip ' + cls + '">' + (ACTION_LABEL[a] || a) + ' ' + byAction[a].length + '</span>';
      });
      if (r.killed > 0) chips += '<span class="hst-chip kill">结束进程 ' + r.killed + '</span>';
      if (r.extraDlls > 0) chips += '<span class="hst-chip dll">连坐 DLL ' + r.extraDlls + '</span>';
      // 明细：仅展示非成功项（失败 / 重启删除）的路径，最多 6 条
      const bad = []
        .concat(byAction.failed || [], byAction.deferred || []).slice(0, 6);
      let detail = '';
      if (bad.length) {
        detail = '<div class="hst-paths">' + bad.map(function (it) {
          return '<div class="hst-path"><span class="hst-a ' + (ACTION_CLS[it.action] || 'off') + '">' +
            (ACTION_LABEL[it.action] || it.action) + '</span>' + esc(it.path) + '</div>';
        }).join('') +
        ((byAction.failed || []).length + (byAction.deferred || []).length > 6
          ? '<div class="hst-more">…等 ' + ((byAction.failed || []).length + (byAction.deferred || []).length) + ' 项</div>'
          : '') + '</div>';
      }
      return '<div class="hst-item">' +
        '<div class="hst-head"><span class="hst-time">' + esc(r.time || '') + '</span>' +
        '<span class="hst-mode ' + modeCls + '">' + mode + '</span>' +
        '<span class="hst-sum">请求 ' + (r.requested || 0) + ' 项</span></div>' +
        '<div class="hst-chips">' + chips + '</div>' + detail + '</div>';
    }).join('');
    historyEl.innerHTML = html;
  }

  function render(data) {
    if (!statusEl) return;
    if (data && data.type === 'service_unavailable') { showServiceDown(); return; }
    const st = data && data.status;
    statusEl.className = 'envscan-status ' + statusClass(st);
    setShield(st);
    const engine = (data && data.engine) || '';
    const time = (data && data.timestamp) || '';
    const score = (data && typeof data.score === 'number') ? data.score : 0;
    const count = (data && typeof data.count === 'number') ? data.count : (data && data.findings ? data.findings.length : 0);
    const selfBad = (data && data.selfCheck === false);
    statusEl.innerHTML = '<strong>' + statusText(st) + '</strong>' +
      '<span class="es-meta">引擎 v' + esc(engine) + ' ｜ ' + esc(time) + ' ｜ 风险分 ' + score + ' ｜ 命中 ' + count + ' 项' +
      (selfBad ? ' ｜ 程序自身完整性校验失败！' : '') + '</span>';
    if (findingsEl) {
      findingsEl.innerHTML = '';
      const list = (data && data.findings) || [];
      if (list.length) {
        // 按等级分组折叠：高（默认展开）/ 中（默认展开）/ 低 / 警告（默认收起）。
        // 「警告」= 权重 0 的纯提示项（旁证 / 自保健康状态），不参与判危。
        const GROUPS = [
          { key: '高',   label: '高危',  open: true  },
          { key: '中',   label: '中危',  open: true  },
          { key: '低',   label: '低危',  open: false },
          { key: '警告', label: '警告 · 不计分提示', open: false }
        ];
        GROUPS.forEach(function (g) {
          const rows = list.filter(function (f) { return (f.severity || '低') === g.key; });
          if (!rows.length) return;
          const det = document.createElement('details');
          det.className = 'es-group es-g-' + g.key;
          if (g.open) det.open = true;
          const table = document.createElement('table');
          table.className = 'es-table';
          table.innerHTML = '<tr><th>类别</th><th>等级</th><th>权重</th><th>说明</th><th>IOC</th></tr>';
          rows.forEach(function (f) {
            const w = (typeof f.weight === 'number') ? f.weight : 0;
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + esc(f.category) + '</td>' +
              '<td class="' + sevClass(f.severity) + '">' + esc(f.severity) + '</td>' +
              '<td class="es-weight">' + w + '</td>' +
              '<td>' + esc(f.title) + '<br><span class="es-detail">' + esc(f.detail || '') + '</span></td>' +
              '<td>' + esc(f.ioc || '') + '</td>';
            table.appendChild(tr);
          });
          const sum = document.createElement('summary');
          sum.innerHTML = '<span class="es-g-dot ' + g.key + '"></span>' + g.label +
            '<span class="es-g-count">' + rows.length + ' 项</span>';
          det.appendChild(sum);
          det.appendChild(table);
          findingsEl.appendChild(det);
        });
      }
    }
    if (hintEl) hintEl.style.display = 'none';
    // 扫描响应已到 → 恢复「立即检查」按钮（防连点禁用态）
    if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '立即检查'; }
  }

  // 已连上本地程序，但后台 Windows 服务没运行
  function showServiceDown() {
    if (!statusEl) return;
    statusEl.className = 'envscan-status st-offline';
    statusEl.innerHTML = '<strong>已连接本地程序，但后台服务未运行</strong>' +
      '<span class="es-meta">Windows 服务 SilverFoxEnvScanSvc 未启动。请：① 以管理员身份重装安装包；' +
      '② 或在「服务」(services.msc) 中手动启动 SilverFoxEnvScanSvc。</span>';
    setShield('offline');
    if (hintEl) hintEl.style.display = 'none';
  }
  // 连不上本地程序（宿主未找到 / 扩展 ID 不匹配被拦截 / 启动失败）——透出浏览器真实错误
  function showConnectionError(detail) {
    if (!statusEl) return;
    let meta = '无法与本地检测程序建立连接。请确认：①已安装银狐环境检测程序；' +
      '②安装时填写的 Chrome/Edge 扩展 ID 与当前扩展一致；③安装包以管理员身份运行。';
    if (detail) meta += '<br><span class="es-err">浏览器错误：' + esc(detail) + '</span>';
    statusEl.className = 'envscan-status st-offline';
    statusEl.innerHTML = '<strong>未连接本地检测程序</strong><span class="es-meta">' + meta + '</span>';
    setShield('offline');
    if (hintEl) hintEl.style.display = 'block';
  }

  function sendCmd(type) {
    if (port) { try { port.postMessage({ type: type }); } catch (e) { showConnectionError(); } }
  }

  function openPort() {
    if (port) return;
    try {
      port = chrome.runtime.connectNative(NM_HOST);
    } catch (e) { showConnectionError(e && e.message); return; }
    statusEl.className = 'envscan-status st-loading';
    statusEl.textContent = '正在连接本地检测程序…';
    port.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'clean_history') { renderHistory(msg.records || []); return; }
      render(msg);
      // 清除完成后（响应帧含 clean 报告）顺带刷新清除记录
      if (msg && msg.clean) sendCmd('history');
    });
    port.onDisconnect.addListener(function () {
      const err = chrome.runtime.lastError;
      port = null;
      if (timer) { clearInterval(timer); timer = null; }
      // 仅当连接真正出错时提示；service_unavailable 由消息分支处理，不会走到这里
      if (err) showConnectionError(err.message);
    });
    sendCmd('status');
    sendCmd('history');
    if (timer) clearInterval(timer);
    timer = setInterval(function () { sendCmd('status'); }, 30000);
  }

  function closePort() {
    if (timer) { clearInterval(timer); timer = null; }
    if (port) { try { port.disconnect(); } catch (e) {} port = null; }
  }

  if (dlBtn) dlBtn.addEventListener('click', function () { window.open(DOWNLOAD_URL, '_blank'); });
  if (checkBtn) checkBtn.addEventListener('click', function () {
    // 防连点：全量扫描 ~20 秒，扫描期间禁用按钮（服务端也会丢弃重复 rescan，双保险）
    if (checkBtn.disabled) return;
    checkBtn.disabled = true;
    checkBtn.textContent = '扫描中…';
    sendCmd('rescan');
  });

  // 进入「环境检测」相关导航（旧版单独项 / 新版并入「安全工具」分组）时打开原生消息端口
  // 并定时刷新；切走时断开端口。由 setupNav 统一驱动，避免新版导航重建后旧绑定失效。
  window.__sfEnvscanPort = function (open) { if (open) openPort(); else closePort(); };
  const curActive = document.querySelector('.nav-item.active');
  const curHas = curActive && (curActive.dataset.targets || curActive.dataset.target || '')
    .trim().split(/\s+/).indexOf('envscan') >= 0;
  if (curHas) openPort();
})();
