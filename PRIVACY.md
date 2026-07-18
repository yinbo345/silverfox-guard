# 隐私政策 / Privacy Policy

**银狐防护 · SilverFox Guard**（以下简称"本扩展"）

生效日期 / Effective date：2026-07-18

---

## 一、我们收集什么 / What we collect

本扩展**完全在您的浏览器本地运行**，所有网页分析均在您设备上的内容脚本与后台服务中完成。

我们**不收集、不上传、不传输**以下任何信息：

- 您浏览的网页内容、表单输入、登录凭据；
- 您的浏览历史、书签、Cookie；
- 任何可识别个人身份的信息（姓名、邮箱、电话、IP 地址等）；
- 您的下载文件内容。

**唯一对外发出的网络请求是"域名年龄查询"。** 为判断一个网站是否新注册（银狐木马常使用新域名投递），本扩展仅将网站的**注册域名**（例如 `example.com`，不含路径、参数或页面内容）发送给公共 RDAP / WHOIS 服务器。该请求不包含您的任何个人信息，也不包含所访问页面的任何内容。

We **do not collect, upload, or transmit** any of the following: page content you browse, form inputs, credentials, browsing history, bookmarks, cookies, or any personally identifiable information (name, email, phone, IP, etc.). The **only** outbound network request is a domain-age lookup: to judge whether a site is newly registered (a common SilverFox delivery tactic), the extension sends **only the registrable domain** (e.g. `example.com`, without path, query, or page content) to public RDAP/WHOIS servers. This request contains no personal data and no page content.

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

我们不与任何第三方共享、出售或交易您的数据。除上文所述的公共 RDAP 查询外，本扩展不调用任何第三方服务、广告或分析平台。

We do not share, sell, or trade your data with any third party. Apart from the public RDAP lookup described above, the extension calls no third-party services, advertising, or analytics platforms.

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
