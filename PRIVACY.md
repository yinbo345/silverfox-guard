# 隐私政策 / Privacy Policy

**银狐防护 · SilverFox Guard**（以下简称"本扩展"）

生效日期 / Effective Date：2026-08-23（对应版本 v1.4.5）

---

## 一、我们收集什么 / What we collect

本扩展核心防护能力**完全在您的浏览器本地运行**，所有网页分析均在您设备上的内容脚本与后台服务中完成。

我们**不收集、不上传、不传输**您的浏览历史、书签、Cookie、登录凭据、表单输入，以及任何可识别个人身份的信息（姓名、邮箱、电话、IP 地址等）。

除用户主动触发的下载，以及下文明确说明的可选云端 AI 分析外，本扩展自动发出的网络请求包括两类：

1. **域名年龄查询。** 为判断一个网站是否新注册（银狐木马常使用新域名投递），本扩展仅将网站的**注册域名**（例如 `example.com`，不含路径、参数或页面内容）发送给公共 RDAP / WHOIS 服务器。该请求不包含您的任何个人信息，也不包含所访问页面的任何内容。

2. **资源解析请求。** 为识别经脚本跳转、页面内嵌直链、重定向转发、文本文件内藏匿地址等伪装的钓鱼或木马下载投递，扩展会在您访问的页面上下文内，按需向该网页所引用的资源地址发起有限的网络请求（如脚本内直链、meta refresh 跳转目标、iframe 内嵌资源、重定向目标、同域文本文件等），用于解析其真实指向。此类请求遵循以下原则：仅用于本地风险判定，请求不发往本扩展运营方的服务器；跨站请求不携带您的登录凭据（不发送 Cookie），仅读取资源响应以判断其真实地址；不收集、不上传任何个人信息。

**另有一次用户主动触发的下载行为。** 在「银狐急救」功能中，当用户点击下载按钮时，扩展通过浏览器标准下载 API 从 360 官方域名 `dl.360safe.com` 拉取 360 系统急救箱压缩包。该请求仅为文件下载、不含任何个人信息，扩展也不会执行或读取该文件内容。

We do not collect, upload, or transmit your browsing history, bookmarks, cookies, credentials, form inputs, or any personally identifiable information (name, email, phone, IP, etc.). Apart from user-initiated downloads and the optional cloud AI analysis described below, the extension makes two kinds of automatic outbound network requests:

1. **Domain-age lookup.** To judge whether a site is newly registered (a common SilverFox delivery tactic), the extension sends **only the registrable domain** (e.g. `example.com`, without path, query, or page content) to public RDAP/WHOIS servers. This request contains no personal data and no page content.

2. **Resource-resolution requests.** To detect phishing or trojan download delivery disguised through script redirects, in-page direct links, redirect forwarding, or addresses hidden inside text files, the extension may, within the context of the page you are visiting, issue limited network requests to resource URLs referenced by that page (such as script-embedded links, meta-refresh targets, iframe-embedded resources, redirect targets, and same-origin text files) in order to resolve their true destination. These requests follow these principles: they are used only for on-device risk assessment and are not sent to the extension operator's servers; cross-origin requests carry no login credentials (no cookies are sent) and only read the resource response to determine its real address; no personal data is collected or uploaded.

**There is also one user-initiated download.** In the "SilverFox Rescue" feature, when the user clicks the download button, the extension uses the browser's standard download API to fetch the 360 System Rescue Box archive from 360's official domain `dl.360safe.com`. This request is purely a file download carrying no personal data, and the extension does not execute or read the file's contents.

---

## 二、可选的云端 AI 分析（默认关闭）/ Optional cloud AI analysis (OFF by default)

自 v1.4.5 起，本扩展提供「Max 模式」下的可选云端 AI 增强。该功能**默认关闭**，需您在设置中主动开启后才会生效。开启后，扩展会在以下两种场景下向您所配置的 AI 服务商发送数据：

1. **网页风险 AI 分析**（`aiCloudWebAnalyse` 开启时）
   - 发送内容：当前页面的**正文文本、页面 URL、页面标题**。
   - 不发送：账号、密码、Cookie、表单输入、浏览历史。

2. **文件扫描 AI 辅助分析**（`aiScanFileAnalyse` 开启时）
   - 发送内容：本地扫描引擎**提取的可疑特征摘要**，包括文件名、文件大小、文件类型魔数、命中的本地规则等**元数据**，**不含文件正文内容**。
   - 不发送：文件完整内容、文件内的个人文档数据。

