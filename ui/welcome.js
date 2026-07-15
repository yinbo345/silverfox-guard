/*
 * welcome.js — 银狐防护「加载成功」欢迎页交互
 *   • 进入设置：打开扩展设置面板
 *   • 开始浏览：关闭本欢迎标签页（带兜底，避免某些环境下 window.close 无效）
 */
'use strict';

function closeSelf() {
  // 多数情况下扩展自己打开的标签页可直接关闭
  if (window.close) window.close();
  // 兜底：拿不到关闭效果时，用 tabs API 移除当前页
  try {
    chrome.tabs.getCurrent((tab) => { if (tab && tab.id != null) chrome.tabs.remove(tab.id); });
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  const settingsBtn = document.getElementById('settingsBtn');
  const startBtn = document.getElementById('startBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage(); } catch (e) { closeSelf(); }
  });
  if (startBtn) startBtn.addEventListener('click', closeSelf);
});
