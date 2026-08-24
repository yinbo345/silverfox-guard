/*
 * background.js — 银狐防护后台 service worker
 * 职责：
 *   1) 初始化默认设置
 *   2) 接收内容脚本的「检测上报」，记录「被判定为危险的标签页」(dangerTabs) 与「用户已放行的站点」(releasedHosts)
 *   3) 拦截下载：★ 只有「发起下载的页面」本身被判定为危险且用户未放行时才拦，绝不全局误拦
 *   4) 接收「离开此网站」指令，直接关闭该标签页（不再跳百度）
 * 状态保存在 chrome.storage.session，可在 service worker 重启后存活（同一浏览器会话内有效）。
 */
'use strict';

importScripts('rules/iocs.js', 'rules/analyzer.js');

// 兼容 service worker（self，无 window）与内容脚本（window 隔离世界）两种上下文：
// iocs.js / analyzer.js 已同时挂到 self 与 window。兜底 stub 防止依赖缺失时崩溃。
const SF = self.SF_ANALYZER || (typeof window !== 'undefined' ? window.SF_ANALYZER : null) || {
  classifyLink: function () { return 'other'; },
  isOfficialDomain: function () { return false; },
  detectSpoof: function () { return null; }
};

// 用户在当前会话里「仍要下载」明确放行的下载 URL（避免重复拦截；SW 重启后清空，会重新询问，安全）
const allowedDownloads = new Set();

// 记录每个标签页最近一次「顶级导航」的 URL，用于检测「危险站 → 跳转新站」的银狐跳转链
const lastTopUrl = {};
// 记录每个标签页「本次导航前的上一跳」页面 URL（用于下载来源归属回退：
// 当跳转下载的 referrer/initiator 为空时，用上一跳页面定位真实来源，避免秒跳下载漏归）
const prevTopUrl = {};
// 记录每次顶级导航「提交完成」的时间戳，用于识别「点进即下载 / 服务端强制下载」的自动下载竞速
const navCommitTime = {};
// 自动下载判定窗口：页面提交后该时间窗内发起的高危文件下载，视为「自动下载」而非用户手动点击
const AUTO_WINDOW_MS = 1500;

// 分析闸门：标签页「检测未出结果前默认拒绝下载」的状态机
//   analyzing = 已加载、内容脚本尚未回传判定 → 该标签全部下载先取消挂起
//   safe      = 已判定安全 → 挂起下载静默重下，后续下载直接放行
//   danger    = 已判定危险 → 挂起下载保持取消并弹警告，后续下载按危险拦截
const analysisState = {};
const heldDownloads = {};       // tabId -> [{id,url,filename}]
const reissuedUrls = new Set(); // 判安后已静默重下的 URL，避免 onCreated 二次闸控
const analysisTimers = {};      // tabId -> 超时兜底句柄
const ANALYSIS_TIMEOUT_MS = 4000; // 内容脚本异常/畸形页时失效开放，按安全放行

// 性能优化：模块级复用正则，避免重复编译
const WWW_RE = /^www\./;

const DEFAULTS = {
  enabledGlobal: true, showWarning: true, autoBlockDownloads: true, notify: true, sensitivity: 'medium',
  aiPersona: 'balanced',   // AI 助手性格档：'balanced' 均衡 | 'efficient' 高效 | 'gentle' 温柔 | 'pro' 严谨 | 'humorous' 幽默
  remindMode: 'normal',    // 扩展整体报读/提醒偏好：'normal' 正常（危险告警 + 适度主动提示）| 'quiet' 安静（仅危险告警，不弹软提示/主动建议）
  oobeDone: false,         // 首次引导（OOBE）是否已完成
  // ICP 备案权威核验总开关：关闭后完全不向第三方备案接口发起任何请求，
  // 备案判定退回「仅扫描页面文本」的旧行为（判定更保守，但零外部请求）。
  icpApiVerify: true,
  enabled: {
    knownIoc: true, vmDetection: true, domainImpersonation: true, execDownload: true,
    cloudDiskDist: true, obfuscatedJs: true, fakeOfficial: true,
    socialEngineering: true, domainStructure: true, redirectIframe: true
  },
  allowlist: [], customKeywords: [], customBadDomains: []
};

// ===== 会话级状态（service worker 重启不丢）=====
function loadState() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.session.get({ dangerTabs: {}, releasedHosts: {} }, function (s) {
        resolve({ dangerTabs: s.dangerTabs || {}, releasedHosts: s.releasedHosts || {} });
      });
    } catch (e) { resolve({ dangerTabs: {}, releasedHosts: {} }); }
  });
}
function saveState(state) {
  try { chrome.storage.session.set({ dangerTabs: state.dangerTabs, releasedHosts: state.releasedHosts }); } catch (e) {}
}

// 内存缓存：下载拦截等高频路径每次都读 storage.sync，service worker 冷启动后首次读即缓存，
// 之后同步返回；监听 storage.onChanged 在设置变更时失效，确保 options 页改动即时生效。
let _settingsCache = null;
function getSettings() {
  if (_settingsCache) return Promise.resolve(_settingsCache);
  return new Promise(function (resolve) {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      _settingsCache = Object.assign({}, DEFAULTS, s || {});
      resolve(_settingsCache);
    });
  });
}
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' && _settingsCache) _settingsCache = null; // 任意 sync 设置变更 → 下次 getSettings 重新拉取
  });
}

function parseHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}

function hostMatch(host, list) {
  host = (host || '').toLowerCase();
  return (list || []).some(function (d) {
    d = String(d).trim().toLowerCase();
    return d && (host === d || host.endsWith('.' + d));
  });
}