**AI 服务商与传输安全**
- 您可在设置中选择 AI 服务商：智谱 GLM（默认）、DeepSeek、OpenAI、Moonshot，或自定义兼容接口。
- 上述数据均通过 **HTTPS** 加密传输，并使用您配置或扩展内置的 **API Key** 进行鉴权。
- 扩展内置的免费模型 Key 仅供试用，您可随时替换为自己的 Key；Key 仅保存在您的浏览器本地存储，不会回传给我们。
- 我们（扩展开发者）**不运营任何 AI 服务器**，也不经手上述 AI 请求的数据。AI 服务商如何处理这些数据，遵循其各自的隐私政策。

**Starting with v1.4.5**, the extension offers an optional cloud AI enhancement under "Max Mode". It is **OFF by default** and only activates when you explicitly enable it. When enabled, the extension sends data to your chosen AI provider in two scenarios:

1. **Web-page risk AI analysis** (when `aiCloudWebAnalyse` is on): the page's **body text, page URL, and page title**. It does NOT send accounts, passwords, cookies, form inputs, or browsing history.
2. **File-scan AI assistance** (when `aiScanFileAnalyse` is on): a **suspicious-feature summary extracted locally** — file name, size, file-type magic bytes, and matched local rules (metadata only), **not the file's contents**.

All such data is sent over **HTTPS** with API-key authentication to the provider you selected (Zhipu GLM by default, or DeepSeek / OpenAI / Moonshot / custom). We, the developer, **operate no AI servers** and never handle that data; the provider's own privacy policy governs it.

---

## 三、数据存储 / Data storage

- 您的设置（灵敏度、开关、白名单、自定义 API Key）通过浏览器本地 `storage` 保存，仅存于本机，不与任何服务器同步。
- 拦截统计仅保存在本地，用于扩展内展示，不上传任何服务器。

Your settings (sensitivity, toggles, allowlist, custom API keys) are stored locally via the browser's `storage` API and never synced to any server. Blocking statistics remain on-device and are never uploaded.

---

## 四、远程代码 / Remote code

本扩展**不包含任何远程托管的脚本**。所有检测逻辑、规则与评分引擎都随扩展一并打包，运行时不从网络加载任何可执行脚本。可选的云端 AI 分析仅通过标准 HTTPS 接口向您所配置的 AI 服务商发送上文所述的数据并接收文本结论，不构成加载或执行远程代码。

The extension **does not use any remotely hosted executable scripts**. All detection logic, rules, and the scoring engine are bundled with the package; no executable script is loaded from the network at runtime. The optional cloud AI analysis only sends the data described above and receives a text verdict via a standard HTTPS API; it does not load or execute remote code.

---

## 五、第三方共享 / Third parties

我们不与任何第三方共享、出售或交易您的个人数据。除上文所述的公共 RDAP 查询、资源解析请求（仅本地读取响应以判定真实地址，不构成数据共享）、「银狐急救」中用户主动触发的 360 官方工具下载，以及您主动开启的可选云端 AI 分析（数据发往您自选的 AI 服务商）外，本扩展不调用任何第三方服务、广告或分析平台。前述 360 下载仅向用户设备保存文件，资源解析请求仅用于本地风险判定，AI 分析仅在您开启后按您选择的服务商进行，均不构成任何用户个人数据的被动共享。

We do not share, sell, or trade your personal data with any third party. Apart from the public RDAP lookup, the resource-resolution requests described above (read locally only), the user-initiated download of 360's official rescue tool, and the optional cloud AI analysis you explicitly enable (data goes to your chosen AI provider), the extension calls no third-party services, advertising, or analytics platforms.

---

## 六、用户控制 / Your controls

- 可随时在扩展设置中全局关闭防护；
- 可将信任的网站加入白名单；
- 云端 AI 功能默认关闭；关闭 Max 模式或对应子开关后，扩展不再向任何 AI 服务商发送数据；
- 可清除本地统计，可随时替换或清除 API Key。

You may disable protection globally at any time, add trusted sites to the allowlist, and clear local statistics. The cloud AI feature is OFF by default; once you turn off Max Mode or the relevant sub-toggle, the extension stops sending any data to AI providers. You can also clear or replace your API key at any time.

---

## 七、儿童 / Children

本扩展不面向 13 岁以下儿童，也不故意收集儿童信息。

The extension is not directed to children under 13 and does not knowingly collect their information.
