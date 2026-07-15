# 银狐防护 · SilverFox Guard

Chrome / Edge 浏览器扩展（Manifest V3），实时检测并拦截「银狐木马（Silver Fox / 游蛇）」钓鱼与仿冒下载站点，保护你免受恶意软件下载与欺诈页面侵害。

> 💡 **算法致敬**：本项目的检测引擎基于 [@Lolitide](https://github.com/Lolitide) 的开源作品
> [VirusDetector](https://github.com/Lolitide/VirusDetector)（MIT License）的规则算法，
> 在其基础上使用 AI 进行了大幅改良与扩展（加权评分、组合信号升级、自动下载竞速兜底、跳转链污染追踪等）。
> 特此致谢原作者，本改良版同样以 MIT License 发布。

---

## ✨ 功能特性

- **实时网页代码分析**：解析 DOM 结构、下载入口、话术特征，而非仅依赖域名黑名单。
- **多维度加权评分**：官方域名早期退出、ICP 备案核查、域名仿冒检测（编辑距离 / 去连字符比对）、代码工程化与 AI 生成质量评估。
- **拦截任意下载入口**：`<a>` / `<button>` / `<div>` 等任意元素，并覆盖 JS 程序化下载（`window.open` / `a.click` / `blob` / `location` 跳转）。
- **自动下载竞速兜底**：`<meta refresh>`、服务端强制下载（`Content-Disposition: attachment`）等「点进即下」场景也能拦截。
- **跳转链污染追踪**：危险站 → 跳转新站（银狐跳转链）时，仍能识别并拦截下游下载。
- **智能免误拦**：官方 / 搜索引擎白名单；`file://` 本地文件、浏览器内部页、本地开发服务器自动跳过。
- **体验优化**：加载成功欢迎页 + 设置面板（全局开关 / 下载自动拦截 / 灵敏度 低·中·高 / 自定义白黑名单）。

## 🛡️ 工作原理

1. **采集**：页面域名、HTML、下载链接、代码特征。
2. **评分**：加权评分引擎计算风险分（0–200+），命中组合信号直接升级为危险。
3. **预警**：达到阈值触发 `warn`（提醒）或 `danger`（拦截 + 弹窗 + 禁用下载入口）。
4. **兜底**：后台 `chrome.downloads` 监听，覆盖内容脚本判定前的自动下载。

## 📦 安装

- **开发者模式加载**：克隆本仓库 → 打开 `chrome://extensions`（或 Edge 的 `edge://extensions`）→
  开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择仓库根目录。
- 首次加载会自动弹出欢迎页。

## 🔧 设置

点击工具栏图标 → 「设置」，可调整：全局开关、下载自动拦截、灵敏度、自定义白 / 黑名单。

## 📁 目录结构

```
silverfox-guard/
├── manifest.json          # MV3 清单
├── background.js          # Service Worker：下载兜底 / 跳转链追踪
├── content/               # 内容脚本：页面分析 + 拦截浮层
├── rules/                 # 检测规则（iocs.js）+ 评分引擎（analyzer.js）
├── ui/                    # 弹窗 / 设置 / 欢迎页
├── icons/                 # 扩展图标（16/48/128）
└── icon-src/              # 图标矢量源（shield.svg）
```

## 📜 许可证

原算法与部分规则来自 [Lolitide/VirusDetector](https://github.com/Lolitide/VirusDetector)，以 MIT License 发布。
本改良版（SilverFox Guard）同样以 MIT License 发布，详见 [LICENSE](./LICENSE)。
