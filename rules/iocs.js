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
    'yiyan.baidu.com','chat.baidu.com','tongyi.aliyun.com','qianwen.aliyun.com','qianwen.com','dashscope.console.aliyun.com','doubao.com','volcengine.com','xinghuo.xfyun.cn','agent.xfyun.cn','chat.360.com','ai.360.com','ai.360.cn','kimi.moonshot.cn','kimi.com','platform.kimi.com','api.moonshot.cn','moonshot.cn','chat.deepseek.com','deepseek.com','platform.deepseek.com','chatglm.cn','bigmodel.cn','open.bigmodel.cn','openai.com','chatgpt.com','platform.openai.com',
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
    'aliyun.com','aliyuncs.com','alibabacloud.com','cloud.tencent.com','tencentcloud.com','huaweicloud.com','cloud.baidu.com','intl.cloud.baidu.com','csdn.net','oschina.net','gitee.com','juejin.cn','v2ex.com','github.com',
    // 海外托管 / 部署平台的「厂商官网本体」（公司自有站点，非用户内容托管 → 可整体判安全）
    // ⚠️ 注意：用户内容托管子域（*.vercel.app / *.netlify.app / *.pages.dev / *.github.io 等）
    // 已迁至下方 TRUSTED_PLATFORMS。原因：这些平台任何人都能免费部署带 HTTPS 的站点，
    // 银狐完全可以在上面架仿冒投递站；把它们放进「完全豁免」名单等于给黑产留后门。
    // 迁移后它们仅跳过「域名仿冒」判定（避免误判），其余检测规则全部照常运行。
    'vercel.com','vercel.dev','netlify.com','cloudflare.com','render.com','heroku.com','replit.com',
    'gitlab.com','githubusercontent.com',
    // 海外安全认证 / SSL 证书颁发机构(CA) / 人机验证平台（银狐几乎不可能持有，一律判安全）
    'letsencrypt.org','digicert.com','sectigo.com','globalsign.com','ssl.com','entrust.com','comodo.com','geotrust.com',
    'thawte.com','verisign.com','identrust.com','zerossl.com','hcaptcha.com','recaptcha.net','gstatic.com','googleapis.com',
    // 系统工具
    'drivergenius.com','ludashi.com','cpuid.com','todesk.com','todeskai.com','sunlogin.oray.com','oray.com','teamviewer.com','anydesk.com','lenovo.com.cn','lenovo.com',
    'cpuid.com','hwmonitor.com','aida64.com','samsung.com','westerndigital.com','seagate.com','toshiba.com','dell.com','hp.com','acer.com','asus.com','gigabyte.com','msi.com','asrock.com','corsair.com','kingston.com','logitech.com','razer.com','coolermaster.com','noctua.at','nzxt.com','seasonic.com','antec.com','phanteks.com','lian-li.com','gskill.com','teamgroupinc.com','adata.com','crucial.com','micron.com',
    // 浏览器
    'brave.com','opera.com','vivaldi.com','yandex.com','torproject.org','maxthon.com','microsoft.com','mozilla.org','firefox.com','google.com','google.cn','google.com.hk','googlemail.com','gmail.com','apple.com','safari.com',
    // 办公 / 开发
    'microsoft.com','office.com','microsoft365.com','live.com','outlook.com','onenote.com','skype.com','zoom.us','webex.com','slack.com','discord.com','telegram.org','thunderbird.net','notepad-plus-plus.org','sublimetext.com','jetbrains.com','code.visualstudio.com','visualstudio.com','github.com',
    // 微软身份/云/认证域名（OAuth/SSO/登录中转页，极易被「microsoftonline 含 microsoft 子串」误判为仿冒；整体判安全）
    'microsoftonline.com','windows.net','login.windows.net','hotmail.com','msn.com','office365.com','azure.com','passport.com','passport.microsoft.com','azureedge.net',
    // 压缩 / 系统工具
    'rarlab.com','win-rar.com','winrar.com.cn','7-zip.org','bandisoft.com','bandizip.com','peazip.com','haozip.2345.cc','yasuo.360.cn','winzip.com','cpu-z.com','hwmonitor.com','aida64.com','crystaldiskmark.info','crystaldiskinfo.info','prime95.com','furmark.com','memtest86.com','techpowerup.com','gpuz.com','msi.com','afterburner.com',
    // 下载工具
    'internetdownloadmanager.com','secure.internetdownloadmanager.com','bitcomet.com','wiki-zh.bitcomet.com','freedownloadmanager.org','qbittorrent.org','utorrent.com','bittorrent.com','transmissionbt.com','aria2.github.io','motrix.app','xdown.org',
    // 安全软件
    'avast.com','avg.com','kaspersky.com','bitdefender.com','eset.com','mcafee.com','norton.com','symantec.com','trendmicro.com','malwarebytes.com','avira.com','drweb.com','panda.com','gdata.com','f-secure.com','sophos.com','comodo.com','zonealarm.com',
    // 媒体
    'adobe.com','photoshop.com','adobe.io','videolan.org','obsproject.com','audacityteam.org','ffmpeg.org',
    // 游戏平台
    'wegame.com.cn','wegame.com','minecraft.net','minecraft.wiki','mojang.com','steamchina.com','store.steamchina.com','help.steamchina.com','game.163.com','neteasegames.com','steampowered.com','steamgames.com','epicgames.com','gog.com','origin.com','ea.com','ubisoft.com','uplay.com','playstation.com','xbox.com','nintendo.com','battle.net','blizzard.com',
    // 主机模拟器（RPCS3 官方 rpcs3.net、PCSX2、PPSSPP、Yuzu、Ryujinx、Cemu、Dolphin、Citra、DuckStation 等）
    'rpcs3.net','pcsx2.net','ppsspp.org','yuzu-emu.org','ryujinx.org','cemu.info','dolphin-emu.org','citra-emu.org','duckstation.org','xenia.jp','rpcs3.org',
    // 加速器
    'uu.163.com','xunyou.com','leigod.com','qiyou.cn','yuelun.com','xianniu.com','jiasu.bohe.com','fnjiasu.com','golinkcn.com','xiaoheihe.cn','acc.xiaoheihe.cn','tmgalite.qq.com','nn.com','akspeedy.com',
    // 新闻 / 信息
    'toutiao.com','baidu.com','zhihu.com',
    // 搜索引擎（独立域名，避免中文搜索时被 ICP 缺失败误判）
    'bing.com','sogou.com','so.com','yahoo.com','duckduckgo.com','yandex.com','ask.com',
    // 高考志愿填报 / 教育考试院 / 招生考试院（各省官方考生服务平台，极易被「社工话术/低质量页面」误判，直接整体判安全）
    // 注：.gov.cn / .edu.cn 后缀已由 isGovDomain 覆盖，此处仍显式列出，便于维护与审计。
    'bjeea.cn',                 // 北京教育考试院
    'zhaokao.net',              // 天津招考资讯网
    'hebeea.edu.cn',            // 河北省教育考试院
    'sxkszx.cn',               // 山西招生考试网
    'zsks.cn',                  // 内蒙古招生考试信息网（nm.zsks.cn）
    'lnzsks.com',               // 辽宁招生考试之窗
    'jleea.com.cn',             // 吉林省教育考试院 / 普通高考考生服务平台（gk.jleea.com.cn）
    'jleea.edu.cn',             // 吉林省教育考试院
    'lzk.hl.cn',                // 黑龙江招生考试信息港
    'hljea.cn',                 // 黑龙江省教育考试院
    'shmeea.edu.cn',            // 上海教育考试院
    'jseea.cn',                 // 江苏省教育考试院
    'zjzs.net',                 // 浙江省教育考试院
    'ahzsks.cn',                // 安徽省教育招生考试院
    'eeafj.cn',                 // 福建省教育考试院
    'jxeea.cn',                 // 江西省教育考试院
    'sdzk.cn',                  // 山东省教育招生考试院
    'haeea.cn',                 // 河南省教育考试院
    'hbea.edu.cn',              // 湖北省教育考试院
    'hubzs.com.cn',             // 湖北招生数智综合平台（zspt.hubzs.com.cn）
    'hneao.cn',                 // 湖南招生考试信息港（ks.hneao.cn）
    'hneeb.cn',                 // 湖南省教育考试院
    'gd.gov.cn',                // 广东省教育考试院（eea.gd.gov.cn）
    'gxeea.cn',                 // 广西招生考试院
    'hainan.gov.cn',            // 海南省考试局（ea.hainan.gov.cn）
    'cqksy.cn',                 // 重庆市教育考试院
    'sceea.cn',                 // 四川省教育考试院
    'guizhou.gov.cn',           // 贵州省招生考试院（zsksy.guizhou.gov.cn）
    'ynzs.cn',                  // 云南省招生考试院
    'sneac.com',                // 陕西省教育考试院
    'sneea.cn',                 // 陕西省教育考试院
    'ganseea.cn',               // 甘肃省教育考试院
    'gszs.edu.cn',              // 甘肃省教育考试院
    'qhjyks.com',               // 青海省教育招生考试院
    'nxjyks.cn',                // 宁夏教育考试院
    'xjzk.gov.cn',              // 新疆招生网
    'hunan.gov.cn',             // 湖南省教育考试院（jyt.hunan.gov.cn）
    'xizang.gov.cn',            // 西藏教育考试院
    'chsi.com.cn',              // 阳光高考 / 学信网（教育部高校招生阳光工程指定平台）
    // 银狐防护 · SilverFox Guard 项目官网（扩展分发页）
    'silverfoxguard.dpdns.org',
    // WorkBuddy 官网（用户实测曾被旧版误报，纳入 early-exit 永不拦截）
    'workbuddy.cn',

    // ============ 误报反馈补录（来源：B 站评论区 / GitHub Issues）============
    // 原则：只补「确实被用户报告误拦且经确认的站点」，不做盲目扩库，
    // 避免把任何人都能注册的 UGC 托管域放进完全豁免名单（等于给黑产留后门）。
    // AdGuard：广告拦截与隐私保护，属安全软件品类（与 avast/kaspersky 同类），官网本体
    'adguard.com', 'adguard.org', 'adguard.net', 'adguard-vpn.com', 'adguardteam.com',
    // 技术学习 / 编程教育（用户反馈 leetcode 官网、编程猫社区被拦）
    'leetcode.cn', 'leetcode.com', 'leetcode-cn.com',
    'codemao.cn',                       // 编程猫（shequ.codemao.cn 等子域一并覆盖）
    'codechat.codemao.64mowan.top',     // 编程猫第三方聊天站（用户反馈误报，已确认加白）
    // 智能电视 / 安卓 TV 应用市场（软件下载站，易被「下载分发+话术」组合误判）
    'znds.com',
    // ⚠️ 注意：免费域名服务商（如 digitalplat）及其签发的免费子域一律【不】加入此处。
    // 免费域名是银狐投递站的主力载体，任何人匿名即可注册，对其放行只会放大漏报。
    // （2026-08-30 曾误补 digitalplat.org，经确认后移除）
    // 用户自建站点（经评论区确认加白，均有正规用途）
    'technologyehco.us.ci',             // 昼若轩的个人站
    'lycheeledger.cn',                  // whcl412 的个人站
    // GitHub 资源域补全（避免 GitHub 站内资源被拦；github.io 属 UGC 托管，不在此列）
    'githubassets.com', 'github.dev', 'githubcopilot.com',

    // ============ 2026-08 误报治理：官网白名单大规模扩容（#341）============
    // 目标：把易误报的合法站点长尾「银行 / 证券 / 保险 / 基金 / 媒体 / 互联网 / 软件工具 / 电商 / 央企500强 /
    //       医疗医药 / 交通物流 / 能源 / 教育 / 旅游 / 快消 / 游戏文娱 / 公共事业 / 外企中国」补进 early-exit 名单。
    // 原则：只收真实、稳定、知名的官方法人/机构站点本体；任何人可免费注册的 UGC 托管域、免费域名
    //       （.tk/.ml/.ga/.cf 等）、来路不明的个人站一律不收（避免给黑产留后门）。
    // 说明：.gov.cn / .edu.cn / .ac.cn / .mil 已由 isGovDomain 自动覆盖，无需逐条列出。

    // ---- 银行（政策性 / 国有大行 / 股份制 / 城商 / 农商 / 外资）----
    'icbc.com.cn','abchina.com','boc.cn','ccb.com','bankcomm.com','psbc.com.cn','cmbchina.com',
    'cmbc.com.cn','cib.com.cn','citicbank.com','spdb.com.cn','cebbank.com','bank.pingan.com','hxb.com.cn',
    'cgbchina.com.cn','czbank.com','cbhb.com.cn','eximbank.gov.cn','cdb.com.cn','adbc.com.cn',
    'bankofbeijing.com.cn','bosc.cn','jshbchina.com','njcb.com.cn','nib.com.cn','hzbank.com.cn',
    'qdccb.com.cn','bankofdl.com','xmccb.com','tccb.com.cn','hrbcb.com.cn','bankofgy.com.cn',
    'ccbank.cn','cqcbank.com','zzbank.cn','cscb.cn','suzhoubank.com','lzbank.com','nccbank.com.cn',
    'hebbank.com','qlbank.com.cn','whccb.com.cn','sxccb.com.cn','jinzhoubank.com.cn','bsbchina.com',
    'lhbchina.com','srcb.com.cn','bjrcb.com.cn','gzrcbank.com','cqrcb.com.cn','dongguanbank.cn',
    'hzcbank.com.cn','jxbank.com.cn','bhb.cn','jcbank.com.cn','bohs.cn','jhccb.com.cn','hsbank.com.cn',
    'hsbc.com.cn','citibank.com.cn','sc.com','standardchartered.com.cn','hangseng.com.cn','bnpparibas.com.cn',
    'jpmorgan.com.cn','ubs.com','mufg.jp','mizuhobank.com','sumitomomitsui','ocbc.com','uob.com.sg',
    'maybank.com','bankofamerica.com','deutschebank.com.cn','ing.com','rabobank.com','db.com',

    // ---- 证券（券商）----
    'guosen.com.cn','gf.com.cn','gtja.com','htsec.com','csc108.com','swhy.com','cicc.com.cn',
    'cijsc.com.cn','zts.com.cn','ebscn.com','gyzq.com.cn','dgzq.com.cn','htzq.com.cn','jyzq.com.cn',
    'dwzq.com.cn','qlzq.com.cn','sxzb.com.cn','i618.com.cn','newone.com.cn','cmschina.com',
    'tfzq.com.cn','huatai.com','hongyuan.com','chinalongsun.com','lhzq.com.cn','yzq.newone.com.cn',
    'haitong.com','guotaijunan.com','shdjt.com','stocke.com','sw2000.com.cn','swhysc.com',
    'cs.ecitic.com','citic.com','china-invs.cn','orientsec.com.cn','wzq.com.cn','xzq.com.cn',

    // ---- 保险 / 基金 / 期货 / 信托 / AMC ----
    'china-life.com.cn','picc.com','piccnet.com.cn','cpic.com','cpic.com.cn','taikang.com','taikang.com.cn',
    'pingan.com','pa18.com','ccic.com.cn','sinosig.com','sunlife.com.cn','metlife.com.cn','aia.com.cn',
    'allianz.com.cn','generali.com.cn','chubb.com','fwd.com','manulife.com.cn','prudential.com.hk',
    'pru.com.hk','chinaamc.com','eestone.com','jjmmw.com','fund.eastmoney.com','tiantianfunds.com',
    'licai.com','jrj.com.cn','chinafund.cn','csfunds.com.cn','wtfund.com','ourku.com',
    'cffex.com.cn','shfe.com.cn','dce.com.cn','czce.com.cn','ine.com.cn','cme.com',
    'citics.com','citic-tai.com','ctitic.com','huarong.com','amc.cinda.com','gxfc.com.cn',

    // ---- 新闻 / 媒体 / 广电 / 报刊 ----
    'people.com.cn','xinhuanet.com','cctv.com','cctv.cn','china.com','chinanews.com.cn','china.org.cn',
    'cnr.cn','cri.cn','cntv.cn','huanqiu.com','globaltimes.com.cn','thepaper.cn','yicai.com',
    'caixin.com','caixin.com.cn','stcn.com','cs.com.cn','jrj.com.cn','eastmoney.com','21jingji.com',
    '21cbh.com','nbweekly.com','sina.com.cn','sina.com','sohu.com','163.com','yesky.com','zdnet.com.cn',
    'pconline.com.cn','it168.com','pcpop.com','donews.com','techweb.com.cn','leiphone.com','36kr.com',
    'huxiu.com','ifanr.com','pingwest.com','qdaily.com','jiemian.com','lanjinger.com','cls.cn',
    'wallstreetcn.com','fx168.com','bjnews.com.cn','bjd.com.cn','eastday.com','news365.com.cn',
    'southcn.com','gdtoday.com','zjol.com.cn','jschina.com.cn','yangtse.com','sdnews.com.cn','dzwww.com',
    'qlwb.com.cn','dahe.cn','hnby.com.cn','hebnews.cn','yzdsb.com.cn','voc.com.cn','hnrednet.cn',
    'cnhubei.com','scol.com.cn','sctv.com','fjsen.com','sxdaily.com.cn','cnwest.com','ahwang.cn',
    'anhuinews.com','jxnews.com.cn','lnrb.com.cn','hljnews.cn','hrbrent.com.cn','jlnews.com.cn',
    'gog.cn','gzdaily.com.cn','yunnan.cn','hinews.cn','hndaily.cn','gansudaily.com.cn','gscn.com.cn',
    'qhnews.com.cn','nxnet.cn','nxdaily.com','ts.cn','nmgnews.com.cn','nmrb.com.cn','gxnews.com.cn',
    'gxrb.com.cn','sxrb.com','sxgov.cn','cqnews.net','cqwb.cn','tjnews.cn','enorth.com.cn','tibet.cn',

    // ---- 互联网 / 科技 / AI / 云 ----
    'baidu.com','baidu.cn','iqiyi.com','iq.com','youku.com','tudou.com','kuaishou.com','douyin.com',
    'bytedance.com','toutiao.com','xigua.com','feishu.cn','larkoffice.com','tiktok.com','capcut.com',
    'meitu.com','meituinc.com','xima.tv','ximalaya.com','zhangyue.com','duokan.com','qidian.com',
    'yuewen.com','sfacg.com','acfun.cn','bilibili.tv','hupu.com','douyu.com','huya.com','yy.com',
    'pinduoduo.com','pdd.com','xunmeng.com','meituan.com','dianping.com','waimai.meituan.com',
    'ele.me','koubei.com','alibaba.com','alimama.com','1688.com','alitrip.com','fliggy.com',
    'cainiao.com','zhifubao.com','antgroup.com','antfin.com','netease.com','163.com','126.com',
    'yeah.net','neteasegames.com','shimo.im','kdocs.cn','wps.cn','wps.com','kuaishou.com',
    'sogou.com','soso.com','qq.com','tencent.com','weibo.com','weibo.cn','zhihu.com','guokr.com',
    'douban.com','ruguoapp.com','xiaohongshu.com','xhs.com','tianya.cn','mtime.com','douban.fm',
    'cmread.com','mozhua.net','jiakaobaodian.com','zhangyu.com','aigei.com','51cto.com',
    'cnblogs.com','blogjava.net','iteye.com','talkwithtrend.com','ui.cn','zcool.com.cn','poocss.com',
    'chinaz.com','admin5.com','im286.com','a5.net','webmasterhome.cn','cnzz.com','umeng.com',
    'talkingdata.com','mob.com','umeng.com','bugly.qq.com','tencentcloud.com','aliyun.com',
    'aliyuncs.com','huaweicloud.com','huawei.com','xiaomi.com','mi.com','duokan.com','getui.com',

    // ---- 软件 / 工具 / 下载 / 论坛社区（极易被误报，重点补）----
    '52pojie.cn','52pojie.com','ghxi.com','tool.lu','lanzou.com','lanzous.com','lanzoux.com',
    'lanzouw.com','ilanzou.com', // 蓝奏云主站官网 / 优享版官网（B站网友反馈误报，2026-08-31 加）
    'pcsoft.com.cn','onlinedown.net','duote.com','crsky.com','zol.com.cn','skycn.com','xiazaiba.com',
    'a67.com','greenxf.com','rj.baidu.com','software.qq.com','mydown.com','oray.com','putty.org',
    'winscp.net','filezilla-project.org','notepad-plus-plus.org','sublimetext.com','jetbrains.com',
    'code.visualstudio.com','visualstudio.com','atom.io','github.com','gitlab.com','gitee.com',
    'discuz.net','phpwind.com','zblogcn.com','dedecms.com','phpcms.com','empirecms.com','wordpress.org',
    'typecho.org','hexo.io','vuejs.org','reactjs.org','nodejs.org','python.org','rust-lang.org',
    'golang.org','php.net','java.com','oracle.com','mysql.com','mariadb.org','postgresql.org',
    'mongodb.com','redis.io','nginx.org','apache.org','nginx.com','ubuntu.com','debian.org',
    'archlinux.org','fedoraproject.org','centos.org','opensuse.org','kali.org','kali-linux.com',
    'deepin.org','ubuntukylin.com','uniontech.com','uos.com','linglong.cn','wps-linux.com',
    'appinn.com','ipip.net','ip.cn','whatismyip.com','ip138.com','chinaz.com','boce.com',
    'tool.oschina.net','c.runoob.com','runoob.com','w3school.com.cn','w3cschool.cn','cnblogs.com',
    'juejin.cn','v2ex.com','oschina.net','csdn.net','gitee.com','gitbook.io','readthedocs.io',
    'stackoverflow.com','freecodecamp.org','leetcode.cn','leetcode.com','codemao.cn','code.org',

    // ---- 电商 / 零售 / 外卖 / 本地生活 ----
    'taobao.com','tmall.com','jd.com','jd.hk','pinduoduo.com','meituan.com','suning.com','goofish.com',
    'gome.com.cn','dangdang.com','book.com','amazon.cn','amazon.com','jumei.com','vancl.com',
    'yhd.com','yihaodian.com','vip.com','vipshop.com','sasa.com','sephora.cn','uniqlo.com',
    'hm.com','zara.com','nike.com','adidas.com.cn','li-ning.com','anta.com','361.com','xtep.com',
    'erke.com','peerless.com','ximalaya.com','fanli.com','returnbuy.com','55bbs.com','moonbasa.com',
    'kimiss.com','onlylady.com','yoka.com','pclady.com','pcpop.com','39.net','120ask.com',
    'jd.com','smzdm.com','whatsmoney.com','haitao.com','kaola.com','xiji.com','mi.com',

    // ---- 通信运营商 ----
    '10086.cn','10010.com','189.cn','10000.com','chinamobile.com','chinaunicom.com','chinatelecom.com',
    'cmcc.com','chinamobileltd.com','chinaunicom.com.hk','ctm.com.mo','cmhk.com','one2free.com',
    'pccw.com','smartone.com','three.com.hk','csl.com','1010.com','cmlink.com',

    // ---- 能源 / 电力 / 石化 / 煤炭 / 钢铁 / 有色 ----
    'cnpc.com','petrochina.com.cn','sinopec.com','cnooc.com','cnpc.com.cn','shenergy.com','huadian.com',
    'chng.com.cn','spic.com.cn','cgdc.com.cn','cgnpc.com.cn','statepower.com.cn','guodian.com',
    'baosteel.com','shsteel.com','ansteel.com','wusteel.com','hbisco.com','shougang.com','taigang.com',
    'chinalco.com','chalco.com.cn','jiangxi-copper.com','tongling.com','yunlu.com','zijinmining.com',
    'cmoc.com','jnyl.com','yanzhoucoal.com','china-coal.com','shenhua.com','camce.com','powerchina.cn',
    'chemchina.com','sinochem.com','syngenta.cn','yara.com','bluestar.com','wanhua.com','haihua.com',

    // ---- 汽车 / 制造 / 央企 / 500强 ----
    'saicmotor.com','faw.com','dongfeng.com','geely.com','chery.cn','greatwallmotor.com','byd.com',
    'gac.com.cn','gac-toyota.com','gac-honda.com','bmw.com.cn','benz.com.cn','audi.cn','volkswagen.com.cn',
    'toyota.com.cn','honda.com.cn','nissan.com.cn','ford.com.cn','gm.com.cn','hyundai.com.cn',
    'kia.com.cn','mazda.com.cn','subaru.com.cn','mitsubishi.com.cn','volvo.com.cn','tesla.cn',
    'nio.cn','xpeng.com','lixiang.com','wmotor.com','levdeo.com','enovate.com','arcfox.com',
    'haier.com','hisense.com','tcl.com','skyworth.com','gree.com','midea.com','meidi.com',
    'changhong.com','konka.com','galanz.com','robam.com','vatti.com','oppel.com','supor.com',
    'joyoung.com','midea.com','haier.com','casarte.com','leader.com','littleswan.com','beko.com',
    'sinopec.com','cnpc.com','cnooc.com','sasac.gov.cn','china-mae.com','csg.cn','sgcc.com.cn',

    // ---- 航空 / 铁路 / 地铁 / 物流 / 快递 ----
    'airchina.com','csair.com','ceair.com','muair.com','shenzhenair.com','hainanairlines.com','xiamenair.com',
    'shanghaiair.com','springairlines.com','juneyaoair.com','westair.cn','okair.net','chinaexpressair.com',
    '12306.cn','china-railway.com.cn','crh.com.cn','railway.com.cn','tiqianx.com','mtr.com.hk',
    'sfbchina.com','sf-express.com','zto.com','yto8000.com','yundaex.com','sto.cn','jt-express.com',
    'deppon.com','dblogistics.com','ems.com.cn','china-post.com.cn','post.com.cn','yimidida.com',
    'huolala.com','kuaibao.com','zhongtong.com','yunda.com','shentong.com','youzheng.com.cn',

    // ---- 地产 / 建筑 / 建材 ----
    'vanke.com','countrygarden.com','evergrande.com','poly.com.cn','cem.com.cn','crland.com.hk',
    'longfor.com','greentown.com.cn','seazen.com.cn','sunac.com.cn','gemdale.com','logan.com.hk',
    'shimao.com','rsh.com.cn','zhongliang.com','zhongjun.com','agile.com.cn','bgy.com.cn',
    'csc.com.cn','cscec.com','crec.com','crcc.cn','ccccltd.cn','powerchina.cn','cmc.com.cn',
    'cnccc.com','csg.cn','ceec.net.cn','xcmg.com','zoomlion.com','sany.com','liugong.com',
    'zoomliion.com','sunward.com','csg.cn','bjjs.com','shfc.gov.cn','szhome.com',

    // ---- 医疗 / 医药 / 健康 ----
    'nmpa.gov.cn','nhc.gov.cn','chinacdc.cn','icdc.cn','pharmnet.com.cn','yaozh.com','dxy.com',
    'dxy.cn','haodf.com','xywy.com','39.net','120ask.com','familydoctor.com.cn','jkkp.com',
    'jianke.com','111.com.cn','yao123.com','yaofang.cn','medsci.cn','biocompare.com','bioon.com',
    'dxy.com','yaozh.com','syphu.com','sphic.com','sinopharm.com','unionmed.com',
    'snp.com.cn','cspc.com','hualanbio.com','wantai.com','kangtai.com','zhifeishengwu.com',
    'fosunpharma.com','hutian.com','nhwa.com','hansoh.cn','hengrui.com','3sbio.com','innobic.com',
    'minhai.com','bchot.com','tongfang.com','jxqx.com','zjgpharma.com','zhejiangdisease.com',

    // ---- 教育 / 培训 / 考试 / 留学 ----
    'chsi.com.cn','eol.cn','eol.com.cn','cnedu.cn','kaoyan.com','kaoyan365.com','yuloo.com',
    'studyabroad.com.cn','liuxue.com','applysquare.com','zhixue.com','xueersi.com','sina.com.cn',
    'neworiental.org','xdf.cn','koolearn.com','tpedutest.com','baijia.com','aofan.com',
    'cnhubei.com','eeagd.edu.cn','jseea.cn','zjzs.net','sdzk.cn','ahzsks.cn','bjeea.cn',
    'zikao365.com','eol.cn','edu.cn','cer.net','moe.gov.cn','chsi.com.cn','ncss.cn',
    'cuc.edu.cn','bit.edu.cn','tsinghua.edu.cn','pku.edu.cn','fudan.edu.cn','sjtu.edu.cn',
    'zju.edu.cn','nju.edu.cn','ustc.edu.cn','sysu.edu.cn','whu.edu.cn','hit.edu.cn','scut.edu.cn',

    // ---- 旅游 / 酒店 / 生活服务 ----
    'ctrip.com','trip.com','qunar.com','elong.com','ly.com','tuniu.com','mafengwo.cn','lvmama.com',
    '17u.cn','ctrip.com','fliggy.com','alitrip.com','tongcheng.com','easemob.com','huazhu.com',
    'jinjiang.com','btg.com.cn','homeinns.com','7daysinn.com','vn.hotels.com','marriott.com',
    'hilton.com','ihg.com','accor.com','wyndham.com','shangri-la.com','kempinski.com',
    'ctrip.com','lv.com','visa.com','mastercard.cn','unionpay.com','unionpayintl.com','up.com.cn',
    'chinapay.com','95516.com','95588.com','95599.com','95555.com','95533.com','95559.com',
    '95561.com','95595.com','95568.com','95528.com','95580.com','95577.com','400.com',

    // ---- 食品 / 饮料 / 快消 / 农业 ----
    'moutai.com.cn','wuliangye.com.cn','luzhoulaojiao.com','yanghe.com','gujing.com.cn','jnc.com.cn',
    'niulanshan.com.cn','qingdao.com','tsingtao.com','snowbeer.com.cn','yanjing.com.cn','zjbeer.com',
    'coca-colacompany.com','pepsi.com','nestle.com.cn','yili.com','mengniu.com','want-want.com',
    'masterkong.com.cn','cofco.com','beijinghy.com','sanxing.com','haier.com',
    'yili.com.cn','mengniu.cn','nongfu-spring.com','nongfusanquan.com','wahaha.com','toly.com',
    'glico.com','meiji.com','yili.com','brightdairy.com','sanyuan.com','mengniu.com',

    // ---- 游戏 / 动漫 / 文娱 / 体育 ----
    'minecraft.net','mojang.com','steampowered.com','steamgames.com','epicgames.com','gog.com',
    'origin.com','ea.com','ubisoft.com','uplay.com','playstation.com','xbox.com','nintendo.com',
    'battle.net','blizzard.com','riotgames.com','leagueoflegends.com','genshin.com','mihoyo.com',
    'hoyoverse.com','neteasegames.com','game.163.com','tencentgames.com','wegame.com','taptap.com',
    'taptap.cn',    'cngal.org','bangumi.tv','bgm.tv','animenewsnetwork.com','myanimelist.net',
    'bilibili.com','acg.178.com','17173.com','duowan.com','nga.cn','wowar.com','wowhead.com',
    'huya.com','douyu.com','yy.com','panda.tv','zhanqi.tv','bilibili.tv',

    // ---- 公共事业（水 / 电 / 气 / 暖 / 广电 / 市政）----
    'sgcc.com.cn','csg.cn','chinapower.com.cn','waterchina.com','bewg.com.cn','bdc.com.cn',
    'bjwater.com','shanghaiwater.com','gw.com.cn','gas.com.cn','chinagashub.com','pipechina.com',
    'cnpc.com','cnpc.com.cn','petrochina.com.cn','sinopec.com','cnooc.com','chinagashub.com',
    'bjgas.com','shgas.com','gzzhgd.com','cin.gov.cn','mohurd.gov.cn','mohrss.gov.cn','mof.gov.cn',
    'mofcom.gov.cn','ndrc.gov.cn','miit.gov.cn','samr.gov.cn','customs.gov.cn','tax.gov.cn',

    // ---- 外企中国 / 国际组织 / 商会 / 使领馆 ----
    'microsoft.com','microsoft.cn','apple.com','apple.com.cn','ibm.com','ibm.com.cn','intel.com',
    'intel.cn','amd.com','nvidia.com','nvidia.cn','dell.com','dell.com.cn','hp.com','hp.com.cn',
    'lenovo.com','lenovo.com.cn','samsung.com','samsung.com.cn','lg.com','sony.com','sony.com.cn',
    'panasonic.cn','hitachi.com','toshiba.com','sharp.cn','philips.com.cn','bosch.com','siemens.com',
    'ge.com','ge.com.cn','honeywell.com','3m.com','dupont.com','basf.com','bayer.com','novartis.com',
    'pfizer.com','roche.com','gsk.com','jnj.com','unilever.com','pg.com','coca-colacompany.com',
    'nestle.com','danone.com','ikea.com','ikea.cn','carrefour.com','walmart.com','walmart.cn',
    'metro.com.cn','auchan.com','rt-mart.com','yum.com','kfc.com.cn','yumchina.com','mcd.com.cn',
    'starbucks.com.cn','uni-president.com','masterkong.com.cn','jnsn.com',
    // —— 用户误报反馈（GitHub Issues 批量确认，均为安全站点，加白名单早期退出）——
    '0bcjstko9509h.space.mcode.cn','360.xiaomai.cc.cd','8kmm.com','ae0kcokdy1z45.space.mcode.cn',
    'battlelog.battlefield.com','bbs.kafan.cn','bingdiancn.com','cloudflare-cn.com','crxsoso.com',
    'curseforge.com','d.seewo.com','geogebra.org','gunsaw-level-codes.jimmyking.dev','jfglzs.com',
    'mcapks.net','mcmod.cn','minimaxi.com','mumu-dili.pages.dev','pc.woozooo.com','shequ.codemao.cn',
    'shijuezu.com','sparanoid.com','spestech.com','store.rg-adguard.net',
    'uiso44xg1go9p.space.mcode.cn','wwda.lanzouj.com','wwn.lanzouy.com','wwtr.lanzouw.com',
    // —— 被误报为「恶意」实为安全的大站（真实域名，加白名单避险）——
    'bing.com','chaoxing.com'
  ];

  // ============ UGC 平台白名单（仅跳过「域名仿冒」判定，其余规则照常运行）============
  // 合入自 VirusDetector 的 TRUSTED_PLATFORMS（44 个），并补齐我们原有覆盖。
  //
  // 与 OFFICIAL_DOMAINS 的本质区别：
  //   OFFICIAL_DOMAINS   → 完全豁免、早期退出、永不拦截（只放真正的品牌官网本体）
  //   TRUSTED_PLATFORMS  → 只跳过「域名仿冒」这一条规则，其余检测（混淆脚本 / 沙箱探测 /
  //                        木马安装包 / 双扩展名 / 网盘分发 / 诱饵话术…）全部照常运行
  //
  // 为什么必须区分：Wiki 农场、代码托管 Pages、静态托管 PaaS、博客平台这类站点，
  // 子域由用户自由创建（如 wechat-download.vercel.app），因此
  //   ① 子域名里出现品牌词是常态 → 不该判「域名仿冒」，否则海量合法页面误报；
  //   ② 但页面内容完全不可信 → 银狐可白嫖免费 HTTPS 托管投递木马，绝不能整体豁免。
  const TRUSTED_PLATFORMS = [
    // ---- Wiki 平台 ----
    'fandom.com', 'wikia.com', 'wikimedia.org', 'miraheze.org', 'wiki.gg', 'gamepedia.com',
    // ---- 代码托管 Pages ----
    'github.io', 'gitlab.io', 'bitbucket.io', 'sourceforge.io', 'codeberg.page',
    // ---- PaaS / 静态站点托管 ----
    'netlify.app', 'vercel.app', 'herokuapp.com', 'pages.dev', 'surge.sh', 'glitch.me',
    'onrender.com', 'fly.dev', 'workers.dev', 'deno.dev',
    // ---- 博客与内容平台 ----
    'medium.com', 'wordpress.com', 'blogger.com', 'blogspot.com', 'tumblr.com', 'hatenablog.com',
    'fc2.com', 'livejournal.com', 'typepad.com', 'substack.com', 'ghost.io', 'hashnode.dev', 'dev.to',
    // ---- 文档与知识库 ----
    'readthedocs.io', 'notion.site', 'gitbook.io',
    // ---- 建站 / 个人页 ----
    'weebly.com', 'wixsite.com', 'jimdo.com', 'strikingly.com', 'carrd.co', 'about.me', 'linktr.ee',
    // ---- 本项目补充（原先误放在 OFFICIAL_DOMAINS 的用户内容托管域）----
    'replit.app', 'repl.co', 'firebaseapp.com', 'web.app', 'codesandbox.io', 'stackblitz.com'
  ];

  // ============ 可信文件分发平台（下载黑名单的「护栏」，禁止被自动拉黑）============
  // 合入自 VirusDetector 的 TRUSTED_DOWNLOAD_HOSTS。用途与 TRUSTED_PLATFORMS 不同：
  // 本表专供「下载黑名单」自动学习时做保护——用户在某个页面手动拦下一次下载后，
  // 系统会把下载来源域自动拉黑并跨站复用；若来源恰好是 GitHub Releases / PyPI / 微软 CDN
  // 这类共享分发平台，拉黑将连带误伤海量正常下载，因此这些域名一律禁止进入黑名单。
  // 注意：这不等于「豁免」——命中这些平台的页面仍照常参与全部评分。
  const TRUSTED_DOWNLOAD_HOSTS = [
    // 代码托管 Releases
    'github.com', 'gitlab.com', 'gitee.com', 'bitbucket.org', 'codeberg.org', 'githubusercontent.com',
    // 包管理器
    'npmjs.com', 'pypi.org', 'files.pythonhosted.org',
    // 开源托管
    'sourceforge.net', 'fosshub.com',
    // 大型厂商 CDN / 官方下载
    'microsoft.com', 'google.com', 'apple.com', 'mozilla.org', 'adobe.com', 'oracle.com', 'ibm.com', 'amazon.com',
    // 用户自定义可信域（2026-08-31 加，来自 B站网友反馈 / 同类 AI agent 误报）
    'LHW.pythonanywhere.com', // B站网友自建蓝奏云镜像站
    'lobsterai.youdao.com', // 有道 AI 龙虾（电脑 agent 工具，与 WorkBuddy 同类，误报豁免）
    // 操作系统官方源
    'ubuntu.com', 'debian.org', 'archlinux.org', 'fedoraproject.org', 'centos.org', 'opensuse.org',
    'docker.com', 'appimage.org',
    // 知名开源软件官方
    'videolan.org', 'libreoffice.org', 'gnu.org', 'apache.org', 'python.org', 'nodejs.org',
    'rust-lang.org', 'golang.org', 'nginx.org', 'mysql.com', 'postgresql.org'
  ];

  // ============ 已知银狐木马投递站黑名单（硬编码：命中即判 danger，永不豁免）============
  // 来源：用户上报 / CNCERT 通报。命中即强制拦截，不受灵敏度或维度开关影响。
  const KNOWN_BAD_DOMAINS = [
    'wy-mmusic.com.cn',
    // 以下来自 2025–2026 公开威胁报告（知道创宇404 / 微步 / 威胁情报），确认为银狐(APT-Q-27/金眼狗)钓鱼/C2 域名
    'ggfanyi.com',              // 仿冒谷歌翻译钓鱼站（anquanke 报告）
    'jackadmin1.cn','jackadmin2.cn','jackadmin3.cn','jackadmin4.cn','jackadmin5.cn', // APT-Q-27 银行木马 C2 面板
    'jackbank1.cn','jackbank2.cn','jackbank3.cn','jackbank4.cn','jackbank5.cn',       // APT-Q-27 银行木马欺诈页
    'appsl-360.com',            // 用户上报银狐木马投递站（仿 360 命名，下载入口已确认银狐载荷）
    'app-360weishi.com.cn',     // 用户上报银狐木马投递站（仿 360 卫士命名，下载跳转中转页）
    'oentvu8xii.com',            // 银狐下载中转页（app-360weishi 跳转至此触发下载，打开即自动关闭）
    'chrome-china.net',          // 仿冒 Chrome 官方下载的钓鱼站（download.chrome-china.net 入口，meta refresh 秒跳下载）
    'coreapps.cc',               // 银狐载荷 CDN（chrome-china.net 等仿冒站跳转至此分发 .zip 木马安装包）
    // —— 用户举报确认恶意（GitHub Issues 恶意站点举报批量确认）——
    'net-bcutbilibili.com.cn',   // 仿冒 B 站（net-bcutbilibili）钓鱼投递
    'deepvseek.com.cn',          // 仿冒 DeepSeek（deepvseek，非官方 deepseek.com）钓鱼
    '88vyvwbt.qpefh.com',        // 随机子域，银狐木马投递/C2
    'abi04.8msg8.com',           // 随机子域，银狐木马投递/C2
    'chat.51mitu.com',           // 多次举报为恶意 AI 钓鱼站
    'qissmusic.com.cn',          // 仿冒音乐平台（qissmusic）钓鱼站
    'qianwenai.com',             // 仿冒通义千问（qianwen+ai 非官方）钓鱼
    '108ai.com'                  // 用户举报疑似恶意 AI 钓鱼站（GitHub confirmed-phish 标签确认）
  ];

  // ============ 已知银狐「木马化投递物」文件名（硬编码：命中即强风险）============
  // 来源：用户提交的银狐样本「只读静态分析」（未执行，仅提取字符串级 IOC）。
  //   bzy.exe            → 内嵌 ProductName="A Great VPN" / CompanyName="NextVPN LLC"（假冒 A Great VPN 客户端木马）
  //   shanlian_VPN_64.exe → 内嵌 FileDescription="闪连VPN Setup" / CompanyName="闪连VPN"（假冒「闪连 VPN」木马）
  // 两者均为银狐（游蛇）典型的「木马化正版/诱导软件」投递：把流行工具（VPN/加速器/办公）重打包成带毒安装包，
  // 经仿冒下载站或群聊话术分发。MV3 扩展无法读取下载字节，故以「文件名」这一稳定可观测特征作为拦截锚点。
  // ⚠️ 仅比对小写规范化后的文件名；下载 URL 的查询串/片段已被剥离，避免误匹配路径。
  const KNOWN_BAD_FILENAMES = [
    'bzy.exe',
    'shanlian_vpn_64.exe',
    'shanlian-vpn-64.exe',
    'shanlianvpn_64.exe',
    '闪连vpn setup.exe',
    '闪连vpn_setup.exe',
    '闪连vpn.exe',
    'a great vpn.exe',
    'agreatvpn.exe',
    'nextvpn.exe'
  ];

  // 可疑下载文件名模式（仅作「中风险」提示，不直接强拦，避免误伤正常 VPN 官网）
  // 锚定银狐「随机/仿冒品牌 + VPN/加速器」安装包命名规律，阈值收紧（必须含 vpn + setup/install 且为 exe）。
  const SUSPICIOUS_DOWNLOAD_NAME_PATTERNS = [
    /_vpn_64\.exe$/i,
    /_vpn_32\.exe$/i,
    /vpn[_-]?setup\.exe$/i,
    /(setup|install).*vpn.*\.exe$/i,
    /vpn.*(setup|install).*\.exe$/i
  ];

  // ============ 品牌关键词（用于域名仿冒检测：段匹配 / 子串 / 堆叠 / 编辑距离；命中但非官方域 → 仿冒）============
  const BRAND_KEYWORDS = [
    'wechatpay','微信支付','alipay','支付宝','deepseek','chatglm','智谱清言','kimi','openai','chatgpt','doubao','豆包','tongyi','通义千问','xinghuo','讯飞星火','yiyan','文心一言',
    'bilibili','哔哩哔哩','iqiyi','爱奇艺','youku','优酷','mgtv','芒果tv','kugou','酷狗','kuwo','酷我','netease','网易云音乐','qqmusic','qq音乐','weiyun','腾讯微云','aliyundrive','阿里云盘',
    'quark','夸克网盘','baidupan','百度网盘','wps','金山办公','dingtalk','钉钉','feishu','飞书','weixin','微信','wechat','企业微信','todesk','向日葵',
    'sunlogin','teamviewer','anydesk','lenovo','联想','360安全卫士','huorong','火绒','qq','腾讯qq','sougou','搜狗','pinyin','输入法','baidu','百度','taobao','淘宝','tmall','天猫','jd','京东',
    'pinduoduo','拼多多','meituan','美团','aliyun','阿里云','tencent','腾讯云','huawei','华为云','csdn','gitee','github','juejin','掘金','zhihu','知乎','toutiao','今日头条','amap','高德','didiglobal','滴滴',
    'xunlei','迅雷','winrar','7-zip','bandizip','2345','好压','ludashi','鲁大师','drivergenius','驱动精灵','qqbrowser','qq浏览器','chrome','谷歌浏览器','firefox','火狐','edge','microsoft','mozilla',
    'moonshot','月之暗面','volcengine','火山引擎','xfyun','科大讯飞','bigmodel','wechat','android','chrome','clash','verge','potplayer','蓝奏云','lanzou','金蝶','kingdee','用友','ufida','航天信息','金税','税控','财务','erp',
    // 研究中高频被仿冒、原词库缺漏的对象
    'telegram','teams','微软teams','有道','有道翻译','youdao','比特浏览器','bitbrowser','快连','快连vpn','letsvpn','纸飞机','易翻译','货币换算','汇率转换','flash','搜狗浏览器','sogou浏览器',
    // 外国知名软件/模拟器（用户上报 rpcs3.io 仿冒 rpcs3 官方，需识别其为仿冒站）
    'rpcs3','ps3模拟器','pcsx2','ppsspp','xenia','cemu','yuzu','ryujinx','dolphin模拟器','cemu模拟器','retroarch','epsxe','citra','duckstation','rpcs3模拟器',
    // 海外主流软件品牌（仿冒站高频目标，扩充至 ~121 个品牌）
    'adobe','photoshop','premiere','aftereffects','illustrator','lightroom','acrobat','reader','pdf','vlc','potplayer','kmplayer','gomplayer','audacity','obs','ffmpeg',
    'office','word','excel','powerpoint','outlook','onenote','onenote','teams','skype','zoom','webex','slack','discord','telegram','thunderbird','foxmail','notepad','notepad++','sublime','vscode','visualstudiocode','jetbrains','pycharm','intellij',
    'chrome','chromium','brave','opera','vivaldi','safari','yandex','tor','centbrowser','maxthon','firefox','edge','internetexplorer','ie',
    'winrar','winzip','7zip','bandizip','peazip','360zip','haozip','2345好压','2345zip','2345看图王','2345浏览器','2345','ludashi','cpuz','hwmonitor','aida64','crystaldiskmark','crystaldiskinfo','prime95','furmark','memtest86','gpuz','msiafterburner','afterburner',
    'idm','internetdownloadmanager','fdm','freedownloadmanager','qbittorrent','utorrent','bittorrent','transmission','aria2','motrix','xdown',
    'avast','avg','kaspersky','bitdefender','eset','mcafee','norton','symantec','trendmicro','malwarebytes','avira','drweb','panda','gdata','f-secure','sophos','comodo','zonealarm','claymore',
    'asus','gigabyte','msi','asrock','corsair','kingston','samsung','westerndigital','seagate','toshiba','lg','dell','hp','acer','logitech','razer','steelseries','cherry','coolermaster','noctua','phanteks','lianli','nzxt','antecc','seasonic','corsair','gskill','teamgroup','adata','crucial','micron',    'intel','amd','nvidia',
    // 银狐木马化投递物品牌（来自用户提交样本静态分析：bzy.exe=A Great VPN/NextVPN LLC；shanlian_VPN_64.exe=闪连VPN）
    '闪连','shanlian','闪连vpn','nextvpn','agreatvpn','a great vpn','nextvpn llc',
    // 全球高危钓鱼品牌（非中国区官方域，但为银狐/钓鱼高发仿冒目标，显式补入）
    'paypal','facebook','whatsapp','instagram','netflix','linkedin','twitter','tiktok'
  ];

  // 友情链接区块「指向无关大牌」检测专用品牌库：银狐伪官方下载站模板常在页脚「友情链接」里
  // 塞一堆百度/淘宝/QQ/微信等大牌外链来显得正规。命中这些大牌且非本站品牌才算「无关」。
  const FRIENDLY_LINK_BRANDS = [
    'baidu','百度','taobao','淘宝','tmall','天猫','jd','京东','pinduoduo','拼多多','meituan','美团','alipay','支付宝',
    'wechat','微信','qq','腾讯','tencent','sina','新浪','weibo','微博','netease','网易','163','youku','优酷','iqiyi','爱奇艺',
    'bilibili','哔哩哔哩','kugou','酷狗','douyin','抖音','toutiao','今日头条','didi','滴滴','ctrip','携程','360','lenovo','联想',
    'xiaomi','小米','huawei','华为','oppo','vivo','suning','苏宁','jumei','聚美','58','赶集','ganji','baixing','百姓','zhihu','知乎',
    'csdn','qqbrowser','qq浏览器','sogou','搜狗','uc','ucbrowser','uc浏览器','todesk','向日葵','teamviewer','anydesk','wps','金山','kingsoft',
    'kuaishou','快手','qqmusic','qq音乐','网易云音乐','baixing','百姓网','soso','sohu','搜狐','qqgame','wegame','steam'
  ];

  // 与"下载 / 安装"相关的上下文词
  const DOWNLOAD_KEYWORDS = [
    '下载', 'download', '安装', 'install', '官方版', '最新版', '正版', '免费版',
    '高速下载', '安全下载', '本地下载', '立即下载', '一键安装', '极速下载', '客户端', '安装包', '完整版'
  ];

  // 社会工程 / 钓鱼诱导话术（银狐投递文档、群聊话术）
  // 注：极常见的「工资/薪资/工资明细/发票/电子发票」已从本表移除（任何正常 HR/财务网页都会中招，
  // 造成大量误报）；财税类诱饵改由更精准、且以「存在下载入口」为门控的 LURE_THEMES 负责。
  // ⚠️ 2026-08-30 误报治理重构：社工话术拆分为「强诱导」与「一般可疑」两级。
  //
  // 原实现把所有词一视同仁按 n×6 计分（上限 24），但其中大量词汇在正规站遍地都是：
  //   '验证码' → 任何登录页都有
  //   '限时'/'福利'/'红包'/'返利'/'领取' → 电商与活动页标配
  //   '培训资料'/'学习资料'/'课程资料'/'成绩单' → 教育站标配
  //   '通知'/'通报'/'名单'/'人事'/'离职'/'劳动合同' → 企业与政务站常见
  //   '内部' → 过于泛化，误伤极重
  // 再叠加 useDownloadSocial 组合规则（有下载入口 + 命中社工话术 → danger），
  // 直接导致 znds.com 这类正规软件下载站被判死。
  //
  // 重构后：
  //   强诱导词（银狐/钓鱼专属话术）→ 高分，且参与组合升级
  //   一般可疑词（正规站常见）→ 仅低分，不参与组合升级
  //   '内部' 与 '验证码' 因误报率过高，直接移除
  // ⚠️ 2026-08-31 二次重构（实测根因驱动）：
  // 用真实页面 HTML 离线复现发现，STRONG 组里混入了两类「非钓鱼话术」，是正规站误报主因：
  //
  //   ① 软件资源站业态词：破解 / 注册机 / 激活工具 / 免费激活 / 内部版
  //      —— 吾爱破解、果核剥壳这类老牌技术社区的页面必然出现（这是它们的内容主题本身）。
  //         实测 www.ghxi.com 命中「破解 + 注册机 + 激活工具」三词直接推向 danger。
  //   ② 社群联系方式：qq群 / 加q群 / 加qq群 / 客服微信 / 扫码领取 / 远程协助
  //      —— 国内几乎所有社区站、工具站、开源项目页都挂 QQ 交流群。
  //         实测 tool.lu 仅因页面含「qq群」即命中强诱导。
  //
  // 这两类词的共同问题：它们描述「话题/联系方式」，而非「诱导受害者执行动作的诈骗剧本」。
  // 真正的银狐/钓鱼专属话术是「冒充公权力或财务场景施压」——公检法 / 涉案 / 通缉 / 安全账户 /
  // 转账 / 社保补贴 / 付款单据 / 内部通知 / 违纪 / 裁员 / 补偿 —— 正规站几乎不会成篇出现。
  //
  // 因此 STRONG 只保留诈骗剧本词；业态词与社群词下调至 WEAK（仍计低分参与堆叠，
  // 但不再单独触发「下载入口 + 强诱导 → 直接判 danger」的组合升级）。
  const SOCIAL_ENGINEERING_STRONG = [
    '安全账户', '涉案', '通缉', '公检法', '保密协议',
    '社保补贴', '付款单据', '内部通知', '违纪', '裁员'
  ];
  const SOCIAL_ENGINEERING_WEAK = [
    // ---- 原 STRONG 降级：软件资源站业态词（内容主题，非诈骗剧本）----
    '破解', '注册机', '激活工具', '免费激活', '内部版',
    // ---- 原 STRONG 降级：社群联系方式（国内社区站标配）----
    '加qq群', '加q群', 'qq群', '客服微信', '扫码领取', '远程协助',
    // ---- 原有弱词 ----
    '最新通知', '通报', '名单', '会议资料', '政策文件', '成绩单',
    '领取', '福利', '限时', '红包', '返利', '兼职', '中奖',
    '人事', '离职', '劳动合同', '培训资料', '学习资料', '课程资料',
    '转账', '补偿'
  ];
  // 向后兼容：合并视图，供旧调用方整体读取
  const SOCIAL_ENGINEERING = SOCIAL_ENGINEERING_STRONG.concat(SOCIAL_ENGINEERING_WEAK);

  // 假冒官方话术（仅保留「银狐用来安抚受害者」的强特征防御性话术；
  // 普通下载按钮文案「安全下载/高速下载/本地下载/电信下载/普通下载/绿色版/纯净版/无插件」过于常见，
  // 已从本表移除，避免任何带 exe 的正规下载站被误判为 danger）
  const FAKE_OFFICIAL = [
    '官方下载', '官网认证', '官网正版', '防病毒误报', '杀软误报', '杀毒软件误报',
    '加白名单', '官方授权', '这是安全的', '无毒', '官网下载', '正版下载', '官方正版'
  ];

  // ============ 银狐「签名诱饵」主题（高区分度，正常站点极少出现）============
  // 来源：2025–2026 多份银狐报告归纳的反复出现的投递主题。
  // 这些词单独出现在普通页面概率极低；若同时页内含下载/网盘入口，则高度可疑。
  // 已用 hasDownloadLink 门控（见 analyzer.js detLureTheme），避免政府/企业正常网页误伤。
  const LURE_THEMES = [
    '税务稽查', '所得税汇算', '企业所得税汇算', '个税退税', '个人所得税退税', '退税', '金税',
    '汇算清缴', '稽查通知', '税务抽查', '稽查局', '违规记录', '补贴申领', '社保补贴', '工资补贴',
    '薪资补贴', '行政处罚告知书', '处理决定书', '开票目录', '补贴发放', '补贴名单', '工资明细表',
    '录取名单', '采购名单', '名单公示', '清查通报', '整改通知', '专项检查', '稽查材料', '退费通知'
  ];

  // ============ 伪造「插件/浏览器/Flash 版本过低」更新提示 ============
  // 银狐常用「点击页面任意位置→弹窗 flash/浏览器版本过低→重定向下载页」诱导。
  // 门控：需页面含重定向/iframe 或下载入口，避免正常站点「请更新浏览器」横幅误伤。
  const FAKE_UPDATE_TERMS = [
    'flash版本过低', 'flash 版本过低', '版本过低', '插件版本过低', '浏览器版本过低', '您的浏览器版本过低',
    '浏览器版本过', '请更新插件', '需要安装插件', '插件已过期', '请安装最新插件', '缺少flash', '未安装flash',
    'flash播放器', '播放器版本过低', 'npapi', '请下载flash', 'adobe flash', 'flash player 版本'
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
  // ⚠️ 通用规则（超长 hex 转义 / 大量 fromCharCode / 超长 atob base64）阈值已上调，
  // 避免误伤 Vercel/Netlify/Next.js 等现代化站点压缩后的生产 JS、内联字体/图片/sourcemap。
  // 保留 obfuscator.io 专属的 `_0x` 变量特征（terser/esbuild 等压缩器不会产出，是高置信混淆信号）。
  // ⚠️ 2026-08-30 误报治理重构（两条改动）：
  //   1) 删除 (unescape|decodeURIComponent) 规则：处理 % 编码是路由解析与参数解码的
  //      常规操作，正规站（尤其中文站、SPA、带跳转统计的站点）普遍使用，
  //      作为「混淆」特征误报率极高，予以删除。
  //   2) atob 长 base64 阈值 300 → 2000：内联 SVG / 图标字体 / 小图 / webpack 内联
  //      资源轻松超过 300 字符，原阈值几乎必中；抬到 2000 后命中的基本只剩真实加密载荷。
  // 保留项说明：packed 打包器、超长十六进制转义、大量 fromCharCode、_0x 变量数组
  // （obfuscator.io 专属）、document.write+unescape、javascript: 伪协议执行
  // —— 这些都是高置信的真实混淆特征，正规打包工具不会产出。
  const OBFUSCATION_PATTERNS = [
    /eval\s*\(\s*function\s*\([\s\S]{0,40}?\)\s*\{[\s\S]{0,80}?return[\s\S]{0,120}?\}\s*\(\s*\d+\s*,/i, // packed 打包器
    /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){40,}/i, // 超长十六进制转义串（阈值 20→40）
    /(?:fromCharCode|String\.fromCharCode)\s*\((?:0x[0-9a-f]+|\d+)\s*(?:,[^)]{0,200}?){12,}/i, // 大量 fromCharCode（8→12）
    /atob\s*\(\s*['"][A-Za-z0-9+/=]{2000,}/i, // 超长 base64 字面量（120→300→2000，规避内联资源误判）
    /_0x[a-f0-9]{4,}\s*=[\s\S]{0,30}?\[['"][a-z0-9]+['"]\]/, // 典型十六进制变量混淆（obfuscator.io 专属）
    // 经典加密落地：document.write(unescape(...))
    // ⚠️ 2026-08-31 收紧：原规则只要出现 `document.write(unescape(` 即判混淆，
    // 但这正是 **CNZZ / 友盟+ 站长统计的官方标准埋点代码** 写法，国内数百万网站在用：
    //   document.write(unescape("%3Cspan id='cnzz_stat_icon_xxx'%3E%3C/span%3E%3Cscript src='"+p+"'%3E%3C/script%3E"))
    // 实测 www.lanzou.com 即因这段统计代码被判「JS 代码混淆 +30」。
    // 正规用法编码的只是一小段 HTML 标签（零星几个 %XX，且被字符串拼接打断）；
    // 真正的加密落地会把整段脚本全部编码 → 必然出现长串**连续** %XX。
    // 因此改为要求：unescape 调用后 200 字符内出现 ≥40 个连续 %XX 编码。
    /document\.write\s*\(\s*unescape\s*\([\s\S]{0,200}?(?:%[0-9a-f]{2}){40,}/i,
    /var\s+_0x[0-9a-f]+\s*=\s*\[/i, // 混淆变量数组（obfuscator.io 专属）
    /javascript\s*:\s*(?:eval|atob|decodeURIComponent)\s*\(/i
  ];

  // 虚拟机 / 沙箱环境检测（银狐 loader 强特征）
  // ⚠️ 只保留「原生系统调用 / 虚拟机厂商 / 反调试 / 显式 VM 探测函数名」这类强特征。
  // 已删除 navigator.hardwareConcurrency / navigator.plugins.length / navigator.maxTouchPoints /
  // screen.width / window.external / 泛化 debugger 关键字 / wmi|SELECT * FROM 等——这些是几乎所有
  // 现代网站（尤其 Vercel/Netlify/GitHub Pages 等海外托管站）都会用到的标准浏览器 API，
  // 命中即 +35 强特征直接判 danger，是海外托管/认证平台被误判为银狐的主因。
  const VM_DETECTION_PATTERNS = [
    /GetModuleHandle|IsDebuggerPresent|CreateToolhelp32Snapshot/i,
    /VirtualBox|VMware|QEMU|Parallels|Hyper\-?V|Oracle VM/i,
    /Win32_Processor|Win32_BIOS|Win32_ComputerSystem/i,
    /cpuz|speccy|sandboxie|wireshark/i,
    /anti[_-]?debug|antiDebug|__debugger\b/i,
    /(?:detect[\s_]?vm|isVM|vmDetect|checkVM|sandboxCheck|antiSandbox)/i
  ];

  // 已知恶意脚本片段 / C2 行为特征（通用、低误报）
  const KNOWN_BAD_SNIPPETS = [
    /powershell\s+\-nop\s+\-w\s+hidden/i,
    /powershell\s+\-enc\b|powershell\s+\-e\s+[A-Za-z0-9+/=]{20,}|EncodedCommand/i, // PowerShell 编码执行（银狐 loader 常用）
    /iex\s*\(|Invoke-Expression|DownloadString|FromBase64String/i, // PowerShell 下载/解码载荷
    /certutil\s+\-urlcache\s+\-split\s+\-f/i,
    /bitsadmin\s+\/transfer/i,
    /rundll32\s*\(/i,
    /regsvr32\s+\/s\s+/i,
    /WScript\.Shell|wscript\.exe|cscript\.exe|mshta\b|mshta\.exe/i, // 脚本宿主/HTA 落地
    /ShellExecute\s*\(/i,
    /CreateObject\s*\(\s*['"]WScript/i,
    /\\AppData\\Roaming|%AppData%|%Temp%|%TEMP%/i,
    /taskkill\s+\/f\s+\/im/i,
    /netsh\s+firewall|netsh\s+advfirewall/i,
    /schtasks\s+\/create|reg\s+add.*CurrentVersion\\Run|sc\s+create\b|net\s+start\s+\w+/i, // 持久化
    /Set-MpPreference|Add-MpPreference|DisableAntiSpyware|-ExclusionPath|MpPreference/i, // 关闭/排除 Defender（银狐对抗）
    /VirtualAlloc|CreateThread|RtlMoveMemory|WriteProcessMemory/i, // 内存注入/Shellcode 加载（银狐 loader 强特征）
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
  // ⚠️ 2026-08-31 修复一处通杀级误报：原实现对整条 href 做 `endsWith('.' + ext)` 判断，
  // 而 EXEC_EXTENSIONS 含 'com'、ARCHIVE_EXTENSIONS 含 'zip' / 'cab' / 'img' —— 这些同时
  // 是真实顶级域名。于是任何指向域名根、末尾不带斜杠的普通链接都会被判成「可执行文件直链」：
  //     <a href="http://www.woozooo.com">  →  endsWith('.com') → exec
  //     <a href="https://example.com">     →  exec
  // 页脚友链、合作方、备案查询链接普遍是这种写法，导致几乎所有中文站都凭空产出若干
  // 「.exe 直链」，直接触发 execDownload 维度加分（实测 www.lanzou.com 因此 +12）。
  //
  // 修复：扩展名只在【URL 路径的最后一段】上判断，host 不参与。
  //   http://www.woozooo.com        → path='/'          → 末段为空 → other  ✅
  //   https://x.com/setup.exe       → 末段='setup.exe'  → exec            ✅
  //   /dl/wechat.com                → 末段='wechat.com' → exec（真 DOS 可执行）✅
  function _lastPathSegment(href) {
    let s = String(href).split('#')[0].split('?')[0];
    // 剥离 scheme + host（含协议相对写法 //host/path）
    const m = s.match(/^[a-z][a-z0-9+.\-]*:\/\/[^/]*(\/.*)?$/i);
    if (m) s = m[1] || '/';
    else if (/^\/\/[^/]+/.test(s)) s = s.replace(/^\/\/[^/]+/, '') || '/';
    const seg = s.split('/').pop() || '';
    return seg.toLowerCase();
  }
  function classifyLink(href) {
    if (!href) return 'other';
    const h = href.toLowerCase();
    if (/^(javascript:|#|mailto:|tel:)/i.test(href)) return 'other';
    const seg = _lastPathSegment(href);
    if (seg && seg.indexOf('.') !== -1) {
      for (const e of EXEC_EXTENSIONS) if (seg.endsWith('.' + e)) return 'exec';
      for (const e of ARCHIVE_EXTENSIONS) if (seg.endsWith('.' + e)) return 'archive';
    }
    for (const c of CLOUD_DISK_HOSTS) if (h.indexOf(c) !== -1) return 'cloud';
    if (/download|\.exe|安装包|客户端|完整版|破解|激活|注册机|绿色版|免费版/i.test(href)) return 'download';
    return 'other';
  }

  const API = {
    OFFICIAL_DOMAINS,
    TRUSTED_PLATFORMS,
    TRUSTED_DOWNLOAD_HOSTS,
    KNOWN_BAD_DOMAINS,
    KNOWN_BAD_FILENAMES,
    SUSPICIOUS_DOWNLOAD_NAME_PATTERNS,
    BRAND_KEYWORDS,
    FRIENDLY_LINK_BRANDS,
    DOWNLOAD_KEYWORDS,
    SOCIAL_ENGINEERING,
    SOCIAL_ENGINEERING_STRONG,
    SOCIAL_ENGINEERING_WEAK,
    FAKE_OFFICIAL,
    SUSPICIOUS_TLDS,
    CLOUD_DISK_HOSTS,
    EXEC_EXTENSIONS,
    ARCHIVE_EXTENSIONS,
    OBFUSCATION_PATTERNS,
    VM_DETECTION_PATTERNS,
    KNOWN_BAD_SNIPPETS,
    REDIRECT_PATTERNS,
    LURE_THEMES,
    FAKE_UPDATE_TERMS,
    classifyLink
  };

  if (typeof window !== 'undefined') window.SF_IOCS = API;
  if (typeof self !== 'undefined') self.SF_IOCS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
