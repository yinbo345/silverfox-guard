/*
 * analyzer.js — 银狐防护 评分引擎（多维度加权 + 早期退出 + 阈值分层）
 *
 * 关键设计（吸收自 VirusDetector 开源实现）：
 *  1) 官方早期退出：域名命中 OFFICIAL_DOMAINS（精确/子域）→ 直接判安全，跳过后续所有规则。
 *     这是根治「真官网被拦下载」的根本手段。
 *  2) ICP 备案核查：中国语境站点（.cn / 含中文）无备案号 → 强可疑（仿冒站基本无备案）。
 *  3) 代码工程化 / AI 生成痕迹：DOM 复杂度低 + 无框架 + 外部资源少 + emoji 密度异常 →
 *     抓「批量复制 / AI 写出来的低质量站」。
 *  4) 域名仿冒检测：品牌词 段匹配 / 子串 / 堆叠 / 编辑距离 + 去连字符二次检测。
 *  5) 阈值分层：warn（温和提示，不拦）/ danger（警告浮层 + 禁用下载链接）。
 *
 * 仅做本地可执行的强特征，不依赖外部网络（RDAP 域名年龄等放到后台异步可选，不影响主判定）。
 */
(function () {
  'use strict';

  // 内容脚本（window 隔离世界）与后台 service worker（self，无 window）两种上下文都要兼容
  const IOCS = (typeof window !== 'undefined' && window.SF_IOCS)
    ? window.SF_IOCS
    : (typeof self !== 'undefined' && self.SF_IOCS)
      ? self.SF_IOCS
      : (typeof require !== 'undefined' ? require('./iocs') : {});

  // ============ 官方域名快速索引（精确 + 子域匹配）============
  const OFFICIAL_SET = new Set((IOCS.OFFICIAL_DOMAINS || []).map(d => d.toLowerCase()));

  // 性能优化：模块级复用正则，避免重复编译
  const WWW_RE = /^www\./;
  const SKIP_HREF_RE = /^javascript:|^#|^mailto:|^tel:/i;

  // ============ 域名后缀分级查表（O(标签数) 替代 O(名单长度) 线性遍历）============
  // ⚠️ 2026-08-27 性能重构（#343）：原先判定「域名本身或其子域是否在某名单中」写法是
  //     SET.has(h) || [...SET].some(d => h.endsWith('.' + d))
  // 即每查一个域名都把整份名单遍历一遍做字符串 endsWith。官方白名单由 444 条扩容到
  // 1464 条后，单次 isOfficialDomain 实测 74.8 µs；而它与 isTrustedDownloadHost 会在
  // **页面链接循环内部**被反复调用（detCrossDomainDownload / detBlacklistedPayload /
  // detDirectExec / detBrandedExe / detBrandedSoftSite 各自遍历一遍全部链接），
  // 200 链接的页面因此产生数十万次字符串比较 —— 白名单越全，页面反而越卡。
  //
  // 改为「后缀分级查表」：把待查域名按 . 逐级切出所有**标签对齐后缀**去 Set 里查。
  //     a.b.example.com → 查 a.b.example.com / b.example.com / example.com / com
  // 与 `h === d || h.endsWith('.' + d)` **语义完全等价**（后者要求 d 之前正好是一个点，
  // 即 d 必须是 h 的标签对齐后缀），复杂度从 O(名单条数) 降为 O(域名标签数)≈4。
  // 前置条件：名单条目均为小写、无首尾空格 / 首尾点 / 连续点（bench-perf.js 已体检通过）。
  function _suffixHit(set, hostname) {
    const h = (hostname || '').toLowerCase().replace(WWW_RE, '');
    if (!h) return false;
    if (set.has(h)) return true;
    let idx = h.indexOf('.');
    while (idx !== -1) {
      if (set.has(h.slice(idx + 1))) return true;
      idx = h.indexOf('.', idx + 1);
    }
    return false;
  }

  // 域名判定结果缓存：名单是静态数据，同一域名的判定结果恒定不变。
  // 页面内链接高度同源（同一 host 反复出现），缓存把重复查询摊平为一次 Map 读取。
  // 限容 4096 防极端页面（数千个不同外链域名）无界增长。
  function _memoHost(cache, hostname, calc) {
    const k = hostname || '';
    let r = cache.get(k);
    if (r === undefined) {
      r = calc(k);
      if (cache.size > 4096) cache.clear();
      cache.set(k, r);
    }
    return r;
  }

  // ============ 已知恶意域名硬编码黑名单（银狐木马投递站，命中即强制 danger）============
  const BAD_SET = new Set((IOCS.KNOWN_BAD_DOMAINS || []).map(d => d.toLowerCase()));
  const _badCache = new Map();
  function isKnownBad(hostname) {
    return _memoHost(_badCache, hostname, (h) => _suffixHit(BAD_SET, h));
  }

  // ============ 政府/公立机构可信域名（严格资质管控后缀，仿冒概率极低）============
  // .gov.cn/.gov 政府、.edu.cn/.edu 高校、.ac.cn 科研院所、.mil 军事。
  // 这些后缀注册需经严格资质审核，银狐几乎不可能持有，应一律判安全，
  // 避免国家/公立网站（如 wenshu.court.gov.cn）被误判为银狐。
  const GOV_TLDS = ['gov.cn', 'gov', 'edu.cn', 'edu', 'ac.cn', 'mil'];
  const GOV_SET = new Set(GOV_TLDS);

  function isGovDomain(hostname) {
    return _suffixHit(GOV_SET, hostname);
  }

  // ============ 云端官网库补充（#384：本地未命中时由后台实时拉取，仅内存、不持久化）============
  // 扩展后台在本地 OFFICIAL_DOMAINS 未命中时，按需实时查询云端公开域名清单；命中结果经
  // registerCloudOfficial 注入本集合后，isOfficialDomain 同步判定即可生效（零延迟、不写 storage）。
  // 云端只回一份公开名单（GET 公开数据），绝不接收用户当前访问域名 → 零隐私上报。
  const EXTRA_OFFICIAL_SET = new Set();
  function registerCloudOfficial(arr) {
    if (!arr) return;
    for (const d of arr) {
      if (d && typeof d === 'string') EXTRA_OFFICIAL_SET.add(d.toLowerCase().replace(WWW_RE, ''));
    }
  }

  const _officialCache = new Map();
  function isOfficialDomain(hostname) {
    return _memoHost(_officialCache, hostname, (h) =>
      // 政府/公立机构可信后缀 → 直接判安全；其余走官方白名单后缀查表
      _suffixHit(GOV_SET, h) || _suffixHit(OFFICIAL_SET, h) || _suffixHit(EXTRA_OFFICIAL_SET, h)
    );
  }

  // ============ UGC 平台白名单（合入自 VirusDetector 的 TrustedPlatforms）============
  // Wiki 农场 / 代码托管 Pages / 静态托管 PaaS / 博客平台等，其子域由用户自由创建。
  // 豁免层级只有一条：跳过「域名仿冒」判定；其余全部规则照常运行。
  // 详见 iocs.js 中 TRUSTED_PLATFORMS 的设计说明。
  const TRUSTED_PLATFORM_SET = new Set((IOCS.TRUSTED_PLATFORMS || []).map(d => d.toLowerCase()));
  const _platformCache = new Map();
  function isTrustedPlatform(hostname) {
    return _memoHost(_platformCache, hostname, (h) => _suffixHit(TRUSTED_PLATFORM_SET, h));
  }

  // ============ link classify 结果缓存（性能优化）============
  // 多个 link 检测器（detLinkAnalysis / detCrossDomainDownload / detDirectExec / detCloudDisk /
  // detBrandedExe / hasDownloadLink / detPasswordArchive / detDoubleExt / detLowQuality）会对同一批
  // link 反复调用 IOCS.classifyLink（内部 toLowerCase + split + 40+ 次循环）。单次 analyze 内把结果缓存到
  // link 对象的 _class 字段，N 个 link 从约 6N 次调用降到 N 次，判定完全等价。
  function classifyLinkCached(l) {
    if (l && l._class !== undefined) return l._class;
    const c = IOCS.classifyLink ? IOCS.classifyLink(l && l.href) : 'other';
    if (l) l._class = c;
    return c;
  }

  // ============ 品牌词命中：ASCII 词必须走词边界（根治短词子串误伤）============
  // ⚠️ 2026-08-31 实测暴露的致命缺陷：品牌词原先一律用 indexOf 子串匹配，而
  // BRAND_KEYWORDS 里含大量 2–4 字母短词（ie / tor / qq / jd / word / wps …），
  // 于是任意页面都会「命中品牌词」：
  //   'ie'   命中 v[ie]w / cl[ie]nt / spec[ie]s …
  //   'tor'  命中 edi[tor] / moni[tor] / fac[tor] …
  //   'word' 命中 pass[word] / key[word] …
  // 实测 www.workbuddy.cn 命中 8 个「品牌词」，其中 tor / ie / word 全是子串误伤，
  // 直接推高 brandedExe 与域名仿冒判定。
  //
  // 修复：纯 ASCII 品牌词一律要求词边界（前后不能是字母或数字）；
  //       中文/CJK 品牌词无词边界问题，保持子串匹配。
  const _brandReCache = new Map();
  function _escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function _brandRegex(b) {
    if (_brandReCache.has(b)) return _brandReCache.get(b);
    let re = null;
    // 仅对「纯 ASCII」品牌词启用词边界；含 CJK 的词直接用 indexOf（返回 null 表示走 indexOf）
    if (/^[\x21-\x7E]+$/.test(b)) {
      // 边界定义为「非字母数字」——刻意允许 . - _ / 作为边界，
      // 以便正常命中 wechat-setup.exe、/wps/download、qq_installer 这类真实投递文件名。
      re = new RegExp('(?:^|[^a-z0-9])' + _escapeRe(b.toLowerCase()) + '(?:[^a-z0-9]|$)', 'i');
    }
    _brandReCache.set(b, re);
    return re;
  }
  function brandHit(text, brand) {
    if (!text || !brand || brand.length < 2) return false;
    const re = _brandRegex(brand);
    if (re) return re.test(text);
    return text.indexOf(brand.toLowerCase()) !== -1;
  }

  // ============ 性能：模块级预编译（消除热循环里的重复 toLowerCase / 逐词正则）============
  // 这些关键词列表在 300+ 页面 × 每条链接 的循环里被反复 .toLowerCase()，每次都重新分配字符串。
  // 改为模块加载时预编译一次，热循环只做纯 includes/indexOf。
  const SOCIAL_STRONG_LOWER = (IOCS.SOCIAL_ENGINEERING_STRONG || []).map(k => k.toLowerCase());
  const SOCIAL_WEAK_LOWER = (IOCS.SOCIAL_ENGINEERING_WEAK || []).map(k => k.toLowerCase());
  const FAKE_OFFICIAL_LOWER = (IOCS.FAKE_OFFICIAL || []).map(k => k.toLowerCase());
  const LURE_THEMES_LOWER = (IOCS.LURE_THEMES || []).map(k => k.toLowerCase());
  const FAKE_UPDATE_LOWER = (IOCS.FAKE_UPDATE_TERMS || []).map(k => k.toLowerCase());
  const FAKE_UPDATE_ORIG = (IOCS.FAKE_UPDATE_TERMS || []);

  // 纯 ASCII 品牌词合并为单个「词边界」正则：一次 test 替代「每条链接 × 全量品牌词」的 brandHit 循环，
  // 与逐词 brandHit 判定完全等价（边界规则 `(?:^|[^a-z0-9])…(?:[^a-z0-9]|$)` 一致）。
  const _asciiBrands = (IOCS.BRAND_KEYWORDS || []).filter(b => /^[\x21-\x7E]+$/.test(b) && b.length >= 2);
  const _cjkBrands = (IOCS.BRAND_KEYWORDS || []).filter(b => !/^[\x21-\x7E]+$/.test(b) && b.length >= 2);
  let _brandCombinedRe = null;
  function _getBrandCombinedRe() {
    if (_brandCombinedRe) return _brandCombinedRe;
    if (_asciiBrands.length) {
      const alt = _asciiBrands.map(b => _escapeRe(b.toLowerCase())).join('|');
      _brandCombinedRe = new RegExp('(?:^|[^a-z0-9])(?:' + alt + ')(?:[^a-z0-9]|$)', 'i');
    }
    return _brandCombinedRe;
  }
  // 一次判定 blob（已小写）是否含任意品牌词。返回 Boolean，供维度快速早退。
  function blobHasBrand(blob) {
    const re = _getBrandCombinedRe();
    if (re && re.test(blob)) return true;
    for (const b of _cjkBrands) if (blob.indexOf(b) !== -1) return true;
    return false;
  }
  // 仅在已确认命中时调用（命中极少），回查具体品牌词用于告警文案，成本可忽略。
  function _matchedBrand(blob) {
    const re = _getBrandCombinedRe();
    if (re) for (const b of _asciiBrands) if (brandHit(blob, b)) return b;
    for (const b of _cjkBrands) if (blob.indexOf(b) !== -1) return b;
    return '';
  }

  // ============ 可信文件分发平台判定（GitHub Releases / 官方 CDN / 包管理器）============
  // 用途：这些平台上的 .exe/.zip 直链是开源软件与厂商官方分发的常态，
  // 不应因「页面有 exe 直链」而给风险分。
  const TRUSTED_DL_SET = new Set((IOCS.TRUSTED_DOWNLOAD_HOSTS || []).map(d => d.toLowerCase()));
  const _trustedDlCache = new Map();
  function isTrustedDownloadHost(host) {
    return _memoHost(_trustedDlCache, host, (h) => _suffixHit(TRUSTED_DL_SET, h));
  }
  // 从链接对象取 host（优先用采集时带的 hostname，否则从 href 解析）
  function _linkHost(l, pageHost) {
    if (l && l.hostname) return String(l.hostname).toLowerCase();
    const href = (l && l.href) || '';
    const m = href.match(/^https?:\/\/([^/:?#]+)/i);
    if (m) return m[1].toLowerCase();
    return (pageHost || '').toLowerCase(); // 相对链接 → 同站
  }

  // ============ 前端渲染未完成识别（SPA 骨架页护栏）============
  // ⚠️ 2026-08-31 定位到的**架构级误报根因**：
  // content script 以 run_at=document_start 注入、DOMContentLoaded 即开始分析。
  // 对 React / Vue 等前端渲染站点，此刻 DOM 仍是骨架（<div id="app"></div>），
  // 于是被「代码工程化低 +40」「低质量/AI生成痕迹 +25」判定为手搓模板站。
  // 实测：www.ghxi.com DOM=30 正文=1 字、www.workbuddy.cn DOM=58 正文=1 字 —— 均因此被判 danger。
  //
  // 判据：DOM 少 + 正文近乎空 + 却具备现代前端工程特征（挂载点 / module 脚本 /
  //       带 hash 的 bundle 文件名 / 大量外部资源）→ 页面只是「还没渲染完」，
  //       而非「粗制滥造」，这两个维度必须弃权而不是加分。
  function _isUnrendered(data) {
    if (data._unrenderedCache !== undefined) return data._unrenderedCache;
    const m = data.metrics || {};
    const elem = m.domElementCount || 0;
    const textLen = m.textLength || 0;
    let unrendered = false;
    // 骨架特征：DOM 稀疏且几乎没有可读正文
    if (elem < 150 && textLen < 400) {
      const html = data._lowerHtml || (data.html || '').toLowerCase();
      const hasMountPoint = /<div[^>]+id=["'](?:app|root|__next|__nuxt|main)["']/.test(html);
      const hasModuleScript = /<script[^>]+type=["']module["']/.test(html);
      // webpack / vite / rollup 产物：文件名带内容 hash（如 index-4f3a9c2b.js、app.8f2e1d.css）
      const hasHashedBundle = /[/-][a-z0-9_]*[.-][a-f0-9]{8,}\.(?:js|css|mjs)/.test(html);
      const hasBundlerHint = /(?:webpack|vite|__next_data__|nuxt|_app-|chunk-|runtime~)/.test(html);
      const manyExternalRes = (m.externalResourceCount || 0) >= 8;
      if (hasMountPoint || hasModuleScript || hasHashedBundle || hasBundlerHint || manyExternalRes) {
        unrendered = true;
      }
    }
    data._unrenderedCache = unrendered;
    return unrendered;
  }

  // ============ 内容型站点识别（正文充实、链接繁多的真实运营站）============
  // 用途：老牌论坛 / 资讯站 / 软件目录站会自然存在少量安装包链接，
  // 这属正常业态，不该与「只有一个下载按钮的空壳投递页」同等计分。
  function _isContentRichSite(data) {
    const m = data.metrics || {};
    const links = (data.links || []).length;
    return (m.textLength || 0) >= 2500 && (m.domElementCount || 0) >= 400 && links >= 40;
  }

  // ============ 资源引用总数（工程化程度的正确度量）============
  // ⚠️ 2026-08-31：metrics.externalResourceCount 只统计【跨域】资源，衡量的是
  // 「用了多少第三方 CDN」，与「页面工程化程度」无关。把 CSS/JS/图片全部同域自托管的
  // 站点（蓝奏云、大量政企站、自建站）该值恒为 0，却被判成「页面简陋 / 外部资源极少」。
  // 因此改用 metrics.resourceCount（同域 + 跨域的资源引用总数）判定「资源极少」；
  // 旧版采集数据不含该字段时回退到跨域计数，保持向后兼容。
  function _resCount(m) {
    if (!m) return 0;
    return (typeof m.resourceCount === 'number') ? m.resourceCount : (m.externalResourceCount || 0);
  }

  // ============ 域名仿冒检测 ============
  // ⚠️ 系统性补全（2026-08-31）：SPOOF_KEYWORDS 原本只取 BRAND_KEYWORDS，
  // 但 #341 把上千官方品牌域补进 OFFICIAL_DOMAINS 却没同步品牌词到 BRAND_KEYWORDS，
  // 导致这些品牌被仿冒时（如 go0gle.top / amaz0n-account.top / icloud-apple.top）漏报。
  // 修复：把每个官方域「紧邻 TLD 的主标签」自动并入仿冒词库（长度≥4 且非通用子域词），
  // 使「官方域 ↔ 仿冒词」始终同源——新增官方域即自动获得仿冒防护，不再依赖手工补词。
  const _SPOOF_STOP = new Set([
    'pages', 'www', 'dev', 'app', 'web', 'mail', 'api', 'cdn', 'img', 'blog', 'shop', 'static',
    'mobile', 'ns', 'smtp', 'pop', 'ftp', 'admin', 'test', 'stage', 'm', 's', 's3', 'vpn', 'w'
  ]);
  const _officialBrandTokens = [];
  for (const d of (IOCS.OFFICIAL_DOMAINS || [])) {
    const _labels = String(d).toLowerCase().split('.');
    if (_labels.length < 2) continue;
    const _brand = _labels[_labels.length - 2]; // 紧邻 TLD 的标签：google.com→google、mail.google.com→google
    if (_brand && _brand.length >= 4 && !_SPOOF_STOP.has(_brand)) _officialBrandTokens.push(_brand);
  }
  const SPOOF_KEYWORDS = [...new Set(
    (IOCS.BRAND_KEYWORDS || []).map(k => k.toLowerCase()).concat(_officialBrandTokens)
  )].sort((a, b) => b.length - a.length);
  // 编辑距离 typo 检测只处理「手工精选」品牌词（长度 ≥5），【不含】从官方域自动派生的词：
  // 派生词含 gmail/outlook 等常见词，会对 mail/login 等常见标签产生编辑距离 1 的误判
  // （mail ↔ gmail），造成海量误报。派生词的仿冒防护由「段匹配 + 子串（含形近归一化）」覆盖，
  // 已足够拦截 go0gle/amaz0n 等形近仿冒。
  const SPOOF_KEYWORDS_LONG = (IOCS.BRAND_KEYWORDS || [])
    .map(k => k.toLowerCase()).filter(k => k.length >= 5);

  // 编辑距离：一维滚动数组实现（原实现每次调用都分配 (m+1)×(n+1) 的二维数组，
  // 在「品牌词 × 域名标签」的双层循环里造成大量短命对象分配）。返回值完全等价。
  const _levRow = [];
  function _levenshtein(a, b) {
    const la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    const row = _levRow;
    for (let j = 0; j <= la; j++) row[j] = j;
    for (let i = 1; i <= lb; i++) {
      let prevDiag = row[0];
      row[0] = i;
      const bi = b.charCodeAt(i - 1);
      for (let j = 1; j <= la; j++) {
        const tmp = row[j];
        const cost = (a.charCodeAt(j - 1) === bi) ? 0 : 1;
        let v = prevDiag + cost;
        const del = row[j] + 1, ins = row[j - 1] + 1;
        if (del < v) v = del;
        if (ins < v) v = ins;
        row[j] = v;
        prevDiag = tmp;
      }
    }
    return row[la];
  }

  // 最长公共前缀 / 后缀长度：用于编辑距离 typo 的护栏，
  // 仅当首尾共有足够字符时才认作「同一词 typo」，避免无语义两词被误判（参原作 S5）。
  function _lcp(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }
  function _lcs(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; }

  // ============ 形近字符混淆检测（homoglyph，原作 S3 算法，此前缺失）============
  // 银狐常用形近字符替换绕过品牌词检测：0↔o、1↔l、rn↔m、vv↔w 等。
  // 只在仿冒匹配阶段对 ASCII 段做规范化；官方豁免仍用原始 normalized，
  // 防止 go0gle 类被误判为官方域名。
  const HOMOGLYPH_MAP = [
    [/0/g, 'o'], [/1/g, 'l'], [/rn/g, 'm'], [/vv/g, 'w']
  ];
  function normalizeHomoglyph(s) {
    let out = s.toLowerCase();
    for (const [re, to] of HOMOGLYPH_MAP) out = out.replace(re, to);
    return out;
  }

  function detectSpoof(hostname) {
    const normalized = (hostname || '').toLowerCase().replace(WWW_RE, '');
    // 官方域名豁免：含品牌词但确属官方（如 www.moonshot.cn / qq.com / kimi.moonshot.cn / aliyun.com）
    // 不算仿冒。否则 detectSpoof 仅做品牌词段匹配会把这些真官网误判为仿冒。
    // 官方豁免使用原始 normalized（不施加形近规范化），防止 go0gle 类被误判为官方域名。
    if (_suffixHit(OFFICIAL_SET, normalized)) return null;
    // UGC 平台跳过：Wiki 农场 / Pages / 静态托管 / 博客的子域由用户自由创建，
    // 子域名里带品牌词是常态（如 wechat-tips.github.io、wps-guide.vercel.app），
    // 判「域名仿冒」会造成海量合法页面误报。
    // ⚠️ 只跳过本条规则——页面内容仍照常参与混淆脚本 / 沙箱探测 / 木马安装包等全部检测。
    if (isTrustedPlatform(normalized)) return null;
    // 形近字符规范化后再做品牌词匹配（捕获 0→o / rn→m / 1→l 等 homoglyph 仿冒）
    const h = normalizeHomoglyph(normalized);
    const labels = h.split('.');
    const labelSegs = labels.map(l => l.split(/[-_]/));

    // ---- 性能重构（#343）：把「品牌词 × 域名段」的嵌套遍历换成查表 ----
    // 原实现对 325 个品牌词各自遍历一遍全部域名段（A 类）与全部段计数（C 类），
    // 是 O(品牌词数 × 段数) 的矩阵扫描。域名段是极小集合（通常 2–5 个），
    // 反过来把段建成 Set / 计数 Map，A、C 两类即降为 O(1) 查表，判定结果完全等价。
    const segCount = new Map();
    for (const segs of labelSegs) {
      for (const seg of segs) segCount.set(seg, (segCount.get(seg) || 0) + 1);
    }
    // B 类（子串包含）的快速否定：品牌词不含换行，故用 \n 拼接各标签后整体 includes
    // 与「逐个标签 includes」等价，且能一次否掉绝大多数品牌词，避免进入内层循环。
    const labelsJoined = labels.join('\n');

    for (const kw of SPOOF_KEYWORDS) {
      // A. 精确段匹配（查表；命中时 seg === kw）
      const cnt = segCount.get(kw) || 0;
      if (cnt > 0) return { brand: kw, matchType: 'seg', detail: `域名段「${kw}」精确匹配品牌词「${kw}」` };
      // B. 子串包含（kw≥4）
      if (kw.length >= 4 && labelsJoined.includes(kw)) {
        for (const label of labels)
          if (label.includes(kw)) return { brand: kw, matchType: 'substr', detail: `域名标签「${label}」包含品牌词「${kw}」` };
      }
      // C. 关键词堆叠（cnt 已由查表得出；cnt>0 已在 A 处返回，此处仅保留原判定语义）
      if (cnt >= 3) return { brand: kw, matchType: 'stack', detail: `品牌词「${kw}」在域名中重复出现 ${cnt} 次` };
    }

    // D. 约束编辑距离（kw≥5, dist 1-2, 长度差≤2）+ LCP/LCS 护栏
    // 仅当首尾共有 ≥4 字符时才认 typo（参原作 S5），避免 wuyou↔kugou 这类无语义两词误判；
    // 双编辑距离(dist=2)且长度差>1 时收紧排除（太弱）。
    // 性能重构（#343）：LCP/LCS 护栏（O(n) 逐字符比较）前移到编辑距离（O(n×m) 动态规划）之前。
    // 二者都只是过滤条件、无副作用，换序后结果集完全等价，却能砍掉绝大多数编辑距离计算。
    for (const kw of SPOOF_KEYWORDS_LONG) {
      for (const label of labels) {
        const diff = Math.abs(label.length - kw.length);
        if (diff > 2) continue;
        if (Math.max(_lcp(label, kw), _lcs(label, kw)) < 4) continue;
        const d = _levenshtein(label, kw);
        if (d < 1 || d > 2) continue;
        if (d === 2 && diff > 1) continue;
        return { brand: kw, matchType: 'typo', detail: `域名「${label}」与品牌词「${kw}」编辑距离 ${d}（疑似 typo 仿冒）` };
      }
    }

    // 去连字符二次检测（覆盖 kn-wps、pay-pal-login 等）
    if (h.indexOf('-') !== -1 || h.indexOf('_') !== -1) {
      const dh = h.replace(/[-_]/g, '');
      const dhLabels = dh.split('.');
      const dhJoined = dhLabels.join('\n');
      for (const kw of SPOOF_KEYWORDS) {
        if (!dhJoined.includes(kw)) continue;   // 快速否定，语义等价
        for (const label of dhLabels)
          if (label.includes(kw)) return { brand: kw, matchType: 'dehyphen', detail: `去连字符后「${label}」含品牌词「${kw}」` };
      }
    }
    return null;
  }

  // detectSpoof 只依赖 hostname（纯函数），但单次 analyze 内的 data 级缓存会在
  // 每次 analyze 入口被清空（异步补强后需按新 icpAuth 重判），导致同一域名反复重算。
  // 这里加一层 host 级缓存：结果恒定，重判时直接命中，省掉整轮品牌词矩阵与编辑距离。
  const _spoofHostCache = new Map();
  function detectSpoofCached(hostname) {
    const k = hostname || '';
    if (_spoofHostCache.has(k)) return _spoofHostCache.get(k);
    const r = detectSpoof(k);
    if (_spoofHostCache.size > 512) _spoofHostCache.clear();
    _spoofHostCache.set(k, r);
    return r;
  }

  // ============ 权威 ICP 备案核验结果（由后台 sf-icp-verify 查询后注入 data.icpAuth）============
  // 三态：{queried:true,hasIcp:true} 确有备案 / {queried:true,hasIcp:false} 确认无备案 /
  //       {queried:false} 查询失败 → 一律回退页面文本扫描，绝不凭失败结果加分。
  function _hasVerifiedIcp(data) {
    const a = data && data.icpAuth;
    return !!(a && a.queried && a.hasIcp);
  }

  // 性能优化：detectSpoof 含编辑距离计算，单次 analyze 内会被多次调用，
  // 在同一 data 对象上缓存结果，避免重复计算
  function getSpoof(data) {
    if (data._spoofCache === undefined) {
      // ★ 官方 ICP 确认联动跳过：权威备案库确认本域名确有备案主体时，跳过域名仿冒判定。
      //   依据：ICP 备案需企业/个人实名提交资料并经审核（周期数周且留实名记录），
      //   银狐一次性投递域名基本不会去备案；「确有备案」因此是很强的可信信号。
      //   ⚠️ 仅跳过仿冒这一条规则，其余检测照常——备案站也可能被入侵或由空壳主体持有；
      //      且硬编码恶意域名黑名单在 analyze 最前面拦截，永不受本跳过影响。
      if (_hasVerifiedIcp(data)) data._spoofCache = null;
      else data._spoofCache = detectSpoofCached(data.hostname);
    }
    return data._spoofCache;
  }

  // ============ ICP 备案提取 ============
  function extractIcp(html) {
    const h = html || '';
    const hasIcpNumber = /(?:[京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新]ICP[\d]+号?|ICP备[\d]{6,12}号?)/i.test(h)
      || /ICP\/IP地址\/域名信息备案管理系统/.test(h)
      || /beian\.miit\.gov\.cn/i.test(h);
    const hasGovIcp = /www\.beian\.gov\.cn|公网安备|公安局备案|联网备案/i.test(h);
    let icpNumber = null;
    const m = h.match(/(?:[京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新]ICP[\d]+号?|ICP备[\d]{6,12}号?)/i);
    if (m) icpNumber = m[0];
    return { hasIcpNumber, hasGovIcp, icpNumber };
  }

  // ============ 单个检测器（返回 {hit, weight, label, detail}）============
  function mk(hit, weight, label, detail) { return { hit: !!hit, weight: hit ? weight : 0, label, detail: hit ? detail : '' }; }

  function detSpoof(data) {
    // ---- 网盘平台自指排除（与 detCloudDisk 同源问题）----
    // 蓝奏云等网盘自身的域名（lanzouw.com / lanzoux.com / lanzoui.com …）
    // 必然包含网盘品牌词（lanzou），会被「域名标签含品牌词」判定为仿冒，
    // 产生「访问蓝奏云 = 仿冒蓝奏云」的自指误判（实测 wwtr.lanzouw.com 因此 +60 分）。
    // 这里仅跳过「域名仿冒」这一个维度，其余检测（混淆脚本 / 沙箱探测 / 社工话术 /
    // 木马化文件名 / 双扩展名 / 网盘分发…）全部照常运行，
    // 因此托管在蓝奏云上的恶意文件依然可被检出。
    const h = (data.hostname || '').toLowerCase().replace(/^www\./, '');
    const isSelfCloud = h && (IOCS.CLOUD_DISK_HOSTS || []).some((c) => h.indexOf(c) !== -1);
    if (isSelfCloud) return mk(false, 0, '域名仿冒官方品牌', '');

    const s = getSpoof(data);
    return s ? mk(true, 60, '域名仿冒官方品牌', s.detail) : mk(false, 0, '域名仿冒官方品牌', '');
  }

  function detIcpMissing(data) {
    const icp = data.icp || {};
    // ★ 权威核验优先：确认本域名确有备案 → 直接判合规，即使页面上一个字都没写。
    //   这是根治「大量合法国内站点（政府/企业/工具站）不在页面展示备案号，
    //   却被『缺备案号』误扣 35 分」的手段——页面文本扫描从此只作兜底。
    if (_hasVerifiedIcp(data)) return mk(false, 0, '缺备案号(ICP)', '');
    const isCn = (data.hostname || '').toLowerCase().endsWith('.cn');
    // 品牌仿冒（如 m1-update-secure.com 这类仿小米但非 .cn 的站）仍需 ICP 维度兜底
    const spoof = getSpoof(data);
    // 中国语境判定收紧为「.cn 域名」或「品牌仿冒」——ICP 备案是 .cn 的法定要求，
    // 不再对「仅含中文内容的 .com 官网」误扣（如 mi.com / samsung.com 中文页），根治整类官方站误判。
    const chineseContext = isCn || !!spoof;
    if (!chineseContext) return mk(false, 0, '缺备案号(ICP)', '');
    if (icp.hasIcpNumber) return mk(false, 0, '缺备案号(ICP)', '');
    // 公网安备 / 公安局备案 / 联网备案 同样属于合规备案资质（高考志愿填报等正规 .cn 站常挂公安备案
    // 而非工信部 ICP 号），命中即视为合规，不再误扣「缺备案号」。
    if (icp.hasGovIcp) return mk(false, 0, '缺备案号(ICP)', '');
    // 页脚挂了工信部 / 全国互联网安全管理服务平台的官方备案查询入口 → 视为已声明备案资质，不扣分。
    // 绕过风险由 detIcpStolen 兜住：若权威备案库显示本域名无任何记录，该维度反而重罚 55 分。
    if (icp.hasBeianLink) return mk(false, 0, '缺备案号(ICP)', '');
    // ⚠️ 2026-08-31 权重 35→18。原因：35 分接近 warn 线（42）的八成，
    // 只要再叠加任意一条轻微信号即误报。而「页面上没写备案号」的成因极多——
    // 备案信息由 JS 异步渲染在页脚（实测 www.52pojie.cn 即属此类）、放在「关于」子页、
    // 或以图片形式展示，都会导致文本扫描取不到。它只是「缺少一项可信加成」，
    // 而非「存在恶意证据」，因此下调为真正的弱信号量级。
    return mk(true, 18, '缺备案号(ICP)', '该站点疑似面向国内用户，但页面未找到 ICP 备案号（仿冒站典型特征）');
  }

  // ============ 盗用他人 ICP 备案号（强特征，重罚）============
  // 钓鱼站惯用手法：在页脚抄一个真实存在的备案号伪装「已合规」，骗过只做页面文本扫描的检测。
  // 判定必须三条同时成立，避免任何误伤：
  //   ① 权威备案接口查询成功（queried）——查询失败一律不判，绝不冤枉；
  //   ② 权威结果为「本域名无备案记录」（!hasIcp）；
  //   ③ 页面上却确实展示了备案号（icp.hasIcpNumber）。
  // 三者同时成立时，页面上的备案号必定不属于本域名 → 盗用，属高置信恶意信号，列入 STRONG 组。
  function detIcpStolen(data) {
    const auth = data.icpAuth || {};
    const icp = data.icp || {};
    if (!auth.queried) return mk(false, 0, '盗用他人备案号', '');   // 查询失败 → 不判
    if (auth.hasIcp) return mk(false, 0, '盗用他人备案号', '');     // 确有备案 → 不判
    // 页面既没写备案号、也没挂官方备案查询入口 → 不属「盗用」，归「缺备案号」管
    if (!icp.hasIcpNumber && !icp.hasBeianLink) return mk(false, 0, '盗用他人备案号', '');
    const shown = icp.icpNumber || '（页脚挂官方备案查询入口，声明已备案）';
    return mk(true, 55, '盗用他人备案号',
      `页面展示备案号「${shown}」，但权威备案库查询显示本域名并无任何备案记录 —— 该备案号不属于本站，属盗用他人备案伪装合规（钓鱼站典型手法）`);
  }

  function detLowQuality(data) {
    const m = data.metrics || {};
    // 没有真实页面指标时不作判定（避免后台/测试只传 hostname 时误伤）
    if (!data.metrics || (!m.textLength && !m.domElementCount)) return mk(false, 0, '低质量/AI生成痕迹', '');
    // 风险语境门槛：仅在「存在下载入口 / 跳转注入 / 域名仿冒」时计入，
    // 避免普通简陋但合法的小站（个人博客等）被「无框架+emoji+无备案」堆叠误判为银狐。
    if (!hasDownloadLink(data) && !_hasRedirectOrIframe(data) && !getSpoof(data)) return mk(false, 0, '低质量/AI生成痕迹', '');
    // ★ SPA 骨架护栏：页面只是尚未渲染完，不能据此判「粗制滥造」（详见 _isUnrendered 说明）
    if (_isUnrendered(data)) return mk(false, 0, '低质量/AI生成痕迹', '');
    let w = 0; const bits = [];
    const elem = m.domElementCount || 0;
    const ext = _resCount(m);   // 资源引用总数（含同域），非「第三方 CDN 数」
    const framework = m.framework;
    // ⚠️ 2026-08-31 收紧：ext < 12 门槛过高——把静态资源全部自托管（不用公共 CDN）
    // 的正规站一律算成「无外部资源」。改为「资源引用总数 < 4」，并要求 DOM 确实稀疏。
    if (elem < 150 && ext < 4) { w += 18; bits.push('页面元素极少(' + elem + ')且几乎无任何资源引用'); }
    // ⚠️ 收紧：原 elem<300 且无框架即 +12。原生 JS / 服务端渲染（SSR）站点大量存在，
    // 「不用前端框架」本身完全不是恶意信号。改为仅在 DOM 也极稀疏时作为辅助信号。
    if (!framework && elem < 120) { w += 8; bits.push('结构简单且未使用主流前端框架'); }
    if (m.emojiDensity > 6 && (m.textLength || 0) < 900) { w += 15; bits.push('emoji 密度异常(' + m.emojiDensity + '‰)且正文短'); }
    if ((m.textLength || 0) < 220 && (data.links || []).some(l => classifyLinkCached(l) !== 'other')) { w += 15; bits.push('极简页面却包含下载/跳转链接'); }
    if (ext < 3 && (data.links || []).some(l => { const c = classifyLinkCached(l); return c === 'exec' || c === 'download'; })) { w += 20; bits.push('页面几乎无任何资源引用却直推可执行下载'); }
    if (w > 18) w = 18; // 弱信号封顶 25→18：页面简陋 ≠ 木马，不应逼近 warn 线
    return w > 0 ? mk(true, w, '低质量/AI生成痕迹', bits.join('；')) : mk(false, 0, '低质量/AI生成痕迹', '');
  }

  function detCodeEngineering(data) {
    const m = data.metrics || {};
    if (!data.metrics || (!m.textLength && !m.domElementCount)) return mk(false, 0, '代码工程化低', '');
    // 风险语境门槛：仅在「存在下载入口 / 跳转注入 / 域名仿冒」时计入，
    // 简陋合法站（无下载/跳转/仿冒）不因此拿分。银狐投递站必有下载/跳转/仿冒，不受影响。
    if (!hasDownloadLink(data) && !_hasRedirectOrIframe(data) && !getSpoof(data)) return mk(false, 0, '代码工程化低', '');
    // ★ SPA 骨架护栏：DOMContentLoaded 时前端尚未渲染，此刻的 DOM 数量不代表工程质量。
    //   实测 ghxi.com（DOM=30）/ workbuddy.cn（DOM=58）即被此维度误判 +40 分。
    if (_isUnrendered(data)) return mk(false, 0, '代码工程化低', '');
    const scripts = data.scripts || [];
    const html = data.html || '';
    let w = 0; const bits = [];
    const elem = m.domElementCount || 0;
    const ext = _resCount(m);   // 资源引用总数（含同域），非「第三方 CDN 数」
    const scriptCnt = m.scriptCount || 0;
    const inlineCnt = m.inlineScriptCount || 0;
    const externalCnt = m.externalScriptCount || 0;
    const iframeCnt = m.iframeCount || 0;

    // 1) DOM 复杂度低 + 无主流框架 = 手搓/AI 生成站特征（视频 60 分代码工程化维度）
    //    ⚠️ 收紧 elem<200 → <120：200 个元素已是一个正常的中小型页面，门槛过宽。
    if (elem < 120 && !m.framework) { w += 18; bits.push(`DOM 极简(${elem})且无主流框架`); }
    if (elem < 100 && scriptCnt < 5) { w += 14; bits.push('页面结构极简且几乎无脚本'); }

    // 2) 外部资源过少或过度单一：银狐模板常只引用 1~2 个外部脚本/统计
    //    ⚠️ 2026-08-31 收紧：原条件 (ext<=2 && scriptCnt>0) 命中面极广——把全部静态资源
    //    自托管在本域名下（不引用任何第三方 CDN）的正规站一律算「外部资源极少」。
    //    实测 lanzou.com（ext=0，资源全自托管）因此白扣 12 分。
    //    改为必须【同时】DOM 也稀疏，才视为「银狐单页模板」特征。
    if (ext <= 2 && scriptCnt > 0 && elem < 200) { w += 12; bits.push(`资源引用极少(${ext}个)且页面结构简单`); }

    // 3) 脚本工程化：外部脚本 vs 内联脚本比例异常（银狐常内联混淆/打包）
    if (inlineCnt > 0 && externalCnt === 0 && scriptCnt >= 2) { w += 10; bits.push('全为内联脚本（无外部脚本分离）'); }

    // 4) 符号密度异常：单个大脚本内变量名/字符串极度稠密
    // ⚠️ 2026-08-31 收紧：原阈值 maxScriptLen>2000 且 avgDensity>1200 命中面过广——
    // 现代站点内联一段 2KB 的初始化/配置/埋点脚本极为普通（实测 ghxi、workbuddy、
    // lanzou 三站全部命中本条白扣 10 分）。真正值得警惕的是「整站逻辑塞进一个巨大内联块
    // 且没有任何外部脚本分离」，故把体积阈值抬到 20KB 并要求无外部脚本。
    let totalScriptLen = 0, maxScriptLen = 0;
    for (const s of scripts) { totalScriptLen += s.length; maxScriptLen = Math.max(maxScriptLen, s.length); }
    if (scripts.length > 0 && maxScriptLen > 20000 && externalCnt === 0 && scripts.length <= 3) {
      w += 10; bits.push('全部逻辑塞入单个超大内联脚本且无外部脚本分离（打包/混淆迹象）');
    }

    // 5) 与现有混淆/VM检测组合：若已命中混淆则加工程化分，避免重复满分
    if (data._obfuscationHit) { w += 12; bits.push('JS 已命中混淆特征'); }
    if (data._vmHit) { w += 10; bits.push('脚本已命中沙箱探测特征'); }

    // 6) 存在跨域 iframe 框架但 DOM 极简单
    if (iframeCnt > 0 && elem < 300) { w += 8; bits.push(`含 ${iframeCnt} 个 iframe 但 DOM 简单`); }

    // 封顶 40→28：代码工程化低属中风险（页面简陋 ≠ 木马）。
    // 40 分几乎等于「一条维度就把页面推到 warn(42) 门口」，与「中风险」定位不符。
    if (w > 28) w = 28;
    return w > 0 ? mk(true, w, '代码工程化低', bits.join('；')) : mk(false, 0, '代码工程化低', '');
  }

  function detLinkAnalysis(data) {
    const links = data.links || [];
    const pageHost = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    let externalCount = 0, crossDomainCount = 0, downloadCount = 0;
    const domains = new Set();
    const hrefCounts = {};
    const execOrArchive = [];

    for (const l of links) {
      const href = l.href || '';
      if (!href || SKIP_HREF_RE.test(href)) continue;
      let host = '';
      try { host = _linkHost(l, pageHost); } catch (e) { continue; }
      hrefCounts[href] = (hrefCounts[href] || 0) + 1;
      if (host && host !== pageHost) {
        externalCount++;
        domains.add(host);
      }
      const c = classifyLinkCached(l);
      if (c === 'exec' || c === 'archive' || c === 'download' || c === 'cloud') {
        downloadCount++;
        // 可信分发平台（GitHub Releases / 官方 CDN / 包管理器）不算「跨域分发」，
        // 除非载荷文件名本身可疑 —— 与 detCrossDomainDownload 保持同一判定口径。
        if (host && host !== pageHost && !(isTrustedDownloadHost(host) && !_isPayloadishName(href))) crossDomainCount++;
      }
    }

    // 重复链接（模板站常见同一链接重复多次）
    let duplicateCount = 0;
    for (const k of Object.keys(hrefCounts)) if (hrefCounts[k] > 1) duplicateCount += hrefCounts[k] - 1;

    let w = 0; const bits = [];
    if (externalCount >= 5 && downloadCount >= 2) { w += 16; bits.push(`外链 ${externalCount} 个且含 ${downloadCount} 处下载/可执行入口`); }
    if (crossDomainCount >= 1) { w += 10; bits.push(`下载/可执行链接跨域 ${crossDomainCount} 个`); }
    if (duplicateCount >= 5) { w += 8; bits.push(`重复链接 ${duplicateCount} 处（模板站常见）`); }
    if (domains.size >= 6) { w += 8; bits.push(`外链指向 ${domains.size} 个不同域名（过度分散）`); }
    if (downloadCount >= 3 && externalCount === 0) { w += 8; bits.push(`站内下载入口密集(${downloadCount})且无外链`); }
    if (w > 50) w = 50;
    return w > 0 ? mk(true, w, '链接分析异常', bits.join('；')) : mk(false, 0, '链接分析异常', '');
  }

  function detCrossDomainDownload(data) {
    const links = data.links || [];
    const pageHost = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    let cross = 0;
    for (const l of links) {
      const href = l.href || '';
      if (!href || SKIP_HREF_RE.test(href)) continue;
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive' && c !== 'download') continue;
      let host = '';
      try { host = _linkHost(l, pageHost); } catch (e) { continue; }
      if (!host || host === pageHost) continue;
      // ⚠️ 2026-08-31：把安装包托管到 GitHub Releases / 官方 CDN / 包管理器再从官网外链过去，
      // 是开源项目与中小软件官网的普遍做法（自建站省带宽），并非「规避检测的跨域分发」。
      // 载荷文件名本身可疑时（伪装系统进程 / 双扩展名等）不予豁免。
      if (isTrustedDownloadHost(host) && !_isPayloadishName(href)) continue;
      cross++;
    }
    if (cross > 0) return mk(true, Math.min(cross * 10, 20), '下载链接跨域', `发现 ${cross} 个下载/可执行链接指向第三方域名`);
    return mk(false, 0, '下载链接跨域', '');
  }

  // ============ 指向已拦截的投递域名（#16 下载黑名单跨站复用）============
  // data.dlBlacklist 由内容脚本从后台取回（纯本地记录：过去真正被拦下来的那些载荷域名）。
  // 银狐落地页天天换、载荷 CDN 却长期复用，所以「新站 + 老载荷域名」是高价值信号。
  // 权重 45 归入 MEDIUM：单独命中不强制判危（避免早期一次误拦污染名单后无限传染），
  // 但与任意其它中/弱信号叠加即升级 danger。受保护域名在后台入库时已被拦下，不会进名单。
  function detBlacklistedPayload(data) {
    const list = data.dlBlacklist;
    if (!list || !list.length) return mk(false, 0, '指向已拦截的投递域名', '');
    const set = new Set(list.map(function (d) { return String(d).toLowerCase(); }));
    const pageHost = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    const hit = new Set();
    for (const l of (data.links || [])) {
      const href = (l && l.href) || '';
      if (!href || SKIP_HREF_RE.test(href)) continue;
      let host = '';
      try { host = _linkHost(l, pageHost); } catch (e) { continue; }
      if (!host) continue;
      if (set.has(host)) { hit.add(host); continue; }
      // 子域名匹配：载荷桶常换子域（a1.cdn-x.top / a2.cdn-x.top），按注册域名命中
      const parts = host.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const cand = parts.slice(i).join('.');
        if (set.has(cand)) { hit.add(cand); break; }
      }
    }
    if (!hit.size) return mk(false, 0, '指向已拦截的投递域名', '');
    const names = Array.from(hit).slice(0, 3).join('、');
    return mk(true, 45, '指向已拦截的投递域名',
      `本页下载链接指向 ${names}${hit.size > 3 ? ' 等' : ''} —— 该域名此前已因投递可疑文件被本扩展拦截过，属跨站复用的载荷分发域名`);
  }

  function detDomainAge(data) {
    if (typeof data.domainAgeDays !== 'number') return mk(false, 0, '域名年龄', '');
    const days = data.domainAgeDays;
    if (days < 30) return mk(true, 60, '新注册域名', `域名注册时间不足 30 天（${days} 天），新注册域名是银狐/钓鱼站高频特征`);
    if (days > 180) return mk(true, -20, '老域名减分', `域名已注册 ${days} 天，风险下调`);
    return mk(false, 0, '域名年龄', '');
  }

  // ⚠️ 2026-08-31 重构（实测第一误报源：5/5 良性样本全部命中本维度）
  // 旧实现的三个致命问题：
  //   ① hasKw 用 DOWNLOAD_KEYWORDS 扫【整页 HTML】，词表含「下载 / download / 安装 / 客户端」，
  //      而中文站页脚、导航、App 推广位几乎必然出现「下载」二字 → hasKw 恒为真，
  //      于是「页面存在 1 个 .exe 链接」即无条件 +22 分。
  //   ② 完全不看 .exe 链接【指向哪里】：GitHub Releases、微软官方 CDN、包管理器
  //      这类可信分发平台的安装包直链与投递站的自建落地包同等计分。
  //   ③ 完全不看【页面体量】：老牌论坛/软件目录站正文数万字、链接数百条，
  //      其中夹带几个安装包属正常业态，与「只有一个下载按钮的空壳页」判定强度相同。
  // 修复：可信分发平台链接不计分；话术要求「就近」而非全页；内容型大站少量安装包豁免；
  //      权重 22→12（单独不再足以把页面推过 warn 线，须与其他信号叠加）。
  // ============ 投递型文件名识别（放宽豁免时的兜底防线）============
  // 上述三条豁免（可信平台 / 就近话术 / 内容型大站）都可能被投递站针对性利用：
  // 灌一堆正文与内链把自己刷成「内容型大站」，或把下载按钮文案写成「继续」躲开话术判定。
  // 但载荷文件名本身是躲不掉的——它必须让受害者双击运行。以下四类文件名一旦出现，
  // 任何豁免都不再生效：
  //   ① 伪装 Windows 系统进程（svchost.exe / rundll32.exe …）——正规站绝不会提供
  //   ② 双扩展名伪装（发票.pdf.exe）
  //   ③ 纯随机串命名（8–40 位十六进制/数字，无任何语义）——自动化生成载荷特征
  //   ④ 中文诱饵命名（工资表.exe / 通知.exe / 附件.exe / 对账单.exe …）
  const _SYS_PROC_RE = /(?:^|[^a-z0-9])(?:svchost|rundll32|lsass|csrss|winlogon|dllhost|taskhost(?:w)?|conhost|spoolsv|services|smss|wininit|explorer|regsvr32|mshta|wscript|cscript)\.(?:exe|com|scr|pif)$/i;
  const _DOUBLE_EXT_RE = /\.(?:pdf|docx?|xlsx?|pptx?|txt|jpe?g|png|gif|zip|rar|7z|mp4|apk)\.(?:exe|scr|com|pif|bat|cmd|vbs|js|hta|lnk)$/i;
  const _RANDOM_NAME_RE = /(?:^|\/)(?:[0-9a-f]{8,40}|\d{8,20})\.(?:exe|msi|scr|com|pif|bat|cmd|vbs|hta|lnk)$/i;
  const _CN_LURE_NAME_RE = /(?:工资|薪资|奖金|补贴|通知|通告|文件|附件|对账|账单|发票|合同|报表|简历|名单|投诉|举报|判决|传票|催收|资料|照片|视频|安装包|驱动|补丁|激活|破解)[^/]{0,12}\.(?:exe|msi|scr|com|pif|bat|cmd|vbs|hta|lnk)$/i;

  function _payloadFileName(href) {
    const s = String(href || '').split('#')[0].split('?')[0];
    return (s.split('/').pop() || '').toLowerCase();
  }
  function _isPayloadishName(href) {
    const name = _payloadFileName(href);
    if (!name) return false;
    if (_SYS_PROC_RE.test(name)) return true;
    if (_DOUBLE_EXT_RE.test(name)) return true;
    if (_RANDOM_NAME_RE.test('/' + name)) return true;
    if (_CN_LURE_NAME_RE.test(decodeURIComponentSafe(name))) return true;
    const bad = IOCS.KNOWN_BAD_FILENAMES || [];
    if (bad.some(b => name === String(b).toLowerCase())) return true;
    const pats = IOCS.SUSPICIOUS_DOWNLOAD_NAME_PATTERNS || [];
    if (pats.some(re => { try { return re.test(name); } catch (e) { return false; } })) return true;
    return false;
  }
  function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  // ============ 空壳投递页识别 ============
  // 「整个页面除了一个下载链接几乎什么都没有」本身就是投递页的核心形态。
  // 与 _isUnrendered 的区别：未渲染 SPA 会带有 mount point / 打包产物脚本 / 大量资源引用，
  // 而空壳投递页是真的没有内容。故此处显式排除未渲染情形，避免与 SPA 护栏冲突。
  function _isShellPage(data) {
    if (_isUnrendered(data)) return false;
    const m = data.metrics || {};
    if (!data.metrics) return false;
    const elem = m.domElementCount || 0;
    const textLen = m.textLength || 0;
    const links = (data.links || []).length;
    return elem > 0 && elem < 150 && textLen < 400 && links < 8;
  }

  function detDirectExec(data) {
    const links = data.links || [];
    const pageHost = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    let execCount = 0, archCount = 0, trustedSkipped = 0;
    let execNearKw = 0;   // 链接自身文本/文件名带下载话术的可执行链接数
    let payloadish = [];  // 命中投递型文件名的载荷（不吃任何豁免）
    const DL_KW = IOCS.DOWNLOAD_KEYWORDS || [];
    for (const l of links) {
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive') continue;
      const isBadName = _isPayloadishName(l && l.href);
      // ① 可信分发平台豁免：GitHub Releases / 官方 CDN / PyPI 等
      //    ——但文件名本身就是投递特征时不豁免（可信平台同样会被滥用托管载荷）
      const lh = _linkHost(l, pageHost);
      if (isTrustedDownloadHost(lh) && !isBadName) { trustedSkipped++; continue; }
      if (isBadName) payloadish.push(_payloadFileName(l && l.href));
      if (c === 'exec') {
        execCount++;
        const near = ((l.href || '') + ' ' + (l.text || '')).toLowerCase();
        if (DL_KW.some(k => near.includes(k.toLowerCase()))) execNearKw++;
      } else {
        archCount++;
      }
    }

    // ★ 兜底防线：出现投递型文件名 → 跳过后续所有豁免逻辑，按正常权重计分。
    //   文件名本身的恶意判定归 payloadNamePattern 维度（STRONG 组）负责重罚，
    //   此处不重复计分，只是不让豁免把这条链接洗白。
    if (payloadish.length) {
      return mk(true, 12, '直链可执行文件',
        `发现 ${payloadish.length} 个具备投递特征的可执行文件直链（已跳过全部豁免）`);
    }

    // ③ 内容型大站（正文充实 + 链接繁多）夹带少量安装包 → 正常业态，不计分。
    //    投递站不具备这种体量：它们正文短、链接少、目标单一。
    if (_isContentRichSite(data) && execCount <= 3 && archCount <= 5) {
      return mk(false, 0, '直链可执行文件', '');
    }

    if (execCount > 0) {
      // ② 话术判定改为「就近」：链接文本/文件名本身带下载话术才算强化信号。
      //    仅凭页面别处出现「下载」二字不再作为升格依据。
      const strong = execNearKw > 0 || execCount > 2;
      if (!strong && execCount === 1) {
        // 孤立一个 .exe 链接、且链接本身无下载话术 → 通常是正规站的客户端下载入口。
        // 但若整个页面就是个空壳（DOM 稀疏 + 正文极短 + 链接极少），
        // 「全站只有一个 exe」恰恰是投递页的典型形态，此时照常计分。
        if (_isShellPage(data)) {
          return mk(true, 12, '直链可执行文件',
            '页面内容近乎为空，却只提供一个 .exe 直链（空壳投递页典型形态）');
        }
        return mk(false, 0, '直链可执行文件', '');
      }
      const d = `发现 ${execCount} 个 .exe 直链` + (execNearKw > 0 ? '（含下载话术）' : '')
        + (trustedSkipped > 0 ? `，另有 ${trustedSkipped} 个指向可信分发平台已豁免` : '');
      return mk(true, 12, '直链可执行文件', d);
    }
    // 压缩包：须多个且带就近话术，权重下调 18→8
    if (archCount >= 2) {
      return mk(true, 8, '直链压缩包', `发现 ${archCount} 个压缩包直链`);
    }
    return mk(false, 0, '直链可执行文件', '');
  }

  function detCloudDisk(data) {
    // ---- 自指排除：当前站点本身就是一个网盘平台时，不应把它判为「网盘分发」----
    // 原实现直接扫页面 HTML 是否包含网盘域名字符串，而网盘自己的页面必然包含自己的域名
    // （如 wwtr.lanzouw.com 页面满是 "lanzou"、pan.baidu.com 满是 "pan.baidu.com"），
    // 导致「访问网盘官网 = 命中网盘分发 +30」的自指误判，这是 lanzouw / 百度网盘 /
    // Google Drive 等官网被误拦的主因。此处先判断自指，是网盘本体则本维度不计分
    // （外链指向网盘的检测照常：用户仍可从网盘页跳到第三方投递页，那条链路不受影响）。
    const selfHost = (data.hostname || '').toLowerCase().replace(/^www\./, '');
    const isSelfCloud = selfHost && (IOCS.CLOUD_DISK_HOSTS || []).some((h) => selfHost.indexOf(h) !== -1);
    // ⚠️ 2026-08-31 二次修复：上一版仅排除「自指」，仍保留「网盘站内有跳到其他网盘的
    // 链接 → +30」的分支。但网盘官网首页天然会出现其他网盘域名——帮助文档的迁移教程、
    // 「支持从 X 网盘导入」的功能介绍、页脚合作与友链、乃至竞品对比表都会触发。
    // 实测 www.lanzou.com 因 3 个此类链接被 +30 分。
    // 「网盘分发」这一维度的本意是识别【非网盘站把安装包托管到网盘来规避检测】，
    // 对网盘平台本体而言该语义根本不成立，故整条维度对网盘本体一律弃权。
    // （托管在网盘上的恶意文件仍由文件名/双扩展名/密码压缩包等维度照常检出。）
    if (isSelfCloud) return mk(false, 0, '网盘/云盘分发', '');

    const links = data.links || [];
    let n = 0;
    for (const l of links) {
      const c = classifyLinkCached(l);
      if (c === 'cloud') n++;
    }
    // 也扫一下页面文本里的网盘域名
    const lowerHtml = data._lowerHtml;
    const cloudHostHit = (IOCS.CLOUD_DISK_HOSTS || []).some(h => lowerHtml.includes(h));
    if (n > 0 || cloudHostHit) return mk(true, 30, '网盘/云盘分发', `检测到 ${n} 个网盘跳转链接` + (cloudHostHit ? '（页面含网盘域名）' : ''));
    return mk(false, 0, '网盘/云盘分发', '');
  }

  function detObfuscation(data) {
    const scripts = data.scripts || [];
    let hit = false, detail = '';
    for (const s of scripts) {
      for (const p of (IOCS.OBFUSCATION_PATTERNS || [])) {
        if (p.test(s)) { hit = true; detail = '内联脚本含 JS 混淆/打包特征'; break; }
      }
      if (hit) break;
    }
    return mk(hit, 30, 'JS 代码混淆', detail);
  }

  function detVm(data) {
    const scripts = data.scripts || [];
    const lower = data._joinedScriptsLower;
    let hit = false, detail = '';
    for (const p of (IOCS.VM_DETECTION_PATTERNS || [])) {
      if (p.test(lower)) { hit = true; detail = '内联脚本含虚拟机/沙箱探测代码（银狐 loader 强特征）'; break; }
    }
    if (!hit) {
      for (const p of (IOCS.KNOWN_BAD_SNIPPETS || [])) {
        if (p.test(lower)) { hit = true; detail = '内联脚本含已知恶意/落地载荷特征'; break; }
      }
    }
    // 仅在命中混淆或脚本确实存在时给分，避免空脚本误判
    if (hit && scripts.length > 0) return mk(true, 35, '沙箱探测/恶意代码', detail);
    return mk(false, 0, '沙箱探测/恶意代码', '');
  }

  function detSocial(data) {
    const text = data._titleHtmlLower;
    let strong = 0, weak = 0;
    for (const kw of SOCIAL_STRONG_LOWER) if (text.includes(kw)) strong++;
    for (const kw of SOCIAL_WEAK_LOWER) if (text.includes(kw)) weak++;
    // 供组合升级规则使用：只有「强诱导」话术才参与「下载分发 + 社工话术」的致命组合升级。
    // 否则正规软件下载站（页面含"限时/福利/领取"等营销词 + 下载按钮）会被直接判死。
    data._socialStrong = strong > 0;
    const w = strong * 8 + weak * 2;
    if (w > 0) return mk(true, Math.min(w, 24), '钓鱼诱导话术', `命中强诱导话术 ${strong} 处、一般可疑词 ${weak} 处`);
    return mk(false, 0, '钓鱼诱导话术', '');
  }

  function detFakeOfficial(data) {
    if (isOfficialDomain(data.hostname)) return mk(false, 0, '假冒官方话术', '');
    const text = data._titleHtmlLower;
    let n = 0;
    for (const kw of FAKE_OFFICIAL_LOWER) if (text.includes(kw)) n++;
    if (n > 0) return mk(true, Math.min(n * 4, 16), '假冒官方话术', `非官方域名却使用「${n}」处官方话术`);
    return mk(false, 0, '假冒官方话术', '');
  }

  function detRedirect(data) {
    const html = data.html || '';
    let hit = false, detail = '';
    for (const p of (IOCS.REDIRECT_PATTERNS || [])) {
      if (p.test(html)) { hit = true; detail = '页面含外部 iframe 重定向 / meta refresh 自动跳转'; break; }
    }
    if (!hit && (data.iframeSrcs || []).some(src => {
      try { return new URL(src, 'http://' + data.hostname).hostname !== data.hostname; } catch (e) { return false; }
    })) { hit = true; detail = '检测到跨域 iframe 嵌套'; }
    return mk(hit, 25, '重定向/注入', detail);
  }

  // ============ NOAH 投递组件检测 ============
  // 银狐新型「运行时取链」投递组件：恶意下载地址不在静态 HTML 里，
  // 而是页面加载后由 JS 从多个中继后端（relays.json / api.php）动态拉取 download_link 再触发下载。
  // 以此规避「静态 URL 特征」检测——这是 deepseek-mac.com.cn 等站曾绕过本扩展的根本原因。
  // 锚定 NOAH 专属内部标识（与落地域名无关，域名轮换仍有效），且需多标记同时命中避免误报。
  function detNoahKit(data) {
    const scripts = data.scripts || [];
    const joined = data._joinedScripts;
    if (!joined) return mk(false, 0, 'NOAH 投递组件', '');
    // 必须先出现 NOAH 专属标识之一，才可能是该组件（避免 download_link 等通用词误伤正常站）
    if (!/NOAH_DL_REV|noah_relay_pool/i.test(joined)) return mk(false, 0, 'NOAH 投递组件', '');
    const markers = [
      /NOAH_DL_REV/i, /noah_relay_pool/i, /api\.php\?t=/i, /relays\.json/i,
      /DISCOVERY\s*=/i, /download_link/i, /startDownload/i, /POOL_KEY/i
    ];
    let hit = 0;
    for (const p of markers) if (p.test(joined)) hit++;
    if (hit >= 3 && /download_link/i.test(joined)) {
      return mk(true, 50, 'NOAH 投递组件',
        '内联脚本含 NOAH 下载投递组件特征（运行时从多中继后端动态拉取 download_link 再触发下载，刻意规避静态 URL 检测）');
    }
    return mk(false, 0, 'NOAH 投递组件', '');
  }

  // ============ 通用「运行时取链投递」检测（与组件名/落地域名无关） ============
  // 银狐一类「运行时取链」投递手法的通用指纹：恶意下载地址不在静态 HTML，
  // 而是页面 JS 运行时从外部中继/配置/后端动态取得下载链接，再创建隐藏 <a> 并 .click() 触发下载，
  // 刻意规避「静态 URL 特征」检测。本检测器不依赖任何组件专属标识（如 NOAH_*/noah_relay_pool），
  // 只认「投递机制」——无论攻击者把组件改名还是轮换落地域名都通用，根治「只针对单一站点」的盲区。
  function detRuntimeDownload(data) {
    const html = data.html || '';
    const scripts = data.scripts || [];
    const joined = data._joinedScripts;
    if (!joined) return mk(false, 0, '运行时取链投递', '');
    // 机制①：运行时创建隐藏锚点并 .click() 触发导航/下载（createElement('a')…a.click() / appendChild…click()）
    const tempAnchorClick = /createElement\(\s*['"]a['"]\s*\)[\s\S]{0,600}?\.click\(\)/i.test(joined) ||
                            /appendChild\([^)]*\)[\s\S]{0,300}?\.click\(\)/i.test(joined);
    if (!tempAnchorClick) return mk(false, 0, '运行时取链投递', '');
    // 机制②：下载链接来自运行时获取（外部中继/配置/变量），而非写死在静态 HTML。
    // 用「下载链接变量名」或「relay 风格 fetch」判定，避免误伤正常站（config/dl 等常见词不计入）。
    const runtimeLink = /(download_link|durl|file_url|down_url|downloadUrl|apk_url|exe_url|getDownloadUrl|fileLink|download_url)/i.test(joined) ||
                        /(relays\.json|api\.php|relayPool|getRelay|fetch\(['"][^'"]*relay)/i.test(joined);
    if (!runtimeLink) return mk(false, 0, '运行时取链投递', '');
    // 机制③：页面确有下载入口（避免误伤正常站用 createElement('a').click() 做复制/分享等 benign 用途）
    const hasDlEntry = /(下载|立即下载|免费下载|高速下载|官方下载|电脑版|btn-download|data-download|download)/i.test(html) ||
                       /(下载|立即下载|免费下载)/i.test(joined);
    if (!hasDlEntry) return mk(false, 0, '运行时取链投递', '');
    return mk(true, 50, '运行时取链投递',
      '内联脚本在运行时从外部中继/配置动态取得下载链接，并创建隐藏锚点触发下载（规避静态 URL 特征检测），属银狐一类「运行时取链」投递手法');
  }

  // ============ 极简自跳转下载中转页检测 ============
  // 银狐新型「瞬间下载」中转页：页面本身近乎空白、仅加载流量统计（如 51.la），
  // 再用 JS（window.location.replace）或 meta refresh 在数百毫秒内自跳转到带下载参数的同域 URL，
  // 该 URL 由服务端直接吐二进制附件（Content-Disposition: attachment），内容脚本看不到响应体而无法拦。
  // 这是 sau912om.com/inst15 等站「跳转没被去掉」的手法。
  function detDownloadRedirector(data) {
    const html = data.html || '';
    const scripts = data.scripts || [];
    const scriptText = data._joinedScripts;
    const host = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    // 同源自跳转：JS 改写 location，或 meta refresh 指向同域（含 noscript 内的）
    const jsSelfRedirect = /(?:window\.)?location\.(?:replace|assign|href)\s*=\s*['"`](\/[^'"`]|https?:\/\/[^'"`]*\.)?/i.test(scriptText);
    const metaSelf = (data.metaRefreshUrls || []).some(function (m) {
      const u = m.url || '';
      if (/^(https?:)?\/\//i.test(u)) {
        try { return new URL(u).hostname.toLowerCase().replace(WWW_RE, '') === host; } catch (e) { return false; }
      }
      return u.indexOf('/') === 0;
    });
    if (!jsSelfRedirect && !metaSelf) return mk(false, 0, '极简自跳转下载页', '');
    // 收窄误报：正常 SPA 有完整 DOM；仅「极简页面 + (统计脚本 | 下载参数)」才认作中转页
    const textLen = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
    const tinyBody = (data.metrics && (data.metrics.domElementCount || 0) < 50) || textLen < 250;
    const hasAnalytics = /sdk\.51\.la|51\.la|cnzz|tongji|matomo|gtag|gtm|analytics/i.test(html + scriptText);
    const dlParam = /[?&](?:la_)?download|dl=|file=|exe=|soft=|pc=|mac=|win=/i.test(scriptText + html);
    if (tinyBody && (hasAnalytics || dlParam)) {
      return mk(true, 45, '极简自跳转下载页',
        '页面近乎空白却用 JS/meta 自跳转到下载参数地址（服务端直接吐二进制附件），属银狐「瞬间下载」中转页手法');
    }
    return mk(false, 0, '极简自跳转下载页', '');
  }

  // 是否存在「可执行/压缩包/网盘/下载」类链接（用于门控文本类检测，降低误报）
  function hasDownloadLink(data) {
    const links = data.links || [];
    return links.some((l) => {
      const c = classifyLinkCached(l);
      return c === 'exec' || c === 'archive' || c === 'cloud' || c === 'download';
    });
  }

  // ============ 银狐「木马化正版软件」投递检测 ============
  // 手搓银狐站常把流行软件（微信/钉钉/WPS/迅雷/QQ 等）重打包成带毒安装包分发，
  // 且页面做得像正版下载站——这是「疑似风险却漏判」的主因。
  // 特征：下载链接的文件名/文本含品牌词，且为可执行或压缩包扩展名 → 强风险。
  // ⚠️ 2026-08-31 重构：原实现把「页面以品牌软件名义提供下载」也归入本维度并列为
  // STRONG 强特征，而 medium 档 strongToDanger=1 —— 命中即直接判 danger。
  // 实测 tool.lu 总分仅 52（低于 danger 线 72）却因本维度被强制判危；
  // 果核剥壳 ghxi.com 同样命中。原因有两层：
  //   ① 品牌词用 indexOf 子串匹配，短词（ie/tor/word/wps…）在任意页面都能命中；
  //   ② 匹配范围是【整页 HTML】，任何软件站/工具站/技术社区都必然同时出现
  //      「某品牌名」与「最新版/客户端/安装包」这类词。
  // 修复：本维度只保留真正高置信的「下载链接文件名含品牌词」（分支 1，仍属 STRONG），
  //      并加词边界匹配 + 可信分发平台豁免；分支 2 拆分为独立的弱信号维度
  //      detBrandedSoftSite（见下），不再参与强特征直判。
  function detBrandedExe(data) {
    const links = data.links || [];
    const pageHost = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    for (const l of links) {
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive') continue;
      // 可信分发平台（GitHub Releases / 官方 CDN / 包管理器）上的品牌安装包是正常分发
      const lh = _linkHost(l, pageHost);
      if (isTrustedDownloadHost(lh)) continue;
      // 链接指向品牌自己的官网 → 是官方下载入口，不是仿冒投递
      if (isOfficialDomain(lh)) continue;
      const blob = ((l.href || '') + ' ' + (l.text || '')).toLowerCase();
      if (blobHasBrand(blob)) {
        const b = _matchedBrand(blob);
        return mk(true, 40, '品牌仿冒安装包',
          `下载链接「${l.text || l.href}」含品牌词「${b || '知名软件'}」且为${c === 'exec' ? '可执行' : '压缩包'}文件（银狐常用木马化正版软件投递）`);
      }
    }
    return mk(false, 0, '品牌仿冒安装包', '');
  }

  // ============ 「以品牌软件名义提供下载」——弱信号维度 ============
  // 由 detBrandedExe 分支 2 拆分而来，定位从 STRONG 降为 WEAK，权重 22→10。
  // 依据：正规软件目录站（果核剥壳/ZNDS/便携软件站）与在线工具站的业态本身就是
  // 「介绍某品牌软件 + 提供下载」，这一组合无法区分善恶，只能作为堆叠时的辅助信号。
  // 同时把品牌词匹配范围从【整页 HTML】收紧为【标题 + 下载链接文本/文件名】，
  // 避免页脚友链、导航、推荐位里的品牌名参与判定。
  function detBrandedSoftSite(data) {
    if (!hasDownloadLink(data)) return mk(false, 0, '品牌软件下载站', '');
    const pageHost = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    // 仅在标题 + 下载类链接的文本/href 内查找品牌词
    let scope = (data.title || '').toLowerCase();
    for (const l of (data.links || [])) {
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive' && c !== 'download') continue;
      const lh = _linkHost(l, pageHost);
      if (isTrustedDownloadHost(lh) || isOfficialDomain(lh)) continue;
      scope += ' ' + ((l.href || '') + ' ' + (l.text || '')).toLowerCase();
    }
    if (!scope.trim()) return mk(false, 0, '品牌软件下载站', '');
    const lowerHtml = data._lowerHtml;
    const hasDistWording = /(安装包|客户端|pc版|电脑版|官方版|完整版|绿色版|本地下载|最新版|修复补丁|离线安装包|升级包|离线包|便携版|免安装版|纯净版|高速下载)/.test(lowerHtml);
    if (!hasDistWording) return mk(false, 0, '品牌软件下载站', '');
    if (blobHasBrand(scope)) {
      const b = _matchedBrand(scope);
      return mk(true, 10, '品牌软件下载站', `站点以「${b || '知名软件'}」软件名义提供下载（软件目录站常态，仅作辅助信号）`);
    }
    return mk(false, 0, '品牌软件下载站', '');
  }

  // ============ 已知木马化投递物文件名检测 ============
  // 与 iocs.js 的 KNOWN_BAD_FILENAMES / SUSPICIOUS_DOWNLOAD_NAME_PATTERNS 联动：
  // 样本（bzy.exe=假冒 A Great VPN、shanlian_VPN_64.exe=假冒闪连VPN）经静态分析提取的文件名
  // 作为「稳定可观测」的 IOC——MV3 扩展读不到下载字节，文件名是银狐木马化安装包最可靠的识别锚点之一。
  // 精确命中已知文件名 → 强特征（STRONG）；仅符合可疑命名模式 → 中风险（MEDIUM）。
  function _fileNameOf(l) {
    const href = (l && l.href) || '';
    const fromHref = href.split(/[?#]/)[0].split('/').pop() || '';
    const fromText = (l && l.text) || '';
    return (fromHref + ' ' + fromText).toLowerCase().trim();
  }
  function detBadPayloadName(data) {
    const links = data.links || [];
    for (const l of links) {
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive') continue;
      const name = _fileNameOf(l);
      if (!name) continue;
      for (const f of (IOCS.KNOWN_BAD_FILENAMES || [])) {
        if (name === f) {
          return mk(true, 45, '已知木马化投递物', `下载链接指向已知银狐木马化安装包「${name}」（样本静态分析确认的投递物文件名）`);
        }
      }
      for (const p of (IOCS.SUSPICIOUS_DOWNLOAD_NAME_PATTERNS || [])) {
        if (p.test(name)) {
          return mk(true, 25, '可疑安装包文件名', `下载链接文件名「${name}」符合银狐木马化安装包命名规律（仿冒 VPN/加速器 安装包）`);
        }
      }
    }
    return mk(false, 0, '已知木马化投递物', '');
  }

  // ============ 载荷文件名模式（高置信投递特征，STRONG 组）============
  // 与 badPayloadName 的分工：那一维靠【已知样本名单】（精确匹配，命中率低但零误报），
  // 本维靠【命名模式】覆盖未知样本。四类模式均为正规站点不会出现的形态：
  //   ① 与 Windows 系统进程同名（svchost.exe / rundll32.exe / lsass.exe …）
  //      —— 正规站没有任何理由提供系统进程同名可执行文件下载
  //   ② 双扩展名伪装（发票.pdf.exe / 报表.xlsx.scr）
  //   ③ 纯随机串命名（16 位十六进制 / 长数字串），无任何语义 —— 自动化批量生成载荷
  //   ④ 中文诱饵命名（工资表.exe / 通知.exe / 判决书.exe …）—— 正规软件不这么命名
  // 该维度设计目的：让「老域名 + 有正文内容 + 无仿冒」这类躲开所有形态学信号的投递站，
  // 仍能凭载荷文件名本身被识别（载荷必须让受害者双击运行，这是躲不掉的暴露面）。
  function detPayloadNamePattern(data) {
    const links = data.links || [];
    const hits = [];
    let kind = '';
    for (const l of links) {
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive') continue;
      const name = _payloadFileName(l && l.href);
      if (!name) continue;
      const decoded = decodeURIComponentSafe(name);
      let k = '';
      if (_SYS_PROC_RE.test(name)) k = '与 Windows 系统进程同名';
      else if (_DOUBLE_EXT_RE.test(name)) k = '双扩展名伪装';
      else if (_RANDOM_NAME_RE.test('/' + name)) k = '纯随机串命名';
      else if (_CN_LURE_NAME_RE.test(decoded)) k = '中文诱饵命名';
      if (!k) continue;
      if (!kind) kind = k;
      if (hits.indexOf(decoded) === -1) hits.push(decoded);
    }
    if (!hits.length) return mk(false, 0, '可疑载荷文件名', '');
    return mk(true, 40, '可疑载荷文件名',
      `下载链接文件名具备木马投递特征（${kind}）：${hits.slice(0, 3).join('、')}` +
      (hits.length > 3 ? ` 等 ${hits.length} 个` : ''));
  }

  // ============ 带密码压缩包分发检测 ============
  // 银狐常用「网盘/压缩包 + 解压密码」规避杀软查杀（密码包无法被静态扫描）。
  function detPasswordArchive(data) {
    const links = data.links || [];
    const lowerHtml = data._lowerHtml;
    const hasArchive = links.some((l) => {
      const c = classifyLinkCached(l);
      return c === 'archive' || c === 'cloud';
    });
    if (!hasArchive) return mk(false, 0, '密码压缩包', '');
    if (/解压密码|提取密码|压缩包密码|解压码|解压口令|密码[:：]?\s*[一-龥a-z0-9]{4,}|password\s*[:：]/i.test(lowerHtml)) {
      return mk(true, 26, '带密码压缩包分发', '压缩包/网盘分发并附「解压密码」，银狐常用密码包规避杀软查杀');
    }
    return mk(false, 0, '密码压缩包', '');
  }

  // ============ 银狐「签名诱饵」主题检测 ============
  // 财税/稽查/补贴/违规记录等是银狐 2025–2026 反复使用的投递主题，正常站点极少出现；
  // 门控：页面须含下载/网盘入口，避免政府/企业正常网页（多已被官方/政府域名豁免）误伤。
  function detLureTheme(data) {
    if (!hasDownloadLink(data)) return mk(false, 0, '银狐诱饵主题', '');
    const text = data._titleHtmlLower;
    let n = 0;
    for (const kw of LURE_THEMES_LOWER) {
      if (text.indexOf(kw) !== -1) n++;
    }
    if (n > 0) return mk(true, 28, '银狐诱饵主题', `命中 ${n} 处银狐高频投递主题（税务/稽查/补贴等），且页面含下载入口`);
    return mk(false, 0, '银狐诱饵主题', '');
  }

  // ============ 伪造「插件/浏览器版本过低」更新提示 ============
  // 银狐常用「点击页面任意位置→弹窗 flash/浏览器版本过低→重定向下载页」诱导。
  // 门控：需页面含自动跳转/跨域 iframe 或下载入口，避免正常「请更新浏览器」横幅误伤。
  function _hasRedirectOrIframe(data) {
    const html = data.html || '';
    for (const p of (IOCS.REDIRECT_PATTERNS || [])) if (p.test(html)) return true;
    if ((data.iframeSrcs || []).some(src => {
      try { return new URL(src, 'http://' + data.hostname).hostname !== data.hostname; } catch (e) { return false; }
    })) return true;
    return false;
  }
  function detFakeUpdate(data) {
    const text = data._titleHtmlLower;
    let hit = false, kw = '';
    for (let i = 0; i < FAKE_UPDATE_LOWER.length; i++) {
      if (text.indexOf(FAKE_UPDATE_LOWER[i]) !== -1) { hit = true; kw = FAKE_UPDATE_ORIG[i]; break; }
    }
    if (!hit) return mk(false, 0, '伪造更新提示', '');
    if (!_hasRedirectOrIframe(data) && !hasDownloadLink(data)) return mk(false, 0, '伪造更新提示', '');
    return mk(true, 22, '伪造更新提示', `页面含「${kw}」提示，疑似伪造更新诱导下载（银狐常用手法）`);
  }

  // ============ 友情链接区块「指向无关大牌」检测 ============
  // 银狐伪官方下载站模板常在页脚放「友情链接」区块，里面塞一堆百度/淘宝/QQ/微信等
  // 与本站毫无相关的大牌外链，用来显得正规。判定：页面含友情链接类标记 + 其下方链接块内
  // ≥3 个指向「不同且非本站品牌」的大牌外链（同域内链忽略）→ 弱特征，疑似批量模板/钓鱼伪装。
  const FRIENDLY_MARKERS = ['友情链接', '合作伙伴', '相关网站', '推荐网站', '互换链接', '友链'];
  const _FL_BRANDS = [...new Set((IOCS.FRIENDLY_LINK_BRANDS || []).map(k => k.toLowerCase()))];

  // 提取 html 中从 fromIdx 起、window 窗口内的 <a> 链接（href + 去标签文本）
  function _extractLinksAfter(html, fromIdx, window) {
    const slice = (html || '').slice(fromIdx, fromIdx + window);
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const out = [];
    let m;
    while ((m = re.exec(slice)) !== null && out.length < 300) {
      out.push({ href: m[1], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    }
    return out;
  }

  // 注册域（eTLD+1），含 .com.cn / .net.cn 等二级后缀
  function _regDomain(host) {
    if (!host) return '';
    host = host.toLowerCase().replace(WWW_RE, '');
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const two = ['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'co.uk', 'com.au', 'com.tw', 'co.jp'];
    if (parts.length >= 3 && two.includes(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  }

  function detFriendlyLinks(data) {
    const html = data.html || '';
    if (!html) return mk(false, 0, '友情链接异常', '');
    const lowHtml = data._lowerHtml;
    let markerIdx = -1;
    for (const mk2 of FRIENDLY_MARKERS) {
      const idx = lowHtml.indexOf(mk2.toLowerCase());
      if (idx !== -1) { markerIdx = idx; break; }
    }
    if (markerIdx === -1) return mk(false, 0, '友情链接异常', '');
    const links = _extractLinksAfter(html, markerIdx, 6000);
    if (links.length === 0) return mk(false, 0, '友情链接异常', '');

    // 本站自身品牌（hostname/title 命中大牌库）→ 友情链接里指向它自己不算「无关」
    const pageHost = (data.hostname || '').toLowerCase();
    const pageTitle = (data.title || '').toLowerCase();
    const ownBrands = new Set();
    for (const b of _FL_BRANDS) { if (b.length < 2) continue; if (pageHost.indexOf(b) !== -1 || pageTitle.indexOf(b) !== -1) ownBrands.add(b); }
    const pageReg = _regDomain(pageHost);

    // 官方域名（百度/淘宝等真官网）的友情链接不算异常
    if (isOfficialDomain(pageHost)) return mk(false, 0, '友情链接异常', '');

    const unrelated = new Set();
    for (const l of links) {
      const href = (l.href || '').trim();
      if (!/^https?:\/\//i.test(href)) continue; // 只算外链
      let host;
      try { host = new URL(href).hostname.toLowerCase(); } catch (e) { continue; }
      const reg = _regDomain(host);
      if (!reg || reg === pageReg) continue; // 同域/子域内链忽略
      const hay = host + ' ' + (l.text || '').toLowerCase();
      for (const b of _FL_BRANDS) {
        if (b.length < 2) continue;
        if (hay.indexOf(b) !== -1 && !ownBrands.has(b)) { unrelated.add(b); break; }
      }
    }
    if (unrelated.size >= 3) {
      // 门控：有备案的正规中文站常互相加友情链接（百度/淘宝/京东互链是常态），
      // 单独出现会大规模误报。仅当页面同时存在其它风险背景时才计入，避免误伤良性站。
      const m = data.metrics || {};
      const otherRisk =
        hasDownloadLink(data) ||
        !!getSpoof(data) ||
        ((data.hostname || '').toLowerCase().endsWith('.cn') && !(data.icp && data.icp.hasIcpNumber)) ||
        ((m.domElementCount || 0) < 60 || (m.textLength || 0) < 400);
      if (!otherRisk) return mk(false, 0, '友情链接异常', '');
      const w = Math.min(unrelated.size, 5) * 6; // 3→18, 4→24, 5+→30（弱特征）
      return mk(true, w, '友情链接异常',
        `页脚「友情链接」区块含 ${unrelated.size} 个与本站品牌无关的大牌外链（${[...unrelated].slice(0, 5).join('/')}），疑似批量模板站/钓鱼伪装`);
    }
    return mk(false, 0, '友情链接异常', '');
  }

  // ============ 双扩展名/伪装扩展名可执行文件检测 ============
  // 银狐常把恶意 exe 命名为「发票.pdf.exe」「报告.doc.exe」「xxx.exe.zip」伪装成文档/压缩包。
  const DOUBLE_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|jpg|jpeg|png|gif|txt|mp4|mp3|html?|zip|rar|7z|tar|gz|iso|img)\.(exe|scr|msi|bat|cmd|com|pif|vbs|ps1|jar|lnk|cpl|wsf|hta|dll)$/i;
  const REV_DOUBLE_EXT_RE = /\.exe\.(zip|rar|7z|pdf|docx?|xlsx?|pptx?|jpg|jpeg|png|txt|html?)$/i;
  function detDoubleExt(data) {
    const links = data.links || [];
    for (const l of links) {
      const c = classifyLinkCached(l);
      if (c !== 'exec' && c !== 'archive') continue;
      const url = (l.href || '').split('?')[0].split('#')[0];
      const base = url.substring(url.lastIndexOf('/') + 1);
      if (DOUBLE_EXT_RE.test(base) || REV_DOUBLE_EXT_RE.test(base)) {
        return mk(true, 30, '双扩展名伪装', `下载链接「${base}」使用双扩展名伪装（银狐常用文档/压缩包外衣藏可执行）`);
      }
    }
    return mk(false, 0, '双扩展名伪装', '');
  }

  function detSuspiciousTld(data) {
    const h = (data.hostname || '').toLowerCase();
    const tld = h.split('.').pop();
    const inList = (IOCS.SUSPICIOUS_TLDS || []).includes(tld);
    // 随机串域名：单一长段由无语义字母数字混杂组成
    const labels = h.split('.');
    const randomish = labels.some(l => /^[a-z0-9]{10,}$/.test(l) && /[0-9]/.test(l) && /[a-z]/.test(l));
    if (inList || randomish) {
      const d = inList ? `域名使用廉价/免费 TLD(.${tld})` : '域名含无语义随机字符串段';
      // ⚠️ 2026-08-30 降权：20 → 8。
      // 依据（项目方确认）：银狐投递站现已普遍改用「二类域名」（正常注册的普通域名），
      // 基本不再使用 top/xyz 这类廉价或免费后缀；而廉价后缀的主要使用者是
      // 预算有限的普通个人站长与小项目。继续按高风险打分只会制造大量误报，
      // 且对检出率几乎没有贡献。故降为弱信号（8 分），仅作辅助参考。
      return mk(true, inList ? 8 : 20, '可疑域名结构', d);
    }
    return mk(false, 0, '可疑域名结构', '');
  }

  // ============ 灵敏度 → 阈值（分层：low=保守高门槛少误报 / medium=均衡 / high=激进低门槛）============
  // 注意：阈值只决定「纯分数」判危线；组合升级规则（见 analyze 内）同样随灵敏度调整，
  // 否则切到 low 仍会被组合逻辑强拦，灵敏度形同虚设。
  function thresholds(sensitivity) {
    switch ((sensitivity || 'medium').toLowerCase()) {
      // 标定依据（见下方 comboConfig）：真实恶意样本纯分值落在 93–232，
      // 旧值 medium=65 / high=50 冗余过大，良性站仅靠「无备案+低质量+一句社工」即可凑到 80+ 误拦。
      // 新值把 danger 线抬到中风险特征主导区，同时由 mediumToDanger 组合规则兜住「多中风险撑分」的恶意页。
      case 'low':    return { warn: 55, danger: 88 };
      case 'high':   return { warn: 30, danger: 58 };
      case 'medium':
      default:       return { warn: 42, danger: 72 };
    }
  }

  // ============ 组合升级配置（随灵敏度变化）============
  // low  ：只认硬强特征 + 多信号叠加（少误报）
  // medium：均衡
  // high  ：放宽弱特征组合（多拦截）
  // ============ 风险特征分层（模块级常量，避免每次 analyze 重建数组）============
  //   STRONG  ：高置信木马信号 —— 域名仿冒 / 沙箱探测 / 品牌木马安装包 / 双扩展名 /
  //             盗用备案 / Noah 套件 / 下载中转 / 运行时下载 / 已知投递物 / 可疑载荷文件名
  //   MEDIUM  ：中风险 —— 代码工程化低 / 链接异常 / 网盘分发 / 直链可执行 / 密码包 /
  //             诱饵主题 / 跳转注入 / 域名年龄 / 已拦截载荷域名 / JS 混淆
  //   WEAK    ：弱信号 —— 缺备案 / 低质量痕迹 / 钓鱼话术 / 假冒官方 / 可疑域名结构 /
  //             跨域下载 / 友链异常 / 品牌软件下载站
  // 注：execDownload / cloudDiskDist 已从 STRONG 移出（普通软件站也常见，不应单凭 .exe/网盘直链强拦）。
  // ⚠️ 2026-08-30：obfuscatedJs 由 STRONG 降至 MEDIUM —— 现代前端普遍 webpack/terser 打包，
  //    base64 内联资源、fromCharCode、长转义在正规站极常见，而 medium 档 strongToDanger=1
  //    意味着命中即 danger，这曾是正规站被误拦的主要来源。
  // ⚠️ 2026-08-31：brandedSoftSite 由 STRONG/brandedExe 拆分降级至 WEAK —— 正规软件目录站
  //    与在线工具站的业态即「介绍品牌软件 + 提供下载」，无法据此区分善恶。
  const FEATURE_STRONG = ['domainImpersonation', 'vmDetection', 'brandedExe', 'doubleExt', 'icpStolen', 'noahKit', 'downloadRedirector', 'runtimeDownload', 'badPayloadName', 'payloadNamePattern'];
  const FEATURE_MEDIUM = ['codeEngineering', 'linkAnalysis', 'cloudDiskDist', 'execDownload', 'passwordArchive', 'lureTheme', 'redirectIframe', 'domainAge', 'blacklistedPayload', 'obfuscatedJs'];
  const FEATURE_WEAK   = ['icpMissing', 'lowQuality', 'socialEngineering', 'fakeOfficial', 'domainStructure', 'crossDomainDownload', 'friendlyLinks', 'brandedSoftSite'];

  function comboConfig(sens) {
    switch ((sens || 'medium').toLowerCase()) {
      // mediumToDanger：中风险特征（代码工程化/链接异常/网盘/直链exe/密码包/诱饵主题/跳转注入/新域名）
      // 累计达到该数量即升级 danger。用于「无强特征、纯靠多中风险撑分」的恶意页（如伪造更新+跳转+exe=69分），
      // 避免抬高分值阈值后这类页漏判。
      case 'low':   return { strongToDanger: 1, strongPlusOther: 2, mediumToDanger: 4, weakToDanger: 4, icpPlusWeak: 3, useDownloadSocial: false, useFakeSocial: false };
      case 'high':  return { strongToDanger: 1, strongPlusOther: 1, mediumToDanger: 2, weakToDanger: 3, icpPlusWeak: 2, useDownloadSocial: true,  useFakeSocial: true };
      case 'medium':
      default:      return { strongToDanger: 1, strongPlusOther: 2, mediumToDanger: 3, weakToDanger: 3, icpPlusWeak: 2, useDownloadSocial: true,  useFakeSocial: true };
    }
  }

  const ALL = [
    { id: 'domainImpersonation', fn: detSpoof },
    { id: 'icpMissing', fn: detIcpMissing },
    { id: 'icpStolen', fn: detIcpStolen },
    { id: 'codeEngineering', fn: detCodeEngineering },
    { id: 'linkAnalysis', fn: detLinkAnalysis },
    { id: 'crossDomainDownload', fn: detCrossDomainDownload },
    { id: 'blacklistedPayload', fn: detBlacklistedPayload },
    { id: 'domainAge', fn: detDomainAge },
    { id: 'lowQuality', fn: detLowQuality },
    { id: 'execDownload', fn: detDirectExec },
    { id: 'cloudDiskDist', fn: detCloudDisk },
    { id: 'obfuscatedJs', fn: detObfuscation },
    { id: 'vmDetection', fn: detVm },
    { id: 'socialEngineering', fn: detSocial },
    { id: 'fakeOfficial', fn: detFakeOfficial },
    { id: 'redirectIframe', fn: detRedirect },
    { id: 'noahKit', fn: detNoahKit },
    { id: 'downloadRedirector', fn: detDownloadRedirector },
    { id: 'runtimeDownload', fn: detRuntimeDownload },
    { id: 'domainStructure', fn: detSuspiciousTld },
    { id: 'brandedExe', fn: detBrandedExe },
    { id: 'brandedSoftSite', fn: detBrandedSoftSite },
    { id: 'badPayloadName', fn: detBadPayloadName },
    { id: 'payloadNamePattern', fn: detPayloadNamePattern },
    { id: 'passwordArchive', fn: detPasswordArchive },
    { id: 'lureTheme', fn: detLureTheme },
    { id: 'fakeUpdate', fn: detFakeUpdate },
    { id: 'friendlyLinks', fn: detFriendlyLinks },
    { id: 'doubleExt', fn: detDoubleExt }
  ];

  /**
   * 主分析入口
   * @param {Object} data  enrich 后的页面数据
   * @param {Object} [options] { enabled: {...bool}, sensitivity: 'low'|'medium'|'high' }
   */
  function analyze(data, options) {
    options = options || {};
    const enabled = options.enabled || {};
    const { warn, danger } = thresholds(options.sensitivity);

    data = data || {};
    data.hostname = data.hostname || location.hostname || '';

    // 仿冒判定缓存只在「单次 analyze 内」有效，进入时必须清空。
    // 原因：内容脚本会先用主采集数据判一次，随后异步补到 icpAuth / domainAgeDays 后拿同一个
    // data 对象重判；若沿用上一轮缓存，「官方 ICP 确认联动跳过」在重判时会失效（读到旧的仿冒结果）。
    data._spoofCache = undefined;

    // ---- 协议早退：非 http(s) 页面（file://、chrome://、edge://、about: 等）一律判安全 ----
    const _proto = (data.protocol || location.protocol || '').toLowerCase();
    if (_proto && _proto !== 'http:' && _proto !== 'https:') {
      return {
        score: 0, level: 'safe', detected: false, official: false, spoof: null,
        reasons: [{ label: '本地/内部页面', detail: '非 http(s) 协议（' + _proto + '），跳过银狐检测', weight: 0 }],
        features: {}, threshold: danger
      };
    }

    // ---- 本地回环早退：localhost / 127.0.0.1 等本地开发地址一律判安全 ----
    // 对标上游 v2.5.1 修复的「本地回环 Bug」：localhost 是 http(s) 协议，会进入正常评分流程被误检。
    const _host = (data.hostname || '').toLowerCase().replace(WWW_RE, '');
    if (_host === 'localhost' || _host === '127.0.0.1' || _host === '[::1]' || _host.endsWith('.localhost')) {
      return {
        score: 0, level: 'safe', detected: false, official: true, spoof: null,
        reasons: [{ label: '本地开发地址', detail: 'localhost / 127.0.0.1 本地回环地址，跳过银狐检测', weight: 0 }],
        features: {}, threshold: danger
      };
    }

    // ---- 已知木马投递站硬拦截（硬编码黑名单，永不豁免，强制 danger）----
    if (isKnownBad(data.hostname)) {
      return {
        score: 100, level: 'danger', detected: true, official: false, spoof: null,
        reasons: [{ label: '已知银狐木马站点', detail: `「${data.hostname}」在硬编码恶意域名黑名单中，已强制拦截并禁用下载入口`, weight: 100 }],
        features: { knownBad: true }, threshold: danger
      };
    }

    // ---- 官方早期退出（根治真官网误拦）----
    if (isOfficialDomain(data.hostname)) {
      return {
        score: 0, level: 'safe', detected: false, official: true, spoof: null,
        reasons: [{ label: '官方可信域名', detail: `「${data.hostname}」在官方白名单中，直接判定安全`, weight: 0 }],
        features: {}, threshold: danger
      };
    }

    // ---- 性能优化：预计算供多个检测器复用的派生字符串 ----
    // 避免对整页 html / 脚本反复 toLowerCase()、反复 scripts.join('\n')（长页面可达数 MB，
    // 多个检测器各算一次会造成可观的字符串分配与遍历开销）。判定结果完全等价。
    data._lowerHtml = (data.html || '').toLowerCase();
    data._titleHtmlLower = ((data.title || '') + ' ' + (data.html || '')).toLowerCase();
    const _scriptsArr = data.scripts || [];
    data._joinedScripts = _scriptsArr.join('\n');
    data._joinedScriptsLower = data._joinedScripts.toLowerCase();

    let score = 0;
    const reasons = [];
    const features = {};
    let _ageDiscount = null;   // 老域名减分暂存，是否生效取决于本页有无明确恶意证据
    for (const cat of ALL) {
      if (enabled[cat.id] === false) continue; // 用户关闭的维度跳过
      let r;
      try { r = cat.fn(data) || { hit: false, weight: 0, label: cat.id, detail: '' }; }
      catch (e) { r = { hit: false, weight: 0, label: cat.id, detail: '' }; }
      // 只把正向风险维度计入 feature 组合（域名年龄减分等负向维度不参与组合升级）
      features[cat.id] = r.hit && r.weight > 0;
      if (r.hit) {
        // 老域名减分先暂存，稍后按「是否存在明确恶意证据」决定是否应用
        if (cat.id === 'domainAge' && r.weight < 0) { _ageDiscount = r; }
        else { score += r.weight; reasons.push({ label: r.label, detail: r.detail, weight: r.weight }); }
      }
      // 为代码工程化维度提供混淆/VM 命中信号
      if (cat.id === 'obfuscatedJs' && r.hit) data._obfuscationHit = true;
      if (cat.id === 'vmDetection' && r.hit) data._vmHit = true;
    }

    // ⚠️ 2026-08-31：老域名减分（-20）必须在出现明确恶意证据时失效。
    // 原实现无条件减 20 分，于是「注册多年的域名」成了通用免死金牌 —— 而现实中长期投递站、
    // 被入侵接管的老站、到期抢注的老域名都极常见。实测：老域名 + 伪装系统进程载荷
    // （svchost.exe）原本因 -20 抵消而落到 safe。
    // 规则：命中任一 STRONG 特征，或累计 ≥2 条 MEDIUM 特征时，不再给予老域名减分；
    //       仅在「页面整体干净、最多一条中风险」时保留这份信任加成。
    if (_ageDiscount) {
      const _strongN = FEATURE_STRONG.filter((id) => features[id]).length;
      const _mediumN = FEATURE_MEDIUM.filter((id) => features[id]).length;
      if (_strongN === 0 && _mediumN < 2) {
        score += _ageDiscount.weight;
        reasons.push({ label: _ageDiscount.label, detail: _ageDiscount.detail, weight: _ageDiscount.weight });
      } else {
        reasons.push({
          label: '老域名减分已作废', weight: 0,
          detail: `域名注册年限较长，但本页已命中 ${_strongN} 项高置信恶意特征与 ${_mediumN} 项中风险特征 —— 老域名不作为信任依据（长期投递站 / 被接管老站 / 过期抢注域名均属常见）`
        });
      }
    }

    // 域名年龄减分可能把总分拉低，但不允许低于 0
    if (score < 0) score = 0;

    let level = 'safe';
    if (score >= danger) level = 'danger';
    else if (score >= warn) level = 'warn';

    // ---- 组合信号升级：多个风险信号叠加时，银狐投递概率极高，强制 danger ----
    // 灵敏度感知（comboConfig）：low 只认硬强特征+多信号叠加（少误报）；high 放宽弱特征组合（多拦截）。
    // 特征重估后分层：
    //   STRONG  ：域名仿冒 / JS混淆 / 沙箱探测 / 品牌木马安装包 / 双扩展名伪装 —— 高置信木马信号
    //   MEDIUM  ：代码工程化低 / 链接异常 / 网盘分发 / 直链可执行 / 密码包 / 诱饵主题 / 重定向注入 / 新域名
    //   WEAK    ：缺备案 / 低质量AI痕迹 / 钓鱼话术 / 假冒官方 / 可疑域名结构 / 跨域下载 / 友情链接异常
    // 注：execDownload / cloudDiskDist 已从 STRONG 移出（普通软件站也常见，不应单凭 .exe/网盘直链强拦）。
    // ⚠️ 2026-08-30 重构：obfuscatedJs 由 STRONG 降至 MEDIUM。
    // 原因：现代前端普遍使用 webpack / terser 打包压缩，base64 内联资源（图标、字体、
    // 小图）、fromCharCode、长字符串转义等「混淆特征」在正规站点极其常见。它原本是
    // STRONG，而 medium 档 strongToDanger=1 —— 命中即 danger，这是大量正规站点
    // （尤其含内联资源、图表库、字体图标、SPA 的站点）被误拦的主要来源。
    // 降级后：单靠混淆不再直接判死，须与其他信号叠加才升级；真正高置信的
    // obfuscator.io 专属特征（_0x 变量数组、packed 打包器）仍保留在词表内正常加分。
    const STRONG = FEATURE_STRONG, MEDIUM = FEATURE_MEDIUM, WEAK = FEATURE_WEAK;
    const cfg = comboConfig(options.sensitivity);
    const strongHits = STRONG.filter(id => features[id]);
    const mediumHits = MEDIUM.filter(id => features[id]);
    const weakHits   = WEAK.filter(id => features[id]);
    const otherCount = mediumHits.length + weakHits.length;

    if (level !== 'danger') {
      let escalated = false, detail = '';
      if (strongHits.length >= cfg.strongToDanger) {
        escalated = true; detail = '命中银狐强特征（' + strongHits.join('/') + '），判定为木马投递站';
      } else if (strongHits.length >= 1 && otherCount >= cfg.strongPlusOther) {
        escalated = true; detail = '强特征（' + strongHits.join('/') + '）叠加其他可疑信号，判定为木马投递站';
      } else if (mediumHits.length >= cfg.mediumToDanger) {
        escalated = true; detail = '多项中风险特征叠加（' + mediumHits.join('/') + '），判定为木马投递站';
      } else if (weakHits.length >= cfg.weakToDanger) {
        escalated = true; detail = '多项弱可疑特征叠加（' + weakHits.join('/') + '），判定为高风险站';
      } else if (features.icpMissing && weakHits.length >= cfg.icpPlusWeak) {
        escalated = true; detail = '国内无备案且多项弱可疑特征叠加，判定为高风险站';
      } else if (cfg.useDownloadSocial &&
                 (features.execDownload || features.cloudDiskDist || features.brandedExe || features.passwordArchive) &&
                 // ⚠️ 2026-08-30：原先这里用 features.socialEngineering（只要命中任意社工词），
                 // 导致「有下载按钮 + 页面有'限时/福利/验证码'等常见营销词」的正规软件站被判死。
                 // 改为只认「强诱导话术」（qq群/客服微信/安全账户/破解/激活工具等）。
                 (data._socialStrong || features.fakeOfficial || features.lureTheme || features.fakeUpdate)) {
        // 「下载分发 + 社工/假冒/诱饵话术」：手搓银狐（做得像正版）的典型组合，分数卡 warn 却漏拦 → 升级。
        escalated = true; detail = '存在下载分发入口且页面含社工/假冒/诱饵话术，判定为银狐投递站';
      } else if (cfg.useFakeSocial && features.fakeOfficial && data._socialStrong) {
        // 「假冒官方话术 + 社工话术」：钓鱼站强组合，两条弱信号也升级。
        escalated = true; detail = '同时使用假冒官方话术与社工话术，判定为钓鱼站';
      }
      if (escalated) {
        level = 'danger';
        reasons.push({ label: '组合信号升级', detail, weight: 0 });
      }
    }

    return {
      score, level, detected: level === 'danger', official: false,
      spoof: getSpoof(data),
      trustedPlatform: isTrustedPlatform(data.hostname),
      reasons, features, threshold: danger
    };
  }

  // 维度元信息（供设置面板渲染：开关、权重、说明）
  const CATEGORIES = [
    { id: 'domainImpersonation', label: '域名仿冒官方品牌', weight: 60, desc: '域名含品牌词/编辑距离近似，命中 121+ 品牌中任意一个即按视频 8 项规则加 60 分' },
    { id: 'icpMissing', label: '缺备案号(ICP)', weight: 18, desc: '面向国内却无 ICP 备案号（权重已下调：备案信息常由 JS 渲染或置于子页，缺失不等于恶意）' },
    { id: 'icpStolen', label: '盗用他人备案号', weight: 55, desc: '页面展示备案号但权威备案库查无此域名记录，属盗用他人备案伪装合规' },
    { id: 'codeEngineering', label: '代码工程化低', weight: 28, desc: 'DOM 极简、无主流框架、外部资源极少、脚本打包异常，疑似手搓/模板站（前端渲染未完成的页面已豁免）' },
    { id: 'linkAnalysis', label: '链接分析异常', weight: 50, desc: '外链/下载链接/重复链接/跨域分发等维度综合评分，封顶 50 分（#4 重构后链接来源增多，已下调以防误报）' },
    { id: 'crossDomainDownload', label: '下载链接跨域', weight: 20, desc: '下载/可执行链接指向与页面不同的域名' },
    { id: 'blacklistedPayload', label: '指向已拦截的投递域名', weight: 45, desc: '下载链接指向此前已被拦截过的载荷域名，银狐换落地页不换载荷 CDN 的典型复用特征' },
    { id: 'domainAge', label: '域名年龄', weight: 60, desc: '新注册域名 +60 分（异步 WHOIS），老域名 -20 分' },
    { id: 'lowQuality', label: '低质量/AI生成痕迹', weight: 18, desc: 'DOM 极简、emoji 异常，疑似批量复制/AI 生成站（前端渲染未完成的页面已豁免）' },
    { id: 'execDownload', label: '直链可执行文件', weight: 12, desc: '页面存在 .exe/.msi 直链（指向 GitHub/官方 CDN 等可信分发平台、以及内容型大站的少量安装包已豁免）' },
    { id: 'cloudDiskDist', label: '网盘/云盘分发', weight: 30, desc: '通过阿里云盘/百度网盘等网盘跳转分发安装包（网盘平台本体已整体豁免）' },
    { id: 'obfuscatedJs', label: 'JS 代码混淆', weight: 30, desc: '内联脚本存在打包/编码混淆' },
    { id: 'vmDetection', label: '沙箱探测/恶意代码', weight: 35, desc: '脚本探测虚拟机/沙箱，或含已知落地载荷特征' },
    { id: 'socialEngineering', label: '钓鱼诱导话术', weight: 24, desc: '出现「公检法/涉案/安全账户/内部通知」等诈骗剧本话术（软件站业态词与 QQ 群等社群词已降级为弱信号）' },
    { id: 'fakeOfficial', label: '假冒官方话术', weight: 16, desc: '非官方域名却使用"官方下载/安全下载"等话术' },
    { id: 'redirectIframe', label: '重定向/注入', weight: 25, desc: '存在外部 iframe 嵌套或 meta refresh 自动跳转' },
    { id: 'noahKit', label: 'NOAH 投递组件', weight: 50, desc: '内联脚本含 NOAH 运行时取链投递组件（多中继动态拉取 download_link，规避静态 URL 检测）' },
    { id: 'downloadRedirector', label: '极简自跳转下载页', weight: 45, desc: '空白页用 JS/meta 自跳转下载参数地址、服务端直接吐二进制附件，属银狐「瞬间下载」中转页' },
    { id: 'runtimeDownload', label: '运行时取链投递', weight: 50, desc: '内联脚本运行时从外部中继/配置动态拉取下载链接并创建隐藏锚点触发下载，与组件名/落地域名无关，通用识别此类投递手法' },
    { id: 'domainStructure', label: '可疑域名结构', weight: 20, desc: '使用高风险后缀或含无语义随机字符串段' },
    { id: 'brandedExe', label: '品牌仿冒安装包', weight: 40, desc: '下载链接文件名含品牌词且为可执行/压缩包，银狐木马化正版软件投递' },
    { id: 'brandedSoftSite', label: '品牌软件下载站', weight: 10, desc: '页面以某品牌软件名义提供下载。软件目录站/工具站的正常业态，仅作堆叠时的辅助弱信号' },
    { id: 'badPayloadName', label: '已知木马化投递物', weight: 45, desc: '下载链接文件名命中已知银狐木马化安装包（如 bzy.exe / shanlian_VPN_64.exe），样本静态分析确认的 IOC' },
    { id: 'payloadNamePattern', label: '可疑载荷文件名', weight: 40, desc: '下载文件名与 Windows 系统进程同名、双扩展名伪装、纯随机串或中文诱饵命名（正规站不会出现的命名形态）' },
    { id: 'passwordArchive', label: '带密码压缩包', weight: 26, desc: '网盘/压缩包分发并附解压密码，规避杀软查杀' },
    { id: 'lureTheme', label: '银狐诱饵主题', weight: 28, desc: '页面含税务稽查/补贴/违规记录等银狐高频投递主题，且含下载入口' },
    { id: 'fakeUpdate', label: '伪造更新提示', weight: 22, desc: '页面含"版本过低/请更新插件"等伪造更新诱导，疑似银狐手法' },
    { id: 'friendlyLinks', label: '友情链接异常', weight: 30, desc: '页脚友情链接区块含≥3个与本站品牌无关的大牌外链，疑似批量模板站/钓鱼伪装' },
    { id: 'doubleExt', label: '双扩展名伪装', weight: 30, desc: '下载链接使用 .pdf.exe 等双扩展名伪装成文档/压缩包' }
  ];

  const API = {
    analyze,
    isOfficialDomain,
    registerCloudOfficial,
    isTrustedPlatform,
    detectSpoof,
    extractIcp,
    classifyLink: IOCS.classifyLink,
    thresholds,
    CATEGORIES
  };

  if (typeof window !== 'undefined') window.SF_ANALYZER = API;
  if (typeof self !== 'undefined') self.SF_ANALYZER = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
