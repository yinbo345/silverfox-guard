# Edge 扩展商店上架素材包 / Edge Add-ons Submission Package

扩展：**银狐防护 · SilverFox Guard** ｜ 版本：**v1.2.2** ｜ Manifest V3

> 本文件供你（开发者）在 Microsoft Partner Center 提交时使用，所有文案、权限理由、测试说明均已按 Edge 审核要求起草。

---

## 1. 商店文案 / Store listing

- **名称（锁定自 manifest，商店页面只读，不可改）：** 银狐防护 · SilverFox Guard
- **简短描述（Short description，≤ 132 字符）：**
  - 中文：识别并拦截银狐（游蛇）木马网站，命中风险特征即警告并阻断其下载与跳转。
  - English: Detects and blocks SilverFox (YouShe) trojan phishing sites, warning users and stopping malicious downloads.
- **详细描述（Detailed description）：**
  - 中文：银狐防护是一款专注于银狐（游蛇）木马投递网站的防护扩展。它通过本地代码分析识别仿冒官网、新注册域名、隐藏的压缩包/可执行下载、可疑跳转链等风险特征，命中即弹出警告并默认阻断该页面的全部下载通道，待确认安全后再放行。所有分析均在浏览器本地完成，不上传任何页面内容，不加载远程代码。
  - English: SilverFox Guard protects against SilverFox (YouShe) trojan delivery sites. It analyzes page code locally to detect spoofed official sites, newly registered domains, hidden archive/executable downloads, and suspicious redirect chains. On a match it warns the user and blocks all downloads from that page by default, releasing them only after the page is confirmed safe. All analysis runs locally in the browser—no page content is uploaded and no remote code is loaded.
- **搜索关键词 / Search keywords（中英文都填）：**
  - 中文：银狐，银狐木马，游蛇，木马，钓鱼，仿冒，下载拦截，银狐防护
  - English: SilverFox, YouShe, trojan, malware, phishing, spoof, download blocker, scam

---

## 2. 权限理由 / Permission justifications

Edge 提交时必须逐条说明权限用途，按下表填写：

| 权限 | 类型 | 用途说明（填入商店表单） |
|------|------|--------------------------|
| `<all_urls>` | host_permissions | 需在用户访问的所有网站上注入内容脚本，以读取页面 DOM 并分析代码特征，识别仿冒站与木马投递行为。 |
| `downloads` | permissions | 拦截并取消来自危险网站的恶意下载（可执行文件、压缩包等），是核心防护能力。 |
| `webNavigation` | permissions | 追踪页面跳转链，将"秒跳下载"正确归因到来源危险站点，避免拦截归属失败。 |
| `storage` | permissions | 保存用户设置（灵敏度、开关、白名单）与本地拦截统计，仅存于本机。 |
| `notifications` | permissions | 在检测到危险网站或下载时向用户弹出警告通知。 |
| `activeTab` | permissions | 用户主动点击扩展图标时，读取当前标签页信息以展示检测结果详情。 |

> 所有权限均为本地功能所需，无广告、无追踪、无远程代码。

---

## 3. 远程代码声明 / Remote code declaration

**本扩展不使用任何远程托管的代码或脚本。** 所有检测逻辑、规则与评分引擎均随包打包，运行时不从网络加载任何可执行脚本。

→ 在提交表单的"Does your extension use remote code?"一问中选择 **No（否）**。这对审核是加分项。

---

## 4. 测试说明（给微软审核员）/ Test notes for Microsoft reviewers

请在安装本扩展后，使用以下站点验证防护效果：

1. 访问 `https://download.chrome-china.net/d.php` —— 应被识别为仿冒站（仿冒 Chrome 官方下载），其自动触发的 `.zip` 下载应被阻断。
2. 访问 `https://rpcs3.io`（仿冒官方 `rpcs3.net`）—— 应判定为危险并拦截。
3. 访问任意正常网站（如 `https://www.wikipedia.org`）—— 应正常放行，下载不受任何阻碍。
4. 点击扩展图标，弹出面板可查看当前页检测详情与设置项。

> 注意：测试站点 1、2 为真实恶意/仿冒站点，仅供审核验证，请勿在无关环境中访问。

---

## 5. 隐私政策 URL / Privacy policy URL

- GitHub Pages（推荐，构建完成后使用）：`https://yinbo345.github.io/silverfox-guard/PRIVACY.md`
- 备用直链（立即可用）：`https://raw.githubusercontent.com/yinbo345/silverfox-guard/main/PRIVACY.md`

---

## 6. 上架步骤清单 / Step-by-step checklist

1. 用 **Microsoft 账号**（Outlook / GitHub 等绑定的 MSA）登录 [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/)。
2. 进入 **Edge** 板块，注册/加入 **Edge 开发者计划**（**免费，无注册费**）。
3. 新建"**扩展**"提交，上传发行包 `silverfox-guard-v1.2.2.zip`（位于 `D:\silverfox-guard-dist\`，或直接用 GitHub Release 资产）。
4. 填写商店文案（见第 1 节）。
5. 填写**隐私政策 URL**（见第 5 节）。
6. 逐条填写**权限理由**（见第 2 节）。
7. 声明**无远程代码**（见第 3 节）。
8. 粘贴**测试说明**（见第 4 节）。
9. 提交审核，等待微软审核（通常数个工作日）。
10. 审核通过后点击发布。

---

## 7. 发行包信息 / Package

- 文件名：`silverfox-guard-v1.2.2.zip`
- 格式：ZIP（扁平结构，manifest.json 位于根，符合 Edge 要求）
- Manifest：V3
- 兼容性：Edge / Chrome 全兼容，无需改代码
- 图标：`icons/icon16.png`、`icon48.png`、`icon128.png` 均已包含
