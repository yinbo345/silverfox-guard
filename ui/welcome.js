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
  // 外观偏好跟随设置页（主题 / 深浅色 / 材质 / 字体 / 字号 / 自定义背景，与设置页一致）
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({
        fontMode: 'system', theme: 'dark', themePalette: 'classic',
        material: 'frosted', fontScale: 1, bgImage: ''
      }, (s) => {
        const root = document.documentElement;
        if (s.fontMode === 'smiley') root.classList.add('font-smiley');
        if (s.theme === 'light') root.classList.add('theme-light');
        const pal = s.themePalette || 'classic';
        if (pal === 'gold') root.classList.add('theme-gold');
        else if (pal === 'neon') root.classList.add('theme-neon');
        else if (pal === 'mist') root.classList.add('theme-mist');
        else if (pal === 'space') root.classList.add('theme-space');
        else if (pal === 'pixel') root.classList.add('theme-pixel');
        if (s.material === 'liquid' && pal !== 'pixel') root.classList.add('material-liquid');
        if (typeof s.fontScale === 'number') {
          let sc = s.fontScale; if (s.fontMode === 'smiley') sc *= 1.10;
          root.style.setProperty('--sf-scale', sc.toFixed(3));
        }
        if (s.bgImage && pal !== 'pixel') root.style.setProperty('--sf-bg-image', 'url(' + s.bgImage + ')');
      });
    }
  } catch (e) {}

  const settingsBtn = document.getElementById('settingsBtn');
  const startBtn = document.getElementById('startBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage(); } catch (e) { closeSelf(); }
  });
  if (startBtn) startBtn.addEventListener('click', closeSelf);
});