// 注册域（eTLD+1），含 .com.cn / .net.cn 等二级后缀——域名年龄查询需对「注册域名」取 WHOIS/RDAP，
// 不能对完整子域名（如 www.xxx.com）查，否则查不到。
function _regDomain(host) {
  if (!host) return '';
  host = String(host).toLowerCase().replace(WWW_RE, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const two = ['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'co.uk', 'com.au', 'com.tw', 'co.jp'];
  if (parts.length >= 3 && two.includes(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// 硬编码银狐木马投递站黑名单（与页面级「已知银狐木马站点」判定同源，来自 iocs.js KNOWN_BAD_DOMAINS）。
// 专门用于下载拦截：命中「下载 URL 域名」或「来源/referrer 域名」即视为已知恶意，下载须强制取消（永不豁免）。
// 背景：此前 onCreated 只查用户自定义黑名单 customBadDomains，漏掉了硬编码名单里的投递站，
//       导致这类站点的 ZIP/EXE 在被页面级标记危险后，下载仍可能放行。
const _KNOWN_BAD_HOSTS = (function () {
  const list = (self.SF_IOCS && self.SF_IOCS.KNOWN_BAD_DOMAINS) || [];
  return list.map(function (d) { return String(d).trim().toLowerCase(); });
})();
function isKnownBadHost(h) {
  h = (h || '').toLowerCase();
  return _KNOWN_BAD_HOSTS.some(function (d) { return d && (h === d || h.endsWith('.' + d)); });
}

// 判断本次下载的「发起页面」是否为危险且未放行，并返回命中的标签页 id 列表
function sourceHostOf(item, state) {
  const dt = state.dangerTabs || {};
  // 1) 直接由该标签页发起
  if (item.tabId && item.tabId >= 0 && dt[item.tabId] && !dt[item.tabId].released) {
    return { host: dt[item.tabId].hostname, tabIds: [item.tabId] };
  }
  // 2) 由 referrer / initiator 页面发起（网页 JS 触发的下载 item.tabId 常为 -1）
  const src = item.initiator || item.referrer || '';
  let h = '';
  try { h = new URL(src).hostname.toLowerCase(); } catch (e) {}
  if (h) {
    if (state.releasedHosts && state.releasedHosts[h]) return { host: '', tabIds: [] }; // 用户已完全放行
    const tabIds = [];
    for (const id in dt) {
      if (!dt[id].released && dt[id].hostname === h) tabIds.push(Number(id));
    }
    if (tabIds.length) return { host: h, tabIds };
  }
  return { host: '', tabIds: [] };
}

// 高危文件类型（银狐木马载体）：直链可执行 + 压缩包 + 网盘分发
function isHighRiskFile(url) {
  const t = (SF && SF.classifyLink) ? SF.classifyLink(url) : 'other';
  return t === 'exec' || t === 'archive' || t === 'cloud';
}

// Chrome 自带 Safe Browsing 的「恶意」判定值（免费加成，用之拦截已知恶意下载）
//   content = 下载的文件已知为恶意；url = 下载网址已知含恶意；host = 来源主机已知分发恶意二进制
// 故意不含 'uncommon'(罕见文件) 与 'unwanted'(潜在不需要)，避免误拦正常新发布软件造成误伤。
function isMaliciousDanger(danger) {
  return danger === 'content' || danger === 'url' || danger === 'host';
}

// 推断本次下载的「来源页面」域名（优先 initiator/referrer，回退到本标签最近一次顶级导航）
function downloadSourceHost(item) {
  const src = item.initiator || item.referrer || '';
  let h = '';
  try { h = new URL(src).hostname.toLowerCase(); } catch (e) {}
  // 回退：referrer/initiator 为空时，用本标签「当前/上一跳」顶级导航页面定位来源
  // （meta refresh 秒跳下载常不带 referrer，但其发起页仍在导航历史里）
  if (!h && item.tabId && item.tabId >= 0) {
    const cand = lastTopUrl[item.tabId] || prevTopUrl[item.tabId] || '';
    if (cand) { try { h = new URL(cand).hostname.toLowerCase(); } catch (e) {} }
  }
  return h;
}

// 将标签页标记为「跳转链污染」（可被内容脚本在判定无害时通过 sf-clear-chain 自动清除）
function markTainted(item, host, state) {
  const tabId = item.tabId;
  if (tabId == null || tabId < 0) return;
  const h = (host || '').toLowerCase();
  const prev = state.dangerTabs[tabId];
  if (!prev || !prev.released) {
    state.dangerTabs[tabId] = { hostname: h || (prev && prev.hostname) || '', released: false, chained: true };
    saveState(state);
  }
}

// 本标签页是否处于「跳转链污染」状态（曾由已判定的危险站跳转而来，且用户未放行）
function isTainted(state, tabId) {
  const t = state.dangerTabs && state.dangerTabs[tabId];
  return !!(t && !t.released && t.chained);
}

chrome.runtime.onInstalled.addListener(function (details) {
  chrome.storage.sync.get(DEFAULTS, function (s) {
    chrome.storage.sync.set(Object.assign({}, DEFAULTS, s || {}));
  });
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, function (r) {
    if (!r.stats) chrome.storage.local.set({ stats: { warnings: 0, blocks: 0, recent: [] } });
  });
  // 首次安装 → 打开 OOBE 首次引导向导（取代旧的「加载成功」欢迎页）
  if (details.reason === 'install') {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('ui/oobe.html') }); } catch (e) {}
  } else if (details.reason === 'update') {
    // 老用户升级：默认视为已完成引导，避免强制弹向导（全新用户走 install 分支）
    chrome.storage.sync.get({ oobeDone: false }, function (s) {
      if (!s.oobeDone) chrome.storage.sync.set({ oobeDone: true });
    });
  }
});

// ===== 危险弹窗系统通知（Windows 右下角 toast）=====
// 由内容脚本（content.js 的 sfNotify）在命中危险时发 sf-notify 消息，后台用
// chrome.notifications 创建原生系统通知。相比声音提示更可靠，无需用户手势解锁。

// ===== 域名年龄查询（RDAP，异步，带缓存与超时）=====
// ① 用 rdap.org 公共引导服务（自动 302 跳转到权威 RDAP 服务器，支持 CORS），
//    无需依赖任何第三方代理，避免不可控外部依赖。
// ② 解析 events 中 eventAction==='registration' 的 eventDate 计算注册天数。
// ③ 失败（网络/CORS/该后缀不支持 RDAP/无注册事件）→ 返回 null，由评分引擎「无数据时优雅跳过」，
//    绝不因查不到而误判（沿用此前「域名年龄维度就绪待数据」的设计）。
// ④ 内存缓存查询结果（同会话内不重复查询），并限制缓存规模。
const _ageCache = new Map(); // regDomain -> {days:number|null, ts:number}
const _AGE_TTL = 6 * 60 * 60 * 1000; // 6 小时
function _ageCacheGet(domain) {
  const e = _ageCache.get(domain);
  if (e && (Date.now() - e.ts) < _AGE_TTL) return e.days;
  return undefined; // undefined=未缓存；null=已查无数据
}
function _ageCacheSet(domain, days) {
  _ageCache.set(domain, { days: days, ts: Date.now() });
  if (_ageCache.size > 500) { // 防止无界增长
    const first = _ageCache.keys().next().value;
    if (first !== undefined) _ageCache.delete(first);
  }
}
async function queryDomainAge(domain) {
  if (!domain) return null;
  const cached = _ageCacheGet(domain);
  if (cached !== undefined) return cached;
  let days = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 6000);
    const resp = await fetch('https://rdap.org/domain/' + encodeURIComponent(domain), {
      redirect: 'follow', signal: ctrl.signal, cache: 'no-store'
    });
    clearTimeout(timer);
    if (resp.ok) {
      const j = await resp.json();
      const events = (j && j.events) || [];
      for (const ev of events) {
        if (ev && ev.eventAction === 'registration' && ev.eventDate) {
          const t = new Date(ev.eventDate).getTime();
          if (!isNaN(t)) {
            const ms = Date.now() - t;
            days = ms < 0 ? 0 : Math.floor(ms / 86400000);
            break;
          }
        }
      }
    }
  } catch (e) { /* RDAP 不可用则保持 null，优雅跳过 */ }
  _ageCacheSet(domain, days);
  return days;
}

// ===== 下载黑名单：被拦下载的载荷域名自动入库 + 跨站复用 =====
// 银狐的运营模式是「一次性落地页 + 复用载荷 CDN」：landing 域名批量换（今天 wps-xz.top、
// 明天 wps-dl.icu），但真正投木马的那个下载域名/对象存储桶往往连用几十个站。
// 因此每次真正取消一个下载时，就把该「下载文件所在注册域名」记下来；
// 下次任何页面（哪怕是全新未判危的落地页）指向同一载荷域名，即可立刻加分甚至直接拦，
// 无需重新把落地页判危一遍 —— 这就是「跨站复用」的价值。
//
// 防误伤三重保险（任何一条命中都不入库）：
//   ① 可信分发域名（GitHub / 微软 / npm / 各发行版镜像等 37 个，见 iocs.js TRUSTED_DOWNLOAD_HOSTS）；
//   ② 品牌官方域名（OFFICIAL_DOMAINS）；
//   ③ 用户信任白名单（settings.allowlist）。
// 另加：90 天自动过期、上限 500 条按最近命中时间淘汰、设置页可逐条删除或一键清空。
const DL_BL_KEY = 'dlBlacklist';
const DL_BL_TTL = 90 * 24 * 60 * 60 * 1000; // 90 天未再命中即过期移除
const DL_BL_MAX = 500;
let _dlBl = null;          // { domain: { first, last, hits, sample, from } }
let _dlBlLoading = null;

