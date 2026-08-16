# 隐私政策 / Privacy Policy

**银狐防护 · SilverFox Guard**（以下简称"本扩展"）

生效日期 / Effective Date：2026-08-16

---

## 一、我们收集什么 / What we collect

本扩展**完全在您的浏览器本地运行**，所有网页分析均在您设备上的内容脚本与后台服务中完成。

我们**不收集、不上传、不传输**以下任何信息：

- 您浏览的网页内容、表单输入、登录凭据；
- 您的浏览历史、书签、Cookie；
- 任何可识别个人身份的信息（姓名、邮箱、电话、IP 地址等）；
- 您的下载文件内容。

**除用户主动触发的下载外，本扩展自动发出的网络请求包括两类：**

1. **域名年龄查询。** 为判断一个网站是否新注册（银狐木马常使用新域名投递），本扩展仅将网站的**注册域名**（例如 `example.com`，不含路径、参数或页面内容）发送给公共 RDAP / WHOIS 服务器。该请求不包含您的任何个人信息，也不包含所访问页面的任何内容。

2. **资源解析请求。** 为识别经脚本跳转、页面内嵌直链、重定向转发、文本文件内藏匿地址等伪装的钓鱼或木马下载投递，扩展会在您访问的页面上下文内，按需向该网页所引用的资源地址发起有限的网络请求（如脚本内直链、meta refresh 跳转目标、iframe 内嵌资源、重定向目标、同域文本文件等），用于解析其真实指向。此类请求遵循以下原则：仅用于本地风险判定，请求不发往本扩展运营方的服务器；跨站请求不携带您的登录凭据（不发送 Cookie），仅读取资源响应以判断其真实地址；不收集、不上传任何个人信息。

**另有一次用户主动触发的下载行为。** 在「银狐急救」功能中，当用户点击下载按钮时，扩展通过浏览器标准下载 API 从 360 官方域名 `dl.360safe.com` 拉取 360 系统急救箱压缩包。该请求仅为文件下载、不含任何个人信息，扩展也不会执行或读取该文件内容。

We **do not collect, upload, or transmit** any of the following: page content you browse, form inputs, credentials, browsing history, bookmarks, cookies, or any personally identifiable information (name, email, phone, IP, etc.). Apart from user-initiated downloads, the extension makes two kinds of automatic outbound network requests:

1. **Domain-age lookup.** To judge whether a site is newly registered (a common SilverFox delivery tactic), the extension sends **only the registrable domain** (e.g. `example.com`, without path, query, or page content) to public RDAP/WHOIS servers. This request contains no personal data and no page content.

2. **Resource-resolution requests.** To detect phishing or trojan download delivery disguised through script redirects, in-page direct links, redirect forwarding, or addresses hidden inside text files, the extension may, within the context of the page you are visiting, issue limited network requests to resource URLs referenced by that page (such as script-embedded links, meta-refresh targets, iframe-embedded resources, redirect targets, and same-origin text files) in order to resolve their true destination. These requests follow these principles: they are used only for on-device risk assessment and are not sent to the extension operator's servers; cross-origin requests carry no login credentials (no cookies are sent) and only read the resource response to determine its real address; no personal data is collected or uploaded.

**There is also one user-initiated download.** In the "SilverFox Rescue" feature, when the user clicks the download button, the extension uses the browser's standard download API to fetch the 360 System Rescue Box archive from 360's official domain `dl.360safe.com`. This request is purely a file download carrying no personal data, and the extension does not execute or read the file's contents.

---

## 二、数据存储 / Data storage

- 您的设置（灵敏度、开关、白名单）通过浏览器本地 `storage` 保存，仅存于本机，不与任何服务器同步。
- 拦截统计仅保存在本地，用于扩展内展示，不上传任何服务器。

Your settings (sensitivity, toggles, allowlist) are stored locally via the browser's `storage` API and never synced to any server. Blocking statistics remain on-device and are never uploaded.

---

## 三、远程代码 / Remote code

本扩展**不包含任何远程代码或远程托管的脚本**。所有检测逻辑、规则与评分引擎都随扩展一并打包，运行时不从网络加载任何可执行脚本。这既保障了性能，也避免了供应链攻击风险。

The extension **does not use any remotely hosted code or scripts**. All detection logic, rules, and the scoring engine are bundled with the package; no executable script is loaded from the network at runtime.

---

## 四、第三方共享 / Third parties

我们不与任何第三方共享、出售或交易您的数据。除上文所述的公共 RDAP 查询、资源解析请求（仅本地读取响应以判定真实地址，不构成数据共享），以及「银狐急救」中用户主动触发的 360 官方工具下载外，本扩展不调用任何第三方服务、广告或分析平台。前述 360 下载仅向用户设备保存文件，资源解析请求仅用于本地风险判定，均不构成任何用户数据共享。

We do not share, sell, or trade your data with any third party. Apart from the public RDAP lookup and the resource-resolution requests described above (read locally only to determine a resource's true address, not constituting data sharing), and the user-initiated download of 360's official rescue tool in the "SilverFox Rescue" feature, the extension calls no third-party services, advertising, or analytics platforms. That 360 download only saves a file to the user's device, and the resource-resolution requests are used only for on-device risk assessment; neither constitutes any sharing of user data.

---

## 五、用户控制 / Your controls

- 可随时在扩展设置中全局关闭防护；
- 可将信任的网站加入白名单；
- 可清除本地统计。

You may disable protection globally at any time, add trusted sites to the allowlist, and clear local statistics from the settings page.

---

## 六、儿童 / Children

本扩展不面向 13 岁以下儿童，也不故意收集儿童信息。

The extension is not directed to children under 13 and does not knowingly collect their information.

---

## 七、政策变更 / Changes

若本政策变更，将在本页面更新，并随扩展版本说明告知用户。

If this policy changes, the update will be published on this page and noted in the extension's release notes.

---

## 八、联系我们 / Contact

如对本政策有疑问，可通过项目仓库 Issues 联系：

https://github.com/yinbo345/silverfox-guard/issues
