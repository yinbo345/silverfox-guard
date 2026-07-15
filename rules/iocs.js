/*
 * iocs.js — 银狐(Silver Fox / 游蛇)木马投递网站特征库
 * 数据来源：CNCERT / 安天 官方通报 + 参考 VirusDetector 开源实现(domain-database / icp-utils)。
 * 同时被 content script 与 background service worker 加载，兼容 window / self / node。
 */
(function () {
  'use strict';

  // ============ 可信官方域名（精确匹配 + 子域匹配；命中即「早期退出」判为安全，永不拦截）============
  // 覆盖银狐最常仿冒的目标：办公 / IM / 浏览器 / 安全 / 网盘 / AI / 下载工具 / 压缩 / 电商 / 支付 / 系统工具 / 游戏 / 加速器 / 新闻 等
  const OFFICIAL_DOMAINS = [
    // 安全软件
    '360.cn','360.com','huorong.cn','guanjia.qq.com','gj.qq.com','rising.com.cn','duba.net','ijinshan.com','threatbook.cn','threatbook.com',
    // 浏览器
    'browser.360.cn','se.360.cn','chromex.360.cn','browser.qq.com','liulanqi.qq.com','ie.sogou.com','liebao.cn','maxthon.cn','maxthon.com','mozilla.org','firefox.com','google.com','google.cn','google.com.hk','googlemail.com','gmail.com','microsoft.com',
    // IM / 社交
    'weixin.qq.com','wechat.com','im.qq.com','qq.com','dingtalk.com','feishu.cn','larkoffice.com','work.weixin.qq.com','office.qq.com','immomo.com','soulapp.cn','uc.cn','ucweb.com',
    // 输入法
    'pinyin.sogou.com','shurufa.sogou.com','shurufa.baidu.com','ime.baidu.com','srf.xunfei.cn','qq.pinyin.cn','xinshuru.com',
    // 办公
    'wps.cn','wps.com','kdocs.cn','docs.qq.com','shimo.im','yozosoft.com',
    // 视频
    'v.qq.com','iqiyi.com','iq.com','youku.com','bilibili.com','mgtv.com','ixigua.com','tv.sohu.com','sohu.com',
    // 音乐
    'music.163.com','y.qq.com','music.qq.com','kugou.com','kuwo.cn','qishui.com','music.migu.cn','migu.cn',
    // 云盘
    'pan.baidu.com','aliyundrive.com','alipan.com','weiyun.com','115.com','cloud.189.cn','pan.quark.cn','pan.xunlei.com',
    // AI
    'yiyan.baidu.com','chat.baidu.com','tongyi.aliyun.com','qianwen.aliyun.com','qianwen.com','dashscope.console.aliyun.com','doubao.com','volcengine.com','xinghuo.xfyun.cn','agent.xfyun.cn','chat.360.com','ai.360.com','ai.360.cn','kimi.moonshot.cn','kimi.com','platform.kimi.com','api.moonshot.cn','chat.deepseek.com','deepseek.com','platform.deepseek.com','chatglm.cn','bigmodel.cn','open.bigmodel.cn','openai.com','chatgpt.com','platform.openai.com',
    // 下载工具
    'xunlei.com','dl.xunlei.com','mobile.xunlei.com','internetdownloadmanager.com','secure.internetdownloadmanager.com','bitcomet.com','wiki-zh.bitcomet.com',
    // 压缩
    'rarlab.com','win-rar.com','winrar.com.cn','7-zip.org','bandisoft.com','bandizip.com','haozip.2345.cc','yasuo.360.cn',
    // 电商
    'taobao.com','tmall.com','jd.com','pinduoduo.com','meituan.com','suning.com','goofish.com',
    // 地图 / 出行
    'map.baidu.com','amap.com','gaode.com','www.autonavi.com','ditu.amap.com','mobile.amap.com','didiglobal.com','map.qq.com',
    // 支付
    'alipay.com','alipayplus.com','open.alipay.com','p.alipay.com','pay.weixin.qq.com','api.mch.weixin.qq.com','api2.mch.weixin.qq.com','payapp.weixin.qq.com','action.weixin.qq.com','api.wechatpay.cn','api2.wechatpay.cn',
    // 开发者 / 云
    'aliyun.com','aliyuncs.com','alibabacloud.com','cloud.tencent.com','tencentcloud.com','huaweicloud.com','cloud.baidu.com','intl.cloud.baidu.com','csdn.net','oschina.net','gitee.com','juejin.cn','v2ex.com','github.com','github.io',
    // 系统工具
    'drivergenius.com','ludashi.com','cpuid.com','todesk.com','todeskai.com','sunlogin.oray.com','oray.com','teamviewer.com','anydesk.com','lenovo.com.cn','lenovo.com',
    // 游戏平台
    'wegame.com.cn','wegame.com','minecraft.net','minecraft.wiki','mojang.com','steamchina.com','store.steamchina.com','help.steamchina.com','game.163.com','neteasegames.com',
    // 加速器
    'uu.163.com','xunyou.com','leigod.com','qiyou.cn','yuelun.com','xianniu.com','jiasu.bohe.com','fnjiasu.com','golinkcn.com','xiaoheihe.cn','acc.xiaoheihe.cn','tmgalite.qq.com','nn.com','akspeedy.com',
    // 新闻 / 信息
    'toutiao.com','baidu.com','zhihu.com',
    // 搜索引擎（独立域名，避免中文搜索时被 ICP 缺失败误判）
    'bing.com','sogou.com','so.com','yahoo.com','duckduckgo.com','yandex.com','ask.com'
  ];

  // ============ 品牌关键词（用于域名仿冒检测：段匹配 / 子串 / 堆叠 / 编辑距离；命中但非官方域 → 仿冒）============
  const BRAND_KEYWORDS = [
    'wechatpay','微信支付','alipay','支付宝','deepseek','chatglm','智谱清言','kimi','openai','chatgpt','doubao','豆包','tongyi','通义千问','xinghuo','讯飞星火','yiyan','文心一言',
    'bilibili','哔哩哔哩','iqiyi','爱奇艺','youku','优酷','mgtv','芒果tv','kugou','酷狗','kuwo','酷我','netease','网易云音乐','qqmusic','qq音乐','weiyun','腾讯微云','aliyundrive','阿里云盘',
    'quark','夸克网盘','baidupan','百度网盘','wps','金山办公','wegame','腾讯游戏平台','steamchina','蒸汽平台','dingtalk','钉钉','feishu','飞书','weixin','微信','wechat','企业微信','todesk','向日葵',
    'sunlogin','teamviewer','anydesk','lenovo','联想','360安全卫士','huorong','火绒','qq','腾讯qq','sougou','搜狗','pinyin','输入法','baidu','百度','taobao','淘宝','tmall','天猫','jd','京东',
    'pinduoduo','拼多多','meituan','美团','aliyun','阿里云','tencent','腾讯云','huawei','华为云','csdn','gitee','github','juejin','掘金','zhihu','知乎','toutiao','今日头条','amap','高德','didiglobal','滴滴',
    'xunlei','迅雷','winrar','7-zip','bandizip','2345','好压','ludashi','鲁大师','drivergenius','驱动精灵','qqbrowser','qq浏览器','chrome','谷歌浏览器','firefox','火狐','edge','microsoft','mozilla',
    'moonshot','月之暗面','volcengine','火山引擎','xfyun','科大讯飞','bigmodel','wechat','android','chrome','clash','verge','potplayer','蓝奏云','lanzou','金蝶','kingdee','用友','ufida','航天信息','金税','税控','财务','erp'
  ];

  // 与"下载 / 安装"相关的上下文词
  const DOWNLOAD_KEYWORDS = [
    '下载', 'download', '安装', 'install', '官方版', '最新版', '正版', '免费版',
    '高速下载', '安全下载', '本地下载', '立即下载', '一键安装', '极速下载', '客户端', '安装包', '完整版'
  ];

  // 社会工程 / 钓鱼诱导话术（银狐投递文档、群聊话术）
  const SOCIAL_ENGINEERING = [
    '内部', '内部通知', '最新通知', '违纪', '通报', '裁员', '补偿', '名单', '工资明细', '工资', '薪资',
    '付款单据', '社保补贴', '会议资料', '政策文件', '成绩单', '电子发票', '发票', '薪资', '薪酬',
    '加qq群', '加q群', 'qq群', '客服微信', '扫码领取', '免费激活', '破解', '注册机', '激活工具',
    '内部版', '远程协助', '验证码', '领取', '福利', '限时', '红包', '返利', '兼职', '中奖', '公检法',
    '安全账户', '转账', '涉案', '通缉', '保密协议', '人事', '离职', '劳动合同', '培训资料', '学习资料', '课程资料'
  ];

  // 假冒官方话术
  const FAKE_OFFICIAL = [
    '官方下载', '官网认证', '官网正版', '安全下载', '高速下载', '防病毒误报', '杀软误报', '杀毒软件误报',
    '加白名单', '本地下载', '电信下载', '联通下载', '普通下载', '绿色版', '纯净版', '无插件', '官方授权',
    '这是安全的', '无毒', '官网下载', '正版下载', '官方正版'
  ];

  // 银狐黑产偏好的低成本 / 批量注册 TLD
  const SUSPICIOUS_TLDS = [
    'top', 'xyz', 'live', 'shop', 'vip', 'cc', 'ren', 'wang', 'pw', 'click', 'link',
    'online', 'fun', 'rest', 'icu', 'buzz', 'work', 'date', 'trade', 'country', 'stream',
    'gq', 'cf', 'ml', 'tk', 'ga', 'nic', 'cyou', 'red', 'ink', 'mobi', 'pro', 'ltd', 'store',
    'win', 'xin', 'buzz', 'racing', 'monster', 'download', 'loan', 'icu', 'su', 'ru'
  ];

  // 常见网盘 / 云盘分发域名（二级或主域关键词）
  const CLOUD_DISK_HOSTS = [
    'aliyundrive.com', 'alipan.com', 'pan.baidu.com', 'weiyun.com',
    'pan.quark.cn', 'lanzou', 'lanzoux', 'lanzous', '123pan.com', '123912.com',
    'ctfile.com', 'cowtransfer', 'airportal', 'firefoxchina.cn', 'mediafire.com',
    'drive.google.com', 'dropbox.com', 'mega.nz', 'pan.xunlei.com', 'cloud.189.cn'
  ];

  // 强可疑可执行文件扩展名（一旦下载基本就是木马载体）
  const EXEC_EXTENSIONS = ['exe', 'msi', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'ps1', 'jar', 'lnk', 'cpl', 'wsf', 'hta', 'dll', 'sys'];
  // 中风险压缩包扩展名（需结合其它信号才判危）
  const ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z', 'gz', 'tar', 'iso', 'img', 'tgz', 'bz2', 'xz', 'z', 'cab', 'arj', 'lzh', 'zst', 'apk'];

  // JS 混淆 / 打包特征（基于网页代码分析）
  const OBFUSCATION_PATTERNS = [
    /eval\s*\(\s*function\s*\([\s\S]{0,40}?\)\s*\{[\s\S]{0,80}?return[\s\S]{0,120}?\}\s*\(\s*\d+\s*,/i, // packed 打包器
    /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){20,}/i, // 超长十六进制转义串
    /(?:fromCharCode|String\.fromCharCode)\s*\((?:0x[0-9a-f]+|\d+)\s*(?:,[^)]{0,200}?){8,}/i, // 大量 fromCharCode
    /atob\s*\(\s*['"][A-Za-z0-9+/=]{120,}/i, // 超长 base64 字面量
    /_0x[a-f0-9]{4,}\s*=[\s\S]{0,30}?\[['"][a-z0-9]+['"]\]/, // 典型十六进制变量混淆
    /(unescape|decodeURIComponent)\s*\(\s*['"]%[0-9a-f]{2}/i, // % 编码混淆
    /document\.write\s*\(\s*unescape\s*\(/, // 经典加密落地
    /var\s+_0x[0-9a-f]+\s*=\s*\[/i, // 混淆变量数组
    /javascript\s*:\s*(?:eval|atob|decodeURIComponent)\s*\(/i
  ];

  // 虚拟机 / 沙箱环境检测（银狐 loader 强特征）
  const VM_DETECTION_PATTERNS = [
    /navigator\.hardwareConcurrency/i,
    /navigator\.plugins\.length/i,
    /navigator\.maxTouchPoints/i,
    /screen\.(width|height|availWidth)/i,
    /window\.external/i,
    /GetModuleHandle|IsDebuggerPresent|CreateToolhelp32Snapshot/i,
    /VirtualBox|VMware|QEMU|Parallels|Hyper\-?V|Oracle VM/i,
    /wmi|Win32_Processor|SELECT\s+\*?\s+FROM/i,
    /cpuz|speccy|sandboxie|wireshark/i,
    /mac\s+address|bios|motherboard/i,
    /(?:\b|_)debugger\b|anti[_-]?debug|antiDebug|__debugger/i,
    /(?:detect[\s_]?vm|isVM|vmDetect|checkVM|sandboxCheck)/i
  ];

  // 已知恶意脚本片段 / C2 行为特征（通用、低误报）
  const KNOWN_BAD_SNIPPETS = [
    /powershell\s+\-nop\s+\-w\s+hidden/i,
    /certutil\s+\-urlcache\s+\-split\s+\-f/i,
    /bitsadmin\s+\/transfer/i,
    /rundll32\s*\(/i,
    /regsvr32\s+\/s\s+/i,
    /WScript\.Shell/i,
    /ShellExecute\s*\(/i,
    /CreateObject\s*\(\s*['"]WScript/i,
    /\\AppData\\Roaming|%AppData%|%Temp%|%TEMP%/i,
    /taskkill\s+\/f\s+\/im/i,
    /netsh\s+firewall|netsh\s+advfirewall/i,
    /schtasks\s+\/create/i,
    /CurrentControlSet\\Services/i
  ];

  // 重定向 / 注入检测
  const REDIRECT_PATTERNS = [
    /<meta[^>]+http\-equiv\s*=\s*['"]?refresh/i, // meta refresh 跳转
    /location\.(href|replace|assign)\s*=\s*['"][^'"]+/i,
    /window\.open\s*\(\s*['"][^'"]+/i,
    /setTimeout\s*\(\s*function[\s\S]{0,40}?location/i,
    /<iframe[^>]+src\s*=\s*['"](https?:)?\/\/(?!(?:www\.)?(?:youtube|google|gstatic|googleapis|w3\.org|alicdn|bdimg|baidustatic))[^'"]+/i
  ];

  // ============ 链接分类（供拦截逻辑使用）============
  function classifyLink(href) {
    if (!href) return 'other';
    const h = href.toLowerCase();
    if (/^(javascript:|#|mailto:|tel:)/i.test(href)) return 'other';
    for (const e of EXEC_EXTENSIONS) if (h.endsWith('.' + e)) return 'exec';
    for (const e of ARCHIVE_EXTENSIONS) if (h.endsWith('.' + e)) return 'archive';
    for (const c of CLOUD_DISK_HOSTS) if (h.indexOf(c) !== -1) return 'cloud';
    if (/download|\.exe|安装包|客户端|完整版|破解|激活|注册机|绿色版|免费版/i.test(href)) return 'download';
    return 'other';
  }

  const API = {
    OFFICIAL_DOMAINS,
    BRAND_KEYWORDS,
    DOWNLOAD_KEYWORDS,
    SOCIAL_ENGINEERING,
    FAKE_OFFICIAL,
    SUSPICIOUS_TLDS,
    CLOUD_DISK_HOSTS,
    EXEC_EXTENSIONS,
    ARCHIVE_EXTENSIONS,
    OBFUSCATION_PATTERNS,
    VM_DETECTION_PATTERNS,
    KNOWN_BAD_SNIPPETS,
    REDIRECT_PATTERNS,
    classifyLink
  };

  if (typeof window !== 'undefined') window.SF_IOCS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