function _dlBlLoad() {
  if (_dlBl) return Promise.resolve(_dlBl);
  if (_dlBlLoading) return _dlBlLoading;
  _dlBlLoading = new Promise(function (resolve) {
    try {
      chrome.storage.local.get({ [DL_BL_KEY]: {} }, function (r) {
        _dlBl = (r && r[DL_BL_KEY]) || {};
        _dlBlPrune();
        resolve(_dlBl);
      });
    } catch (e) { _dlBl = {}; resolve(_dlBl); }
  });
  return _dlBlLoading;
}
function _dlBlSave() {
  try { chrome.storage.local.set({ [DL_BL_KEY]: _dlBl || {} }); } catch (e) {}
}
// 过期清理 + 超量淘汰（按 last 最近命中时间保留）
function _dlBlPrune() {
  if (!_dlBl) return false;
  const now = Date.now();
  let changed = false;
  for (const d in _dlBl) {
    const e = _dlBl[d];
    if (!e || !e.last || (now - e.last) > DL_BL_TTL) { delete _dlBl[d]; changed = true; }
  }
  const keys = Object.keys(_dlBl);
  if (keys.length > DL_BL_MAX) {
    keys.sort(function (a, b) { return (_dlBl[b].last || 0) - (_dlBl[a].last || 0); });
    keys.slice(DL_BL_MAX).forEach(function (k) { delete _dlBl[k]; });
    changed = true;
  }
  if (changed) _dlBlSave();
  return changed;
}
// 是否受保护（绝不入库）
function _dlBlProtected(host, settings) {
  const h = (host || '').toLowerCase();
  if (!h) return true;
  const trusted = (self.SF_IOCS && self.SF_IOCS.TRUSTED_DOWNLOAD_HOSTS) || [];
  if (hostMatch(h, trusted)) return true;
  try { if (SF && SF.isOfficialDomain && SF.isOfficialDomain(h)) return true; } catch (e) {}
  if (settings && hostMatch(h, settings.allowlist)) return true;
  return false;
}
// 记一次拦截：只记「下载文件所在的注册域名」（载荷域名），落地页域名仅作来源元数据留档
function dlBlacklistAdd(downloadHost, meta) {
  const h = (downloadHost || '').toLowerCase();
  if (!h) return;
  return Promise.all([_dlBlLoad(), getSettings()]).then(function (arr) {
    const settings = arr[1];
    if (_dlBlProtected(h, settings)) return;
    const dom = _regDomain(h);
    if (!dom) return;
    const now = Date.now();
    const cur = _dlBl[dom];
    if (cur) {
      cur.last = now;
      cur.hits = (cur.hits || 1) + 1;
      if (meta && meta.from && cur.from !== meta.from) cur.from = meta.from;
    } else {
      _dlBl[dom] = {
        first: now, last: now, hits: 1,
        sample: (meta && meta.filename) ? String(meta.filename).slice(0, 80) : '',
        from: (meta && meta.from) ? String(meta.from).slice(0, 120) : ''
      };
    }
    _dlBlPrune();
    _dlBlSave();
  }).catch(function () {});
}
// 命中查询（按注册域名匹配，含全部子域名）
function dlBlacklistHas(host) {
  if (!_dlBl) return false;                 // 未加载完成时保守返回 false（不误拦）
  const dom = _regDomain((host || '').toLowerCase());
  return !!(dom && _dlBl[dom]);
}
function dlBlacklistDomains() {
  return _dlBlLoad().then(function () { return Object.keys(_dlBl || {}); });
}
// service worker 一启动就预热，保证 downloads.onCreated（同步判断）能立即查到黑名单
try { _dlBlLoad(); } catch (e) {}

// ===== ICP 备案「权威核验」（多源 API + 24h 缓存 + 限流 + 超时）=====
// 背景：只扫「页面文本里的备案号」两头都会错——
//   ① 大量合法国内站点并不在页面上展示备案号 → 被误判「无备案」而白白加分；
//   ② 钓鱼站盗用他人备案号写在页脚 → 反被误判「合规」而放行（app-4399.com.cn 即此类）。
// 因此改为按域名调权威备案接口核验，页面文本扫描降级为兜底。
//
// 返回三态（缺一不可，判定逻辑见 analyzer.js 的 detIcpMissing / detIcpStolen）：
//   { queried:true,  hasIcp:true  } → 该域名确有备案主体 → 联动跳过仿冒类判定
//   { queried:true,  hasIcp:false } → 权威确认「本域名无备案」→ 页面若仍显示备案号即为盗用，重罚
//   { queried:false }              → 接口失败/限流/超时 → 回退页面文本扫描，绝不凭此加分
//
// ★ 隐私控制：本查询会把「注册域名」发给第三方备案接口，因此**绝不对所有站点查询**。
//   仅在 content.js 判定「确有核验价值」时才发起（详见 content.js needIcpVerify 门控）：
//   页面出现备案号需验真伪 / .cn 站点未找到备案号 / 已检出域名仿冒。
//   其余站点（绝大多数海外站与普通站）完全不触发任何外部请求。
const _icpCache = new Map();          // regDomain -> { r:{...}, ts:number }
const _ICP_TTL = 24 * 60 * 60 * 1000; // 成功结果缓存 24 小时
const _ICP_FAIL_TTL = 5 * 60 * 1000;  // 失败短缓存，避免高频重试打爆公共接口
const _icpRateWindow = new Map();     // providerName -> [请求时间戳...]

const ICP_PROVIDERS = [
  {
    name: 'uapis', rateLimitPerMin: 0,
    buildUrl: function (d) { return 'https://uapis.cn/api/v1/network/icp?domain=' + encodeURIComponent(d); },
    // 有备案：{"code":200,"serviceLicence":"京ICP备xxxxxxx号","unitName":"..."}
    // 无备案：{"code":200,"serviceLicence":"查询失败","unitName":"查询失败"}
    // ⚠️ 查不到时它仍返回 code:200，必须靠「是否含 ICP备/ICP证」区分真实备案号与失败文案，
    //    否则会把无备案的外国站误判成 hasIcp:true，直接放行造成漏检。
    parse: function (d) {
      const lic = (d && typeof d.serviceLicence === 'string') ? d.serviceLicence.trim() : '';
      if (d && (d.code === 200 || d.code === '200') && /ICP[备证]/.test(lic)) {
        return { hasIcp: true, icpNumber: lic, unitName: (d.unitName && d.unitName !== '查询失败') ? d.unitName : '' };
      }
      return { hasIcp: false };
    }
  },
  {
    // 公开 demo 凭据，上游可能随时撤销；撤销后本源静默失败并回退首源/页面扫描，不影响判定安全性
    name: 'apihz', rateLimitPerMin: 10, id: '88888888', key: '88888888',
    buildUrl: function (d, c) {
      return 'https://cn.apihz.cn/api/wangzhan/icp.php?id=' + encodeURIComponent(c.id) +
             '&key=' + encodeURIComponent(c.key) + '&domain=' + encodeURIComponent(d);
    },
    // 有备案：{"code":200,"icp":"蜀ICP备xxx号","unit":"..."} / 无备案：{"code":400,"msg":"查询失败或没有备案。"}
    parse: function (d) {
      const lic = (d && typeof d.icp === 'string') ? d.icp.trim() : '';
      if (d && (d.code === 200 || d.code === '200') && /ICP[备证]/.test(lic)) {
        return { hasIcp: true, icpNumber: lic, unitName: (d.unit && d.unit !== '查询失败') ? d.unit : '' };
      }
      return { hasIcp: false };
    }
  }
];

// 令牌桶：60 秒滑动窗口内限制单源请求数，超限则本周期跳过该源
function _icpAcquire(p) {
  const limit = p.rateLimitPerMin || 0;
  if (!limit) return true;
  const now = Date.now();
  const recent = (_icpRateWindow.get(p.name) || []).filter(function (t) { return now - t < 60000; });
  _icpRateWindow.set(p.name, recent);
  if (recent.length >= limit) return false;
  recent.push(now);
  return true;
}

function _icpCacheGet(domain) {
  const e = _icpCache.get(domain);
  if (!e) return undefined;
  const ttl = e.r && e.r.queried ? _ICP_TTL : _ICP_FAIL_TTL;
  if (Date.now() - e.ts < ttl) return e.r;
  return undefined;
}
function _icpCacheSet(domain, r) {
  _icpCache.set(domain, { r: r, ts: Date.now() });
  if (_icpCache.size > 500) { // 防止无界增长
    const first = _icpCache.keys().next().value;
    if (first !== undefined) _icpCache.delete(first);
  }
}

