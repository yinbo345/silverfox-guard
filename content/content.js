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

  // 性能优化：模块级复用正则与闭包，避免每次调用 / 循环重新编译
  const ABS_URL_RE = /^(https?:)?\/\//i;
  const DLINK_URL_RE = /https?:\/\/[^\s"'<>（）()【】\[\]{}|\\^`]+/gi;
  const TXT_EXT_RE = /\.txt(?:[?#]|$)/i;
  function isDlLink(u) {
    const t = SF.classifyLink(u);
    return t === 'exec' || t === 'archive' || t === 'cloud' || t === 'download';
  }

  const DEFAULTS = {
    enabledGlobal: true,
    showWarning: true,
    autoBlockDownloads: true,
    notify: true,
    sensitivity: 'medium',
    enabled: {
      domainImpersonation: true, icpMissing: true, lowQuality: true,
      execDownload: true, cloudDiskDist: true, obfuscatedJs: true, vmDetection: true,
      socialEngineering: true, fakeOfficial: true, redirectIframe: true, domainStructure: true,
      brandedExe: true, passwordArchive: true
    },
    allowlist: [],
    customKeywords: [],
    customBadDomains: [],
    fontMode: 'system',   // 'system' | 'smiley'
    theme: 'dark',        // 'dark' | 'light'
    fontScale: 1          // 0.85 ~ 1.40，界面字号缩放系数
  };

  let lastResult = { analyzed: false };
  let blockedCount = 0;
  let unblocked = false;
  let observer = null;
  let dangerActive = false;       // 本页已被判危 → 启用硬拦截钩子
  let navBlock = false;           // 仅在高置信木马信号（STRONG 类）判危时才拦「一切程序化导航」
  let fullLockdown = false;       // 高置信木马信号命中也进入「全面锁定」：判危页所有交互型 CTA 入口（不论显示什么文字）一律灰化 + 拦截点击，覆盖伪装成「开始对话」「API 开放平台」的投递按钮
  let hardGuardsInstalled = false; // 硬拦截钩子（window.open / a.click / 点击捕获 / location）是否已安装
  let dangerReported = false;     // 防「报毒」重复上报：同一页面仅向后台/系统通知上报一次 danger
  let dangerAcknowledged = false; // 用户已点「仍然继续」确认进入 → 本页不再重复弹 danger 浮层（拦截仍生效）

  // 高置信木马信号：命中这些之一即判危时，除禁用下载入口外，还要拦截本页一切程序化导航
  // （location 跳转 / 锚点 .click / window.open），以堵死「同源带参跳转」「运行时中继取链」这类
  // 服务端吐二进制附件、内容脚本看不到响应体的下载手法。普通 medium 组合误判的页不拦导航，避免误伤。
  const NAV_BLOCK_FEATURES = ['domainImpersonation', 'obfuscatedJs', 'vmDetection', 'brandedExe', 'doubleExt', 'icpStolen', 'noahKit', 'downloadRedirector', 'runtimeDownload'];

  // 用户在「大弹窗」里点「仍要下载」后的短时放行窗口（ms）
  let nextAllowedUntil = 0;
  function isNextAllowed() { return Date.now() < nextAllowedUntil; }
  function allowNextAction(ms) { nextAllowedUntil = Date.now() + (ms || 500); }

  // 字体偏好：用户「切换字体」设置，供网页内横幅跟随（设置页/弹窗已各自处理）
  let currentFontMode = 'system';
  let fontFaceInjected = false;
  let currentScale = 1;

  function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s || {})));
      } catch (e) { resolve(DEFAULTS); }
    });
  }

  // 包装 chrome.runtime.sendMessage，返回 Promise（用于需要响应的消息：sf-check-chain / sf-domain-age）
  function sendMsg(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r)); } catch (e) { resolve(null); }
    });
  }

  function isAllowlisted(hostname, allowlist) {
    hostname = (hostname || '').toLowerCase();
    return (allowlist || []).some((d) => {
      d = (d || '').trim().toLowerCase();
      return d && (hostname === d || hostname.endsWith('.' + d));
    });
  }

  // ===== 可信分发域名（内容侧分析豁免）=====
  // 网盘、GitHub 官方及镜像等站点的下载（含 .zip/.msi/任意文件）都是合法内容，
  // 分析引擎不应将其判为银狐木马投递站——否则进入即弹「危险网站」警告，并 disable 全部下载入口（变灰不可点）。
  // 与后台背景豁免列表保持同源。
  const TRUSTED_DISPATCH = [
    // 网盘类
    '123pan.com', '123pan.cn',                          // 一二三云盘（分享域名 123pan.cn，如 *.share.123pan.cn）
    'pan.baidu.com', 'wap.baidu.com', 'eyun.baidu.com', // 百度网盘
    'aliyundrive.com',                                  // 阿里云盘
    'weiyun.com',                                       // 腾讯微云
    'lanzou.com', 'lanzous.com', 'lanzoux.com',         // 蓝奏云
    'pan.quark.cn',                                     // 夸克网盘
    'cloud.189.cn',                                     // 天翼云盘
    '115.com', '115cache.com',                          // 115 网盘
    'ctfile.com',                                       // 城通网盘
    'cowtransfer.com',                                  // 奶牛快传
    'wenshushu.cn',                                     // 文叔叔
    'ys168.com',                                        // 永硕网盘
    'jianguoyun.com',                                   // 坚果云
    'quqi.com',                                         // 曲奇云盘
    'caiyun.139.com',                                   // 和彩云（移动）
    'fangcloud.com',                                    // 亿方云
    // GitHub 官方
    'github.com', 'github.io', 'github.dev', 'githubusercontent.com',
    'githubassets.com', 'github.community', 'githubstatus.com', 'github.blog',
    // GitHub 镜像
    'ghproxy.com', 'mirror.ghproxy.com', 'ghproxy.net', 'ghproxy.cfd',
    'kgithub.com', 'github.moeyy.xyz', 'github.bibaiyu.com', 'githubproxy.com',
    'gitclone.com', 'hub.gitmirror.com', 'github.coolapk.com', 'hub.fastgit.xyz',
    'fastgit.org', 'gh.api.99988866.xyz'
  ];
  function isTrustedDispatch(hostname) {
    hostname = (hostname || '').toLowerCase();
    return TRUSTED_DISPATCH.some(function (d) {
      d = String(d).trim().toLowerCase();
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

  // 带动画的关闭助手：加 .sf-closing 触发 CSS 退场动画，动画结束（或兜底超时）后移除
  function closeEl(el) {
    if (!el) return;
    if (!el.parentNode) { try { el.remove(); } catch (e) {} return; }
    el.classList.add('sf-closing');
    let done = false;
    const finish = () => { if (done) return; done = true; try { el.remove(); } catch (e) {} };
    try {
      el.addEventListener('animationend', finish, { once: true });
      el.addEventListener('transitionend', finish, { once: true });
    } catch (e) {}
    setTimeout(finish, 420); // 兜底：动画未触发时也能移除
  }

  // ===== 采集页面代码 + 工程化指标 + ICP =====
  function collectMetrics() {
    let domElementCount = 0;
    try { domElementCount = document.getElementsByTagName('*').length; } catch (e) {}
    let extRes = 0, scriptCount = 0, inlineScriptCount = 0, externalScriptCount = 0, iframeCount = 0;
    try {
      document.querySelectorAll('script').forEach((s) => {
        scriptCount++;
        const src = s.getAttribute('src') || '';
        if (src) {
          externalScriptCount++;
          if (ABS_URL_RE.test(src) && src.indexOf(location.hostname) === -1) extRes++;
        } else { inlineScriptCount++; }
      });
    } catch (e) {}
    try {
      document.querySelectorAll('img[src],link[href],iframe[src],source[src],video[src],audio[src],object[data],embed[src]')
        .forEach((el) => {
          const a = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data-src') || el.getAttribute('data') || '';
          if (ABS_URL_RE.test(a) && a.indexOf(location.hostname) === -1) extRes++;
        });
    } catch (e) {}
    try { iframeCount = document.querySelectorAll('iframe').length; } catch (e) {}
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
    // 性能优化：CJK / emoji 统计仅采样前 4000 码元。这二者只是粗粒度启发式信号，
    // 全量遍历长页面（innerText 可达数万字符）开销大，采样对判定无实质影响。
    const _sampleLen = Math.min(bodyText.length, 4000);
    let cjk = 0;
    for (let i = 0; i < _sampleLen; i++) {
      const cp = bodyText.codePointAt(i);
      if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) cjk++;
      if (cp > 0xFFFF) i++;
    }
    const _sampleText = bodyText.slice(0, _sampleLen);
    const hasCJK = (_sampleLen > 0 && (cjk / _sampleLen) >= 0.08) || cjk >= 500;
    let emojiCount = 0;
    try { emojiCount = (_sampleText.match(/\p{Emoji_Presentation}|\p{Emoji}/gu) || []).length; } catch (e) {}
    const emojiDensity = _sampleLen > 0 ? (emojiCount / _sampleLen) * 1000 : 0;
    return {
      domElementCount, externalResourceCount: extRes, framework,
      textLength, cjkCount: cjk, cjkRatio: textLength ? cjk / textLength : 0,
      hasCJK, emojiCount, emojiDensity: Math.round(emojiDensity * 100) / 100,
      scriptCount, inlineScriptCount, externalScriptCount, iframeCount
    };
  }

  // 同步主采集：基础 DOM + 页面文本内嵌下载直链扫描（不含 .txt 异步解析）。
  // 必须同步、快速返回，以便 run() 在页面被 meta refresh 秒跳走之前完成判定。
  function collectCore() {
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
    // meta refresh 跳转（#4 资源解析器用作种子）：提取 url 与延时
    const metaRefreshUrls = [];
    try {
      document.querySelectorAll('meta[http-equiv]').forEach((m) => {
        const he = (m.getAttribute('http-equiv') || '').toLowerCase();
        if (he !== 'refresh') return;
        const c = m.getAttribute('content') || '';
        const um = c.match(/url\s*=\s*['"]?\s*([^'"\s]+)/i);
        if (!um || !um[1]) return;
        const dm = c.match(/^\s*(\d+)\s*;/);
        metaRefreshUrls.push({ url: um[1], delay: dm ? parseInt(dm[1], 10) : 0, originalContent: c });
      });
    } catch (e) {}
    let html = '';
    try { html = document.documentElement.outerHTML || ''; } catch (e) {}

    // 同步增强：扫描正文/HTML 文本中内嵌的下载直链（如 meta refresh 指向的 .zip 真实地址）。
    // 同步执行、不阻塞主判定；保守：只增强「检测」，不主动 block。
    const seen = new Set(links.map((l) => l.href));
    let bodyText = '';
    try { bodyText = (document.body && document.body.innerText) || ''; } catch (e) {}
    const textHtml = (html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const combinedText = bodyText + '\n' + textHtml;
    DLINK_URL_RE.lastIndex = 0;
    let mm;
    while ((mm = DLINK_URL_RE.exec(combinedText)) !== null) {
      const u = mm[0];
      if (isDlLink(u) && !seen.has(u)) { seen.add(u); links.push({ href: u, text: '(页面文本内嵌下载链接)' }); }
    }

    return { hostname, title: document.title || '', html, scripts, links, iframeSrcs, metaRefreshUrls, _seen: seen };
  }

  // ★ ICP 权威核验的「值得查」门控（隐私优先）。
  // 核验请求会把本站注册域名发给第三方备案查询接口，因此绝不能对所有站点无脑查询。
  // 仅在以下三种「核验结果确实会改变判定」的场景才发起，其余一律只用页面文本扫描：
  //   ① 页面展示了备案号 → 需要验真伪，才能揪出「盗用他人备案号」的钓鱼站（#3）；
  //   ② .cn 域名但页面找不到任何备案标识 → 可能只是没在页面展示，查一次避免「缺备案号」误扣 35 分；
  //   ③ 已判定域名仿冒 → 若权威库确认确有备案，则跳过仿冒判定（#2），根治正规品牌站误伤。
  function needIcpVerify(settings, data) {
    if (!settings || settings.icpApiVerify === false) return false;
    if (lastResult && (lastResult.allowlisted || lastResult.disabled)) return false; // 白名单/停用站不查
    const icp = data.icp || {};
    if (icp.hasIcpNumber) return true;                                   // ① 验真伪
    const isCn = (location.hostname || '').toLowerCase().endsWith('.cn');
    if (isCn && !icp.hasGovIcp) return true;                             // ② 防误扣
    if (lastResult && lastResult.spoof) return true;                     // ③ 防误伤品牌站
    return false;
  }

  // 本页是否存在指向「下载黑名单」域名的链接（按注册域名逐级后缀匹配，覆盖换子域的载荷桶）
  function anyLinkInBlacklist(data, domains) {
    const set = new Set(domains);
    for (const l of (data.links || [])) {
      const href = (l && l.href) || '';
      if (!href) continue;
      let h = '';
      try { h = new URL(href, location.href).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
      if (!h) continue;
      if (set.has(h)) return true;
      const parts = h.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        if (set.has(parts.slice(i).join('.'))) return true;
      }
    }
    return false;
  }

  // 后台异步补强：ICP 权威核验 + 域名年龄 RDAP + 同域 .txt 内嵌下载链接。
  // 不阻塞主判定；仅当补到新链接 / 年龄 / 备案核验数据时，用最新数据重判（结果变更才真正影响 UI / dangerTabs）。
  async function enrichAsync(settings, chained, data) {
    if (!settings || !settings.enabledGlobal) return;
    let changed = false;
    // 0) ICP 权威核验（三态结果注入 data.icpAuth：确有备案 / 确认无备案 / 查询失败）
    //    查询失败时后台返回 {queried:false}，评分引擎会完全回退到页面文本扫描，绝不凭失败结果加分。
    if (needIcpVerify(settings, data)) {
      try {
        const ra = await sendMsg({ type: 'sf-icp-verify', hostname: location.hostname });
        if (ra && ra.queried) { data.icpAuth = ra; changed = true; }
      } catch (e) {}
    }
    // 0.5) 下载黑名单（#16 跨站复用）：纯本地读取、无任何外部请求。
    //      只有本页确实存在指向黑名单域名的链接时才触发重判，避免无意义地重跑一遍分析。
    try {
      const rb = await sendMsg({ type: 'sf-dl-blacklist' });
      const domains = (rb && rb.domains) || [];
      if (domains.length) {
        data.dlBlacklist = domains;
        if (anyLinkInBlacklist(data, domains)) changed = true;
      }
    } catch (e) {}
    // 1) 域名年龄（后台异步；查不到则保持 undefined，评分引擎优雅跳过）
    try {
      const r = await sendMsg({ type: 'sf-domain-age', hostname: location.hostname });
      if (r && typeof r.days === 'number') { data.domainAgeDays = r.days; changed = true; }
    } catch (e) {}
    // 2) 同域 .txt 文件解析，提取隐藏的压缩包/网盘直链（银狐常用 .txt 藏真实下载地址）
    const seen = data._seen || new Set(data.links.map((l) => l.href));
    const txtHrefs = data.links
      .map((l) => l.href)
      .filter((h) => TXT_EXT_RE.test(h || ''))
      .filter((h) => { try { return new URL(h, location.href).hostname === location.hostname; } catch (e) { return false; } })
      .slice(0, 3);
    for (const href of txtHrefs) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 5000);
        const rr = await fetch(href, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        if (!rr.ok) continue;
        const txt = await rr.text();
        DLINK_URL_RE.lastIndex = 0;
        const localSeen = new Set();
        let m2;
        while ((m2 = DLINK_URL_RE.exec(txt)) !== null) {
          const u = m2[0];
          if (isDlLink(u) && !seen.has(u) && !localSeen.has(u)) {
            seen.add(u); localSeen.add(u);
            data.links.push({ href: u, text: '(.txt 文件内嵌下载链接)' });
            changed = true;
          }
        }
      } catch (e) { /* 跨域/超时/404 等，静默忽略 */ }
    }
    // 3) BFS 资源解析器（#4 重构下载发现层）：异步下挖脚本内直链 / 重定向链 / 同域 .txt 递归 / iframe。
    //    作为「增量增强」放在异步层，不与 collectCore 同步快判冲突；只补充现有层抓不到的入口，合并进 data.links 重判。
    try {
      if (typeof SF_RESOLVER !== 'undefined' && SF_RESOLVER.resolve) {
        const pageUrl = location.href;
        const initialData = {
          inlineScripts: (data.scripts || []).map((t) => ({ text: t })),
          metaRefreshUrls: data.metaRefreshUrls || [],
          iframeSrcs: data.iframeSrcs || [],
          links: data.links,
          pageText: (data.html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
        };
        const graph = await SF_RESOLVER.resolve(pageUrl, initialData, {
          maxDepth: 3, maxTotalResources: 20, perResourceTimeout: 2000,
          totalTimeout: 5000, maxRedirects: 5, maxTxtRecursion: 2
        });
        for (const d of (graph.downloadLinks || [])) {
          const href = d.href;
          if (href && !seen.has(href)) { seen.add(href); data.links.push({ href: href, text: d.text || '(.txt 内嵌)' }); changed = true; }
        }
      }
    } catch (e) { /* 解析器异常不影响主判定 */ }

    if (changed) analyzeAndAct(settings, chained, data);
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
    // 全面锁定：高置信木马信号（仿冒站 / NOAH / 运行时取链投递 / 自跳转下载页）命中时，
    // 页面上所有「交互型入口」都视作木马投递点 —— 攻击者可把下载木马的按钮伪装成
    // 「开始对话」「API 开放平台」等官网正常功能名，不再要求文字含「下载」。
    // 覆盖：button 标签 / 非导航锚点(a href=javascript:#) / role=button|link / 带 CTA 类 / 带 onclick。
    // 真实导航 a（指向官网/首页的 http(s) 链接）不强制锁定，避免把整页正常链接全灰掉；
    // 良性误判页因 navBlock=false → fullLockdown=false，此分支不触发，不误伤。
    if (fullLockdown) {
      const tag = el.tagName;
      const href = (el.getAttribute && el.getAttribute('href')) || '';
      const role = el.getAttribute && el.getAttribute('role');
      const cls = String(el.className || '').toLowerCase();
      const hasOnclick = el.hasAttribute && (el.hasAttribute('onclick') || typeof el.onclick === 'function');
      if (tag === 'BUTTON') return true;
      if (tag === 'A') {
        // 非导航锚点（javascript:/#）→ 锁定；真实 http(s) 导航链接 → 不锁定
        if (/^(javascript:|#)/i.test(href)) return true;
        return false;
      }
      if (role === 'button' || role === 'link') return true;
      if (hasOnclick) return true;
      if (/btn|button|cta|card-link|card|nav-link|nav-btn|download|down|client|item|primary|secondary/i.test(cls)) return true;
      return false;
    }
    if (el.tagName === 'A' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') || '';
      // 真实导航链接：按下载 URL 特征判定
      if (!/^(javascript:|#|mailto:|tel:)/i.test(href)) return isDownloadUrl(href);
      // 非导航锚点（如深狐 NOAH 的 <a href="javascript:void(0)" data-download>）：
      // 退化到下方「形态判定」——命中下载词/类/属性即视为下载入口，必须禁用其点击
    }
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
    if (!el || (el.dataset && el.dataset.sfBlocked) || unblocked) return;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      // mailto:/tel: 等非下载外链直接跳过
      if (!href || /^(mailto:|tel:)/i.test(href)) return;
      if (/^(javascript:|#)/i.test(href)) {
        // 非导航锚点（JS 触发下载，如深狐 NOAH 的 <a href="javascript:void(0)" data-download>）：
        // 仅当它本身被识别为下载入口（下载词/类/属性）时才禁用
        if (!isDownloadEntry(el)) return;
      } else if (!isDownloadUrl(href)) {
        return;
      }
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
        if (!dangerNavBlocked(url)) return _open.apply(window, arguments);
        return null;
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
          if (unblocked || isNextAllowed()) return _click.call(a);
          const href = a.getAttribute('href') || a.href || '';
          // 仅拦截真实导航（排除 javascript:/#/mailto:/tel:/about: 等非导航）
          const navHref = (href && !/^(javascript:|#|mailto:|tel:|about:)/i.test(href)) ? href : null;
          // 高置信信号(navBlock) 或 明确下载 URL → 拦截，堵死运行时中继取链 / 直接甩文件
          if (navHref && (navBlock || isDownloadUrl(navHref))) {
            if (!document.getElementById('sf-overlay')) showDownloadBlocked(location.hostname, { url: navHref });
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
    // 早期拦截：IDM 等第三方下载器常在 mousedown 阶段就把链接 URL 抢走（早于 click），
    // 故在 mousedown / pointerdown 捕获阶段即拦截，阻断其接管下载。
    document.addEventListener('mousedown', globalClickGuard, true);
    document.addEventListener('pointerdown', globalClickGuard, true);
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

  // 高置信木马信号判危页拦截「任何程序化导航」（location 跳转 / 锚点 .click / window.open），
  // 不再只认「下载 URL」特征——攻击者常用同源带参跳转、或运行时从 relay 拉来的中转 URL
  // 触发二进制下载，这些 URL 不匹配下载特征却照样把访客甩去下载页（即「跳转没被去掉」）。
  // 拦截条件（任一即拦）：
  //   ① 本页命中 NAV_BLOCK_FEATURES 高置信信号（navBlock=true）→ 拦一切程序化导航；
  //   ② 任意 danger 页若出现「明确下载 URL」导航（如 ?la_download=1 / .exe / 网盘直链）→ 拦。
  // 普通页面跳转（/dashboard 等）不含下载特征 → 不误伤良性页；
  // 用户主动点「完全放行」(unblocked) 或短时窗口(isNextAllowed) 时放行。
  function dangerNavBlocked(url) {
    if (unblocked || isNextAllowed()) return false;
    // 高置信木马信号(navBlock)命中 → 拦截本页一切程序化导航；
    // 任意 danger 页若出现「明确下载 URL」的导航（如 ?la_download=1 / .exe / 网盘直链）也拦截，
    // 堵死直接甩二进制附件的手法；普通页面跳转（/dashboard 等）不含下载特征 → 不误伤。
    if (!navBlock && !(url && isDownloadUrl(url))) return false;
    // 主警告浮层已显示时不再叠加「下载被拦截」浮层，仅静默阻断导航
    if (!document.getElementById('sf-overlay')) showDownloadBlocked(location.hostname, { url: url || '' });
    return true;
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
            if (!dangerNavBlocked(url)) return origSet.call(window.location, url);
          }
        });
      }
    } catch (e) {}
    try {
      const origReplace = window.location.replace;
      window.location.replace = function (url) {
        if (!dangerNavBlocked(url)) return origReplace.apply(window.location, arguments);
      };
    } catch (e) {}
    try {
      const origAssign = window.location.assign;
      window.location.assign = function (url) {
        if (!dangerNavBlocked(url)) return origAssign.apply(window.location, arguments);
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
    // 用户已确认「仍然继续」→ 本页不再重复弹 danger 浮层（下载拦截仍生效）。
    // 修复：原逻辑仅靠 DOM 里是否存在 #sf-overlay 判重，但「继续访问」会 closeEl 移除 overlay，
    // 导致 enrichAsync 异步补强 / SPA 重跑 analyzeAndAct 时再次弹窗。
    if (dangerAcknowledged) return;
    if (document.getElementById('sf-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sf-overlay';
    overlay.className = 'sf-overlay' + (currentFontMode === 'smiley' ? ' sf-font-smiley' : '');
    const card = document.createElement('div');
    card.className = 'sf-card';
    overlay.appendChild(card);
    (document.body || document.documentElement).appendChild(overlay);
    renderWarning(card, result);
  }

  function renderWarning(card, result) {
    const isAi = !!(result && result.aiBrand); // 本次为云端 AI 官网核验判出的仿冒
    const reasonsHtml = result.reasons.map((r) =>
      '<li' + (r.ai ? ' class="sf-reason-ai"' : '') + '><span class="sf-dot"></span><span><b>' + escapeHtml(r.label) + '</b><br>' + escapeHtml(r.detail || '') + '</span></li>'
    ).join('');

    const aiBadge = isAi
      ? '<div class="sf-ai-badge"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 8.5 8 9 4.6-2.5 8-6 8-11V7l-8-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>AI 判断 · 官网核验不符</div>'
      : '';
    const subText = isAi
      ? '云端 AI 经官网核验判定：当前站点 <b>' + escapeHtml(location.hostname) + '</b> 仿冒品牌「<b>' + escapeHtml(result.aiBrand) + '</b>」官方域名「' + escapeHtml(result.aiOfficial || '') + '」。<br>为防止木马植入，已自动禁用本页所有下载入口。'
      : '当前站点 <b>' + escapeHtml(location.hostname) + '</b> 命中 ' + result.reasons.length +
      ' 项风险特征（风险分 ' + result.score + ' / 阈值 ' + result.threshold + '）。<br>为防止木马植入，已自动禁用本页所有下载入口。';

    card.innerHTML =
      SHIELD_SVG +
      '<h2 class="sf-title">检测到银狐木马风险网站</h2>' +
      aiBadge +
      '<p class="sf-sub">' + subText + '</p>' +
      '<ul class="sf-reasons">' + reasonsHtml + '</ul>' +
      '<div class="sf-actions">' +
      '<button class="sf-btn sf-btn-leave" id="sf-leave">离开此网站</button>' +
      '<button class="sf-btn sf-btn-continue" id="sf-continue">继续访问（仍拦截下载）</button>' +
      '</div>' +
      '<p class="sf-foot">银狐（游蛇）木马常通过仿冒官网投递带毒安装包，请勿轻易放行下载。<br>若已安装 IDM 等第三方下载器，请临时关闭其「浏览器接管」，以免其从链接直接抓取下载。</p>';

    card.querySelector('#sf-leave').addEventListener('click', leaveSite);
    card.querySelector('#sf-continue').addEventListener('click', () => showContinueConfirm(card, result));
  }

  // 二次确认：用户点击「继续访问」后，再次确认是否进入被判定为银狐木马的风险站点
  function showContinueConfirm(card, result) {
    card.innerHTML =
      SHIELD_SVG +
      '<h2 class="sf-title">二次确认</h2>' +
      '<p class="sf-sub">你确定要访问 <b>' + escapeHtml(location.hostname) + '</b> 吗？<br>该站点已被判定为银狐木马风险网站。关闭警告后我们仍会拦截下载，但页面本身可能包含钓鱼表单或恶意脚本。</p>' +
      '<div class="sf-actions">' +
      '<button class="sf-btn sf-btn-leave" id="sf-cc-back">返回</button>' +
      '<button class="sf-btn sf-btn-continue" id="sf-cc-go">仍然继续</button>' +
      '</div>' +
      '<p class="sf-foot">强烈建议点击「离开此网站」返回安全页面。如确需访问，请务必不要在此页面输入任何账号密码或下载文件。</p>';

    card.querySelector('#sf-cc-back').addEventListener('click', () => renderWarning(card, result));
    card.querySelector('#sf-cc-go').addEventListener('click', () => {
      dangerAcknowledged = true; // 标记本页已确认继续，不再重复弹报毒浮层
      const overlay = card.closest('.sf-overlay') || card;
      closeEl(overlay);
      showBanner(result);
    });
  }

  function showBanner(result) {
    if (document.getElementById('sf-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sf-banner';
    banner.className = 'sf-banner' + (currentFontMode === 'smiley' ? ' sf-font-smiley' : '');
    (document.body || document.documentElement).appendChild(banner);
    renderBanner(banner, result);
  }

  function renderBanner(banner, result) {
    banner.innerHTML =
      '<div class="sf-btext">🛡 银狐防护：已禁用本页 <b id="sf-bcount">' + blockedCount + '</b> 个下载/跳转入口</div>' +
      '<div class="sf-bbtns">' +
      '<button id="sf-release">我已知晓风险，完全放行</button>' +
      '<button id="sf-bclose">✕</button>' +
      '</div>';
    banner.querySelector('#sf-release').addEventListener('click', requestRelease);
    banner.querySelector('#sf-bclose').addEventListener('click', () => closeEl(banner));
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
      renderBanner(banner, lastResult);
    });
  }

  function doRelease() {
    unblocked = true;
    dangerActive = false;
    navBlock = false;
    fullLockdown = false;
    dangerReported = false;
    try { const o = document.getElementById('sf-overlay'); if (o) closeEl(o); } catch (e) {}
    try { const b = document.getElementById('sf-banner'); if (b) closeEl(b); } catch (e) {}
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
    try { const o = document.getElementById('sf-overlay'); if (o) closeEl(o); } catch (e) {}
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
    hint.className = 'sf-hint' + (currentFontMode === 'smiley' ? ' sf-font-smiley' : '');
    hint.innerHTML =
      '🛡 银狐防护提示：当前站点 <b>' + escapeHtml(location.hostname) + '</b> 存在可疑特征（风险分 ' + result.score + '），请谨慎点击任何下载链接。' +
      '<button id="sf-hclose">知道了</button>';
    (document.body || document.documentElement).appendChild(hint);
    hint.querySelector('#sf-hclose').addEventListener('click', () => closeEl(hint));
  }

  // ===== 被拦下载的大弹窗（两个选项） =====
  function showDownloadBlocked(host, opts) {
    opts = opts || {};
    if (document.getElementById('sf-dl-blocked')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sf-dl-blocked';
    overlay.className = 'sf-overlay' + (currentFontMode === 'smiley' ? ' sf-font-smiley' : '');
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

    overlay.querySelector('#sf-dl-keep').addEventListener('click', () => closeEl(overlay));
    overlay.querySelector('#sf-dl-allow').addEventListener('click', () => {
      closeEl(overlay);
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

  // ===== 危险弹窗提醒（Windows 系统通知，chrome.notifications）=====
  // 不再使用声音提示：浏览器自动播放策略在扩展上下文无法稳定解锁，且用户实测声音未生效。
  // 改为调用后台创建原生系统通知（Windows 右下角 toast），更可靠、无需用户手势。
  function sfNotify(result) {
    try {
      const host = (location && location.hostname) || '';
      const msg = {
        type: 'sf-notify',
        title: '⚠️ 银狐防护：发现高风险网站',
        message: '检测到 ' + host + ' 疑似银狐(游蛇)木马投递站，已弹出页面警告并禁用下载/跳转链接。'
      };
      if (chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage(msg);
    } catch (e) {}
  }

  // 上报「分析闸门」判定（每次分析必发，含 safe/warn/danger，供后台默认拒绝闸门解除）
  function reportVerdict(level) {
    try {
      if (chrome.runtime && chrome.runtime.sendMessage)
        chrome.runtime.sendMessage({ type: 'sf-verdict', hostname: location.hostname, level: level || 'safe' });
    } catch (e) {}
  }

  // ===== 上报 =====
  function reportDetection(result) {
    try {
      if (chrome.runtime && chrome.runtime.sendMessage)
        chrome.runtime.sendMessage({ type: 'sf-detected', hostname: location.hostname, data: result });
    } catch (e) {}
  }

  // ===== 后台自动 AI 网页分析（随页面加载触发，不进悬浮球）=====
  // 触发机制类比现有本地规则引擎：run() 本地分析完成后异步发起，不阻塞本地判定。
  // 仅当用户在设置中开启 Max 模式 + 「借助云端AI分析网页」子开关时生效。
  let aiAnalyzed = false; // 本页仅分析一次，避免重复请求
  let settingsRef = null;  // 缓存最近一次 settings，供 aiRaiseDanger 同步复用（避免重复读）
  function maybeAiAnalyze() {
    if (aiAnalyzed) return;
    aiAnalyzed = true;
    getSettings().then(function (settings) {
      settingsRef = settings;
      if (!settings.aiMaxMode || !settings.aiCloudWebAnalyse) return;
      // 受限页面跳过（chrome://、本地文件等无正文可读）
      const proto = (location.protocol || '').toLowerCase();
      if (proto !== 'http:' && proto !== 'https:') return;
      const host = (location.hostname || '').toLowerCase();
      if (isAllowlisted(host, settings.allowlist) || isTrustedDispatch(host)) return; // 可信分发域名不分析
      let bodyText = '';
      try { bodyText = (document.body && document.body.innerText) || ''; } catch (e) {}
      if (bodyText.length > 6000) bodyText = bodyText.slice(0, 6000);
      if (!bodyText.trim()) return;
      sendMsg({ type: 'sf-ai-analyze', page: { url: location.href, title: document.title || '', text: bodyText } })
        .then(function (r) {
          if (!r || !r.ok) {
            // 仅当云端返回「需用户干预」类错误（额度耗尽/限流/Key 失效）才提示一次，
            // 明确区分「本地检测正常」与「云端 AI 分析失败」，并建议关闭 Max 模式。
            if (r && r.needAction) maybeShowAiCloudFailOnce(r.err);
            return; // 其余失败（网络抖动/无返回）静默，不影响防护
          }
          if (r.level === '高') {
            // B1 官网核验判定为仿冒：升级为正式危险处置——弹网页内警告浮层 + 锁定下载入口，
            // 与本地 danger 流程一致（而非仅弹一个会自动消失的轻量 AI 卡片）。
            aiRaiseDanger(r);
          } else if (r.level === '中') {
            // 安静模式（remindMode='quiet'）：仅危险告警，不弹软提示卡，避免打扰。
            if (settings.remindMode !== 'quiet') showAiResult(r);
          }
        })
        .catch(function () {});
    });
  }

  // 云端 AI 分析失败「一次性」提示（低干扰）：
  // 用 sessionStorage 锁整段冷却期（10 分钟）只弹一次，避免限流期间每个新页面都刷屏。
  // 文案明确区分「本地检测正常」与「云端 AI 分析失败」，并建议关闭 Max 模式。
  const AI_CLOUD_FAIL_KEY = 'sf_ai_cloud_fail_shown';
  const AI_CLOUD_FAIL_TTL = 10 * 60 * 1000; // 10 分钟
  function maybeShowAiCloudFailOnce(detail) {
    let ts = 0;
    try { ts = parseInt(sessionStorage.getItem(AI_CLOUD_FAIL_KEY) || '0', 10) || 0; } catch (e) {}
    const now = Date.now();
    if (now - ts < AI_CLOUD_FAIL_TTL) return; // 冷却期内已提示过，跳过
    try { sessionStorage.setItem(AI_CLOUD_FAIL_KEY, String(now)); } catch (e) {}
    showAiCloudFailToast(detail);
  }
  // 专用提示：明确区分「本地检测正常」与「云端 AI 分析失败」，建议关闭 Max 模式。
  // 带换行 + 最大宽度 + 较长停留（5s），不刷屏（受 maybeShowAiCloudFailOnce 冷却锁约束）。
  let aiFailEl = null, aiFailTimer = null;
  function showAiCloudFailToast(detail) {
    if (!document.body) return;
    if (!aiFailEl || !document.body.contains(aiFailEl)) {
      aiFailEl = document.createElement('div');
      aiFailEl.className = 'sf-ai-fail-toast';
      document.body.appendChild(aiFailEl);
    }
    aiFailEl.textContent = '本地检测正常 · 云端 AI 分析失败（' + (detail || '额度或密钥问题') + '）· 建议关闭 Max 模式';
    aiFailEl.style.display = 'block';
    clearTimeout(aiFailTimer);
    aiFailTimer = setTimeout(function () { if (aiFailEl) aiFailEl.style.display = 'none'; }, 5000);
  }

  // B1 官网核验判定为仿冒（level=高）时，升级为正式危险处置：
  // 与本地 danger 流程一致——弹网页内警告浮层、锁定本页全部下载入口、上报检测。
  // 不重复弹 AI 轻量卡片（避免两套提示打架）；已确认放行（dangerAcknowledged）则只刷新 banner 计数。
  function aiRaiseDanger(r) {
    if (dangerAcknowledged) return;
    const brandObj = (r && r.brand) || {};
    const official = brandObj.official || '';
    const brandName = brandObj.brand || '';
    const detailTxt = (r && r.summary)
      ? r.summary
      : '当前域名与 AI 推断的官方域名不一致，疑似仿冒';
    const reasons = [{
      label: '官网核验不符（AI 判定仿冒）',
      detail: '品牌「' + (brandName || '未知') + '」AI 推断官方域名「' + (official || '未知') + '」，与当前访问域名「' + location.hostname + '」不一致，疑似仿冒。' + (detailTxt ? ('\n' + detailTxt) : ''),
      weight: 100,
      ai: true
    }];
    const result = {
      analyzed: true,
      hostname: location.hostname,
      score: 100,
      threshold: 70,
      level: 'danger',
      detected: true,
      aiBrand: brandName,
      aiOfficial: official,
      reasons: reasons,
      features: { domainImpersonation: true }
    };
    lastResult = Object.assign({ blockedCount: 0 }, result);
    dangerActive = true;
    // 仿冒站属高置信信号 → 全面锁定（禁用下载入口 + 拦截程序化导航），与本地 danger 同源处理。
    navBlock = true;
    fullLockdown = true;
    installHardGuards();
    if (settingsRef && settingsRef.autoBlockDownloads) blockAllDownloadEntries();
    updateBannerCount();
    if (settingsRef && settingsRef.showWarning) showWarning(result);
    if (!dangerReported) {
      if (settingsRef && settingsRef.notify) sfNotify(result);
      reportDetection(result);
      dangerReported = true;
    }
  }

  // 页面内 AI 分析结果卡片（独立、低干扰，与本地 danger 警告区分）
  let aiCardEl = null;
  function showAiResult(r) {
    if (aiCardEl && document.body.contains(aiCardEl)) return;
    if (!document.body) return;
    const card = document.createElement('div');
    card.id = 'sf-ai-card';
    card.className = 'sf-ai-card sf-ai-' + (r.level === '高' ? 'high' : 'mid');
    const iconSvg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v6c0 4.6 3 7.7 7 9 4-1.3 7-4.4 7-9V6l-7-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    card.innerHTML =
      '<div class="sf-ai-head">' + iconSvg +
      '<span class="sf-ai-title">AI 网页分析</span>' +
      '<span class="sf-ai-level">风险：' + escapeHtml(r.level) + '</span>' +
      '<button class="sf-ai-close" aria-label="关闭">×</button></div>' +
      '<div class="sf-ai-body">' + escapeHtml((r.summary || '').split('\n').slice(0, 4).join('\n')) + '</div>';
    document.body.appendChild(card);
    card.querySelector('.sf-ai-close').addEventListener('click', function () { closeEl(card); });
    // 自动消失（中危 8s，高危 12s）
    setTimeout(function () { closeEl(card); }, r.level === '高' ? 12000 : 8000);
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

  function analyzeAndAct(settings, chained, data) {
    if (!settings.enabledGlobal) { lastResult = { analyzed: true, disabled: true }; reportVerdict('safe'); return; }
    // ★ 可信分发域名（网盘 / GitHub 官方及镜像）：直接判安全、跳过分析。
    //   否则网盘站点（含大量「下载」入口与网盘链接）会被评分引擎判 danger → 进入即弹「危险网站」警告
    //   并 disable 全部下载按钮（变灰不可点），属严重误伤。与后台 .msi/.zip 豁免同源。
    if (isAllowlisted(location.hostname, settings.allowlist) || isTrustedDispatch(location.hostname)) {
      lastResult = { analyzed: true, allowlisted: true };
      reportVerdict('safe');
      return;
    }

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
      // 高置信木马信号（NAV_BLOCK_FEATURES 之一）命中，或跳转链污染升级 → 除禁用下载入口外，
      // 还要拦截本页一切程序化导航（location 跳转 / 锚点 .click / window.open），
      // 堵死「同源带参跳转」「运行时中继取链」这类内容脚本看不到响应体的二进制下载手法。
      // 普通 medium 组合误判的 danger 页不拦导航，避免良性页被误伤。
      navBlock = NAV_BLOCK_FEATURES.some((f) => result.features && result.features[f]) || !!result.chained;
      // 高置信信号命中即进入「全面锁定」：仿冒站 / NOAH / 运行时取链投递 / 自跳转下载页等页面，
      // 所有交互型 CTA 入口（含伪装成「开始对话」「API 开放平台」的按钮）一律灰化 + 拦截点击
      fullLockdown = navBlock;
      installHardGuards();
      if (settings.autoBlockDownloads) blockAllDownloadEntries();
      updateBannerCount();
      if (settings.showWarning) showWarning(result);
      // 同一页面仅上报一次「报毒」，避免初始分析 + 异步补强 + 二次扫描重复弹出系统通知
      if (!dangerReported) {
        if (settings.notify) sfNotify(result);
        reportDetection(result);
        dangerReported = true;
      }
    } else if (result.level === 'warn') {
      dangerActive = false;
      navBlock = false;
      fullLockdown = false;
      dangerReported = false;
      if (settings.showWarning) showWarnHint(result);
      reportDetection(result);
      // 本页完全无辜（真官网/有备案/无下载），清除跳转链污染
      if (chained) {
        try { chrome.runtime.sendMessage({ type: 'sf-clear-chain' }); } catch (e) {}
      }
    } else {
      dangerActive = false;
      navBlock = false;
      fullLockdown = false;
      dangerReported = false;
      if (chained) {
        try { chrome.runtime.sendMessage({ type: 'sf-clear-chain' }); } catch (e) {}
      }
    }
    reportVerdict(result.level);
  }

  async function run() {
    // 注入得意黑 @font-face（供网页内横幅使用；字体文件经 manifest web_accessible_resources 对 <all_urls> 开放）
    if (!fontFaceInjected) {
      fontFaceInjected = true;
      try {
        const url = chrome.runtime.getURL('fonts/SmileySans-Oblique.woff2');
        const st = document.createElement('style');
        st.textContent = "@font-face{font-family:'SmileySans';src:url('" + url + "') format('woff2');font-display:swap;}";
        (document.head || document.documentElement).appendChild(st);
      } catch (e) {}
    }
    // 仅对普通 http(s) 网页做检测。
    // 本地文件(file://)、浏览器内部页(chrome://、edge://…)、本地开发服务器(localhost/127.0.0.1)
    // 一律跳过——它们没有 ICP 备案且可能是中文页面，会被误判成风险站。
    const proto = (location.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return;
    const _host = (location.hostname || '').toLowerCase();
    if (_host === 'localhost' || _host === '127.0.0.1' || _host === '[::1]') return;

    const settings = await getSettings();
    currentFontMode = settings.fontMode || 'system';
    currentScale = (typeof settings.fontScale === 'number') ? settings.fontScale : 1;
    // 得意黑内置 110% 基准系数（用户实测最佳）；跟随系统仍按滑块原值。
    // 把最终系数注入第三方页面根元素，供网页内横幅的 calc(var(--sf-scale)) 继承。
    if (currentFontMode === 'smiley') currentScale *= 1.10;
    try { document.documentElement.style.setProperty('--sf-scale', currentScale.toFixed(3)); } catch (e) {}
    // 跳转链污染状态（本页是否由已判危站跳转而来）
    let chained = false;
    try { const r = await sendMsg({ type: 'sf-check-chain' }); chained = !!(r && r.tainted); } catch (e) {}

    // ★ 关键修复：先「主采集 → 立即分析」，尽快把危险页写进 dangerTabs，
    //    不再等域名年龄 RDAP(≤6s) / .txt 解析(≤5s)。否则 download.chrome-china.net
    //    这类「meta refresh 秒跳下载」会在内容脚本判定完成前就被导航走，导致下载拦不住。
    // ★ 默认拒绝闸门的内容侧兜底：任何异常都按安全放行，绝不因内容脚本报错把用户下载卡死。
    try {
      const data = collectCore();
      analyzeAndAct(settings, chained, data);
      enrichAsync(settings, chained, data);
    } catch (e) {
      reportVerdict('safe');
    }
    // 后台自动 AI 网页分析：随页面加载异步触发，独立于本地规则判定，不进悬浮球
    try { maybeAiAnalyze(); } catch (e) {}
  }

  // ===== 硬拦截钩子（document_start 即安装，抢在站点脚本之前） =====
  function installHardGuards() {
    if (hardGuardsInstalled) return;
    hardGuardsInstalled = true;

    // 1) window.open（站点脚本之前覆盖）
    try {
      const _open = window.open;
      window.open = function (url) {
        if (!dangerNavBlocked(url)) return _open.apply(window, arguments);
        return null;
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
          if (unblocked || isNextAllowed()) return _click.call(a);
          const href = a.getAttribute('href') || a.href || '';
          // 仅拦截真实导航（排除 javascript:/#/mailto:/tel:/about: 等非导航）
          const navHref = (href && !/^(javascript:|#|mailto:|tel:|about:)/i.test(href)) ? href : null;
          // 高置信信号(navBlock) 或 明确下载 URL → 拦截，堵死运行时中继取链 / 直接甩文件
          if (navHref && (navBlock || isDownloadUrl(navHref))) {
            if (!document.getElementById('sf-overlay')) showDownloadBlocked(location.hostname, { url: navHref });
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
    // 早期拦截：IDM 等第三方下载器常在 mousedown 阶段就把链接 URL 抢走（早于 click），
    // 故在 mousedown / pointerdown 捕获阶段即拦截，阻断其接管下载。
    document.addEventListener('mousedown', globalClickGuard, true);
    document.addEventListener('pointerdown', globalClickGuard, true);
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
