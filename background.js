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

const SF = self.SF_ANALYZER;

// 用户在当前会话里「仍要下载」明确放行的下载 URL（避免重复拦截；SW 重启后清空，会重新询问，安全）
const allowedDownloads = new Set();

// 记录每个标签页最近一次「顶级导航」的 URL，用于检测「危险站 → 跳转新站」的银狐跳转链
const lastTopUrl = {};
// 记录每次顶级导航「提交完成」的时间戳，用于识别「点进即下载 / 服务端强制下载」的自动下载竞速
const navCommitTime = {};
// 自动下载判定窗口：页面提交后该时间窗内发起的高危文件下载，视为「自动下载」而非用户手动点击
const AUTO_WINDOW_MS = 1500;

const DEFAULTS = {
  enabledGlobal: true, showWarning: true, autoBlockDownloads: true, sensitivity: 'medium',
  enabled: {
    knownIoc: true, vmDetection: true, domainImpersonation: true, execDownload: true,
    cloudDiskDist: true, obfuscatedJs: true, fakeOfficial: true,
    socialEngineering: true, domainStructure: true, redirectIframe: true
  },
  allowlist: [], customKeywords: [], customBadDomains: []
};

// ===== 会话级状态（service worker 重启不丢）=====
function loadState() {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get({ dangerTabs: {}, releasedHosts: {} }, (s) => {
        resolve({ dangerTabs: s.dangerTabs || {}, releasedHosts: s.releasedHosts || {} });
      });
    } catch (e) { resolve({ dangerTabs: {}, releasedHosts: {} }); }
  });
}
function saveState(state) {
  try { chrome.storage.session.set({ dangerTabs: state.dangerTabs, releasedHosts: state.releasedHosts }); } catch (e) {}
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s || {})));
  });
}

function parseHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}