async function queryIcp(domain) {
  if (!domain) return { queried: false, hasIcp: false };
  const cached = _icpCacheGet(domain);
  if (cached !== undefined) return cached;

  for (const p of ICP_PROVIDERS) {
    if (!_icpAcquire(p)) continue;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 8000);
      const resp = await fetch(p.buildUrl(domain, p), { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (!text) continue;
      let data;
      try { data = JSON.parse(text); } catch (e) { continue; } // 非 JSON（如接口改版/返回 HTML）→ 换下一源
      const parsed = p.parse(data) || { hasIcp: false };
      const result = {
        queried: true,
        hasIcp: !!parsed.hasIcp,
        icpNumber: parsed.icpNumber || null,
        unitName: parsed.unitName || null,
        service: p.name
      };
      _icpCacheSet(domain, result);
      return result;
    } catch (e) { continue; } // 超时/网络错误 → 换下一源
  }
  const failed = { queried: false, hasIcp: false };
  _icpCacheSet(domain, failed); // 失败按 _ICP_FAIL_TTL 短缓存
  return failed;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  // ===== AI 浮球请求打开设置子页面（content script 无 tabs 权限时的兜底通道）=====
  if (msg.type === 'SF_OPEN_OPTIONS_SECTION') {
    try {
      const sec = (msg.section || 'general');
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html') + '#sec=' + encodeURIComponent(sec), active: true });
      try { sendResponse({ ok: true }); } catch (e) {}
    } catch (e) {
      try { sendResponse({ ok: false }); } catch (e2) {}
    }
    return true;
  }

  // ===== 后台自动 AI 网页分析：content 随页面加载上报文本，background 调云端 AI 按规则清单判断 =====
  if (msg.type === 'sf-ai-analyze') {
    handleAiPageAnalyze(msg, sender).then(function (res) {
      try { sendResponse(res); } catch (e) {}
    }).catch(function (err) {
      try { sendResponse({ ok: false, err: (err && err.message) || '分析失败' }); } catch (e2) {}
    });
    return true; // 异步 sendResponse
  }

  // ===== 银狐扫描文件 AI 辅助分析：scanner 上报本地提取的可疑特征摘要，background 调云端 AI 判断 =====
  if (msg.type === 'sf-ai-analyze-file') {
    handleAiFileAnalyze(msg, sender).then(function (res) {
      try { sendResponse(res); } catch (e) {}
    }).catch(function (err) {
      try { sendResponse({ ok: false, err: (err && err.message) || '分析失败' }); } catch (e2) {}
    });
    return true; // 异步 sendResponse
  }

  if (msg.type === 'sf-icp-verify') {
    // 内容脚本仅在「确有核验价值」时才询问本页域名的权威备案状态
    if (!msg.hostname) { try { sendResponse({ queried: false, hasIcp: false }); } catch (e) {} return true; }
    const dom = _regDomain((msg.hostname || '').toLowerCase().replace(WWW_RE, ''));
    getSettings().then(function (settings) {
      // 总开关关闭 → 不发任何外部请求，调用方回退页面文本扫描
      if (settings.icpApiVerify === false) return { queried: false, hasIcp: false };
      return queryIcp(dom);
    }).then(function (r) {
      try { sendResponse(r || { queried: false, hasIcp: false }); } catch (e) {}
    }).catch(function () {
      try { sendResponse({ queried: false, hasIcp: false }); } catch (e) {}
    });
    return true; // 异步 sendResponse
  }

  // ===== 下载黑名单（#16）通道 =====
  if (msg.type === 'sf-dl-blacklist') {
    // 内容脚本取全量载荷域名列表（纯本地读取，无外部请求），用于给页面下载链接加分
    dlBlacklistDomains().then(function (domains) {
      try { sendResponse({ domains: domains || [] }); } catch (e) {}
    }).catch(function () { try { sendResponse({ domains: [] }); } catch (e) {} });
    return true;
  }
  if (msg.type === 'sf-dl-bl-list') {
    // 设置页取带元数据的完整列表（便于用户核查与逐条删除）
    _dlBlLoad().then(function () {
      const out = Object.keys(_dlBl || {}).map(function (d) {
        return Object.assign({ domain: d }, _dlBl[d]);
      }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
      try { sendResponse({ items: out }); } catch (e) {}
    }).catch(function () { try { sendResponse({ items: [] }); } catch (e) {} });
    return true;
  }
  if (msg.type === 'sf-dl-bl-remove') {
    _dlBlLoad().then(function () {
      const d = (msg.domain || '').toLowerCase();
      if (d && _dlBl[d]) { delete _dlBl[d]; _dlBlSave(); }
      try { sendResponse({ ok: true }); } catch (e) {}
    }).catch(function () { try { sendResponse({ ok: false }); } catch (e) {} });
    return true;
  }
  if (msg.type === 'sf-dl-bl-clear') {
    _dlBl = {}; _dlBlSave();
    try { sendResponse({ ok: true }); } catch (e) {}
    return true;
  }

  if (msg.type === 'sf-domain-age') {
    // 内容脚本在分析前询问本页域名的注册天数；异步返回 {days:number|null}
    const host = (msg.hostname || '').toLowerCase().replace(WWW_RE, '');
    const dom = _regDomain(host);
    queryDomainAge(dom).then(function (days) {
      try { sendResponse({ days: (typeof days === 'number') ? days : null }); } catch (e) {}
    }).catch(function () {
      try { sendResponse({ days: null }); } catch (e) {}
    });
    return true; // 异步 sendResponse
  }

  if (msg.type === 'sf-detected') {
    updateStats(msg.data);
    // 仅当被判为 danger 时记录该标签页，用于下载拦截判定
    if (msg.data && msg.data.level === 'danger' && sender.tab && sender.tab.id != null) {
      loadState().then(function (state) {
        const prev = state.dangerTabs[sender.tab.id];
        state.dangerTabs[sender.tab.id] = {
          hostname: (msg.data.hostname || '').toLowerCase(),
          released: false,
          chained: !!(prev && prev.chained) // 保留跳转链污染标记
        };
        saveState(state);
      });
    }
  } else if (msg.type === 'sf-verdict') {
    // 内容脚本回传「分析闸门」判定：danger=保持取消挂起下载；safe/warn=静默重下挂起下载
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId != null) resolveAnalysis(tabId, msg.level);
  } else if (msg.type === 'sf-check-chain') {
    // 内容脚本询问：本标签页是否由已判定危险站跳转而来
    const tabId = sender.tab ? sender.tab.id : null;
    loadState().then(function (state) {
      sendResponse({ chained: isTainted(state, tabId) });
    });
    return true; // 异步 sendResponse，必须返回 true
  } else if (msg.type === 'sf-clear-chain') {
    // 内容脚本判定本页完全无辜（真官网/有备案/无下载入口）→ 清除跳转链污染，避免误拦
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId != null) {
      loadState().then(function (state) {
        const t = state.dangerTabs[tabId];
        if (t && t.chained && !t.released) { delete state.dangerTabs[tabId]; saveState(state); }
      });
    }
  } else if (msg.type === 'sf-release') {
    const host = (msg.hostname || '').toLowerCase();
    const tabId = sender.tab ? sender.tab.id : null;
    loadState().then(function (state) {
      if (tabId != null && state.dangerTabs[tabId]) state.dangerTabs[tabId].released = true;
      if (host) state.releasedHosts[host] = true;
      saveState(state);
    });
  } else if (msg.type === 'sf-leave') {
    // 直接关闭触发该消息的标签页；关不掉（如最后一个标签）则退到新标签页
    if (sender.tab && sender.tab.id != null) {
      const tid = sender.tab.id;
      chrome.tabs.remove(tid, function () {
        if (chrome.runtime.lastError) {
          try { chrome.tabs.update(tid, { url: 'chrome://newtab/' }); } catch (e) {}
        }
      });
    }
  } else if (msg.type === 'sf-allow-download') {
    // 用户选择「仍要下载」：将该 URL 加入本次会话放行名单（避免重复拦截）
    const url = msg && msg.url;
    if (url) {
      allowedDownloads.add(url);
      // 仅当来自「后台大弹窗」(下载已被取消) 时才由后台重新触发下载；
      // 来自「页面内钩子」(fromPage) 时由页面自身执行下载，后台不必重下，避免双下载。
      if (!msg.fromPage && chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download({ url: url }, function () {
          if (chrome.runtime.lastError) {
            // 无法直接重下（如 blob / 需站内鉴权），提示前台让用户手动在站内下载
            try {
              if (sender.tab && sender.tab.id != null && chrome.tabs && chrome.tabs.sendMessage)
                chrome.tabs.sendMessage(sender.tab.id, { type: 'sf-download-allow-failed', url });
            } catch (e2) {}
          }
        });
      }
    }
  } else if (msg.type === 'sf-notify') {
    // 危险弹窗系统通知（Windows 右下角 toast）：内容脚本转发，后台创建原生通知
    try {
      if (chrome.notifications && chrome.notifications.create) {
        const nid = 'sf-' + Date.now();
        chrome.notifications.create(nid, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: (msg.title || '⚠️ 银狐防护提醒'),
          message: (msg.message || '发现高风险网站'),
          priority: 1,
          requireInteraction: false
        }, function () {});
        // 兜底：无论系统通知设置如何，10 秒后强制清除，避免 toast 常驻右下角
        setTimeout(function () {
          try { chrome.notifications.clear(nid, function () {}); } catch (e) {}
        }, 10000);
      }
    } catch (e) {}
  }
});

