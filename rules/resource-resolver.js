/*
 * resource-resolver.js — 银狐防护「下载发现层」BFS 资源解析器
 *
 * 来源：整合原作者（上游）ResourceResolver 框架，ESM → IIFE 适配我们的
 *       importScripts + 双环境导出（content script / service worker / Node 测试）。
 *
 * 职责：把页面当成一棵树，用多种「解析器」递归往下挖，找出我们旧发现层
 *       抓不到的下载入口，弥补「只有指定网址瞬间下载才能拦截」的短板：
 *         - 内联脚本里写死的直链：location= / window.open / fetch / 字符串字面量 .zip
 *         - .txt 文件里的真实地址（含 .txt → .txt → .zip 多级递归）
 *         - meta refresh 自动跳转目标
 *         - iframe 嵌套的直链 / 同域 iframe 内容扫描
 *         - 跳转链探测：对跨域 / 处理器端点（get.php 等）做 HEAD 跟随 3xx
 *
 * 设计原则（与上游一致）：
 *   - 任何解析失败 → 返回中性结果，绝不影响其它模块、绝不抛错。
 *   - 总超时 5s → 超时立即返回已构建的部分结果。
 *   - 同一 URL 整个生命周期最多解析一次（visited set）。
 *   - 受深度(3) / 资源总数(20) / 单资源超时(2s) / 重定向(5) 限制。
 *
 * 与现有打分引擎的衔接（增量增强式）：
 *   本模块只负责「发现」，产出 downloadLinks（与 data.links 同形的 {href,text} 数组），
 *   由 content.js 合并进 data.links，analyzer 现有的 detCrossDomainDownload /
 *   detBrandedExe / detDoubleExt 等检测器照常消费，无需改动。
 *
 * 注意（浏览器 CORS 现实）：跨域重定向的 Location 头在 content script 中常因
 *   CORS 读不到，故「跳转链探测」对同域重定向器最有效；跨域 CDN 重定向为尽力而为。
 */