function hostMatch(host, list) {
  host = (host || '').toLowerCase();
  return (list || []).some((d) => {
    d = String(d).trim().toLowerCase();
    return d && (host === d || host.endsWith('.' + d));
  });
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

// 推断本次下载的「来源页面」域名（优先 initiator/referrer，回退到本标签最近一次顶级导航）
function downloadSourceHost(item) {
  const src = item.initiator || item.referrer || '';
  let h = '';
  try { h = new URL(src).hostname.toLowerCase(); } catch (e) {}
  if (!h && item.tabId && item.tabId >= 0 && lastTopUrl[item.tabId]) {
    try { h = new URL(lastTopUrl[item.tabId]).hostname.toLowerCase(); } catch (e) {}
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

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    chrome.storage.sync.set(Object.assign({}, DEFAULTS, s || {}));
  });
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
    if (!r.stats) chrome.storage.local.set({ stats: { warnings: 0, blocks: 0, recent: [] } });
  });
  // 首次安装 → 打开「加载成功」欢迎页
  if (details.reason === 'install') {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('ui/welcome.html') }); } catch (e) {}
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'sf-detected') {
    updateStats(msg.data);
    // 仅当被判为 danger 时记录该标签页，用于下载拦截判定
    if (msg.data && msg.data.level === 'danger' && sender.tab && sender.tab.id != null) {
      loadState().then((state) => {
        const prev = state.dangerTabs[sender.tab.id];
        state.dangerTabs[sender.tab.id] = {
          hostname: (msg.data.hostname || '').toLowerCase(),
          released: false,
          chained: !!(prev && prev.chained) // 保留跳转链污染标记
        };
        saveState(state);
      });
    }
  } else if (msg.type === 'sf-check-chain') {
    // 内容脚本询问：本标签页是否由已判定危险站跳转而来
    const tabId = sender.tab ? sender.tab.id : null;
    loadState().then((state) => {
      sendResponse({ chained: isTainted(state, tabId) });
    });
    return true; // 异步 sendResponse，必须返回 true
  } else if (msg.type === 'sf-clear-chain') {
    // 内容脚本判定本页完全无辜（真官网/有备案/无下载入口）→ 清除跳转链污染，避免误拦
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId != null) {
      loadState().then((state) => {
        const t = state.dangerTabs[tabId];
        if (t && t.chained && !t.released) { delete state.dangerTabs[tabId]; saveState(state); }
      });
    }
  } else if (msg.type === 'sf-release') {
    const host = (msg.hostname || '').toLowerCase();
    const tabId = sender.tab ? sender.tab.id : null;
    loadState().then((state) => {
      if (tabId != null && state.dangerTabs[tabId]) state.dangerTabs[tabId].released = true;
      if (host) state.releasedHosts[host] = true;
      saveState(state);
    });
  } else if (msg.type === 'sf-leave') {
    // 直接关闭触发该消息的标签页；关不掉（如最后一个标签）则退到新标签页
    if (sender.tab && sender.tab.id != null) {
      const tid = sender.tab.id;
      chrome.tabs.remove(tid, () => {
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
        chrome.downloads.download({ url: url }, () => {
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
  }
});

function updateStats(data) {
  chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
    const stats = r.stats || { warnings: 0, blocks: 0, recent: [] };
    stats.warnings += 1;
    const recent = stats.recent || [];
    recent.unshift({ hostname: data.hostname, score: data.score, level: data.level, time: data.time });
    stats.recent = recent.slice(0, 30);
    chrome.storage.local.set({ stats });
  });
}

// ===== 拦截下载：仅拦「危险且未放行站点」发起的下载 =====
if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener((item) => {
    if (!item || !item.url) return;
    // 本次下载用户已明确「仍要下载」→ 直接放行（避免重复拦截）
    if (allowedDownloads.has(item.url)) return;
    // 浏览器扩展自身（byExtensionId）发起的下载，一律跳过，避免误拦
    if (item.byExtensionId) return;
    const host = parseHost(item.url);
    getSettings().then((settings) => {
      if (!settings.enabledGlobal || !settings.autoBlockDownloads) return;
      // 白名单站点（按下载文件所在域名放行）
      if (hostMatch(host, settings.allowlist)) return;
      // 用户自定义黑名单域名 → 拦（提示发到当前标签页）
      if (hostMatch(host, settings.customBadDomains)) {
        cancelDownload(item.id, host, item.tabId >= 0 ? [item.tabId] : [], item.url, item.filename);
        return;
      }
      // ★ 核心：只有当「发起下载的页面」被判定危险且未放行时才拦，否则一律放行
      loadState().then((state) => {
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
        const srcHost = downloadSourceHost(item);
        // 文件本身在白名单 / 来源是可信官方域名 → 放行
        if (hostMatch(host, settings.allowlist)) return;
        if (srcHost && (SF.isOfficialDomain(srcHost) || hostMatch(srcHost, settings.allowlist))) return;
        if (isHighRiskFile(item.url)) {
          // 1) 来源域名自身像品牌仿冒（非官方）→ 直接拦，不依赖内容脚本判定
          if (srcHost && SF.detectSpoof(srcHost)) {
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

// ===== 检测银狐「跳转链」：危险站 A 自动跳转到新站 B 时，把 B 标记为污染 =====
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return; // 只处理顶级框架
    const tabId = details.tabId;
    const url = details.url || '';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) {}
    const prev = lastTopUrl[tabId] || '';
    let prevHost = '';
    try { prevHost = new URL(prev).hostname.toLowerCase(); } catch (e) {}
    navCommitTime[tabId] = Date.now(); // 记录本次导航提交时间，供自动下载竞速判定使用
    loadState().then((state) => {
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
  chrome.downloads.cancel(id, () => {
    chrome.storage.local.get({ stats: { warnings: 0, blocks: 0, recent: [] } }, (r) => {
      const stats = r.stats || { warnings: 0, blocks: 0, recent: [] };
      stats.blocks += 1;
      chrome.storage.local.set({ stats });
    });
    // 不再使用系统通知（关掉浏览器后仍会在系统通知中心弹出）；改为在网页内「大弹窗」提示
    // 把提示发到「发起下载的危险页面」对应的所有标签页（解决 item.tabId 为 -1 收不到提示的问题）
    (tabIds || []).forEach((tid) => {
      if (tid != null && tid >= 0 && chrome.tabs && chrome.tabs.sendMessage) {
        try { chrome.tabs.sendMessage(tid, { type: 'sf-download-blocked', host, url, filename }); } catch (e) {}
      }
    });
  });
}

// 标签页关掉后清理其危险状态
if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (lastTopUrl[tabId]) delete lastTopUrl[tabId];
    if (navCommitTime[tabId]) delete navCommitTime[tabId];
    loadState().then((state) => {
      if (state.dangerTabs[tabId]) { delete state.dangerTabs[tabId]; saveState(state); }
    });
  });
}