function updateStats(data) {
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, function (r) {
    const stats = r.stats || { warnings: 0, blocks: 0, recent: [] };
    stats.warnings += 1;
    const recent = stats.recent || [];
    recent.unshift({ hostname: data.hostname, score: data.score, level: data.level, time: data.time });
    stats.recent = recent.slice(0, 30);
    chrome.storage.local.set({ stats });
  });
}

// ===== 分析闸门：默认拒绝（检测未出前先堵死该标签全部下载）=====
function holdDownload(tabId, item) {
  if (!heldDownloads[tabId]) heldDownloads[tabId] = [];
  heldDownloads[tabId].push({ id: item.id, url: item.url, filename: item.filename });
  // 静默取消并擦除，避免下载栏出现「已取消」残影；判安后再静默重下
  try { chrome.downloads.cancel(item.id); } catch (e) {}
  try { chrome.downloads.erase(item.id); } catch (e) {}
}
function flushHeld(tabId) {
  const held = heldDownloads[tabId];
  if (!held || !held.length) return;
  delete heldDownloads[tabId];
  held.forEach(function (h) {
    if (!h.url) return;
    // blob:/data: 无法用 URL 静默重下 → 提示用户手动重新点击
    if (/^(blob:|data:)/i.test(h.url)) {
      try { if (chrome.tabs && chrome.tabs.sendMessage) chrome.tabs.sendMessage(tabId, { type: 'sf-download-allow-failed', url: h.url }); } catch (e2) {}
      return;
    }
    reissuedUrls.add(h.url);
    try { chrome.downloads.download({ url: h.url, filename: h.filename || '', saveAs: false }); } catch (e) {}
  });
}
function resolveAnalysis(tabId, level) {
  if (analysisTimers[tabId]) { clearTimeout(analysisTimers[tabId]); delete analysisTimers[tabId]; }
  const danger = (level === 'danger');
  analysisState[tabId] = danger ? 'danger' : 'safe';
  if (danger) {
    // 危险：保持取消已挂起下载，并向该标签弹警告
    const held = heldDownloads[tabId];
    if (held && held.length) {
      held.forEach(function (h) {
        // 闸门挂起期间的下载在判危后等同于「已拦截」，其载荷域名同样入库（#16）
        try { dlBlacklistAdd(parseHost(h.url), { filename: h.filename, from: lastTopUrl[tabId] ? parseHost(lastTopUrl[tabId]) : '' }); } catch (e) {}
        try { if (chrome.tabs && chrome.tabs.sendMessage) chrome.tabs.sendMessage(tabId, { type: 'sf-download-blocked', host: parseHost(h.url), url: h.url, filename: h.filename }); } catch (e) {}
      });
    }
    delete heldDownloads[tabId];
  } else {
    flushHeld(tabId); // 安全：静默重下挂起下载
  }
}
function armAnalysis(tabId) {
  analysisState[tabId] = 'analyzing';
  if (analysisTimers[tabId]) clearTimeout(analysisTimers[tabId]);
  analysisTimers[tabId] = setTimeout(function () {
    if (analysisState[tabId] === 'analyzing') {
      analysisState[tabId] = 'safe';
      flushHeld(tabId); // 失效开放：内容脚本无回应也按安全放行挂起下载
    }
    delete analysisTimers[tabId];
  }, ANALYSIS_TIMEOUT_MS);
}

// ===== 拦截下载：仅拦「危险且未放行站点」发起的下载 =====
if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(function (item) {
    if (!item || !item.url) return;
    // 判安后静默重下的下载（原被闸门挂起者）→ 直接放行，不再二次闸控
    if (reissuedUrls.has(item.url)) { reissuedUrls.delete(item.url); return; }
    // 本次下载用户已明确「仍要下载」→ 直接放行（避免重复拦截）
    if (allowedDownloads.has(item.url)) return;
    // 浏览器扩展自身（byExtensionId）发起的下载，一律跳过，避免误拦
    if (item.byExtensionId) return;
    const host = parseHost(item.url);
    getSettings().then(function (settings) {
      if (!settings.enabledGlobal || !settings.autoBlockDownloads) return;
      // ★ 免费加成：Chrome 自带 Safe Browsing 已将该下载标记为恶意
      //   （content=文件已知恶意 / url=网址已知恶意 / host=来源主机已知分发恶意二进制）
      //   此判定常在 onCreated 时仍为 safe，云查完成后经 onChanged 返回，见下方 onChanged 兜底。
      if (isMaliciousDanger(item.danger)) {
        cancelDownload(item.id, host, item.tabId >= 0 ? [item.tabId] : [], item.url, item.filename);
        return;
      }
      // ★ 分析闸门：来源标签页仍在检测中 → 默认拒绝，先堵死全部下载并挂起，待判定后处理
      if (item.tabId && item.tabId >= 0 && analysisState[item.tabId] === 'analyzing') {
        holdDownload(item.tabId, item);
        return;
      }
      // 白名单站点（按下载文件所在域名放行）
      if (hostMatch(host, settings.allowlist)) return;
      // 用户自定义黑名单域名 → 拦（提示发到当前标签页）
      if (hostMatch(host, settings.customBadDomains)) {
        cancelDownload(item.id, host, item.tabId >= 0 ? [item.tabId] : [], item.url, item.filename);
        return;
      }
      // ★ 硬编码银狐木马投递站黑名单（与页面级判定同源）：命中下载 URL 或来源域即强制取消，永不豁免
      if (isKnownBadHost(host)) {
        cancelDownload(item.id, host, item.tabId >= 0 ? [item.tabId] : [], item.url, item.filename);
        return;
      }
      const srcHost = downloadSourceHost(item);
      if (srcHost && isKnownBadHost(srcHost)) {
        cancelDownload(item.id, srcHost, item.tabId >= 0 ? [item.tabId] : [], item.url, item.filename);
        return;
      }
      // ★ 下载黑名单跨站复用（#16）：该载荷域名此前已因投递木马被拦过 → 直接取消。
      //   不必等新落地页重新走一遍判危流程（银狐换落地页远比换载荷 CDN 勤快）。
      //   受保护域名（GitHub/微软/官方/用户白名单）永不入库，故此处不会误伤正规下载源。
      if (dlBlacklistHas(host)) {
        cancelDownload(item.id, host, item.tabId >= 0 ? [item.tabId] : [], item.url, item.filename);
        return;
      }
      // ★ 核心：只有当「发起下载的页面」被判定危险且未放行时才拦，否则一律放行
      loadState().then(function (state) {
        const src = sourceHostOf(item, state);
        if (src.host) { cancelDownload(item.id, src.host, src.tabIds, item.url, item.filename); return; }
        // ★ 跳转链兜底：本标签页曾由危险站跳转而来，且本次下载是可执行/网盘类 → 直接拦
        //   （覆盖「B 站自身没独立判危、但其下载仍从被污染标签发起」的场景）
        if (isTainted(state, item.tabId)) {
          const t = SF.classifyLink(item.url);
          if (t === 'exec' || t === 'cloud' || t === 'archive' || t === 'download') {
            cancelDownload(item.id, host, [item.tabId], item.url, item.filename);
            return;
          }
        }
        // ★ 自动下载兜底：下载在内容脚本「判定→标记危险」之前就已触发
        //   （覆盖「点进网站就下载」「服务端 Content-Disposition 强制下载」等抢跑场景）
        // 文件本身在白名单 / 来源是可信官方域名 → 放行
        if (hostMatch(host, settings.allowlist)) return;
        if (srcHost && (SF.isOfficialDomain(srcHost) || hostMatch(srcHost, settings.allowlist))) return;
        if (isHighRiskFile(item.url)) {
          // 1) 来源域名自身像品牌仿冒（非官方）→ 直接拦，不依赖内容脚本判定
          //    注意：必须先排除官方域名，否则 qq.com / www.moonshot.cn 等含品牌词的官网会被误判仿冒而误拦下载
          if (srcHost && !SF.isOfficialDomain(srcHost) && SF.detectSpoof(srcHost)) {
            markTainted(item, srcHost, state);
            cancelDownload(item.id, srcHost, [item.tabId], item.url, item.filename);
            return;
          }
          // 2) 页面刚载入（≤ 窗口期）就自动下高危文件 → 视为「自动下载」，直接拦
          const t0 = (item.tabId && item.tabId >= 0) ? navCommitTime[item.tabId] : 0;
          if (t0 && (Date.now() - t0) <= AUTO_WINDOW_MS) {
            markTainted(item, srcHost || host, state);
            cancelDownload(item.id, srcHost || host, [item.tabId], item.url, item.filename);
            return;
          }
        }
      });
    });
  });
}

