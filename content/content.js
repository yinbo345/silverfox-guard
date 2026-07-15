/*
 * content.js — 银狐防护内容脚本
 * 职责：1) 采集页面代码 + 工程化指标 + ICP 备案
 *       2) 调用评分引擎（含官方早期退出）
 *       3) 分层响应：safe 不动作 / warn 温和提示不拦 / danger 警告浮层 + 禁用全部下载入口
 *       4) 用户可「离开 / 继续访问(仍拦截) / 完全放行」
 *       5) 拦截任意元素触发的下载：a / button / div / img / 程序化 click / location 跳转 / window.open
 */
(function () {
  'use strict';

  const SF = window.SF_ANALYZER;

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
    allowlist: [],
    customKeywords: [],
    customBadDomains: []
  };

  let lastResult = { analyzed: false };
  let blockedCount = 0;
  let unblocked = false;
  let observer = null;
  let dangerActive = false;       // 本页已被判危 → 启用硬拦截钩子
  let hardGuardsInstalled = false; // 硬拦截钩子（window.open / a.click / 点击捕获 / location）是否已安装

  // 用户在「大弹窗」里点「仍要下载」后的短时放行窗口（ms）
  let nextAllowedUntil = 0;
  function isNextAllowed() { return Date.now() < nextAllowedUntil; }
  function allowNextAction(ms) { nextAllowedUntil = Date.now() + (ms || 500); }

  function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s || {})));
      } catch (e) { resolve(DEFAULTS); }
    });
  }

  function isAllowlisted(hostname, allowlist) {
    hostname = (hostname || '').toLowerCase();
    return (allowlist || []).some((d) => {
      d = (d || '').trim().toLowerCase();
      return d && (hostname === d || hostname.endsWith('.' + d));
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ===== 页面内轻提示（去抖，绝不刷屏）=====
  let toastEl = null, toastTimer = null, lastToastAt = 0;
  function showToast(msg) {
    const now = Date.now();
    if (now - lastToastAt < 1500) return; // 去抖：1.5s 内不重复弹
    lastToastAt = now;
    if (!toastEl || !document.body.contains(toastEl)) {
      toastEl = document.createElement('div');
      toastEl.className = 'sf-toast';
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.display = 'none'; }, 2600);
  }

  // ===== 采集页面代码 + 工程化指标 + ICP =====
  function collectMetrics() {
    let domElementCount = 0;
    try { domElementCount = document.getElementsByTagName('*').length; } catch (e) {}
    let extRes = 0;
    try {
      document.querySelectorAll('script[src],img[src],link[href],iframe[src],source[src],video[src],audio[src],object[data],embed[src]')
        .forEach((el) => {
          const a = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data-src') || el.getAttribute('data') || '';
          if (/^(https?:)?\/\//i.test(a) && a.indexOf(location.hostname) === -1) extRes++;
        });
    } catch (e) {}
    let framework = null;
    try {
      if (window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK) framework = 'react';
      else if (window.Vue || window.__VUE__) framework = 'vue';
      else if (window.angular) framework = 'angular';
      else if (window.jQuery || (window.$ && window.$.fn)) framework = 'jquery';
      else if (document.querySelector('next-route-announcer,[data-nextjs]')) framework = 'next';
    } catch (e) {}
    let bodyText = '';
    try { bodyText = document.body ? document.body.innerText || '' : ''; } catch (e) {}
    const textLength = bodyText.length;
    let cjk = 0;
    for (let i = 0; i < bodyText.length; i++) {
      const cp = bodyText.codePointAt(i);
      if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) cjk++;
      if (cp > 0xFFFF) i++;
    }
    const hasCJK = (cjk >= 30 && textLength > 0 && (cjk / textLength) >= 0.08) || cjk >= 500;
    let emojiCount = 0;
    try { emojiCount = (bodyText.match(/\p{Emoji_Presentation}|\p{Emoji}/gu) || []).length; } catch (e) {}
    const emojiDensity = textLength > 0 ? (emojiCount / textLength) * 1000 : 0;
    return {
      domElementCount, externalResourceCount: extRes, framework,
      textLength, cjkCount: cjk, cjkRatio: textLength ? cjk / textLength : 0,
      hasCJK, emojiCount, emojiDensity: Math.round(emojiDensity * 100) / 100
    };
  }

  function collect() {
    const hostname = location.hostname;
    const scripts = [];
    try {
      document.querySelectorAll('script').forEach((s) => {
        const t = s.textContent || s.innerText || '';
        if (t && t.length > 30) scripts.push(t);
      });
    } catch (e) {}
    const links = [];
    try {
      document.querySelectorAll('a[href]').forEach((a) => {
        links.push({ href: a.getAttribute('href'), text: (a.innerText || a.textContent || '').trim().slice(0, 40) });
      });
    } catch (e) {}
    const iframeSrcs = [];
    try {
      document.querySelectorAll('iframe,frame,object,embed').forEach((f) => {
        const s = f.getAttribute('src') || f.getAttribute('data-src') || '';
        if (s) iframeSrcs.push(s);
      });
    } catch (e) {}
    let html = '';
    try { html = document.documentElement.outerHTML || ''; } catch (e) {}
    return { hostname, title: document.title || '', html, scripts, links, iframeSrcs };
  }

  function extractIcp() {
    let hasIcpNumber = false, hasGovIcp = false, icpNumber = null;
    try {
      const t = (document.body && document.body.innerText) || '';
      const m = t.match(/ICP备[\s]*[A-Za-z0-9]+号?-?\d*/i) ||
                t.match(/ICP备案号[\s]*[：:]?[\s]*[A-Za-z0-9]+号?/i) ||
                t.match(/京ICP证\d+号/i) ||
                t.match(/沪ICP备\d+号/i);
      if (m) { hasIcpNumber = true; icpNumber = m[0]; }
      if (/京公网安备\s*\d+号?|公网安备\s*\d+号?|网安备/i.test(t)) hasGovIcp = true;
    } catch (e) {}
    return { hasIcpNumber, hasGovIcp, icpNumber };
  }

  // ===== 下载入口识别 =====
  const DOWNLOAD_TEXT = ['下载', '立即下载', '高速下载', '普通下载', '安全下载', '官方下载',
    '客户端', 'windows', 'win', 'macos', 'mac', 'linux', 'ubuntu', '安卓', 'android', 'ios', 'iphone',
    '安装包', '安装程序', 'pc版', '电脑版', '桌面版', '企业版', '个人版', '点击下载'];
  const DOWNLOAD_ATTRS = ['data-url', 'data-href', 'data-download', 'data-link', 'data-src', 'data-file', 'download'];

  function isDownloadUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    if (u.startsWith('blob:')) return true;
    if (u.startsWith('data:') && /base64/.test(u) && u.length > 500) return true;
    const t = SF.classifyLink(url);
    return t === 'exec' || t === 'cloud' || t === 'download' || t === 'archive';
  }

  function elementText(el) {
    let s = '';
    try {
      s += (el.innerText || el.textContent || '') + ' ';
      s += (el.getAttribute('title') || '') + ' ';
      s += (el.getAttribute('aria-label') || '') + ' ';
      s += (el.getAttribute('alt') || '') + ' ';
      s += (el.getAttribute('placeholder') || '');
    } catch (e) {}
    return s.toLowerCase();
  }

  // 判断单个元素是否像下载入口（div/button/a/img 等）
  function isDownloadEntry(el) {
    if (!el || el.nodeType !== 1) return false;
    // 排除扩展自身的浮层/横幅/提示（其 class 含 card/btn 等易误判词，且文本含"下载"）
    if (el.closest && el.closest('.sf-overlay,.sf-banner,.sf-hint,.sf-toast')) return false;
    if (el.tagName === 'A' && el.hasAttribute('href')) return isDownloadUrl(el.getAttribute('href'));
    const text = elementText(el);
    if (!DOWNLOAD_TEXT.some((k) => text.indexOf(k) !== -1)) return false;
    // 命中下载文本后，再判断它是否可点击或者是下载链接容器
    const tag = el.tagName;
    const role = el.getAttribute('role');
    const cls = String(el.className || '').toLowerCase();
    const id = String(el.id || '').toLowerCase();
    const hasOnclick = el.hasAttribute('onclick') || typeof el.onclick === 'function';
    const dataUrl = DOWNLOAD_ATTRS.map((a) => el.getAttribute(a)).filter(Boolean).join(' ');
    const isClickableTag = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
                           role === 'button' || role === 'link' || el.hasAttribute('tabindex') ||
                           /btn|button|download|down|client|card|item/i.test(cls + ' ' + id) ||
                           hasOnclick || dataUrl;
    if (!isClickableTag) return false;
    return isDownloadUrl(dataUrl) || true;
  }

  // 向上找下载入口祖先（最多 5 层）
  function findDownloadAncestor(el) {
    let cur = el && el.parentElement;
    for (let i = 0; cur && i < 6; i++) {
      if (isDownloadEntry(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // ===== 链接与下载入口静默禁用 =====
  function neutralize(el) {
    if (!el || el.dataset && el.dataset.sfBlocked || unblocked) return;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (!href || /^(javascript:|#|mailto:|tel:)/i.test(href)) return;
      if (!isDownloadUrl(href)) return;
    } else {
      if (!isDownloadEntry(el) && !findDownloadAncestor(el)) return;
    }
    el.dataset.sfBlocked = '1';
    el.addEventListener('click', blockHandler, true);
    el.addEventListener('contextmenu', blockHandler, true);
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.55';
    el.style.filter = 'grayscale(0.6)';
    if (el.tagName === 'A') {
      el.dataset.sfOriginalHref = el.getAttribute('href');
      el.removeAttribute('href');
    }
    blockedCount++;
  }

  // 点击被禁入口：弹大弹窗，由用户选择放行/保持拦截
  function blockHandler(e) {
    if (unblocked || !dangerActive || isNextAllowed()) return;
    const t = e.target;
    if (t && t.closest && t.closest('.sf-overlay,.sf-banner,.sf-hint,.sf-toast')) return;
    const entry = (e.target && (isDownloadEntry(e.target) || findDownloadAncestor(e.target))) || e.target;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    showDownloadBlocked(location.hostname, {
      target: entry
    });
    return false;
  }

  function blockAllDownloadEntries() {
    if (unblocked) return;
    try {
      document.querySelectorAll('a[href]').forEach(neutralize);
      // 额外扫描常见下载入口标签
      document.querySelectorAll('button, div, span, img, section, article, li').forEach(neutralize);
    } catch (e) {}
    // 拦截 JS 弹窗下载
    try {
      const _open = window.open;
      window.open = function (url) {
        if (unblocked || !dangerActive || isNextAllowed()) return _open.apply(window, arguments);
        if (arguments.length && isDownloadUrl(url)) {
          showDownloadBlocked(location.hostname, { url: url });
          return null;
        }
        return _open.apply(window, arguments);
      };
    } catch (e) {}
    // 拦截程序化 a.click（常见 fetch→blob→a.click 投递）
    try {
      const proto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype;
      if (proto && proto.click && !proto._sfClick) {
        const _click = proto.click;
        proto._sfClick = _click;
        proto.click = function () {
          const a = this;
          if (unblocked || !dangerActive || isNextAllowed()) return _click.call(a);
          const href = a.getAttribute('href') || a.href || '';
          if (isDownloadUrl(href)) {
            showDownloadBlocked(location.hostname, { url: href });
            return;
          }
          return _click.call(a);
        };
      }
    } catch (e) {}
    // 拦截 location 跳转下载
    installLocationGuard();
    // 全局点击捕获：拦截非 a/button/div 卡片的点击
    document.addEventListener('click', globalClickGuard, true);
    // 拦截表单提交到外部下载
    document.addEventListener('submit', function (e) {
      if (unblocked || !dangerActive || isNextAllowed()) return;
      const f = e.target;
      const action = (f && f.getAttribute && f.getAttribute('action')) || '';
      if (isDownloadUrl(action)) {
        e.preventDefault();
        showDownloadBlocked(location.hostname, { url: action });
      }
    }, true);
    // 监视动态注入的任意元素
    if (!observer) {
      observer = new MutationObserver((muts) => {
        if (unblocked) return;
        muts.forEach((m) => m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            neutralize(n);
            try { n.querySelectorAll && n.querySelectorAll('a[href],button,div,span,img,section,article,li').forEach(neutralize); } catch (e) {}
          }
        }));
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function installLocationGuard() {
    if (window.location && window.location._sfGuarded) return;
    window.location._sfGuarded = true;
    try {
      const hrefDesc = Object.getOwnPropertyDescriptor(window.location, 'href');
      if (hrefDesc && hrefDesc.set) {
        const origSet = hrefDesc.set;
        Object.defineProperty(window.location, 'href', {
          configurable: true,
          get: function () { return hrefDesc.get.call(window.location); },
          set: function (url) {
            if (unblocked || !dangerActive || isNextAllowed() || !isDownloadUrl(url)) {
              return origSet.call(window.location, url);
            }
            showDownloadBlocked(location.hostname, { url: url });
          }
        });
      }
    } catch (e) {}
    try {
      const origReplace = window.location.replace;
      window.location.replace = function (url) {
        if (unblocked || !dangerActive || isNextAllowed() || !isDownloadUrl(url)) return origReplace.apply(window.location, arguments);
        showDownloadBlocked(location.hostname, { url: url });
      };
    } catch (e) {}
    try {
      const origAssign = window.location.assign;
      window.location.assign = function (url) {
        if (unblocked || !dangerActive || isNextAllowed() || !isDownloadUrl(url)) return origAssign.apply(window.location, arguments);
        showDownloadBlocked(location.hostname, { url: url });
      };
    } catch (e) {}
  }

  function globalClickGuard(e) {
    if (unblocked || !dangerActive || isNextAllowed()) return;
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    // 扩展自身 UI 点击放行（双保险，避免误吞弹窗按钮）
    if (target.closest && target.closest('.sf-overlay,.sf-banner,.sf-hint,.sf-toast')) return;
    const entry = isDownloadEntry(target) ? target : findDownloadAncestor(target);
    if (!entry) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    showDownloadBlocked(location.hostname, { target: entry });
    return false;
  }

  // ===== 警告浮层 =====
  const SHIELD_SVG = '<svg class="sf-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" fill="rgba(255,90,90,.16)" stroke="#ff7a7a" stroke-width="1.4"/>' +
    '<path d="M12 8v5" stroke="#ffd36e" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="12" cy="16.4" r="1.25" fill="#ffd36e"/></svg>';

  function showWarning(result) {
    if (document.getElementById('sf-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sf-overlay';
    overlay.className = 'sf-overlay';

    const reasonsHtml = result.reasons.map((r) =>
      '<li><span class="sf-dot"></span><span><b>' + escapeHtml(r.label) + '</b><br>' + escapeHtml(r.detail || '') + '</span></li>'
    ).join('');

    overlay.innerHTML =
      '<div class="sf-card">' + SHIELD_SVG +
      '<h2 class="sf-title">检测到银狐木马风险网站</h2>' +
      '<p class="sf-sub">当前站点 <b>' + escapeHtml(location.hostname) + '</b> 命中 ' + result.reasons.length +
      ' 项风险特征（风险分 ' + result.score + ' / 阈值 ' + result.threshold + '）。<br>为防止木马植入，已自动禁用本页所有下载入口。</p>' +
      '<ul class="sf-reasons">' + reasonsHtml + '</ul>' +
      '<div class="sf-actions">' +
      '<button class="sf-btn sf-btn-leave" id="sf-leave">离开此网站</button>' +
      '<button class="sf-btn sf-btn-continue" id="sf-continue">继续访问（仍拦截下载）</button>' +
      '</div>' +
      '<p class="sf-foot">银狐（游蛇）木马常通过仿冒官网投递带毒安装包，请勿轻易放行下载。</p>' +
      '</div>';

    (document.body || document.documentElement).appendChild(overlay);

    overlay.querySelector('#sf-leave').addEventListener('click', leaveSite);
    overlay.querySelector('#sf-continue').addEventListener('click', () => {
      overlay.remove();
      showBanner(result);
    });
  }

  function showBanner(result) {
    if (document.getElementById('sf-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sf-banner';
    banner.className = 'sf-banner';
    banner.innerHTML =
      '<div class="sf-btext">🛡 银狐防护：已禁用本页 <b id="sf-bcount">' + blockedCount + '</b> 个下载/跳转入口</div>' +
      '<div class="sf-bbtns">' +
      '<button id="sf-release">我已知晓风险，完全放行</button>' +
      '<button id="sf-bclose">✕</button>' +
      '</div>';
    (document.body || document.documentElement).appendChild(banner);

    banner.querySelector('#sf-release').addEventListener('click', requestRelease);
    banner.querySelector('#sf-bclose').addEventListener('click', () => banner.remove());
  }

  function updateBannerCount() {
    const b = document.getElementById('sf-bcount');
    if (b) b.textContent = blockedCount;
  }

  function requestRelease() {
    const banner = document.getElementById('sf-banner');
    if (!banner) return;
    banner.innerHTML =
      '<div class="sf-btext">⚠️ 确认完全放行？放行后本页所有下载入口将不再受银狐防护保护。</div>' +
      '<div class="sf-bbtns sf-confirm-row">' +
      '<button id="sf-release-confirm" class="sf-btn-danger">确认放行</button>' +
      '<button id="sf-release-cancel">再想想</button>' +
      '</div>';
    banner.querySelector('#sf-release-confirm').addEventListener('click', doRelease);
    banner.querySelector('#sf-release-cancel').addEventListener('click', () => {
      banner.remove();
      showBanner(lastResult);
    });
  }

  function doRelease() {
    unblocked = true;
    dangerActive = false;
    try { document.getElementById('sf-overlay') && document.getElementById('sf-overlay').remove(); } catch (e) {}
    try { document.getElementById('sf-banner') && document.getElementById('sf-banner').remove(); } catch (e) {}
    document.querySelectorAll('[data-sf-blocked]').forEach((el) => {
      el.style.pointerEvents = '';
      el.style.opacity = '';
      el.style.filter = '';
      if (el.dataset.sfOriginalHref) {
        try { el.setAttribute('href', el.dataset.sfOriginalHref); } catch (e) {}
        delete el.dataset.sfOriginalHref;
      }
      delete el.dataset.sfBlocked;
    });
    try {
      if (chrome.runtime && chrome.runtime.sendMessage)
        chrome.runtime.sendMessage({ type: 'sf-release', hostname: location.hostname });
    } catch (e) {}
    showToast('⚠️ 已完全放行该站下载入口');
  }

  function leaveSite() {
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'sf-leave' });
      }
    } catch (e) {}
    try { if (history.length > 1) { history.back(); return; } } catch (e) {}
  }

  // ===== 温和提示（warn 层） =====
  function showWarnHint(result) {
    if (document.getElementById('sf-hint')) return;
    const hint = document.createElement('div');
    hint.id = 'sf-hint';
    hint.className = 'sf-hint';
    hint.innerHTML =
      '🛡 银狐防护提示：当前站点 <b>' + escapeHtml(location.hostname) + '</b> 存在可疑特征（风险分 ' + result.score + '），请谨慎点击任何下载链接。' +
      '<button id="sf-hclose">知道了</button>';
    (document.body || document.documentElement).appendChild(hint);
    hint.querySelector('#sf-hclose').addEventListener('click', () => hint.remove());
  }

  // ===== 被拦下载的大弹窗（两个选项） =====
  function showDownloadBlocked(host, opts) {
    opts = opts || {};
    if (document.getElementById('sf-dl-blocked')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sf-dl-blocked';
    overlay.className = 'sf-overlay';
    overlay.innerHTML =
      '<div class="sf-card">' + SHIELD_SVG +
      '<h2 class="sf-title">下载已被拦截</h2>' +
      '<p class="sf-sub">银狐防护已阻止来自 <b>' + escapeHtml(host) + '</b> 的可疑下载文件。该站点被判定为银狐木马风险网站，下载可能植入木马。</p>' +
      '<div class="sf-actions">' +
      '<button class="sf-btn sf-btn-leave" id="sf-dl-keep">保持拦截</button>' +
      '<button class="sf-btn sf-btn-continue" id="sf-dl-allow">仍要下载</button>' +
      '</div>' +
      '<p class="sf-foot">仅当您明确信任该文件来源时才选择「仍要下载」。</p>' +
      '</div>';
    (document.body || document.documentElement).appendChild(overlay);

    overlay.querySelector('#sf-dl-keep').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#sf-dl-allow').addEventListener('click', () => {
      overlay.remove();
      allowNextAction(700);
      if (opts.url) {
        const a = document.createElement('a');
        a.href = opts.url;
        a.download = '';
        a.target = '_blank';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
      } else if (opts.target && opts.target.click) {
        opts.target.click();
      }
      try {
        if (chrome.runtime && chrome.runtime.sendMessage)
          chrome.runtime.sendMessage({ type: 'sf-allow-download', url: opts.url || '', hostname: host, fromPage: true });
      } catch (e) {}
    });
  }

  // ===== 上报 =====
  function reportDetection(result) {
    try {
      if (chrome.runtime && chrome.runtime.sendMessage)
        chrome.runtime.sendMessage({ type: 'sf-detected', hostname: location.hostname, data: result });
    } catch (e) {}
  }

  // ===== 主流程 =====
  function recomputeLevel(result, sensitivity) {
    const t = SF.thresholds ? SF.thresholds(sensitivity) : { warn: 35, danger: 70 };
    if (result.score >= t.danger) result.level = 'danger';
    else if (result.score >= t.warn) result.level = 'warn';
    else result.level = 'safe';
    result.detected = result.level === 'danger';
    result.threshold = t.danger;
    return result;
  }

  function analyzeAndAct(settings, chained) {
    if (!settings.enabledGlobal) { lastResult = { analyzed: true, disabled: true }; return; }
    if (isAllowlisted(location.hostname, settings.allowlist)) {
      lastResult = { analyzed: true, allowlisted: true };
      return;
    }

    const data = collect();
    data.metrics = collectMetrics();
    data.icp = extractIcp();
    const result = SF.analyze(data, { enabled: settings.enabled, sensitivity: settings.sensitivity });

    // 自定义规则叠加
    const htmlLower = (data.html || '').toLowerCase();
    if (settings.customKeywords && settings.customKeywords.length) {
      const found = settings.customKeywords.filter((k) => htmlLower.indexOf(String(k).toLowerCase()) !== -1);
      if (found.length) {
        result.reasons.push({ label: '命中自定义风险关键词', detail: found.join('、'), weight: 10 });
        result.score += 10;
      }
    }
    if (settings.customBadDomains && settings.customBadDomains.length) {
      const h = location.hostname.toLowerCase();
      if (settings.customBadDomains.some((d) => { d = String(d).trim().toLowerCase(); return d && (h === d || h.endsWith('.' + d)); })) {
        result.reasons.push({ label: '域名命中自定义黑名单', detail: location.hostname, weight: 100 });
        result.score += 100;
      }
    }
    recomputeLevel(result, settings.sensitivity);

    // 跳转链污染升级：本标签由危险站跳转而来，且本页有下载入口/网盘/低质量等信号，升级为 danger 强制拦截
    if (chained && result.level !== 'danger') {
      const hasDownloadSignal = result.features.execDownload || result.features.cloudDiskDist || result.features.fakeOfficial || result.features.domainImpersonation;
      if (hasDownloadSignal || result.score >= 30) {
        result.level = 'danger';
        result.detected = true;
        result.chained = true;
        result.reasons.push({ label: '跳转链污染升级', detail: '该页面由已被拦截的银狐站跳转而来，且包含下载入口，强制启用拦截', weight: 60 });
        result.score += 60;
      }
    }

    lastResult = Object.assign({ analyzed: true, hostname: location.hostname, blockedCount: 0 }, result);

    if (result.level === 'danger') {
      dangerActive = true;
      installHardGuards();
      if (settings.autoBlockDownloads) blockAllDownloadEntries();
      updateBannerCount();
      if (settings.showWarning) showWarning(result);
      reportDetection(result);
    } else if (result.level === 'warn') {
      dangerActive = false;
      if (settings.showWarning) showWarnHint(result);
      reportDetection(result);
      // 本页完全无辜（真官网/有备案/无下载），清除跳转链污染
      if (chained) {
        try { chrome.runtime.sendMessage({ type: 'sf-clear-chain' }); } catch (e) {}
      }
    } else {
      dangerActive = false;
      if (chained) {
        try { chrome.runtime.sendMessage({ type: 'sf-clear-chain' }); } catch (e) {}
      }
    }
  }

  function run() {
    // 仅对普通 http(s) 网页做检测。
    // 本地文件(file://)、浏览器内部页(chrome://、edge://…)、本地开发服务器(localhost/127.0.0.1)
    // 一律跳过——它们没有 ICP 备案且可能是中文页面，会被误判成风险站。
    const proto = (location.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return;
    const _host = (location.hostname || '').toLowerCase();
    if (_host === 'localhost' || _host === '127.0.0.1' || _host === '[::1]') return;

    getSettings().then((settings) => {
      try {
        chrome.runtime.sendMessage({ type: 'sf-check-chain' }, (res) => {
          analyzeAndAct(settings, !!(res && res.tainted));
        });
      } catch (e) {
        analyzeAndAct(settings, false);
      }
    });
  }

  // ===== 硬拦截钩子（document_start 即安装，抢在站点脚本之前） =====
  function installHardGuards() {
    if (hardGuardsInstalled) return;
    hardGuardsInstalled = true;

    // 1) window.open（站点脚本之前覆盖）
    try {
      const _open = window.open;
      window.open = function (url) {
        if (unblocked || !dangerActive || isNextAllowed()) return _open.apply(window, arguments);
        if (arguments.length && isDownloadUrl(url)) {
          showDownloadBlocked(location.hostname, { url: url });
          return null;
        }
        return _open.apply(window, arguments);
      };
    } catch (e) {}

    // 2) HTMLAnchorElement.prototype.click
    try {
      const proto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype;
      if (proto && proto.click && !proto._sfClick) {
        const _click = proto.click;
        proto._sfClick = _click;
        proto.click = function () {
          const a = this;
          if (unblocked || !dangerActive || isNextAllowed()) return _click.call(a);
          const href = a.getAttribute('href') || a.href || '';
          if (isDownloadUrl(href)) {
            showDownloadBlocked(location.hostname, { url: href });
            return;
          }
          return _click.call(a);
        };
      }
    } catch (e) {}

    // 3) location.href / replace / assign 守卫
    installLocationGuard();

    // 4) 全局点击捕获（拦截 div/button/img 等下载卡片）
    if (!document._sfClickGuard) {
      document._sfClickGuard = true;
      document.addEventListener('click', globalClickGuard, true);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'sf-getStatus') { sendResponse(lastResult); return true; }
    if (msg && msg.type === 'sf-download-blocked') { showDownloadBlocked(location.hostname, { url: msg.url || '' }); }
    if (msg && msg.type === 'sf-download-allow-failed') { showToast('⚠️ 请手动在站内点击下载，已临时放行该链接'); }
  });

  // 启动：document_start 时先装硬钩子（此时 body 可能未就绪，run 等 DOM）
  installHardGuards();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();

  // 二次扫描：应对延迟注入的下载按钮
  setTimeout(() => { if (!lastResult.analyzed) run(); }, 1800);
})();
