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

  const IOCS = (typeof window !== 'undefined')
    ? window.SF_IOCS
    : (typeof require !== 'undefined' ? require('./iocs') : {});

  // ============ 官方域名快速索引（精确 + 子域匹配）============
  const OFFICIAL_SET = new Set((IOCS.OFFICIAL_DOMAINS || []).map(d => d.toLowerCase()));

  function isOfficialDomain(hostname) {
    const h = (hostname || '').toLowerCase().replace(/^www\./, '');
    if (OFFICIAL_SET.has(h)) return true;
    for (const d of OFFICIAL_SET) {
      if (h.endsWith('.' + d)) return true;
    }
    return false;
  }

  // ============ 域名仿冒检测 ============
  const SPOOF_KEYWORDS = [...new Set((IOCS.BRAND_KEYWORDS || []).map(k => k.toLowerCase()))]
    .sort((a, b) => b.length - a.length);

  function _levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++)
      for (let j = 1; j <= a.length; j++)
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1));
    return m[b.length][a.length];
  }

  function detectSpoof(hostname) {
    const normalized = (hostname || '').toLowerCase().replace(/^www\./, '');
    const labels = normalized.split('.');
    const labelSegs = labels.map(l => l.split(/[-_]/));
    const allSegs = labelSegs.reduce((a, s) => a.concat(s), []);

    for (const kw of SPOOF_KEYWORDS) {
      // A. 精确段匹配
      for (const segs of labelSegs)
        for (const seg of segs)
          if (seg === kw) return { brand: kw, matchType: 'seg', detail: `域名段「${seg}」精确匹配品牌词「${kw}」` };
      // B. 子串包含（kw≥4）
      if (kw.length >= 4)
        for (const label of labels)
          if (label.includes(kw)) return { brand: kw, matchType: 'substr', detail: `域名标签「${label}」包含品牌词「${kw}」` };
      // C. 关键词堆叠
      let cnt = 0;
      for (const seg of allSegs) if (seg === kw) cnt++;
      if (cnt >= 3) return { brand: kw, matchType: 'stack', detail: `品牌词「${kw}」在域名中重复出现 ${cnt} 次` };
    }

    // D. 约束编辑距离（kw≥5, dist 1-2, 长度差≤2）
    for (const kw of SPOOF_KEYWORDS) {
      if (kw.length < 5) continue;
      for (const label of labels) {
        if (Math.abs(label.length - kw.length) > 2) continue;
        const d = _levenshtein(label, kw);
        if (d >= 1 && d <= 2) return { brand: kw, matchType: 'typo', detail: `域名「${label}」与品牌词「${kw}」编辑距离 ${d}（疑似 typo 仿冒）` };
      }
    }

    // 去连字符二次检测（覆盖 kn-wps、pay-pal-login 等）
    if (normalized.includes('-') || normalized.includes('_')) {
      const dh = normalized.replace(/[-_]/g, '');
      const dhLabels = dh.split('.');
      for (const kw of SPOOF_KEYWORDS) {
        for (const label of dhLabels)
          if (label.includes(kw)) return { brand: kw, matchType: 'dehyphen', detail: `去连字符后「${label}」含品牌词「${kw}」` };
      }
    }
    return null;
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
    const s = detectSpoof(data.hostname);
    return s ? mk(true, 45, '域名仿冒官方品牌', s.detail) : mk(false, 0, '域名仿冒官方品牌', '');
  }

  function detIcpMissing(data) {
    const icp = data.icp || {};
    const isCn = (data.hostname || '').toLowerCase().endsWith('.cn');
    const hasCJK = data.metrics && data.metrics.hasCJK;
    const spoof = detectSpoof(data.hostname);
    // 中国语境：.cn 域名 or 中文内容 or 仿冒中国品牌
    const chineseContext = isCn || hasCJK || !!spoof;
    if (!chineseContext) return mk(false, 0, '缺备案号(ICP)', '');
    if (icp.hasIcpNumber) return mk(false, 0, '缺备案号(ICP)', '');
    return mk(true, 50, '缺备案号(ICP)', '该站点疑似面向国内用户，但页面未找到 ICP 备案号（仿冒站典型特征）');
  }

  function detLowQuality(data) {
    const m = data.metrics || {};
    let w = 0; const bits = [];
    const elem = m.domElementCount || 0;
    const ext = m.externalResourceCount || 0;
    const framework = m.framework;
    if (elem < 150 && ext < 12) { w += 18; bits.push('页面元素极少(<' + elem + ')且无外部资源'); }
    if (!framework && elem < 300) { w += 12; bits.push('未使用主流前端框架'); }
    if (m.emojiDensity > 6 && (m.textLength || 0) < 900) { w += 15; bits.push('emoji 密度异常(' + m.emojiDensity + '‰)且正文短'); }
    if ((m.textLength || 0) < 220 && (data.links || []).some(l => IOCS.classifyLink && IOCS.classifyLink(l.href) !== 'other')) { w += 15; bits.push('极简页面却包含下载/跳转链接'); }
    if (ext < 3 && (data.links || []).some(l => { const c = IOCS.classifyLink && IOCS.classifyLink(l.href); return c === 'exec' || c === 'download'; })) { w += 20; bits.push('几乎无外部资源却直推可执行下载'); }
    return w > 0 ? mk(true, w, '低质量/AI生成痕迹', bits.join('；')) : mk(false, 0, '低质量/AI生成痕迹', '');
  }

  function detDirectExec(data) {
    const links = data.links || [];
    let execCount = 0, archCount = 0, withKw = 0;
    const lowerHtml = (data.html || '').toLowerCase();
    for (const l of links) {
      const c = IOCS.classifyLink ? IOCS.classifyLink(l.href) : 'other';
      if (c === 'exec') execCount++;
      if (c === 'archive') archCount++;
      if (c === 'download') withKw++;
    }
    const hasKw = (IOCS.DOWNLOAD_KEYWORDS || []).some(k => lowerHtml.includes(k.toLowerCase()));
    if (execCount > 0 && (hasKw || execCount > 1)) {
      const d = `发现 ${execCount} 个 .exe 直链` + (hasKw ? ' + 下载话术' : '');
      return mk(true, 22, '直链可执行文件', d);
    }
    if (archCount > 0 && hasKw) return mk(true, 18, '直链压缩包+下载话术', `发现 ${archCount} 个压缩包直链并含下载话术`);
    return mk(false, 0, '直链可执行文件', '');
  }

  function detCloudDisk(data) {
    const links = data.links || [];
    let n = 0;
    for (const l of links) {
      const c = IOCS.classifyLink ? IOCS.classifyLink(l.href) : 'other';
      if (c === 'cloud') n++;
    }
    // 也扫一下页面文本里的网盘域名
    const lowerHtml = (data.html || '').toLowerCase();
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
    const lower = scripts.join('\n').toLowerCase();
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
    const text = ((data.title || '') + ' ' + (data.html || '')).toLowerCase();
    let n = 0;
    for (const kw of (IOCS.SOCIAL_ENGINEERING || [])) if (text.includes(kw.toLowerCase())) n++;
    if (n > 0) return mk(true, Math.min(n * 6, 24), '钓鱼诱导话术', `命中 ${n} 处社工话术（如内部通知/补偿/验证码等）`);
    return mk(false, 0, '钓鱼诱导话术', '');
  }

  function detFakeOfficial(data) {
    if (isOfficialDomain(data.hostname)) return mk(false, 0, '假冒官方话术', '');
    const text = ((data.title || '') + ' ' + (data.html || '')).toLowerCase();
    let n = 0;
    for (const kw of (IOCS.FAKE_OFFICIAL || [])) if (text.includes(kw.toLowerCase())) n++;
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

  function detSuspiciousTld(data) {
    const h = (data.hostname || '').toLowerCase();
    const tld = h.split('.').pop();
    const inList = (IOCS.SUSPICIOUS_TLDS || []).includes(tld);
    // 随机串域名：单一长段由无语义字母数字混杂组成
    const labels = h.split('.');
    const randomish = labels.some(l => /^[a-z0-9]{10,}$/.test(l) && /[0-9]/.test(l) && /[a-z]/.test(l));
    if (inList || randomish) {
      const d = inList ? `域名使用高风险 TLD(.${tld})` : '域名含无语义随机字符串段';
      return mk(true, 20, '可疑域名结构', d);
    }
    return mk(false, 0, '可疑域名结构', '');
  }

  // ============ 灵敏度 → 阈值 ============
  function thresholds(sensitivity) {
    switch ((sensitivity || 'medium').toLowerCase()) {
      case 'low': return { warn: 55, danger: 95 };
      case 'high': return { warn: 20, danger: 40 };
      case 'medium':
      default: return { warn: 35, danger: 60 };
    }
  }

  const ALL = [
    { id: 'domainImpersonation', fn: detSpoof },
    { id: 'icpMissing', fn: detIcpMissing },
    { id: 'lowQuality', fn: detLowQuality },
    { id: 'execDownload', fn: detDirectExec },
    { id: 'cloudDiskDist', fn: detCloudDisk },
    { id: 'obfuscatedJs', fn: detObfuscation },
    { id: 'vmDetection', fn: detVm },
    { id: 'socialEngineering', fn: detSocial },
    { id: 'fakeOfficial', fn: detFakeOfficial },
    { id: 'redirectIframe', fn: detRedirect },
    { id: 'domainStructure', fn: detSuspiciousTld }
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

    // ---- 协议早退：非 http(s) 页面（file://、chrome://、edge://、about: 等）一律判安全 ----
    const _proto = (data.protocol || location.protocol || '').toLowerCase();
    if (_proto && _proto !== 'http:' && _proto !== 'https:') {
      return {
        score: 0, level: 'safe', detected: false, official: false, spoof: null,
        reasons: [{ label: '本地/内部页面', detail: '非 http(s) 协议（' + _proto + '），跳过银狐检测', weight: 0 }],
        features: {}, threshold: danger
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

    let score = 0;
    const reasons = [];
    const features = {};
    for (const cat of ALL) {
      if (enabled[cat.id] === false) continue; // 用户关闭的维度跳过
      let r;
      try { r = cat.fn(data) || { hit: false, weight: 0, label: cat.id, detail: '' }; }
      catch (e) { r = { hit: false, weight: 0, label: cat.id, detail: '' }; }
      features[cat.id] = r.hit;
      if (r.hit) { score += r.weight; reasons.push({ label: r.label, detail: r.detail, weight: r.weight }); }
    }

    let level = 'safe';
    if (score >= danger) level = 'danger';
    else if (score >= warn) level = 'warn';

    // ---- 组合信号升级：多个弱风险信号叠加时，银狐投递概率极高，强制 danger ----
    // 背景：真实银狐站常"做得像样"只命中 1~2 个弱特征，分数卡在 warn 区间却不拦截 → 漏报。
    // 规则：① 命中任一强特征，或 ② 国内无备案 + 其它弱特征，或 ③ 命中 ≥3 个弱特征 → 直接判危。
    const STRONG = ['domainImpersonation', 'execDownload', 'cloudDiskDist', 'obfuscatedJs', 'vmDetection'];
    const WEAK = ['icpMissing', 'lowQuality', 'fakeOfficial', 'socialEngineering', 'redirectIframe', 'domainStructure'];
    const strongHits = STRONG.filter(id => features[id]);
    const weakHits = WEAK.filter(id => features[id]);
    if (strongHits.length >= 1 && level !== 'danger') {
      level = 'danger';
      reasons.push({ label: '强风险特征组合', detail: '命中银狐强特征（' + strongHits.join('/') + '），判定为木马投递站', weight: 0 });
    } else if ((features.icpMissing && weakHits.length >= 2) || weakHits.length >= 3) {
      if (level !== 'danger') {
        level = 'danger';
        reasons.push({ label: '多项可疑特征组合', detail: '国内无备案或多弱可疑特征叠加，判定为高风险站', weight: 0 });
      }
    }

    return {
      score, level, detected: level === 'danger', official: false,
      spoof: detectSpoof(data.hostname),
      reasons, features, threshold: danger
    };
  }

  // 维度元信息（供设置面板渲染：开关、权重、说明）
  const CATEGORIES = [
    { id: 'domainImpersonation', label: '域名仿冒官方品牌', weight: 45, desc: '域名含品牌词/编辑距离近似且带下载入口，疑似仿冒官网' },
    { id: 'icpMissing', label: '缺备案号(ICP)', weight: 50, desc: '面向国内却无 ICP 备案号，仿冒站典型特征' },
    { id: 'lowQuality', label: '低质量/AI生成痕迹', weight: 20, desc: 'DOM 极简、无框架、emoji 异常，疑似批量复制/AI 生成站' },
    { id: 'execDownload', label: '直链可执行文件', weight: 22, desc: '页面存在 .exe/.msi 直链或压缩包+下载话术' },
    { id: 'cloudDiskDist', label: '网盘/云盘分发', weight: 30, desc: '通过阿里云盘/百度网盘等网盘跳转分发安装包' },
    { id: 'obfuscatedJs', label: 'JS 代码混淆', weight: 30, desc: '内联脚本存在打包/编码混淆' },
    { id: 'vmDetection', label: '沙箱探测/恶意代码', weight: 35, desc: '脚本探测虚拟机/沙箱，或含已知落地载荷特征' },
    { id: 'socialEngineering', label: '钓鱼诱导话术', weight: 24, desc: '出现"内部通知/补偿/验证码"等社工话术' },
    { id: 'fakeOfficial', label: '假冒官方话术', weight: 16, desc: '非官方域名却使用"官方下载/安全下载"等话术' },
    { id: 'redirectIframe', label: '重定向/注入', weight: 25, desc: '存在外部 iframe 嵌套或 meta refresh 自动跳转' },
    { id: 'domainStructure', label: '可疑域名结构', weight: 20, desc: '使用高风险后缀或含无语义随机字符串段' }
  ];

  const API = {
    analyze,
    isOfficialDomain,
    detectSpoof,
    extractIcp,
    classifyLink: IOCS.classifyLink,
    thresholds,
    CATEGORIES
  };

  if (typeof window !== 'undefined') window.SF_ANALYZER = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