// ===== Chrome 自带 Safe Browsing 兜底：danger 常在下载「创建后」才经云查返回 =====
//   例如 onCreated 时 danger 仍为 safe，数秒后 onChanged 才变为 content/url/host。
//   这里监听 danger 变化，命中恶意判定时取消（未完成）或弹窗警告（已落地无法撤回）。
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(function (delta) {
    if (!delta || delta.id == null) return;
    if (!(delta.danger && delta.danger.current) || !isMaliciousDanger(delta.danger.current)) return;
    const id = delta.id;
    getSettings().then(function (settings) {
      if (!settings.enabledGlobal || !settings.autoBlockDownloads) return;
      chrome.downloads.search({ id: id }, function (items) {
        if (!items || !items.length) return;
        const it = items[0];
        if (allowedDownloads.has(it.url) || it.byExtensionId) return; // 用户已明确放行 / 扩展自身发起
        const tabIds = it.tabId >= 0 ? [it.tabId] : [];
        const h = parseHost(it.url);
        if (it.state === 'complete') {
          // 已落地到磁盘：cancel 无效，但仍弹窗警告用户文件可疑
          tabIds.forEach(function (tid) {
            if (tid != null && chrome.tabs && chrome.tabs.sendMessage) {
              try { chrome.tabs.sendMessage(tid, { type: 'sf-download-blocked', host: h, url: it.url, filename: it.filename }); } catch (e) {}
            }
          });
          return;
        }
        if (it.state === 'interrupted') return; // 已中断，无需再处理
        cancelDownload(it.id, h, tabIds, it.url, it.filename);
      });
    });
  });
}

// ===== 检测银狐「跳转链」：危险站 A 自动跳转到新站 B 时，把 B 标记为污染 =====
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(function (details) {
    if (details.frameId !== 0) return; // 只处理顶级框架
    const _navUrl = details.url || '';
    let _navProto = '';
    try { _navProto = new URL(_navUrl).protocol; } catch (e) {}
    if (_navProto !== 'http:' && _navProto !== 'https:') return; // 仅对 http(s) 网页起闸；浏览器内部页/扩展页不闸
    const tabId = details.tabId;
    // ★ 分析闸门：页面提交即进入「检测中」状态，该标签下载先默认拒绝（内容脚本回传判定后解除）
    armAnalysis(tabId);
    const url = _navUrl;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) {}
    const prev = lastTopUrl[tabId] || '';
    let prevHost = '';
    try { prevHost = new URL(prev).hostname.toLowerCase(); } catch (e) {}
    navCommitTime[tabId] = Date.now(); // 记录本次导航提交时间，供自动下载竞速判定使用
    prevTopUrl[tabId] = prev; // 记下「上一跳」页面，供下载来源归属回退使用
    loadState().then(function (state) {
      const tab = state.dangerTabs[tabId];
      const prevWasDanger = tab && !tab.released && tab.hostname && tab.hostname === prevHost;
      // A(危险) → B(新域名)：标记 B 为跳转链污染（高风险）
      if (prevWasDanger && host && host !== prevHost) {
        state.dangerTabs[tabId] = { hostname: host, released: false, chained: true };
        saveState(state);
      }
      lastTopUrl[tabId] = url;
    });
  });
}

function cancelDownload(id, host, tabIds, url, filename) {
  // ★ 自动入库（#16）：把本次被拦下载的「载荷域名」记进下载黑名单，供后续跨站复用识别。
  //   host 参数是「落地页/来源域名」，真正要记的是文件所在域名（parseHost(url)），
  //   落地页只作来源元数据留档 —— 银狐换落地页比换载荷 CDN 勤快得多。
  try { dlBlacklistAdd(parseHost(url), { filename: filename, from: host }); } catch (e) {}
  chrome.downloads.cancel(id, function () {
    chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, function (r) {
      const stats = r.stats || { warnings: 0, blocks: 0, recent: [] };
      stats.blocks += 1;
      chrome.storage.local.set({ stats });
    });
    // 不再使用系统通知（关掉浏览器后仍会在系统通知中心弹出）；改为在网页内「大弹窗」提示
    // 把提示发到「发起下载的危险页面」对应的所有标签页（解决 item.tabId 为 -1 收不到提示的问题）
    (tabIds || []).forEach(function (tid) {
      if (tid != null && tid >= 0 && chrome.tabs && chrome.tabs.sendMessage) {
        try { chrome.tabs.sendMessage(tid, { type: 'sf-download-blocked', host: host, url: url, filename: filename }); } catch (e) {}
      }
    });
  });
}

// 标签页关掉后清理其危险状态
if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener(function (tabId) {
    if (lastTopUrl[tabId]) delete lastTopUrl[tabId];
    if (prevTopUrl[tabId]) delete prevTopUrl[tabId];
    if (navCommitTime[tabId]) delete navCommitTime[tabId];
    if (analysisState[tabId]) delete analysisState[tabId];
    if (analysisTimers[tabId]) { clearTimeout(analysisTimers[tabId]); delete analysisTimers[tabId]; }
    if (heldDownloads[tabId]) delete heldDownloads[tabId];
    loadState().then(function (state) {
      if (state.dangerTabs[tabId]) { delete state.dangerTabs[tabId]; saveState(state); }
    });
  });
}