(function () {
  'use strict';

  // ==================== 复用 iocs 的扩展名 / 分类（内容脚本中 window.SF_IOCS 已存在）====================
  function getIOCS() {
    try {
      if (typeof window !== 'undefined' && window.SF_IOCS) return window.SF_IOCS;
      if (typeof self !== 'undefined' && self.SF_IOCS) return self.SF_IOCS;
      if (typeof global !== 'undefined' && global.SF_IOCS) return global.SF_IOCS;
    } catch (e) {}
    return null;
  }

  // 兜底内联常量（与 iocs.js 保持一致；仅在 SF_IOCS 不可用时启用）
  const FALLBACK_EXEC = ['exe', 'msi', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'ps1', 'jar', 'lnk', 'cpl', 'wsf', 'hta', 'dll', 'sys'];
  const FALLBACK_ARCHIVE = ['zip', 'rar', '7z', 'gz', 'tar', 'iso', 'img', 'tgz', 'bz2', 'xz', 'z', 'cab', 'arj', 'lzh', 'zst', 'apk'];
  const FALLBACK_TXT = ['txt', 'text', 'log', 'csv'];
  const FALLBACK_JSON = ['json'];
  const FALLBACK_CLOUD = ['pan.baidu.com', 'aliyundrive.com', 'lanzou', 'quark.cn', '115.com', 'ctfile', 'cowtransfer', 'weiyun', '123pan'];

  function execExts() { const i = getIOCS(); return (i && i.EXEC_EXTENSIONS) || FALLBACK_EXEC; }
  function archiveExts() { const i = getIOCS(); return (i && i.ARCHIVE_EXTENSIONS) || FALLBACK_ARCHIVE; }
  function txtExts() { const i = getIOCS(); return (i && i.TEXT_EXTENSIONS) || FALLBACK_TXT; }
  function jsonExts() { const i = getIOCS(); return (i && i.JSON_EXTENSIONS) || FALLBACK_JSON; }
  function classifyLinkFn() {
    const i = getIOCS();
    if (i && i.classifyLink) return i.classifyLink;
    // 兜底分类（与 iocs.classifyLink 逻辑一致）
    return function (href) {
      if (!href || typeof href !== 'string') return 'other';
      const h = href.toLowerCase().split(/[?#]/)[0];
      for (const e of execExts()) if (h.endsWith('.' + e)) return 'exec';
      for (const e of archiveExts()) if (h.endsWith('.' + e)) return 'archive';
      for (const c of FALLBACK_CLOUD) if (h.indexOf(c) !== -1) return 'cloud';
      if (/download|down|下载/i.test(href)) return 'download';
      return 'other';
    };
  }

  // ==================== 递归 / 限额常量 ====================
  const LIMITS = {
    MAX_DEPTH: 3,                 // 页面本身 depth=0，最多向下 3 层
    MAX_TOTAL_RESOURCES: 20,      // 整个解析最多处理的资源数（含页面本身）
    MAX_TXT_SIZE: 256 * 1024,     // .txt 最大下载 256KB
    PER_RESOURCE_TIMEOUT: 2000,   // 单资源 fetch 超时
    TOTAL_TIMEOUT: 5000,          // 整个 Resolver 总超时
    MAX_REDIRECTS: 5,             // HTTP 30x 最长跟随
    MAX_TXT_RECURSION: 2,         // .txt → .txt 递归层数
    MAX_REDIRECT_PROBES: 10       // 跳转链探测最大探针数
  };

  // ==================== 资源类型 / 来源类型枚举 ====================
  const RESOURCE_TYPES = {
    HTML: 'html', SCRIPT_INLINE: 'script_inline', META_REFRESH: 'meta_refresh',
    IFRAME: 'iframe', TXT: 'txt', JSON: 'json',
    ARCHIVE: 'archive', EXECUTABLE: 'executable',
    REDIRECT_PROBE: 'redirect_probe', REDIRECT: 'redirect', UNKNOWN: 'unknown'
  };
  const SOURCE_TYPES = {
    PAGE_ROOT: 'page_root', A_HREF: 'a_href', INLINE_SCRIPT: 'inline_script',
    META_REFRESH: 'meta_refresh', IFRAME_SRC: 'iframe_src', TXT_CONTENT: 'txt_content',
    REDIRECT: 'redirect', STRING_LITERAL: 'string_literal', PAGE_TEXT: 'html_text',
    SCRIPT_PROBE: 'script_probe'
  };

  // ==================== URL 提取正则（带 g 标志，exec 前须重置 lastIndex）====================
  const LOCATION_PATTERNS = [
    /window\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    /location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    /location\.assign\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi,
    /location\.replace\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi,
    /window\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    /self\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    /top\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    /parent\.location\s*=\s*["'`]([^"'`]+)["'`]/gi
  ];
  const WINDOW_OPEN_PATTERN = /window\.open\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  const FETCH_PATTERNS = [
    /fetch\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    /axios\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    /axios\.get\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    /axios\.post\s*\(\s*["'`]([^"'`]+)["'`]/gi
  ];
  const DOWNLOAD_ATTR_PATTERN = /download\s*=\s*["'`]([^"'`]*)["'`]/gi;
  const NEW_URL_PATTERN = /new\s+URL\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  const URL_PATTERN = /https?:\/\/[^\s<>"'`{}[\]|\\^`一-鿿]+/gi;

  // 字符串字面量中的归档/可执行 URL（由扩展名并集生成，后缀边界锚定）
  const AE_EXTS = (function () {
    try { return [].concat(archiveExts(), execExts()); } catch (e) { return FALLBACK_ARCHIVE.concat(FALLBACK_EXEC); }
  })();
  const STRING_URL_PATTERN = (function () {
    const exts = AE_EXTS.map(function (e) { return e.replace(/^\./, ''); }).join('|');
    return new RegExp("['\"](https?://[^'\"]*\\.(" + exts + ")(?:[\\?&#]|$))['\"]", 'gi');
  })();
  // 兜底归档 URL 提取（用于 pageText / .txt 正文）
  const ARCHIVE_URL_PATTERN = (function () {
    const exts = AE_EXTS.map(function (e) { return e.replace(/^\./, ''); }).join('|');
    return new RegExp("https?:\\/\\/[^\\s<>\"]*\\.(" + exts + ")(?:[\\?&#>\"'<]|\\s|$)", 'gi');
  })();

  // ==================== 工具函数 ====================
  function normalizeKey(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      return u.href.toLowerCase();
    } catch (e) {
      return (url || '').replace(/#.*$/, '').toLowerCase();
    }
  }

  function extractExt(url) {
    try {
      const p = new URL(url).pathname.toLowerCase();
      if (p.endsWith('.tar.gz')) return '.tar.gz';
      if (p.endsWith('.tar.bz2')) return '.tar.bz2';
      if (p.endsWith('.tar.xz')) return '.tar.xz';
      const m = p.match(/\.([a-z0-9]+)$/i);
      return m ? '.' + m[1].toLowerCase() : '';
    } catch (e) { return ''; }
  }

  function isCrossDomain(u1, u2) {
    try { return new URL(u1).hostname !== new URL(u2).hostname; } catch (e) { return true; }
  }

  // 跳过 js:/data:/mailto:/# 等非 http 协议；只接受 http/https 绝对化结果
  function resolveUrl(rawUrl, baseUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const t = rawUrl.trim();
    if (!t) return null;
    if (/^(javascript|data|mailto|tel|file|vbscript):/i.test(t)) return null;
    if (/^#/.test(t)) return null;
    try {
      const r = new URL(t, baseUrl);
      if (r.protocol !== 'http:' && r.protocol !== 'https:') return null;
      return r.href;
    } catch (e) { return null; }
  }

  // 按扩展名给出资源类型（用于 BFS 节点分类与递归决策）
  // 注意：extractExt 返回带点的扩展名（如 '.zip'），而扩展名列表不带点（'zip'），
  // 故比较前统一去掉点，避免大小写/点号不一致导致判定失效。
  function extKind(url) {
    const ext = extractExt(url).replace(/^\./, '');
    const a = archiveExts(), e = execExts(), t = txtExts(), j = jsonExts();
    if (a.indexOf(ext) !== -1) return 'archive';
    if (e.indexOf(ext) !== -1) return 'exec';
    if (t.indexOf(ext) !== -1) return 'txt';
    if (j.indexOf(ext) !== -1) return 'json';
    return 'none';
  }

  // 把 classifyLink 结果映射为「是否下载链接」
  function isDownloadLink(href) {
    const c = classifyLinkFn()(href);
    return c === 'exec' || c === 'archive' || c === 'cloud' || c === 'download';
  }

  // 安全 exec：重置 lastIndex 后循环，避免共享正则 lastIndex 串扰
  function execAll(re, str) {
    const out = [];
    if (!str) return out;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(str)) !== null) {
      out.push(m);
      if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
    }
    return out;
  }

  // ==================== ResourceGraph（轻量，仅保留我们消费的数据）====================
  function ResourceGraph(pageUrl) {
    this.pageUrl = (function () { try { return new URL(pageUrl).href; } catch (e) { return pageUrl; } })();
    try { this.pageDomain = new URL(pageUrl).hostname; } catch (e) { this.pageDomain = ''; }
    this.nodes = {};                 // key(normalized) → node
    this.downloadLinks = [];         // 合并进 data.links 的 {href,text,source,depth,crossDomain}
    this.redirectChain = [];         // [{from,to,statusCode}]
    this.allUrls = [];               // 全部发现的资源（含非下载，调试用）
    this.totalResources = 0;
    this.maxDepth = 0;
    this._downloadSeen = new Set();
  }
  ResourceGraph.prototype.addNode = function (node) {
    const key = normalizeKey(node.url);
    if (this.nodes[key]) return this.nodes[key];
    this.nodes[key] = node;
    this.totalResources = Object.keys(this.nodes).length;
    this.maxDepth = Math.max(this.maxDepth, node.depth || 0);
    this.allUrls.push(node.url);
    // 下载链接收集（去重）
    const kind = node.type;
    const isDl = (kind === RESOURCE_TYPES.ARCHIVE || kind === RESOURCE_TYPES.EXECUTABLE ||
      isDownloadLink(node.url));
    if (isDl && !this._downloadSeen.has(key)) {
      this._downloadSeen.add(key);
      this.downloadLinks.push({
        href: node.url,
        text: node.text || sourceLabel(node.sourceType),
        source: node.sourceType,
        depth: node.depth || 0,
        ext: (node.metadata && node.metadata.ext) || extractExt(node.url),
        crossDomain: !!(node.metadata && node.metadata.isCrossDomain)
      });
    }
    return node;
  };
  ResourceGraph.prototype.addRedirect = function (from, to, statusCode) {
    this.redirectChain.push({ from: from, to: to, statusCode: statusCode });
  };
  ResourceGraph.prototype.getSummary = function () {
    return {
      pageUrl: this.pageUrl, totalResources: this.totalResources, maxDepth: this.maxDepth,
      downloadLinks: this.downloadLinks.length, redirectCount: this.redirectChain.length,
      archiveUrls: this.downloadLinks.filter(function (d) { return /\.(zip|rar|7z|gz|tar|iso|img|tgz|bz2|xz|cab|apk)(\?|#|$)/i.test(d.href); }).map(function (d) { return d.href; }),
      executableUrls: this.downloadLinks.filter(function (d) { return /\.(exe|msi|scr|bat|cmd|com|pif|vbs|ps1|jar|lnk|cpl|wsf|hta|dll|sys)(\?|#|$)/i.test(d.href); }).map(function (d) { return d.href; })
    };
  };

  function sourceLabel(st) {
    switch (st) {
      case SOURCE_TYPES.INLINE_SCRIPT: return '(脚本内直链)';
      case SOURCE_TYPES.STRING_LITERAL: return '(脚本字符串直链)';
      case SOURCE_TYPES.META_REFRESH: return '(meta刷新跳转)';
      case SOURCE_TYPES.IFRAME_SRC: return '(iframe嵌套)';
      case SOURCE_TYPES.TXT_CONTENT: return '(.txt内嵌)';
      case SOURCE_TYPES.REDIRECT: return '(重定向终点)';
      case SOURCE_TYPES.PAGE_TEXT: return '(页面文本)';
      case SOURCE_TYPES.SCRIPT_PROBE: return '(跳转探测)';
      default: return '(页面发现)';
    }
  }

  // ==================== 解析器实现 ====================
  // 每个解析器：canHandle(node) + resolve(node, ctx) → child 描述数组

  // —— 内联脚本：静态分析（不执行），提取各类 URL ——
  function resolveScript(node, ctx) {
    const out = [];
    const scriptText = node.metadata && node.metadata.scriptText || '';
    if (!scriptText || scriptText.length < 3) return out;
    const pageUrl = node.parentUrl || ctx.pageUrl;
    const found = new Set();

    function add(u) { const a = resolveUrl(u, pageUrl); if (a) found.add(a); }

    LOCATION_PATTERNS.forEach(function (p) { execAll(p, scriptText).forEach(function (m) { add(m[1]); }); });
    execAll(WINDOW_OPEN_PATTERN, scriptText).forEach(function (m) { add(m[1]); });
    FETCH_PATTERNS.forEach(function (p) { execAll(p, scriptText).forEach(function (m) { add(m[1]); }); });
    execAll(DOWNLOAD_ATTR_PATTERN, scriptText).forEach(function (m) {
      if (m[1] && m[1].indexOf('/') !== -1) add(m[1]);
    });
    execAll(NEW_URL_PATTERN, scriptText).forEach(function (m) { add(m[1]); });
    execAll(STRING_URL_PATTERN, scriptText).forEach(function (m) { add(m[1]); });
    // 通用字符串字面量（提取其中的 URL）
    extractStringLiterals(scriptText).forEach(function (lit) {
      execAll(URL_PATTERN, lit).forEach(function (m) { add(m[0]); });
    });

    found.forEach(function (url) { out.push(makeChild(url, RESOURCE_TYPES.UNKNOWN, SOURCE_TYPES.INLINE_SCRIPT, node, ctx)); });
    return out;
  }

  // 提取 JS 字符串字面量（最短 5 字符，过滤噪音）
  function extractStringLiterals(code) {
    const lits = [];
    const MIN = 5;
    const patterns = [/'([^'\\]*(?:\\.[^'\\]*)*)'/g, /"([^"\\]*(?:\\.[^"\\]*)*)"/g, /`([^`\\]*(?:\\.[^`\\]*)*)`/g];
    patterns.forEach(function (p) {
      execAll(p, code).forEach(function (m) { if (m[1].length > MIN) lits.push(m[1]); });
    });
    return lits;
  }

  // —— .txt 文件：fetch 内容，提取 URL（含 .txt → .txt 递归）——
  async function resolveTxt(node, ctx) {
    const out = [];
    // 用 txtHop（递归跳数）而非绝对 depth 限制，避免被页面深度计数提前截断
    if ((node.metadata && node.metadata.txtHop || 0) >= ctx.cfg.maxTxtRecursion) return out;
    let content;
    try {
      const r = await ctx.fetchFn(node.url, { sizeLimit: LIMITS.MAX_TXT_SIZE, method: 'GET' });
      content = await r.text();
    } catch (e) { return out; }
    if (!content) return out;
    const pageUrl = node.parentUrl || ctx.pageUrl;
    const found = new Set();
    execAll(ARCHIVE_URL_PATTERN, content).forEach(function (m) { const a = resolveUrl(m[0], pageUrl); if (a) found.add(a); });
    execAll(URL_PATTERN, content).forEach(function (m) { const a = resolveUrl(m[0], pageUrl); if (a) found.add(a); });
    found.forEach(function (url) {
      const ch = makeChild(url, RESOURCE_TYPES.UNKNOWN, SOURCE_TYPES.TXT_CONTENT, node, ctx);
      if (extKind(url) === 'txt') ch.metadata.txtHop = (node.metadata && node.metadata.txtHop || 0) + 1; // 下一级 .txt 累加跳数
      out.push(ch);
    });
    return out;
  }

  // —— meta refresh：把跳转目标作为子节点 ——
  function resolveMeta(node, ctx) {
    const out = [];
    const metas = (node.metadata && node.metadata.metaUrls) || [];
    metas.forEach(function (m) {
      const a = resolveUrl(m.url, node.parentUrl || ctx.pageUrl);
      if (!a) return;
      out.push(makeChild(a, RESOURCE_TYPES.UNKNOWN, SOURCE_TYPES.META_REFRESH, node, ctx));
    });
    return out;
  }

  // —— iframe：直链直接收；同域则 fetch 内容扫描；跨域尽力 ——
  async function resolveIframe(node, ctx) {
    const out = [];
    const url = node.url;
    const kind = extKind(url);
    if (kind === 'archive' || kind === 'exec' || kind === 'txt' || kind === 'json') {
      // 直链型：直接作为子节点产出（makeChild 已收下载链接）
      out.push(makeChild(url, kind === 'txt' ? RESOURCE_TYPES.TXT : (kind === 'json' ? RESOURCE_TYPES.JSON : RESOURCE_TYPES.UNKNOWN), SOURCE_TYPES.IFRAME_SRC, node, ctx));
      return out;
    }
    // 同域 iframe → fetch 内容扫描其中 URL（跨域会被 CORS 拦，静默失败）
    if (!isCrossDomain(url, ctx.pageUrl)) {
      try {
        const r = await ctx.fetchFn(url, { sizeLimit: LIMITS.MAX_TXT_SIZE, method: 'GET' });
        const html = await r.text();
        const found = new Set();
        execAll(ARCHIVE_URL_PATTERN, html).forEach(function (m) { const a = resolveUrl(m[0], url); if (a) found.add(a); });
        execAll(URL_PATTERN, html).forEach(function (m) { const a = resolveUrl(m[0], url); if (a) found.add(a); });
        found.forEach(function (u) { out.push(makeChild(u, RESOURCE_TYPES.UNKNOWN, SOURCE_TYPES.IFRAME_SRC, node, ctx)); });
      } catch (e) { /* 跨域 / 失败 → 跳过 */ }
    }
    return out;
  }

  // —— 跳转链探测：HEAD 跟随 3xx ——
  // 浏览器中跨域 3xx 的 Location 头因 CORS 不可读（opaqueredirect），故用 redirect:'follow'
  // 跟随到终点后比较 response.url 是否变化——response.url 跨域也始终可读（CORS 安全），
  // 从而「跳转到的归档包」在跨域场景也能被发现；同域则仍逐跳读 Location 记录完整链路。
  async function resolveRedirect(node, ctx) {
    const out = [];
    if (node.depth >= ctx.cfg.maxDepth) return out;
    let current = node.url;
    const chainSeen = new Set();
    for (let i = 0; i < ctx.cfg.maxRedirects; i++) {
      if (chainSeen.has(current)) break;
      chainSeen.add(current);
      try {
        const r = await ctx.fetchFn(current, { method: 'HEAD', followRedirects: true });
        const status = r.status || 0;
        const finalUrl = (r.url && r.url !== current) ? r.url : null;
        // 情况 A：明确 3xx + 可读 Location（同域）→ 逐跳记录
        if (status >= 300 && status < 400 && r.headers) {
          const loc = getHeader(r, 'location');
          if (loc) {
            const next = resolveUrl(loc, current);
            if (next && next !== current) {
              ctx.graph.addRedirect(current, next, status);
              const kind = extKind(next);
              current = next;
              if (i === ctx.cfg.maxRedirects - 1 || kind === 'archive' || kind === 'exec' || kind === 'txt' || kind === 'json') {
                out.push(makeChild(next, kind === 'txt' ? RESOURCE_TYPES.TXT : (kind === 'json' ? RESOURCE_TYPES.JSON : RESOURCE_TYPES.UNKNOWN), SOURCE_TYPES.REDIRECT, node, ctx));
              }
              continue;
            }
          }
        }
        // 情况 B（浏览器跨域）：跟随到终点，response.url 与请求不同 → 发生了跳转
        if (finalUrl) {
          ctx.graph.addRedirect(current, finalUrl, status);
          const kind = extKind(finalUrl);
          out.push(makeChild(finalUrl, kind === 'txt' ? RESOURCE_TYPES.TXT : (kind === 'json' ? RESOURCE_TYPES.JSON : RESOURCE_TYPES.UNKNOWN), SOURCE_TYPES.REDIRECT, node, ctx));
        }
        break;
      } catch (e) { break; }
    }
    return out;
  }

  function getHeader(r, name) {
    if (!r || !r.headers) return null;
    if (typeof r.headers.get === 'function') return r.headers.get(name) || r.headers.get(name.toLowerCase());
    return (r.headers[name] || r.headers[name.toLowerCase()] || null);
  }

  // —— JSON 文件：fetch 后扫描字符串值中的 URL ——
  async function resolveJson(node, ctx) {
    const out = [];
    let content;
    try {
      const r = await ctx.fetchFn(node.url, { sizeLimit: LIMITS.MAX_TXT_SIZE, method: 'GET' });
      content = await r.text();
    } catch (e) { return out; }
    if (!content) return out;
    const found = new Set();
    execAll(URL_PATTERN, content).forEach(function (m) { const a = resolveUrl(m[0], node.parentUrl || ctx.pageUrl); if (a) found.add(a); });
    found.forEach(function (url) { out.push(makeChild(url, RESOURCE_TYPES.UNKNOWN, SOURCE_TYPES.TXT_CONTENT, node, ctx)); });
    return out;
  }

  // ==================== 子节点工厂 ====================
  function makeChild(url, forcedType, sourceType, parent, ctx) {
    let kind = forcedType || RESOURCE_TYPES.UNKNOWN;
    const ext = extractExt(url);
    const xdom = isCrossDomain(url, ctx.pageUrl);
    // 未强制类型时按扩展名自动归类，确保 .txt/.json 走对应解析器（被 fetch 解析）
    if (kind === RESOURCE_TYPES.UNKNOWN) {
      const k = extKind(url);
      if (k === 'txt') kind = RESOURCE_TYPES.TXT;
      else if (k === 'json') kind = RESOURCE_TYPES.JSON;
      else if (k === 'archive') kind = RESOURCE_TYPES.ARCHIVE;
      else if (k === 'exec') kind = RESOURCE_TYPES.EXECUTABLE;
    }
    return {
      url: url,
      parentUrl: parent.url,
      depth: (parent.depth || 0) + 1,
      type: kind,
      sourceType: sourceType,
      text: sourceLabel(sourceType),
      metadata: { ext: ext, isCrossDomain: xdom }
    };
  }

  // ==================== 解析器分发 ====================
  const RESOLVERS = [
    { can: function (n) { return n.type === RESOURCE_TYPES.SCRIPT_INLINE; }, run: resolveScript },
    { can: function (n) { return n.type === RESOURCE_TYPES.META_REFRESH; }, run: resolveMeta },
    { can: function (n) { return n.type === RESOURCE_TYPES.TXT; }, run: resolveTxt },
    { can: function (n) { return n.type === RESOURCE_TYPES.IFRAME; }, run: resolveIframe },
    { can: function (n) { return n.type === RESOURCE_TYPES.JSON; }, run: resolveJson },
    { can: function (n) { return n.type === RESOURCE_TYPES.REDIRECT_PROBE || (n.type || '').indexOf('redirect') === 0; }, run: resolveRedirect }
  ];

  async function resolveNode(node, ctx) {
    for (const r of RESOLVERS) {
      if (r.can(node)) {
        try {
          const res = await Promise.race([
            r.run(node, ctx),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('per_resource_timeout')); }, ctx.cfg.perResourceTimeout); })
          ]);
          return res || [];
        } catch (e) { return []; }
      }
    }
    return [];
  }

  // ==================== 初始种子入队 ====================
  function enqueueInitial(queue, initialData, pageUrl, graph, ctx) {
    initialData = initialData || {};
    // 1) 内联脚本
    (initialData.inlineScripts || []).forEach(function (s, i) {
      const text = (s && s.text) || '';
      if (!text || text.length < 3) return;
      // 用 ? 而非 # 作虚拟节点后缀：normalizeKey 去的是 hash，会保留 query，
      // 这样虚拟节点 key 不会和页面根节点（pageUrl 本身）撞车被误判「已访问」。
      queue.push({ url: pageUrl + '?__inline_script_' + i, parentUrl: pageUrl, depth: 1, type: RESOURCE_TYPES.SCRIPT_INLINE, sourceType: SOURCE_TYPES.INLINE_SCRIPT, text: '(脚本内直链)', metadata: { scriptText: text, isExternal: false } });
    });
    // 2) meta refresh
    (initialData.metaRefreshUrls || []).forEach(function (m, i) {
      const u = m && m.url;
      if (!u) return;
      queue.push({ url: pageUrl + '?__meta_refresh_' + i, parentUrl: pageUrl, depth: 1, type: RESOURCE_TYPES.META_REFRESH, sourceType: SOURCE_TYPES.META_REFRESH, text: '(meta刷新跳转)', metadata: { metaUrls: [{ url: u, delay: m.delay || 0, originalContent: m.originalContent || '' }] } });
    });
    // 3) iframe
    (initialData.iframeSrcs || []).forEach(function (src) {
      if (!src) return;
      const a = resolveUrl(src, pageUrl);
      if (!a) return;
      queue.push({ url: a, parentUrl: pageUrl, depth: 1, type: RESOURCE_TYPES.IFRAME, sourceType: SOURCE_TYPES.IFRAME_SRC, text: '(iframe嵌套)', metadata: { ext: extractExt(a), isCrossDomain: isCrossDomain(a, pageUrl) } });
    });
    // 4) 跳转链探针：从现有页面链接中挑「处理器端点 / 跨域非下载」候选（限量）
    let probes = 0;
    (initialData.links || []).forEach(function (l) {
      if (probes >= LIMITS.MAX_REDIRECT_PROBES) return;
      const href = (l && l.href) || '';
      if (!href) return;
      if (!/^https?:\/\//i.test(href)) return; // 跳过 javascript:/#/mailto:/tel: 等非导航链接，避免对其发起 fetch
      const cl = classifyLinkFn()(href);
      if (cl === 'cloud' || cl === 'archive' || cl === 'exec') return;
      const ek = extKind(href);
      if (ek === 'txt' || ek === 'json') return;
      const cross = isCrossDomain(href, pageUrl);
      const handler = /\.(php|asp|aspx|jsp|do|action|cgi|html?)(?:[?#]|$)/i.test(href) || /\?/.test(href);
      if (!cross && !handler) return;
      probes++;
      queue.push({ url: href, parentUrl: pageUrl, depth: 1, type: RESOURCE_TYPES.REDIRECT_PROBE, sourceType: SOURCE_TYPES.SCRIPT_PROBE, text: '(跳转探测)', metadata: { ext: extractExt(href), isCrossDomain: cross } });
    });
  }

  // pageText 兜底：提取归档 URL（与 DLINK_URL_RE 互补，覆盖脚本被挖掉后遗漏的直链）
  function extractFromPageText(graph, pageText, pageUrl, visited, cfg) {
    const found = new Set();
    execAll(ARCHIVE_URL_PATTERN, pageText).forEach(function (m) {
      try {
        const a = new URL(m[0], pageUrl).href;
        if (!visited.has(normalizeKey(a))) found.add(a);
      } catch (e) {}
    });
    found.forEach(function (url) {
      if (graph.totalResources >= cfg.maxTotalResources) return;
      graph.addNode({ url: url, parentUrl: pageUrl, depth: 1, type: RESOURCE_TYPES.ARCHIVE, sourceType: SOURCE_TYPES.PAGE_TEXT, text: '(页面文本)', metadata: { ext: extractExt(url), isCrossDomain: isCrossDomain(url, pageUrl) } });
    });
  }

  // ==================== 默认 fetch 封装（内容脚本用全局 fetch；Node 测试注入 mock）====================
  async function defaultFetch(url, opts) {
    opts = opts || {};
    // 只处理 http(s) 协议：javascript:/data:/mailto:/tel:/# 等非导航链接不应发起网络请求
    if (!/^https?:\/\//i.test(String(url || ''))) {
      return { ok: false, status: 0, skipped: true, headers: null, text: async function () { return ''; } };
    }
    // 避免 HTTPS 页面下的 Mixed Content 拦截：把 http:// 升级为 https://
    // （现代站点普遍支持 https；升级后请求仍在安全上下文，不再触发浏览器硬拦与控制台红字；
    //  即使目标不支持 https 也仅是 fetch 失败被下方 catch 静默跳过，不影响其它逻辑）
    let finalUrl = String(url);
    try {
      if (typeof location !== 'undefined' && location.protocol === 'https:' &&
          /^http:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl.slice(7);
      }
    } catch (e) {}
    const ctrl = new AbortController();
    const tid = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, LIMITS.PER_RESOURCE_TIMEOUT);
    try {
      const r = await fetch(finalUrl, {
        method: opts.method || 'GET',
        signal: ctrl.signal,
        redirect: opts.followRedirects === false ? 'manual' : 'follow',
        cache: 'no-store'
      });
      return {
        ok: r.ok, status: r.status, headers: r.headers,
        text: async function () {
          const cl = (r.headers && r.headers.get) ? r.headers.get('content-length') : null;
          if (cl && parseInt(cl, 10) > (opts.sizeLimit || LIMITS.MAX_TXT_SIZE)) throw new Error('size_exceeded');
          const t = await r.text();
          if (t.length > (opts.sizeLimit || LIMITS.MAX_TXT_SIZE)) throw new Error('size_exceeded');
          return t;
        }
      };
    } finally { clearTimeout(tid); }
  }

  // ==================== 主入口 ====================
  async function resolve(pageUrl, initialData, options) {
    options = options || {};
    const cfg = {
      maxDepth: options.maxDepth || LIMITS.MAX_DEPTH,
      maxTotalResources: options.maxTotalResources || LIMITS.MAX_TOTAL_RESOURCES,
      maxTxtSize: options.maxTxtSize || LIMITS.MAX_TXT_SIZE,
      perResourceTimeout: options.perResourceTimeout || LIMITS.PER_RESOURCE_TIMEOUT,
      totalTimeout: options.totalTimeout || LIMITS.TOTAL_TIMEOUT,
      maxRedirects: options.maxRedirects || LIMITS.MAX_REDIRECTS,
      maxTxtRecursion: options.maxTxtRecursion || LIMITS.MAX_TXT_RECURSION
    };
    const fetchFn = options.fetchFn || defaultFetch;
    const graph = new ResourceGraph(pageUrl);
    const visited = new Set();
    visited.add(normalizeKey(pageUrl));
    const ctx = { graph: graph, cfg: cfg, pageUrl: pageUrl, fetchFn: fetchFn, startTime: Date.now() };
    const queue = [];
    enqueueInitial(queue, initialData, pageUrl, graph, ctx);

    while (queue.length > 0 && graph.totalResources < cfg.maxTotalResources) {
      if (Date.now() - ctx.startTime > cfg.totalTimeout) break;
      const cur = queue.shift();
      const key = normalizeKey(cur.url);
      if (visited.has(key)) continue;
      visited.add(key);
      // 先记录该节点（即便超过 maxDepth 也要收集其下载链接，如深层 .txt 递归出的归档包）
      graph.addNode(cur);
      if ((cur.depth || 0) > cfg.maxDepth) continue; // 超深：仅记录，不再继续下挖子资源
      const children = await resolveNode(cur, ctx);
      for (const ch of children) {
        if (!visited.has(normalizeKey(ch.url))) queue.push(ch);
        if (graph.totalResources >= cfg.maxTotalResources) break;
      }
    }

    if (initialData && initialData.pageText && graph.totalResources < cfg.maxTotalResources) {
      extractFromPageText(graph, initialData.pageText, pageUrl, visited, cfg);
    }
    return graph;
  }

  // ==================== 导出（双环境）====================
  const API = {
    resolve: resolve,
    extractExt: extractExt,
    classifyLink: classifyLinkFn(),
    LIMITS: LIMITS,
    RESOURCE_TYPES: RESOURCE_TYPES,
    SOURCE_TYPES: SOURCE_TYPES,
    isDownloadLink: isDownloadLink,
    _internal: { normalizeKey: normalizeKey, resolveUrl: resolveUrl, extKind: extKind }
  };
  if (typeof window !== 'undefined') window.SF_RESOLVER = API;
  if (typeof self !== 'undefined') self.SF_RESOLVER = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