// ===== 后台自动 AI 网页分析（content 随页面加载触发，不进悬浮球）=====
const AI_PROVIDERS = {
  zhipu:    { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', defaultModel: 'glm-4.7-flash', builtinKey: '86924bafc9aa40f2bf1de9d0fad24546.eWHPPTOQpLioa3qj' },
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-chat' },
  openai:   { endpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini' },
  moonshot: { endpoint: 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k' },
  custom:   { endpoint: '', defaultModel: '' }
};
function aiResolveCfg(s) {
  const provider = s.aiProvider || 'zhipu';
  const p = AI_PROVIDERS[provider] || AI_PROVIDERS.zhipu;
  let endpoint = p.endpoint;
  if (provider === 'custom') {
    const base = (s.aiBaseUrls && s.aiBaseUrls.custom || '').replace(/\/+$/, '');
    endpoint = base ? base + '/chat/completions' : '';
  }
  const key = (s.aiKeys && s.aiKeys[provider] && s.aiKeys[provider].trim()) || p.builtinKey || '';
  return { endpoint: endpoint, key: key, model: s.aiModel || p.defaultModel, provider: provider };
}
function aiAnalyzePrompt(page) {
  return [
    '你是「银狐防护」浏览器扩展的网页风险分析引擎。请基于下方页面信息，按规则清单判断该页面风险等级，并额外完成「品牌官网推断」任务。',
    '风险等级仅限四选一：安全 / 低 / 中 / 高。',
    '规则清单（命中任一类即至少「中」及以上）：',
    '1) 钓鱼/仿冒：域名与官方高度相似（typo/字符替换/形似域名）；页面仿冒知名登录页（银行/邮箱/游戏/社交账号）。',
    '2) 诈骗：虚假中奖/免费送/高额返利话术；诱导加私人微信/QQ/电报「客服」。',
    '3) 钓鱼投递：伪装「下载/开始对话/API开放平台/立即体验」等按钮，实则诱导下载木马或跳转恶意站。',
    '4) 虚假信息：虚假新闻/谣言/夸大疗效/伪科学。',
    '5) 投资陷阱：杀猪盘/虚假理财/「稳赚不赔」话术。',
    '6) 品牌仿冒：从页面醒目品牌词（标题/Logo 文本/域名片段，如「RPACS3」「Steam 客服」）推断该品牌真实官方域名，再比对当前域名是否一致（不一致即仿冒）。',
    '',
    '页面 URL：' + (page.url || '（未知）'),
    '页面标题：' + (page.title || '（未知）'),
    '页面正文（截取前 6000 字）：' + (page.text || '（无正文）'),
    '',
    '【品牌官网推断任务】这是仿冒检测的关键步骤，请尽力完成：',
    '1) 先看页面域名本身：域名主体（去掉 www./前缀/后缀）往往直接包含品牌拼音、英文缩写或产品名，应优先据此推断品牌（如 rpacs3.io→RPACS3，wechat.com→微信）。',
    '2) 再看页面标题、Logo 文本、版权信息、导航与页脚里出现的品牌/产品/机构名。',
    '3) 再结合正文首段、关于我们、联系方式里提到的主体名。',
    '4) 综合上述线索推断该品牌/产品的「真实官方主域名」（仅域名，不要带路径或协议）。',
    '5) 若页面确为纯个人博客/论坛帖子/资讯聚合且找不到任何明确品牌，官方域名才填「无」。',
    '重要：宁可给出一个你推断的近似官方域名，也不要轻易填「无」——留空会导致无法做仿冒比对。',
    '',
    '输出格式（严格遵守，第一行必须是等级，最后三行必须是固定字段，字段名必须顶格并以中文冒号分隔）：',
    '风险等级：X',
    '依据：用 1-3 条要点说明命中了哪类规则、为什么。',
    '建议：可正常访问 / 建议警惕 / 立即离开',
    '品牌词：页面所代表的品牌/产品/机构名（无则填「无」）',
    '官方域名：你推断的该品牌官方主域名（无则填「无」）',
    '官网置信度：高 / 中 / 低（你对该官方域名判断的把握）'
  ].join('\n');
}
function parseAiLevel(text) {
  const m = /风险等级[：:]\s*(安全|低|中|高)/.exec(text || '');
  const level = m ? m[1] : '低';
  return level;
}
// 解析 AI 输出的「品牌官网推断」字段（B1：AI 先推断官网，后台二次核验）
// 设计目标：最大限度容忍 AI 输出格式漂移——多字段名、中英文冒号、JSON、Markdown 表格、
// 「无」的各种写法、字段夹带解释文字，都能尽量抽出来，避免「抽不出来」导致核验失效。
function parseAiBrand(text) {
  text = String(text || '');
  // 1) 先尝试从可能的 JSON / 代码块里抠字段（AI 偶尔返回 ```json {...} ```）
  let work = text;
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const pick = function (keys) {
        for (let i = 0; i < keys.length; i++) if (obj[keys[i]] != null) return String(obj[keys[i]]);
        return '';
      };
      var jBrand = pick(['品牌词', '品牌', 'brand', '产品', '机构']);
      var jOfficial = pick(['官方域名', '官网', '官方', '域名', '主页', 'official', 'domain']);
      var jConf = pick(['官网置信度', '置信度', 'conf', 'confidence']);
      if (jBrand || jOfficial) {
        return { brand: jBrand.trim(), official: cleanDomain(jOfficial), conf: normConf(jConf) };
      }
    } catch (e) { /* 不是合法 JSON，继续走文本解析 */ }
  }
  // 2) 文本行解析：字段名兼容多种写法，冒号兼容中英文/无冒号
  const fieldVal = function (names) {
    const escaped = names.join('|');
    // 顶格或缩进均可；字段名后跟中文冒号/英文冒号/空格都可；兼容「字段名 值」直接用捕获
    const re = new RegExp('(?:^|\\n)\\s*(?:' + escaped + ')\\s*[：:]\\s*(.+?)(?=\\n|$)', 'm');
    const m = re.exec(work);
    if (m && m[1] != null) return m[1].trim();
    // 退路：字段名后没有冒号，直接跟内容（如「品牌词 Steam 官网」）
    const re2 = new RegExp('(?:^|\\n)\\s*(?:' + escaped + ')\\s+(.+?)(?=\\n|$)', 'm');
    const m2 = re2.exec(work);
    if (m2 && m2[1] != null) return m2[1].trim();
    return '';
  };
  const brand = fieldVal(['品牌词', '品牌', '产品名', '产品', '机构名', '机构', '站点品牌']);
  const officialRaw = fieldVal(['官方域名', '官网', '官方', '官网域名', '域名', '主页', '官方网站']);
  const confRaw = fieldVal(['官网置信度', '置信度', '把握', '可信度']);
  return {
    brand: isNone(brand) ? '' : brand,
    official: cleanDomain(officialRaw),
    conf: normConf(confRaw)
  };
}
// 把任意文本清理成单个域名（小写、去协议/路径/引号，并从混杂解释里抠出第一个形似域名的片段）
function cleanDomain(s) {
  if (!s) return '';
  if (isNone(s)) return '';
  s = s.trim().replace(/^["'「」『』]/, '').replace(/["'「」『』]$/, '');
  // 优先用域名正则从整段里揪出形似域名的片段（AI 可能写「官网是 example.com（已验证）」）
  const dmRe = /[a-z0-9一-龥](?:[a-z0-9一-龥\-]*[a-z0-9一-龥])?(?:\.[a-z0-9一-龥\-]+){1,}\.[a-z]{2,}/i;
  const m = dmRe.exec(s);
  let dm = m ? m[0] : s.split(/\s+/)[0];
  dm = dm.toLowerCase().replace(/^https?:\/\//, '').replace(/^\/+/, '').replace(/\/.*$/, '').replace(/[，。、].*$/, '');
  // 去掉可能的端口/查询
  dm = dm.replace(/:[0-9]+$/, '').replace(/\?.*$/, '');
  return dm;
}
// 归一化置信度；缺省/无法识别视为「中」，避免「低」直接让核验失效
function normConf(s) {
  if (!s) return '中';
  if (/高/.test(s)) return '高';
  if (/低/.test(s)) return '低';
  if (/中/.test(s)) return '中';
  return '中';
}
// 判断是否为「无」的各种写法
function isNone(s) {
  if (!s) return true;
  return /^(无|没有|none|n\/a|na|暂无|未知|null|空|—|-|未提及|不确定)$/i.test(s.trim());
}
// 注册域提取（去 www. 前缀）
function _regOf(hostname) {
  if (!hostname) return '';
  return String(hostname).toLowerCase().replace(/^www\./, '');
}
// 后台二次核验：AI 推断的官方域名 vs 当前域名，是否同源（同主域或同 rdap 注册组织）
// 返回 { isImpersonation:boolean, detail:string }
async function verifyOfficialDomain(currentHost, aiOfficial) {
  const cur = _regOf(currentHost);
  const off = _regOf(aiOfficial);
  if (!cur || !off) return { isImpersonation: false, detail: '' };
  if (cur === off) return { isImpersonation: false, detail: '当前域名与推断官方域名一致' };
  // 主域一致（如 a.example.com vs example.com）→ 视为同源，不判仿冒
  const curParts = cur.split('.'), offParts = off.split('.');
  const curMain = curParts.slice(-2).join('.'), offMain = offParts.slice(-2).join('.');
  if (curMain === offMain) return { isImpersonation: false, detail: '同主域，视为官方分支' };
  // 主域不同 → 查两侧 rdap 注册组织做二次核验（不额外外发非必要请求，rdap 已有缓存）
  let curOrg = '', offOrg = '';
  try {
    const [cj, oj] = await Promise.all([
      fetch('https://rdap.org/domain/' + encodeURIComponent(cur), { redirect: 'follow', signal: (function () { const c = new AbortController(); setTimeout(function () { try { c.abort(); } catch (e) {} }, 5000); return c.signal; })() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('https://rdap.org/domain/' + encodeURIComponent(off), { redirect: 'follow', signal: (function () { const c = new AbortController(); setTimeout(function () { try { c.abort(); } catch (e) {} }, 5000); return c.signal; })() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]);
    const orgOf = function (j) {
      if (!j) return '';
      const e = (j.entities || []).find(function (x) { return (x.roles || []).indexOf('registrant') !== -1; }) || (j.entities || [])[0];
      return (e && (e.vcardArray && e.vcardArray[1] ? (e.vcardArray[1].find(function (v) { return v[0] === 'fn'; }) || [])[3] : (e && e.handle) || '')) || '';
    };
    curOrg = orgOf(cj); offOrg = orgOf(oj);
  } catch (e) { /* rdap 不可用则跳过组织比对，仅靠主域差异 */ }
  if (curOrg && offOrg && curOrg === offOrg) {
    return { isImpersonation: false, detail: '两侧域名注册主体一致（' + curOrg + '），视为同一品牌' };
  }
  // 主域不同且注册主体无法证明一致 → 判定为仿冒（域名不匹配官方）
  return {
    isImpersonation: true,
    detail: '当前域名「' + cur + '」与推断官方域名「' + off + '」不一致，疑似仿冒'
  };
}
async function callAiCloud(cfgObj, prompt) {
  if (!cfgObj.endpoint) throw new Error('自定义模型未配置 API 基址');
  if (!cfgObj.key) throw new Error('未配置 API Key');
  let resp;
  try {
    resp = await fetch(cfgObj.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfgObj.key },
      body: JSON.stringify({
        model: cfgObj.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600, temperature: 0.3, stream: false
      })
    });
  } catch (netErr) {
    // 网络异常（断网/超时/DNS 失败）：非用户可干预，needAction=false -> 静默不提示
    const err = new Error('云端网络请求失败：' + (netErr && netErr.message ? netErr.message : '无返回'));
    err.needAction = false;
    throw err;
  }
  if (!resp.ok) {
    let msg = '云端请求失败（HTTP ' + resp.status + '）';
    let needAction = false;
    try { const j = await resp.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
    if (resp.status === 429) { msg = '云端模型调用频率超限（免费模型有每分钟额度）'; needAction = true; }
    if (resp.status === 401) { msg = 'API Key 无效或已失效'; needAction = true; }
    const err = new Error(msg);
    err.needAction = needAction;
    throw err;
  }
  const data = await resp.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return { level: parseAiLevel(text), summary: text.trim() };
}
async function handleAiPageAnalyze(msg, sender) {
  // 守门：仅当开关开启才分析（content 已做过一次判断，这里双保险）
  const s = await new Promise(function (resolve) {
    chrome.storage.sync.get({
      aiMaxMode: false, aiCloudWebAnalyse: false,
      aiProvider: 'zhipu', aiModel: '', aiKeys: {}, aiBaseUrls: {}
    }, function (r) { resolve(r || {}); });
  });
  if (!s.aiMaxMode || !s.aiCloudWebAnalyse) return { ok: false, skipped: true };
  const page = msg.page || {};
  if (!page.text || !page.text.trim()) return { ok: false, err: '页面无正文可分析' };
  const cfgObj = aiResolveCfg(s);
  try {
    const r = await callAiCloud(cfgObj, aiAnalyzePrompt(page));
    let level = r.level, summary = r.summary;
    // —— B1 二次核验：AI 先推断官网，后台硬比对当前域名是否匹配官方 ——
    const brand = parseAiBrand(r.summary);
    if (brand.official && !isNone(brand.official) && brand.official !== _regOf(page.url || '')) {
      const v = await verifyOfficialDomain(page.url || '', brand.official);
      if (v.isImpersonation) {
        level = '高';
        summary = (summary ? summary + '\n' : '') +
          '【官网核验】' + v.detail + '（品牌词：' + (brand.brand || '未知') + '，AI 推断官方：' + brand.official + '，置信度：' + brand.conf + '）。';
      }
    }
    return { ok: true, level: level, summary: summary, url: page.url || '', title: page.title || '', brand: brand };
  } catch (e) {
    // needAction=true 表示「额度耗尽/限流/Key 失效」等需用户干预的明确错误，
    // content 侧据此弹出一次性提示并建议关闭 Max 模式；其余（网络抖动/无返回）静默。
    return { ok: false, err: (e && e.message) || '云端分析失败', needAction: !!(e && e.needAction) };
  }
}

// 文件 AI 辅助分析：仅接收本地提取的可疑特征摘要（不含整文件内容），
// 由云端 AI 结合银狐/木马投递特征判断「正常安装包 / 可疑 / 高危」。
function aiAnalyzeFilePrompt(summary) {
  return '你是一名病毒分析师，正在复核一份已通过本地静态规则扫描的样本。' +
    '本地引擎已提取如下「可疑特征摘要」（不含文件正文，仅元数据与命中特征）：\n' +
    '----\n' + summary + '\n----\n' +
    '请结合以下知识判断该样本风险：\n' +
    '1) 银狐木马家族特征（getinstall64/Gh0st/cb1st/libcef_dll_wrapper/C3Exporer/Server64/InstallEx/NHQDX/Consys21/instal.ini 等）；\n' +
    '2) 白加黑手法（白文件加载恶意 DLL、伪装驱动/词典/显卡驱动组件）；\n' +
    '3) 钓鱼伪装（双扩展名、随机大写字母数字 exe、人事/财务诱导文件名、完整官方包+随机名 exe 同包）；\n' +
    '4) 对抗行为（Defender 排除/关闭、进程注入 API、计划任务/注册表持久化、BYOVD 驱动、C2 端口 8880/18852/9090-9092 等）；\n' +
    '5) 正常安装包也会有数字签名、官方名、内嵌完整安装逻辑——不能仅因「含 exe」判危。\n' +
    '请输出：风险等级（安全/低/中/高）+ 一句话依据 + 最关键 1-2 个判断点。' +
    '若本地命中均为弱特征且无明显银狐/对抗指向，应倾向「安全/低」并说明这是本地静态规则的局限，建议以云端结论为补充而非覆盖。';
}

async function handleAiFileAnalyze(msg, sender) {
  // 守门：仅当开关开启才分析
  const s = await new Promise(function (resolve) {
    chrome.storage.sync.get({
      aiMaxMode: false, aiScanFileAnalyse: false,
      aiProvider: 'zhipu', aiModel: '', aiKeys: {}, aiBaseUrls: {}
    }, function (r) { resolve(r || {}); });
  });
  if (!s.aiMaxMode || !s.aiScanFileAnalyse) return { ok: false, skipped: true };
  const summary = msg.summary || '';
  if (!summary.trim()) return { ok: false, err: '无可分析的特征摘要' };
  const cfgObj = aiResolveCfg(s);
  try {
    const r = await callAiCloud(cfgObj, aiAnalyzeFilePrompt(summary));
    return { ok: true, level: r.level, summary: r.summary, name: msg.name || '' };
  } catch (e) {
    return { ok: false, err: (e && e.message) || '云端分析失败', needAction: !!(e && e.needAction) };
  }
}
