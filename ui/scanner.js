/* 银狐防护 · SilverFox Guard — 静态样本扫描模块
 * scanner.js
 *   SF_CORE   静态分析引擎（特征库 + 字符串/zip/PE/魔数/IAT 分析）
 *   SFScanner 扫描 UI 挂载（配色全部走扩展 --sf-* CSS 变量，自动跟随主题与深浅色）
 * 纯本地静态扫描，绝不运行样本；结果仅供参考，扫描并非 100% 准确。
 */
(function(){
"use strict";

var RULES = [
  /* ---------- 银狐家族特征（致命） ---------- */
  {id:"SF-001", group:"银狐家族特征", sev:3, name:"银狐回联特征 getinstall64", desc:"国家病毒应急处理中心披露的银狐回联 URL 路径（[域名]:8880/getinstall64）。",
   pats:[{t:"s",v:"getinstall64"}]},
  {id:"SF-002", group:"银狐家族特征", sev:3, name:"Gh0st 远控协议标记", desc:"Gh0st 远控木马家族标识，银狐核心远控即 Gh0st 变种。",
   pats:[{t:"s",v:"gh0st"}]},
  {id:"SF-003", group:"银狐家族特征", sev:3, name:"银狐变种特征字符串 cb1st", desc:"内存取证确认的银狐变种特征字符串（Gh0st 分支标记）。",
   pats:[{t:"s",v:"cb1st"}]},
  {id:"SF-004", group:"银狐家族特征", sev:3, name:"白加黑组件 libcef_dll_wrapper", desc:"释放于 C:\\Program Files\\Internet Explorer 的银狐白加黑组件（libcef_dll_wrapper.dll + .bin + temp.key + C3Exporer.exe）。",
   pats:[{t:"s",v:"libcef_dll_wrapper"}]},
  {id:"SF-005", group:"银狐家族特征", sev:3, name:"银狐加载器 C3Exporer / C3Explorer", desc:"由 AppID 计划任务启动的银狐持久化加载器。",
   pats:[{t:"s",v:"c3exporer.exe"},{t:"s",v:"c3explorer.exe"}]},
  {id:"SF-006", group:"银狐家族特征", sev:3, name:"银狐载荷 Server64.dll", desc:"白加黑解密得到的银狐最终远控载荷（Gh0st 类）。",
   pats:[{t:"s",v:"server64.dll"}]},
  {id:"SF-007", group:"银狐家族特征", sev:3, name:"银狐下载器 InstallEx.dll", desc:"Shellcode 解密后内存加载的银狐模块，导出 run 函数。",
   pats:[{t:"s",v:"installex.dll"}]},
  {id:"SF-008", group:"银狐家族特征", sev:3, name:"银狐加密载荷 NHQDX.jpg", desc:"解密后为 DLL 的银狐载荷（内含 80 个加密 C2 地址）。",
   pats:[{t:"s",v:"nhqdx.jpg"}]},
  {id:"SF-009", group:"银狐家族特征", sev:3, name:"银狐远控插件 Consys21 / ConsysFun", desc:"加密远控插件（ConsysFun.png 解密为 Consys21.dll），支持截屏/键盘/语音/远程终端。",
   pats:[{t:"s",v:"consys21"},{t:"s",v:"consysfun"}]},
  {id:"SF-010", group:"银狐家族特征", sev:3, name:"银狐配置 instal.ini", desc:"存有 id 值、用于从 80 个内置 C2 中选择回连地址的加密配置。",
   pats:[{t:"s",v:"instal.ini"}]},
  {id:"SF-011", group:"银狐家族特征", sev:3, name:"团伙内部代号 Winos / WinOs", desc:"瑞星通过服务端 PDB 确认的银狐木马团伙内部称呼。",
   pats:[{t:"s",v:"winos"},{t:"s",v:"win os"}]},
  {id:"SF-012", group:"银狐家族特征", sev:3, name:"白加黑组件 stardict-editor.dll", desc:"伪装词典组件的银狐解密 DLL（解密 _8 文件）。",
   pats:[{t:"s",v:"stardict-editor.dll"}]},
  {id:"SF-013", group:"银狐家族特征", sev:3, name:"银狐互斥量 Global\\Admin!!!", desc:"银狐远控防重复加载的全局互斥量名。",
   pats:[{t:"s",v:"global\\admin!!!"}]},
  {id:"SF-014", group:"银狐家族特征", sev:3, name:"银狐 RC4 通信密钥 qQ996545", desc:"银狐远控通信数据 RC4 加密固定密钥。",
   pats:[{t:"s",v:"qQ996545"}]},
  {id:"SF-015", group:"银狐家族特征", sev:3, name:"银狐心跳串 YourSharedSecretKey", desc:"银狐 UserInfoPlugin 心跳包固定内容。",
   pats:[{t:"s",v:"yoursharedsecretkey"}]},
  {id:"SF-016", group:"银狐家族特征", sev:3, name:"NSIS 恶意加载器 xmplay.exe", desc:"释放并执行恶意载荷的银狐 NSIS 加载器。",
   pats:[{t:"s",v:"xmplay.exe"}]},
  {id:"SF-017", group:"银狐家族特征", sev:3, name:"Shellcode 加载器 AutoRecoverDat.dll", desc:"解密 GPUCache.xml 得到 shellcode 的银狐组件。",
   pats:[{t:"s",v:"autorecoverdat.dll"}]},
  {id:"SF-018", group:"银狐家族特征", sev:3, name:"银狐加密数据 GPUCache.xml", desc:"存放加密 shellcode 的伪装文件名（含 GPUCache2.xml）。",
   pats:[{t:"s",v:"gpucache.xml"},{t:"s",v:"gpucache2.xml"}]},
  {id:"SF-019", group:"银狐家族特征", sev:3, name:"C2 下载组件 APTBIN_Main.dll / VFPower_32.dll / UserInfoPlugin.dll", desc:"银狐分阶段下载组件：创建计划任务、连接 C2 下载远控模块。",
   pats:[{t:"s",v:"aptbin_main.dll"},{t:"s",v:"vfpower_32.dll"},{t:"s",v:"userinfoplugin.dll"}]},
  {id:"SF-020", group:"银狐家族特征", sev:3, name:"BYOVD 驱动 BdApiUtil64.sys", desc:"被银狐劫持以终止安全软件进程的合法驱动（控制码 0x800024b4）。",
   pats:[{t:"s",v:"bdapiutil64.sys"}]},
  {id:"SF-021", group:"银狐家族特征", sev:3, name:"EDR 致盲驱动 rwdriver.sys", desc:"清除内核回调、致盲 EDR 的银狐对抗驱动。",
   pats:[{t:"s",v:"rwdriver.sys"}]},
  {id:"SF-022", group:"银狐家族特征", sev:3, name:"银狐模块 Single.dll / Code_Shellcode后门.dll", desc:"shellcode 二次解密与内存加载后门模块（中文 DLL 名）。",
   pats:[{t:"s",v:"single.dll"},{t:"s",v:"code_shellcode"}]},
  {id:"SF-023", group:"银狐家族特征", sev:3, name:"Winos 远控模块 上线模块.dll / 登录模块.dll", desc:"Winos 远控的上线与登录模块（键盘记录/剪贴板/截屏）。",
   pats:[{t:"s",v:"上线模块.dll"},{t:"s",v:"登录模块.dll"}]},
  {id:"SF-024", group:"银狐家族特征", sev:3, name:"银狐服务端中文插件名", desc:"瑞星披露的服务端插件（键盘记录.dll / 播放监听.dll / 远程终端.dll / 语音监听.dll / 文件管理.dll / 系统管理.dll / 压力测试.dll 等）。",
   pats:[{t:"s",v:"键盘记录.dll"},{t:"s",v:"播放监听.dll"},{t:"s",v:"远程终端.dll"},{t:"s",v:"语音监听.dll"},{t:"s",v:"文件管理.dll"},{t:"s",v:"系统管理.dll"},{t:"s",v:"压力测试.dll"},{t:"s",v:"查看微信聊天记录工具.dll"},{t:"s",v:"企鹅解密.dll"},{t:"s",v:"添加重启上线.dll"},{t:"s",v:"一键提权.dll"}]},
  {id:"SF-025", group:"银狐家族特征", sev:3, name:"PoolParty 线程池注入", desc:"2025 年起银狐高频使用的开源注入手段（TpAllocAlpcCompletion / TP_ALPC / NtAlpcCreatePort）。",
   pats:[{t:"s",v:"tpalalccompletion"},{t:"s",v:"tp_alpc"},{t:"s",v:"ntalpccreateport"},{t:"s",v:"poolparty"}]},
  {id:"SF-026", group:"银狐家族特征", sev:3, name:"UAC 绕过 RPC 接口 GUID", desc:"银狐 UAC 绕过使用的 RPC 接口标识 201ef99a-7fa0-444c-9399-19ba84f12a1a。",
   pats:[{t:"s",v:"201ef99a-7fa0-444c-9399-19ba84f12a1a"}]},
  {id:"SF-027", group:"银狐家族特征", sev:3, name:"提权/对抗组件 bypass.exe · NtHandleCallback.exe", desc:"银狐 UAC 绕过工具与白加黑组件。",
   pats:[{t:"s",v:"nthandlecallback.exe"},{t:"s",v:"bypass.exe"}]},
  {id:"SF-028", group:"银狐家族特征", sev:3, name:"银狐加载器 updat4.vac", desc:"InnoSetup 释放的银狐 DLL 加载器（伪装 .vac 扩展名）。",
   pats:[{t:"s",v:"updat4.vac"}]},
  {id:"SF-029", group:"银狐家族特征", sev:3, name:"银狐远控载荷 NH.dat", desc:"解密后的银狐远控 DLL（含 80 个 C2、RC4 加密通信）。",
   pats:[{t:"s",v:"nh.dat"}]},
  {id:"SF-030", group:"银狐家族特征", sev:3, name:"7z 解压口令 htLcENyRFYwXsHFnUnqK", desc:"银狐样本释放组件使用的固定解压口令。",
   pats:[{t:"s",v:"htlcenyrfywxhfnunqk"}]},
  {id:"SF-031", group:"银狐家族特征", sev:2, name:"白加载链 log.dll + installer.exe", desc:"国家病毒应急处理中心披露：银狐载荷 log.dll 由白文件 installer.exe 加载（C:\\Program Files\\Internet Explorer 目录）。",
   pats:[{t:"r",v:"log\\.dll[\\s\\S]{0,600}installer\\.exe"},{t:"r",v:"installer\\.exe[\\s\\S]{0,600}log\\.dll"}]},
  {id:"SF-032", group:"银狐家族特征", sev:3, name:"LNK 载荷调用执行器", desc:"LNK 快捷方式内容引用 exe / powershell / cmd / rundll32 / mshta——银狐 LNK 图标伪装投递手法。",
   pats:[{t:"r",v:"[^\\n]{0,30}\\.lnk[^\\n]{0,220}(powershell|rundll32|mshta|cmd\\.exe|regsvr32)"}]},

  /* ---------- 安全软件对抗（高危） ---------- */
  {id:"AV-001", group:"安全软件对抗", sev:2, name:"Defender 排除列表操作", desc:"Add-MpPreference -ExclusionPath / -ExclusionProcess，把系统盘或自身加入杀软白名单——银狐高频免杀动作。",
   pats:[{t:"s",v:"add-mppreference -exclusion"}]},
  {id:"AV-002", group:"安全软件对抗", sev:2, name:"关闭 Defender 实时防护", desc:"Set-MpPreference -DisableRealtimeMonitoring 关闭杀软实时监控。",
   pats:[{t:"s",v:"set-mppreference -disablerealtime"}]},
  {id:"AV-003", group:"安全软件对抗", sev:2, name:"结束安全软件进程", desc:"taskkill 终止 360 / 火绒 / 腾讯电脑管家等安全产品进程（Hips、360tray、QQPCRTP、USysDiag、wsctrl）。",
   pats:[{t:"r",v:"taskkill[^\\n]{0,90}(360|hips|qqpcrtp|qqpctray|usysdiag|wsctrl|360tray)"}]},
  {id:"AV-004", group:"安全软件对抗", sev:2, name:"检测安全软件进程 360tray", desc:"遍历进程检测 360tray.exe（银狐针对性绕过 360）。",
   pats:[{t:"s",v:"360tray"},{t:"s",v:"360safe"}]},
  {id:"AV-005", group:"安全软件对抗", sev:2, name:"BYOVD 驱动控制码 0x800024b4", desc:"劫持 BdApiUtil64.sys 终止安全软件进程的设备控制码。",
   pats:[{t:"s",v:"0x800024b4"}]},
  {id:"AV-006", group:"安全软件对抗", sev:2, name:"枚举 TCP 表切断安全软件网络", desc:"GetExtendedTcpTable 枚举并切断安全软件云查杀连接（银狐 2025 变种手法）。",
   pats:[{t:"s",v:"getextendedtcptable"}]},

  /* ---------- 白利用 / 下载执行（高危） ---------- */
  {id:"DL-001", group:"白利用下载执行", sev:2, name:"rundll32 加载伪装扩展名模块", desc:"rundll32.exe 加载 .dat/.xml/.json/.png/.bin/.vac/.key 等伪装文件——银狐高频白利用手法。",
   pats:[{t:"r",v:"rundll32[^\\n]{0,70}\\.(dat|xml|json|png|bin|vac|jpg|key)"}]},
  {id:"DL-002", group:"白利用下载执行", sev:2, name:"regsvr32 远程脚本 (squiblydoo)", desc:"regsvr32 /s /u /i:URL scrobj.dll 远程加载脚本执行。",
   pats:[{t:"r",v:"regsvr32[^\\n]{0,80}scrobj"},{t:"r",v:"regsvr32[^\\n]{0,60}http"}]},
  {id:"DL-003", group:"白利用下载执行", sev:2, name:"mshta 执行脚本", desc:"mshta 执行 javascript / vbscript / 远程 URL（HTA 攻击）。",
   pats:[{t:"r",v:"mshta[^\\n]{0,60}(javascript|http|vbscript)"}]},
  {id:"DL-004", group:"白利用下载执行", sev:2, name:"certutil 远程下载", desc:"certutil -urlcache -split -f 下载并落盘文件。",
   pats:[{t:"r",v:"certutil[^\\n]{0,80}(urlcache|/urlcache)"}]},
  {id:"DL-005", group:"白利用下载执行", sev:2, name:"bitsadmin 远程下载", desc:"bitsadmin /transfer 下载可执行文件。",
   pats:[{t:"r",v:"bitsadmin[^\\n]{0,80}/transfer"}]},
  {id:"DL-006", group:"白利用下载执行", sev:2, name:"PowerShell 编码执行 (-enc)", desc:"powershell -EncodedCommand Base64 载荷——免杀高频手法。",
   pats:[{t:"r",v:"powershell[^\\n]{0,80}(-enc|-encodedcommand)[^\\n]{0,40}"}]},
  {id:"DL-007", group:"白利用下载执行", sev:2, name:"PowerShell 隐藏窗口执行", desc:"powershell -WindowStyle Hidden 静默执行。",
   pats:[{t:"r",v:"powershell[^\\n]{0,60}-w[^\\n]{0,8}hidden"},{t:"r",v:"-windowstyle hidden"}]},
  {id:"DL-008", group:"白利用下载执行", sev:2, name:"PowerShell 绕过执行策略", desc:"-ExecutionPolicy Bypass 绕过脚本执行限制。",
   pats:[{t:"r",v:"powershell[^\\n]{0,70}(-ex[^\\n]{0,12})?bypass"},{t:"r",v:"executionpolicy bypass"}]},
  {id:"DL-009", group:"白利用下载执行", sev:2, name:"IEX 远程下载执行", desc:"Invoke-Expression 下载远程脚本并执行（DownloadString + IEX 链）。",
   pats:[{t:"r",v:"(iex|invoke-expression)[^\\n]{0,50}(http|downloadstring|new-object)"}]},
  {id:"DL-010", group:"白利用下载执行", sev:2, name:"下载后执行链", desc:"DownloadString / DownloadFile + Invoke-Expression / Start-Process 组合。",
   pats:[{t:"s",v:"downloadstring"},{t:"s",v:"downloadfile"}]},
  {id:"DL-011", group:"白利用下载执行", sev:1, name:"cmd /c 调用 PowerShell", desc:"cmd 静默调用 powershell（常见于下载器脚本）。",
   pats:[{t:"r",v:"cmd[^\\n]{0,20}/c[^\\n]{0,70}powershell"}]},
  {id:"DL-012", group:"白利用下载执行", sev:1, name:"wscript / cscript 执行脚本", desc:"Windows 脚本宿主执行 .vbs/.js/.jse/.wsf。",
   pats:[{t:"r",v:"(wscript|cscript)[^\\n]{0,40}\\.(vbs|js|jse|vbe|wsf)"}]},

  /* ---------- C2 通信特征（高危） ---------- */
  {id:"C2-001", group:"C2 通信特征", sev:2, name:"银狐 C2 端口 8880", desc:"国家病毒应急处理中心披露的银狐回联端口（[域名]:8880）。",
   pats:[{t:"r",v:":8880([/\\s\"']|$)"}]},
  {id:"C2-002", group:"C2 通信特征", sev:2, name:"银狐 C2 端口 18852", desc:"银狐 APTBIN_Main / VFPower 下载组件使用的 C2 端口。",
   pats:[{t:"r",v:":18852([/\\s\"']|$)"}]},
  {id:"C2-003", group:"C2 通信特征", sev:2, name:"银狐 C2 端口段 9090-9092", desc:"亚信披露的银狐 C2 端口段（45.204.200.26:9090/9091/9092）。",
   pats:[{t:"r",v:":90(90|91|92)([/\\s\"']|$)"}]},
  {id:"C2-004", group:"C2 通信特征", sev:2, name:"银狐 C2 端口 58600", desc:"Winos 上线模块轮询端口之一（27.124.45.66:58600）。",
   pats:[{t:"r",v:":58600([/\\s\"']|$)"}]},
  {id:"C2-005", group:"C2 通信特征", sev:1, name:"Gh0st 常用端口 8001", desc:"Gh0st 协议常用回连端口（银狐历史样本大量使用）。",
   pats:[{t:"r",v:":8001([/\\s\"']|$)"}]},

  /* ---------- 注入 / 提权 / 持久化（高危） ---------- */
  {id:"IN-001", group:"注入与持久化", sev:2, name:"进程注入原语", desc:"VirtualAllocEx + WriteProcessMemory + CreateRemoteThread 组合（异地线程注入）。",
   pats:[{t:"s",v:"virtualallocex"},{t:"s",v:"writeprocessmemory"},{t:"s",v:"createremotethread"}]},
  {id:"IN-002", group:"注入与持久化", sev:2, name:"APC 注入", desc:"QueueUserAPC / NtQueueApcThread 异步过程调用注入（银狐注入 VSSVC.exe 手法）。",
   pats:[{t:"s",v:"queueuserapc"},{t:"s",v:"ntqueueapcthread"}]},
  {id:"IN-003", group:"注入与持久化", sev:2, name:"计划任务持久化", desc:"schtasks /create 注册计划任务（银狐 AppID 持久化手法）。",
   pats:[{t:"r",v:"schtasks[^\\n]{0,80}/create"}]},
  {id:"IN-004", group:"注入与持久化", sev:1, name:"注册表 Run 键持久化", desc:"HKCU/HKLM CurrentVersion\\Run 写入自启动。",
   pats:[{t:"r",v:"(hkcu|hklm)[^\\n]{0,90}currentversion\\\\run"}]},
  {id:"IN-005", group:"注入与持久化", sev:2, name:"反沙箱 · VMware 检测", desc:"检测 VMware Tools 判断虚拟机环境，沙箱中休眠。",
   pats:[{t:"s",v:"vmware tools"},{t:"r",v:"vmware\\\\tools"}]},
  {id:"IN-006", group:"注入与持久化", sev:2, name:"反射式 DLL 注入 (sRDI)", desc:"Shellcode Reflective DLL Injection——内存反射加载 DLL，磁盘无文件。",
   pats:[{t:"s",v:"reflective dll"},{t:"s",v:"srdi"},{t:"s",v:"peterferrie"}]},
  {id:"IN-007", group:"注入与持久化", sev:2, name:"WMI 事件订阅持久化", desc:"__EventFilter / __EventConsumer 无文件持久化，登录或定时触发执行 PowerShell 载荷。",
   pats:[{t:"s",v:"__eventfilter"},{t:"s",v:"__eventconsumer"},{t:"s",v:"commandlineeventconsumer"},{t:"s",v:"__instancecreationevent"}]},
  {id:"IN-008", group:"注入与持久化", sev:1, name:".local DLL 重定向", desc:"[exe].exe.local 空目录强制 DLL 优先从同目录加载（白加黑辅助手法）。",
   pats:[{t:"r",v:"\\.exe\\.local"}]},

  /* ---------- 安装包异常特征（中危） ---------- */
  {id:"PKG-001", group:"安装包异常特征", sev:1, name:"RunOnce 注册表持久化", desc:"脚本引用 RunOnce 注册表键——安装后自动执行（银狐持久化手法，配合其他特征判定）。",
   pats:[{t:"r",v:"currentversion\\\\runonce"}]},
  {id:"PKG-002", group:"安装包异常特征", sev:1, name:"驱动仓库/内核痕迹", desc:"引用 DriverStore\\FileRepository 等驱动安装路径——伪装驱动更新类安装包常见（银狐曾伪装显卡驱动）。",
   pats:[{t:"r",v:"driverstore\\\\filerepository"}]}
];

/* 文件名规则：独立于内容规则，匹配文件名本身 */
var PH_KEYWORD = "(违纪名单|违纪通报|通报人员|裁员名单|裁员补偿|补偿方案|工资表|内部调查|名单信息|违规人员|处罚决定|稽查名单|发放名单|绩效奖金|考勤表|津贴|补贴发放|审计报告|处分决定)";
var FILE_RULES = [
  {id:"PH-001", group:"钓鱼伪装文件名", sev:2, name:"可执行文件 + 人事/财务诱导关键词", desc:"文件名含“违纪名单 / 裁员补偿 / 工资表”等诱导词且为可执行文件——银狐标志性投递方式。",
   test:function(fn){ return /\.(exe|scr|com|pif|msi|bat|cmd|lnk)$/i.test(fn) && new RegExp(PH_KEYWORD).test(fn); }},
  {id:"PH-002", group:"钓鱼伪装文件名", sev:1, name:"人事/财务诱导关键词", desc:"文件名含违纪名单、裁员补偿、工资表、内部调查等社工关键词。",
   test:function(fn){ return new RegExp(PH_KEYWORD).test(fn); }},
  {id:"PH-003", group:"钓鱼伪装文件名", sev:2, name:"双扩展名伪装", desc:"xxx.pdf.exe / xxx.jpg.scr 等——伪装文档图标的可执行文件。",
   test:function(fn){ return /\.(pdf|jpg|jpeg|png|doc|docx|xls|xlsx|rar|zip|txt|7z|wps)\.(exe|scr|com|pif|bat|cmd|msi|lnk)$/i.test(fn); }},
  {id:"PH-004", group:"钓鱼伪装文件名", sev:1, name:"非常规可执行扩展名", desc:".scr / .pif / .com——银狐投递常使用的可执行扩展名（配合图标伪装）。",
   test:function(fn){ return /\.(scr|pif|com)$/i.test(fn); }},
  {id:"PH-005", group:"钓鱼伪装文件名", sev:1, name:"随机大写字母+数字组合可执行文件", desc:"文件名像乱码一样的全大写字母+数字组合（5-10 位）+ .exe/.scr/.pif——银狐安装包释放恶意载荷的命名特征（排除系统常见 DLL）。",
   test:function(fn){
     var base = fn.split("/").pop().split("\\").pop();
     var m = /^([A-Z0-9]{5,10})\.(exe|scr|pif)$/.exec(base);
     if (!m) return false;
     /* 排除常见系统 DLL/工具名 */
     var sys = ["SETUPAPI","COMCTL32","GDI32","KERNEL32","USER32","ADVAPI32","SHELL32","NTDLL","OLE32","OLEAUT32","WS2_32","WININET","CRYPT32","RPCRT4","VERSION","WINMM","MSVCRT","SHLWAPI"];
     return sys.indexOf(m[1]) < 0;
   }},
  {id:"PH-006", group:"钓鱼伪装文件名", sev:1, name:"安装包 + 随机名可执行文件组合", desc:"同一压缩包内同时存在完整安装包（setup/install/官方软件名）与随机大写字母数字 exe——银狐投递容器特征（完整官方包+恶意载荷）。",
   test:function(fn){ return false; /* 该规则由 zip 容器组合逻辑触发 */ }}
];

/* ================================================================
 * 复用 rules/iocs.js 的 IOC（单一数据源）
 * options.html 已先于本脚本加载 rules/iocs.js，故 self.SF_IOCS 在此可用。
 * 这样「网页链接分析引擎」与「设置页文件静态扫描」共用同一份
 * KNOWN_BAD_FILENAMES / SUSPICIOUS_DOWNLOAD_NAME_PATTERNS / BRAND_KEYWORDS，
 * 不再出现两条独立规则集漂移（此前样本 IOC 只进了 analyzer.js，导致文件扫描扫不出）。
 * ================================================================ */
(function injectIocRules(){
  var SF = (typeof self !== "undefined" && self.SF_IOCS) || (typeof window !== "undefined" && window.SF_IOCS) || null;
  if (!SF) return;

  /* 文件名维度：精确命中已知木马化投递物 → sev3 直接判危 */
  var knownNames = SF.KNOWN_BAD_FILENAMES || [];
  if (knownNames.length){
    FILE_RULES.push({
      id:"SF-FN-001", group:"已知木马化投递物", sev:3,
      name:"已知银狐木马化投递物文件名",
      desc:"文件名与已捕获的银狐木马化投递物完全一致（如 bzy.exe / shanlian_vpn_64.exe）——直接判危。",
      test:function(fn){
        var n = String(fn || "").toLowerCase().split(/[?#]/)[0].split("/").pop().split("\\").pop().trim();
        for (var i = 0; i < knownNames.length; i++){
          if (n === String(knownNames[i]).toLowerCase()) return true;
        }
        return false;
      }
    });
  }

  /* 文件名维度：命中可疑安装包命名模式（*_vpn_64.exe / *vpn*setup*.exe 等）→ sev2 高度可疑 */
  var namePats = SF.SUSPICIOUS_DOWNLOAD_NAME_PATTERNS || [];
  if (namePats.length){
    FILE_RULES.push({
      id:"SF-FN-002", group:"可疑安装包文件名", sev:1,
      name:"可疑 VPN/工具类安装包文件名",
      desc:"文件名符合银狐常用木马化投递命名（*_vpn_64.exe / *vpn*setup*.exe 等）——高度可疑。",
      test:function(fn){
        var n = String(fn || "").toLowerCase().split(/[?#]/)[0].split("/").pop().split("\\").pop().trim();
        for (var i = 0; i < namePats.length; i++){
          var p = namePats[i];
          if (p && p.test && p.test(n)) return true;
        }
        return false;
      }
    });
  }

  /* 注：曾有一则「内嵌木马化投递物品牌串」内容规则（SF-BR-001），对 .exe/.dll 等安装包内容
     匹配整份 BRAND_KEYWORDS（300+ 品牌词），导致所有正常安装包（含 qq/微信/wps 等内嵌资源串）
     一律 sev3 误报。已按决策移除；品牌词仅保留给网页域名仿冒检测（analyzer.js），不再用于文件内容扫描。
     若日后需恢复，应只匹配极窄的「已知木马化投递物专属品牌串」（闪连VPN/NextVPN/A Great VPN 等），
     而非全量品牌词，否则必再次触发全安装包误报。 */
})();

/* ================================================================
 * 核心工具
 * ================================================================ */

/* 提取可打印字符串（ASCII + UTF-16LE，含中文），返回小写拼接文本 */
function extractStrings(buf){
  var u8 = new Uint8Array(buf);
  var parts = [];
  var i, j;

  /* ASCII：可打印 0x20-0x7E，连续 >= 4 个 */
  i = 0;
  var n = u8.length;
  var cur = "";
  while (i < n){
    var c = u8[i];
    if (c >= 0x20 && c <= 0x7e){
      cur += String.fromCharCode(c);
      i++;
    } else {
      if (cur.length >= 4) parts.push(cur);
      cur = "";
      i++;
    }
  }
  if (cur.length >= 4) parts.push(cur);

  /* UTF-16LE：ASCII + 中日韩统一表意文字 + 全角，连续 >= 3 个码元 */
  cur = "";
  var isWide = function(u){
    return (u >= 0x20 && u <= 0x7e) || (u >= 0x4e00 && u <= 0x9fff) || (u >= 0x3000 && u <= 0x303f) || (u >= 0xff00 && u <= 0xffef);
  };
  i = 0;
  while (i + 1 < n){
    var u = u8[i] | (u8[i+1] << 8);
    if (isWide(u)){
      cur += String.fromCharCode(u);
      i += 2;
    } else {
      if (cur.length >= 3) parts.push(cur);
      cur = "";
      i += 1;
    }
  }
  if (cur.length >= 3) parts.push(cur);

  return parts.join("\n").toLowerCase();
}

/* zip 解析：只读 central directory + local header，绝不执行任何内容 */
function parseZip(buf){
  var u8 = new Uint8Array(buf);
  var n = u8.length;
  /* 找 EOCD (PK\x05\x06) */
  var eocd = -1;
  for (var i = n - 22; i >= Math.max(0, n - 22 - 65535); i--){
    if (u8[i] === 0x50 && u8[i+1] === 0x4b && u8[i+2] === 0x05 && u8[i+3] === 0x06){ eocd = i; break; }
  }
  if (eocd < 0) return null;
  var dv = new DataView(buf);
  var cdCount = dv.getUint16(eocd + 10, true);
  var cdOffset = dv.getUint32(eocd + 16, true); /* 相对 zip 数据起始的偏移；SFX 自解压包带 PE stub 前缀时 ≠ 文件起始 */
  /* 定位真正的中央目录起点：
   *   - 普通 zip：cdOffset 即文件绝对偏移，直接是 PK\x01\x02；
   *   - SFX 自解压包（setup.exe = PE stub + zip 数据）：cdOffset 仍相对 zip 数据起始，
   *     需从 cdOffset 向前扫到首个 PK\x01\x02 作为中央目录起点，stubLen = 起点 − cdOffset。
   * 局部头偏移 lho 同样要加上 stubLen 才能落到文件正确位置。 */
  var cdStart = cdOffset;
  var isCD = function(s){ return u8[s] === 0x50 && u8[s+1] === 0x4b && u8[s+2] === 0x01 && u8[s+3] === 0x02; };
  if (!isCD(cdStart)) {
    cdStart = -1;
    for (var s = cdOffset; s + 4 <= eocd; s++) { if (isCD(s)) { cdStart = s; break; } }
    if (cdStart < 0) { /* 兜底：全文件扫首个中央目录签名 */
      for (var t = 0; t + 4 <= n; t++) { if (isCD(t)) { cdStart = t; break; } }
    }
    if (cdStart < 0) return null;
  }
  var stubLen = cdStart - cdOffset;
  var entries = [];
  var off = cdStart;
  var limit = Math.min(cdCount, 500);
  for (var k = 0; k < limit; k++){
    if (off + 46 > n) break;
    if (!isCD(off)) break;
    var flags = dv.getUint16(off + 8, true);
    var method = dv.getUint16(off + 10, true);
    var csize = dv.getUint32(off + 20, true);
    var usize = dv.getUint32(off + 24, true);
    var nameLen = dv.getUint16(off + 28, true);
    var extraLen = dv.getUint16(off + 30, true);
    var commentLen = dv.getUint16(off + 32, true);
    var lho = dv.getUint32(off + 42, true) + stubLen;
    var raw = u8.subarray(off + 46, off + 46 + nameLen);
    var name = decodeZipName(raw, !!(flags & 0x800));
    entries.push({name:name, method:method, csize:csize, usize:usize, lho:lho, data:null});
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeZipName(raw, utf8Flag){
  if (utf8Flag){
    try { return new TextDecoder("utf-8", {fatal:true}).decode(raw); } catch(e){}
  }
  try { return new TextDecoder("utf-8").decode(raw); } catch(e){}
  try { return new TextDecoder("gbk").decode(raw); } catch(e){}
  return "entry#" + raw.length;
}

/* 解压单个 zip 条目（stored 直读；deflate 用 DecompressionStream；其他跳过） */
function inflateEntry(buf, entry){
  var u8 = new Uint8Array(buf);
  var n = u8.length;
  if (entry.lho + 30 > n) return null;
  var dv = new DataView(buf);
  if (!(u8[entry.lho] === 0x50 && u8[entry.lho+1] === 0x4b && u8[entry.lho+2] === 0x03 && u8[entry.lho+3] === 0x04)) return null;
  var nameLen = dv.getUint16(entry.lho + 26, true);
  var extraLen = dv.getUint16(entry.lho + 28, true);
  var dataStart = entry.lho + 30 + nameLen + extraLen;
  if (dataStart + entry.csize > n) return null;
  if (entry.usize > 15 * 1024 * 1024) return null; /* 防 zip 炸弹 */
  var blob = buf.slice(dataStart, dataStart + entry.csize);
  if (entry.method === 0) return blob; /* stored */
  if (entry.method === 8){
    try {
      return new Response(new Blob([blob]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    } catch(e){ return null; }
  }
  return null;
}

/* ================================================================
 * 业界主流静态分析算法（调研自在线样本分析平台标准流程）：
 *   A. SHA-256 哈希（crypto.subtle，可拿去 VirusTotal/微步查信誉）
 *   B. 魔数识别 + 扩展名伪装检测（双扩展名/伪装 pdf-jpg 图标投递）
 *   C. 导入表（IAT）敏感 API 分析（注入/下载/键盘截屏 API 组合）
 * ================================================================ */

/* A. SHA-256（浏览器 WebCrypto 原生支持） */
async function sha256Hex(buf){
  try {
    if (typeof crypto !== "undefined" && crypto.subtle){
      var d = await crypto.subtle.digest("SHA-256", buf);
      var u = new Uint8Array(d), s = "";
      for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? "0" : "") + u[i].toString(16);
      return s;
    }
  } catch(e){}
  return "";
}

/* B. 魔数识别：文件真实类型 vs 扩展名 */
var MAGIC = [
  {name:"PE 可执行文件", m:[0x4d,0x5a], ext:["exe","dll","scr","com","sys","ocx","cpl","drv","msi","fon"]},
  {name:"ZIP 压缩包", m:[0x50,0x4b,0x03,0x04], ext:["zip","jar","apk","docx","xlsx","pptx","odt"]},
  {name:"ZIP 压缩包(空/自解压)", m:[0x50,0x4b,0x05,0x06], ext:["zip","jar","apk"]},
  {name:"PDF 文档", m:[0x25,0x50,0x44,0x46], ext:["pdf"]},
  {name:"7z 压缩包", m:[0x37,0x7a,0xbc,0xaf,0x27,0x1c], ext:["7z"]},
  {name:"RAR 压缩包", m:[0x52,0x61,0x72,0x21], ext:["rar"]},
  {name:"GZIP 压缩", m:[0x1f,0x8b], ext:["gz","tgz"]},
  {name:"PNG 图片", m:[0x89,0x50,0x4e,0x47], ext:["png"]},
  {name:"JPEG 图片", m:[0xff,0xd8,0xff], ext:["jpg","jpeg"]},
  {name:"GIF 图片", m:[0x47,0x49,0x46,0x38], ext:["gif"]},
  {name:"BMP 图片", m:[0x42,0x4d], ext:["bmp"]},
  {name:"OLE/Office 文档", m:[0xd0,0xcf,0x11,0xe0], ext:["doc","xls","ppt","msg"]},
  {name:"RIFF 媒体(AVI/WAV)", m:[0x52,0x49,0x46,0x46], ext:["avi","wav"]},
  {name:"LNK 快捷方式", m:[0x4c,0x00,0x00,0x00,0x01,0x14,0x02,0x00], ext:["lnk"]},
  {name:"脚本 shebang", m:[0x23,0x21], ext:["sh","py","pl","rb"]},
  {name:"UTF-8 BOM 文本", m:[0xef,0xbb,0xbf], ext:[]}
];
var DISGUISE_EXTS = ["pdf","jpg","jpeg","png","gif","bmp","doc","docx","xls","xlsx","ppt","pptx","txt","rtf","wps"]; /* 伪装高频扩展 */
function detectMagic(buf){
  var u8 = new Uint8Array(buf);
  for (var i = 0; i < MAGIC.length; i++){
    var mk = MAGIC[i].m, ok = true;
    if (u8.length < mk.length) continue;
    for (var j = 0; j < mk.length; j++){ if (u8[j] !== mk[j]){ ok = false; break; } }
    if (ok) return MAGIC[i];
  }
  return null;
}
/* 扩展名 vs 真实类型一致性检测 */
function magicMismatch(fileName, magicHit){
  if (!magicHit || !magicHit.ext.length) return null;
  var ext = (fileName.split(".").pop() || "").toLowerCase();
  if (magicHit.ext.indexOf(ext) >= 0) return null;
  var peDisguise = (magicHit.name.indexOf("PE") === 0) && (DISGUISE_EXTS.indexOf(ext) >= 0);
  return {disguise:peDisguise, real:magicHit.name, ext:ext};
}

/* C. 导入表（IAT）敏感 API 分析 */
var IAT_SENSITIVE = {
  inject:  ["virtualallocex","writeprocessmemory","createremotethread","queueuserapc","ntqueueapcthread","setthreadcontext","getthreadcontext","ntunmapviewofsection","mapviewofsection","ntcreatethreadex"],
  download:["urldownloadtofile","urldownloadtocachefile","internetopen","internetreadfile","winhttpopen","httpopenrequest","wsasyncselect"],
  keylog:  ["getasynckeystate","setwindowshookex","getkeystate","getkeyboardstate","bitblt","getdc"],
  exec:    ["winexec","shellexecutea","shellexecutew","regsetvalueexa","regsetvalueexw","regcreatekeyexa","system","createprocessa","createprocessw"]
};
function detectIat(buf){
  var u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (u8.length < 0x40 || u8[0] !== 0x4d || u8[1] !== 0x5a) return null;
  var peOff = u8[0x3c] | (u8[0x3d] << 8) | (u8[0x3e] << 16) | (u8[0x3f] << 24);
  if (peOff + 24 > u8.length) return null;
  if (!(u8[peOff] === 0x50 && u8[peOff+1] === 0x45 && u8[peOff+2] === 0 && u8[peOff+3] === 0)) return null;
  var nsec = dv.getUint16(peOff + 6, true);
  var optSize = dv.getUint16(peOff + 20, true);
  var opt = peOff + 24;
  var magic = dv.getUint16(opt, true);
  var ddOff = opt + (magic === 0x10b ? 96 : 112);
  var impRva = dv.getUint32(ddOff, true);
  if (!impRva) return null;
  var secOff = opt + optSize;
  function rva2off(rva){
    for (var i = 0; i < nsec && i < 16; i++){
      var o = secOff + i * 40;
      var va = dv.getUint32(o + 12, true), vs = dv.getUint32(o + 8, true);
      var ro = dv.getUint32(o + 20, true), rs = dv.getUint32(o + 16, true);
      if (va <= rva && rva < va + Math.max(vs, rs)) return ro + (rva - va);
    }
    return -1;
  }
  function readCStr(off){
    if (off < 0 || off >= u8.length) return "";
    var s = "", end = Math.min(off + 128, u8.length);
    for (var i = off; i < end; i++){
      if (u8[i] === 0) break;
      s += String.fromCharCode(u8[i]);
    }
    return s;
  }
  var dlls = [], funcs = [];
  var descOff = rva2off(impRva);
  if (descOff < 0) return null;
  for (var k = 0; k < 64; k++){
    var d = descOff + k * 20;
    if (d + 20 > u8.length) break;
    var nameRva = dv.getUint32(d + 12, true);
    var oftRva = dv.getUint32(d, true);
    var ftRva = dv.getUint32(d + 16, true);
    if (!nameRva && !oftRva && !ftRva) break;
    var dn = readCStr(rva2off(nameRva));
    if (dn) dlls.push(dn);
    var thunkRva = oftRva || ftRva;
    var thOff = rva2off(thunkRva);
    if (thOff < 0) continue;
    for (var t = 0; t < 0x1000; t++){
      var thPos = thOff + t * 4;
      if (thPos + 4 > u8.length) break;
      var v = dv.getUint32(thPos, true);
      if (!v) break;
      if (v & 0x80000000) continue; /* 序号导入 */
      var fnOff = rva2off(v);
      if (fnOff < 0) continue;
      var fn = readCStr(fnOff + 2);
      if (fn) funcs.push(fn.toLowerCase());
    }
  }
  return {dlls:dlls, funcs:funcs};
}

/* PE 结构启发式：无导入表 / 满熵大节区 / 编译时间戳≈落地时间（对整节加密的样本有效） */
function detectPeAnomaly(buf, meta){
  var hits = [];
  try {
    var u8 = new Uint8Array(buf);
    if (u8.length < 0x40 || u8[0] !== 0x4d || u8[1] !== 0x5a) return hits; /* 非 MZ */
    var peOff = u8[0x3c] | (u8[0x3d] << 8) | (u8[0x3e] << 16) | (u8[0x3f] << 24);
    if (peOff + 24 > u8.length) return hits;
    if (!(u8[peOff] === 0x50 && u8[peOff+1] === 0x45 && u8[peOff+2] === 0 && u8[peOff+3] === 0)) return hits; /* 非 PE\0\0 */
    var dv = new DataView(buf);
    var nsec = dv.getUint16(peOff + 6, true);
    var ts = dv.getUint32(peOff + 8, true);
    var optSize = dv.getUint16(peOff + 20, true);
    var opt = peOff + 24;
    var magic = dv.getUint16(opt, true);
    var ddOff = opt + (magic === 0x10b ? 96 : 112);
    var impRva = dv.getUint32(ddOff, true);
    var impSize = dv.getUint32(ddOff + 4, true);
    var secOff = opt + optSize;
    var maxEnt = 0, bigEntSize = 0, maxEntName = "";
    for (var i = 0; i < nsec && i < 16; i++){
      var o = secOff + i * 40;
      var name = "";
      for (var k = 0; k < 8; k++){
        var ch = u8[o + k];
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      var roff = dv.getUint32(o + 20, true);
      var rsize = dv.getUint32(o + 16, true);
      var e = 0;
      if (rsize > 0 && roff + rsize <= u8.length){
        var freq = new Array(256); for (var c = 0; c < 256; c++) freq[c] = 0;
        for (var j = 0; j < rsize; j++) freq[u8[roff + j]]++;
        for (c = 0; c < 256; c++){ if (freq[c]){ var p = freq[c] / rsize; e -= p * Math.log2(p); } }
      }
      if (e > maxEnt){ maxEnt = e; maxEntName = name; bigEntSize = rsize; }
    }
    var where = "PE 结构: 导入表RVA=" + impRva + " 最大节区熵=" + maxEnt.toFixed(2);
    /* 无导入表 + 高熵 → 加载器/壳 */
    if (impRva === 0 && maxEnt > 7.3){
      hits.push({id:"PE-001", group:"PE 结构异常", sev:2, name:"无导入表 + 高熵载荷", desc:"PE 未导入任何 DLL 且节区高熵——正常程序必然导入 kernel32 等系统库，这是加壳/加密加载器的典型特征。", where:where});
    }
    /* 超过 1MB 的满熵节区 → 整节加密载荷 */
    if (maxEnt > 7.7 && bigEntSize > 1024 * 1024){
      hits.push({id:"PE-002", group:"PE 结构异常", sev:2, name:"整节加密载荷（熵 " + maxEnt.toFixed(2) + "）", desc:"节区 " + maxEntName + " 约 " + Math.round(bigEntSize/1048576) + "MB 且熵接近满值——内容整体加密/压缩，银狐多阶段加密载荷特征。", where:where});
    }
    /* 编译时间戳与落地时间接近 */
    if (meta && meta.mtime && ts > 0){
      var diff = Math.abs(ts * 1000 - meta.mtime);
      if (diff < 48 * 3600 * 1000){
        hits.push({id:"PE-003", group:"PE 结构异常", sev:1, name:"编译时间戳与落地时间几乎一致", desc:"编译时间与文件修改时间相差 <48h——新打包痕迹，正常软件编译时间通常远早于下载时间。", where:"PE 时间戳=" + ts});
      }
    }
    /* 大块低熵数据节 → 内嵌完整安装包/载荷（银狐伪装安装包特征） */
    for (var si = 0; si < nsec && si < 16; si++){
      var so = secOff + si * 40;
      var sname = "";
      for (var sk = 0; sk < 8; sk++){ var sch = u8[so + sk]; if (sch === 0) break; sname += String.fromCharCode(sch); }
      var sroff = dv.getUint32(so + 20, true), sr = dv.getUint32(so + 16, true);
      if (sr > 10 * 1024 * 1024 && sroff + sr <= u8.length){
        var fq = new Array(256); for (var fc = 0; fc < 256; fc++) fq[fc] = 0;
        for (var fj = 0; fj < sr; fj++) fq[u8[sroff + fj]]++;
        var se = 0;
        for (fc = 0; fc < 256; fc++){ if (fq[fc]){ var fp = fq[fc] / sr; se -= fp * Math.log2(fp); } }
        if (se < 5.5){
          /* 检测 NSIS/Inno 打包器标记，升级为高危（安装包内嵌大块未加密数据 = 含完整安装包/载荷） */
          var isNsis = false;
          try {
            var headStr = new TextDecoder("latin1").decode(u8.subarray(0, Math.min(u8.length, 3 * 1024 * 1024))).toLowerCase();
            /* NSIS 的 "Nullsoft Install System" 标记在文件尾部存档区 */
            var tailStart = Math.max(0, u8.length - 2 * 1024 * 1024);
            var tailStr = new TextDecoder("latin1").decode(u8.subarray(tailStart)).toLowerCase();
            if (headStr.indexOf("nullsoft") >= 0 || headStr.indexOf("inno setup") >= 0 ||
                tailStr.indexOf("nullsoft") >= 0 || tailStr.indexOf("nullsoftinst") >= 0 ||
                tailStr.indexOf("inno setup") >= 0) isNsis = true;
          } catch(e2){}
          var sev4 = isNsis ? 2 : 1;
          hits.push({id:"PE-004", group:"PE 结构异常", sev:sev4,
            name:(isNsis ? "安装包内嵌大块未加密数据（含完整安装包/载荷）" : "PE 内含大块低熵数据节（疑似内嵌载荷）"),
            desc:"节区 " + sname + " 约 " + Math.round(sr/1048576) + "MB 但熵仅 " + se.toFixed(2) + "——未加密/未压缩的嵌入数据。" + (isNsis ? "银狐伪装安装包会在其中放入完整官方安装包 + 恶意载荷（用户研判特征）。" : ""),
            where:"节区 ." + sname + " RawSize=" + sr});
          break;
        }
      }
    }
  } catch(e){}
  return hits;
}

/**
 * 检测 PE 是否携带 Authenticode 数字签名。
 *
 * 原理：PE 可选头末尾的 Data Directory 第 5 项（索引 4）是 CERTIFICATE_TABLE
 * （Security Directory），指向内嵌的 WIN_CERTIFICATE 签名块。
 * 只要该项 RVA 与 Size 均非 0，即说明文件被签过名。
 *
 * 用途（降误报的关键减分项）：
 *   正规软件（Chrome / VS Code / 微信 / 各类安装包）几乎都带有效签名；
 *   银狐投递的木马绝大多数没有签名，或使用盗用/自签证书。
 *   因此「带签名」应显著下调风险分——这是把「自家扩展文件被报毒」这类
 *   误报压下去最有效、也最客观的一条依据。
 *
 * 注：这里只判断「是否存在签名块」，不做证书链校验（浏览器环境无法访问
 * 系统信任库）。存在签名不等于签名有效，故只作减分，不作免罪。
 */
function hasPeSignature(buf){
  try {
    if (!buf || buf.byteLength < 0x400) return false;
    var dv = new DataView(buf);
    if (dv.getUint16(0, true) !== 0x5A4D) return false;          // "MZ"
    var peOff = dv.getUint32(0x3C, true);
    if (peOff + 24 > buf.byteLength) return false;
    if (dv.getUint32(peOff, true) !== 0x00004550) return false;  // "PE\0\0"
    var optOff = peOff + 24;
    if (optOff + 2 > buf.byteLength) return false;
    var magic = dv.getUint16(optOff, true);
    var ddOff;
    if (magic === 0x10B) ddOff = optOff + 96;                    // PE32
    else if (magic === 0x20B) ddOff = optOff + 112;              // PE32+
    else return false;
    var secOff = ddOff + 4 * 8;                                  // DataDirectory[4]
    if (secOff + 8 > buf.byteLength) return false;
    var secRva = dv.getUint32(secOff, true);
    var secSize = dv.getUint32(secOff + 4, true);
    return secRva > 0 && secSize > 0;
  } catch(e){
    return false;
  }
}

/* 单文件分析：fileBuf 为 ArrayBuffer 或 null（null 表示仅文件名扫描）；meta 可传 {mtime} */
async function analyzeFile(fileName, fileSize, fileBuf, meta){
  var hits = [];
  var lowerName = fileName.toLowerCase();

  /* 1. 文件名规则 */
  for (var i = 0; i < FILE_RULES.length; i++){
    var fr = FILE_RULES[i];
    if (fr.test(fileName)){
      hits.push({id:fr.id, group:fr.group, sev:fr.sev, name:fr.name, desc:fr.desc, where:"文件名: " + fileName});
    }
  }

  /* 2. 内容扫描 */
  var lowerText = null;
  var scannedBytes = 0;
  if (fileBuf){
    var buf = fileBuf;
    var total = buf.byteLength;
    /* 大文件只扫头部 30MB */
    if (total > 30 * 1024 * 1024){
      buf = buf.slice(0, 30 * 1024 * 1024);
      scannedBytes = total;
    }
    lowerText = extractStrings(buf);
    for (var j = 0; j < RULES.length; j++){
      var r = RULES[j];
      /* 扩展名作用域：仅对匹配扩展名的文件做内容匹配（收窄误报面，媒体/文档不扫品牌词） */
      if (r.extScope && r.extScope.length){
        var _extOk = false;
        for (var _ei = 0; _ei < r.extScope.length; _ei++){
          var _e = r.extScope[_ei];
          if (lowerName.length >= _e.length && lowerName.lastIndexOf(_e) === lowerName.length - _e.length){ _extOk = true; break; }
        }
        if (!_extOk) continue;
      }
      var hitPat = null;
      for (var p = 0; p < r.pats.length; p++){
        var pat = r.pats[p];
        var ok = false;
        if (pat.t === "s"){
          ok = lowerText.indexOf(pat.v.toLowerCase()) >= 0;
        } else {
          try { ok = new RegExp(pat.v, "i").test(lowerText); } catch(e){ ok = false; }
        }
        if (ok){ hitPat = pat; break; }
      }
      if (hitPat){
        hits.push({id:r.id, group:r.group, sev:r.sev, name:r.name, desc:r.desc, where:"内容命中: " + (typeof hitPat.v === "string" ? hitPat.v : hitPat.v)});
      }
    }

    /* 3. 魔数识别 + 扩展名伪装检测 */
    var magicHit = detectMagic(buf);
    var magicInfo = null;
    if (magicHit){
      var mm = magicMismatch(fileName, magicHit);
      magicInfo = {real:magicHit.name};
      if (mm && mm.disguise){
        hits.push({id:"MAGIC-001", group:"文件伪装检测", sev:2, name:"可执行文件伪装成 " + mm.ext.toUpperCase() + " 文档/图片", desc:"真实类型为 PE 可执行文件，扩展名却是 " + mm.ext + "——银狐投递的标志性手法（图标伪装 PDF/JPG + 虚假后缀）。", where:"魔数=" + mm.real + " 扩展名=." + mm.ext});
      } else if (mm){
        hits.push({id:"MAGIC-002", group:"文件伪装检测", sev:1, name:"真实类型与扩展名不一致", desc:"魔数识别为 " + mm.real + "，扩展名却是 ." + mm.ext + "——类型与后缀不符，建议核实来源。", where:"魔数=" + mm.real + " 扩展名=." + mm.ext});
      }
    }

    /* 4. PE 结构启发式（用完整文件，大节区边界不受切片影响） */
    var peHits = detectPeAnomaly(fileBuf, meta);
    for (var pi = 0; pi < peHits.length; pi++) hits.push(peHits[pi]);

    /* 5. 导入表（IAT）敏感 API 分析（同样用完整文件） */
    var iat = detectIat(fileBuf);
    var iatInfo = null;
    if (iat && iat.funcs.length){
      var cnt = {inject:0, download:0, keylog:0, exec:0};
      iat.funcs.forEach(function(f){
        ["inject","download","keylog","exec"].forEach(function(g){
          if (IAT_SENSITIVE[g].indexOf(f) >= 0) cnt[g]++;
        });
      });
      iatInfo = {dlls:iat.dlls.length, funcs:iat.funcs.length, cnt:cnt};
      var iatDesc = function(g){
        return "导入表统计——注入类 " + cnt.inject + " 个 / 下载类 " + cnt.download + " 个 / 键盘截屏类 " + cnt.keylog + " 个 / 执行持久化类 " + cnt.exec + " 个（共导入 " + iat.dlls.length + " 个 DLL、" + iat.funcs.length + " 个函数）";
      };
      if (cnt.inject >= 3){
        hits.push({id:"IAT-001", group:"导入表敏感 API", sev:2, name:"进程注入 API 组合（" + cnt.inject + " 个）", desc:"导入 VirtualAllocEx/WriteProcessMemory/CreateRemoteThread 等注入原语——远控木马加载器特征。", where:iatDesc("inject")});
      } else if (cnt.inject >= 2 || cnt.keylog >= 2){
        hits.push({id:"IAT-002", group:"导入表敏感 API", sev:2, name:"可疑 API 组合（注入/键盘截屏）", desc:"导入类包含进程注入或键盘记录/截屏相关 API——与远控木马行为吻合。", where:iatDesc()});
      } else if (cnt.download >= 2 || cnt.exec >= 3){
        hits.push({id:"IAT-003", group:"导入表敏感 API", sev:1, name:"下载/执行类 API 较集中", desc:"导入类包含多个下载或进程执行 API——结合其他特征判断。", where:iatDesc()});
      }
    }
  }

  /* 4. SHA-256 哈希 */
  var sha256 = "";
  if (fileBuf) sha256 = await sha256Hex(fileBuf);

  /* 5. 评分（2026-08-30 重构：加权评分取代「命中即报毒」）
   *
   * 旧逻辑：if (sev3 > 0 || sev2 > 0) risk = "danger";
   *   问题：只要命中【任意一条】中危规则就直接报毒。而中危规则里包含
   *   download / exec / 注入类 API 等在正规软件、安装包、脚本中极为常见的特征，
   *   导致扩展自身文件、正常程序被大量误报
   *   （用户反馈：上传插件文件夹 → 5 个报毒）。
   *
   * 新逻辑：加权累加 + 数字签名减分 + 分级阈值
   *   - sev3（银狐家族专属高置信特征，如 getinstall64 / gh0st / c3exporer.exe）
   *     保持强判定：无签名即判危；有签名时降级为 suspicious
   *     （签名可能是盗用的，不轻易放行）。
   *   - 单独的 sev2 只值 18 分 → 落在 suspicious 区间，不再直接报毒。
   *   - 携带 Authenticode 签名的 PE 一律 -30 分。
   */
  var sev3 = 0, sev2 = 0, sev1 = 0;
  hits.forEach(function(h){ if (h.sev === 3) sev3++; else if (h.sev === 2) sev2++; else sev1++; });

  var W = { 3:60, 2:18, 1:6 };
  var score = sev3 * W[3] + sev2 * W[2] + sev1 * W[1];
  var mitigations = [];

  var signed = fileBuf ? hasPeSignature(fileBuf) : false;
  if (signed){
    score -= 30;
    mitigations.push("PE 携带 Authenticode 数字签名（风险分 -30）");
  }
  if (score < 0) score = 0;

  var risk;
  if (sev3 > 0){
    risk = signed ? "suspicious" : "danger";
  } else if (score >= 60){
    risk = "danger";
  } else if (score >= 18){
    risk = "suspicious";
  } else {
    risk = "safe";
  }

  return {name:fileName, size:fileSize, scannedBytes:scannedBytes, risk:risk,
          sev3:sev3, sev2:sev2, sev1:sev1, hits:hits,
          score:score, signed:signed, mitigations:mitigations,
          sha256:sha256, magic:magicInfo, iat:iatInfo};
}

/* zip 容器分析：扫描内部文件名 + 可解压条目内容 */
async function analyzeZip(zipName, zipSize, buf){
  var entries = parseZip(buf);
  if (!entries || entries.length === 0) return null;
  var childResults = [];
  var scanned = 0;
  for (var i = 0; i < entries.length; i++){
    var en = entries[i];
    var innerBuf = null;
    var innerSize = en.usize;
    if (en.method === 0 || en.method === 8){
      innerBuf = await inflateEntry(buf, en);
      if (innerBuf) scanned++;
    }
    var r = await analyzeFile(en.name, innerSize, innerBuf);
    if (r.risk !== "safe") childResults.push(r);
  }
  return {zipName:zipName, zipSize:zipSize, entries:entries.length, scanned:scanned, children:childResults};
}

/* 汇总 zip 容器风险：任一子项 danger → 容器 danger；安装包+随机名 exe 组合 → 高危 */
function summarizeZip(zr){
  var hits = [];
  var sev3 = 0, sev2 = 0, sev1 = 0;
  zr.children.forEach(function(c){
    sev3 += c.sev3; sev2 += c.sev2; sev1 += c.sev1;
    c.hits.forEach(function(h){ hits.push({file:c.name, h:h}); });
  });
  /* 组合特征：压缩包内 完整安装包 + 随机大写字母数字 exe（银狐投递容器结构） */
  var names = zr.children.map(function(c){ return c.name.toLowerCase(); });
  var hasInstaller = names.some(function(n){
    return /^(setup|install|uninstall|update|autorun)[\w\- .]*\.(exe|msi)$/.test(n) ||
           /(wps|ding|wechat|baidu|qq|flash|driver|office)[\w\- .]*\.(exe|msi)$/.test(n);
  });
  var hasRand = names.some(function(n){
    var m = /^([a-z0-9]{5,10})\.(exe|scr|pif)$/.exec(n);
    if (!m) return false;
    return ["setupapi","comctl32","gdi32","kernel32","user32","advapi32","shell32","ntdll","ole32","oleaut32","ws2_32","wininet","crypt32","rpcrt4","version","winmm","msvcrt","shlwapi"].indexOf(m[1]) < 0;
  });
  if (hasInstaller && hasRand && names.length >= 2){
    var desc = "压缩包内同时存在完整安装包与随机大写字母+数字组合的 exe——银狐伪装安装包的特征结构（完整官方包 + 恶意载荷释放）。";
    hits.push({file:"(容器组合)", h:{id:"PH-006", group:"钓鱼伪装文件名", sev:2, name:"安装包 + 随机名可执行文件组合", desc:desc, where:"zip 内条目: " + names.join(", ")}});
    sev2++;
  }
  /* 容器风险（2026-08-30 重构）：尊重子文件的判定结果，不再「任一中危特征 → 整包报毒」。
   * 旧逻辑 (sev3>0 || sev2>0) → danger 会把「包内仅有一个可疑文件」放大成整包报毒，
   * 与单文件评分重构的精神不一致。
   * 新逻辑：
   *   任一子项 danger              → 容器 danger
   *   容器级银狐投递结构特征命中   → suspicious（值得提示，但不再直接报毒）
   *   任一子项 suspicious          → suspicious
   */
  var anyDanger = zr.children.some(function(c){ return c.risk === "danger"; });
  var anySusp = zr.children.some(function(c){ return c.risk === "suspicious"; });
  var comboHit = hits.some(function(x){ return x.h && x.h.id === "PH-006"; });
  var risk = anyDanger ? "danger" : ((comboHit || anySusp) ? "suspicious" : "safe");
  return {name:zr.zipName, size:zr.zipSize, risk:risk, sev3:sev3, sev2:sev2, sev1:sev1,
          hits:hits, zipInfo:{entries:zr.entries, scanned:zr.scanned}, children:zr.children};
}

window.SF_CORE = {
  RULES:RULES, FILE_RULES:FILE_RULES,
  extractStrings:extractStrings, parseZip:parseZip, inflateEntry:inflateEntry,
  detectPeAnomaly:detectPeAnomaly, sha256Hex:sha256Hex, detectMagic:detectMagic,
  magicMismatch:magicMismatch, detectIat:detectIat, MAGIC:MAGIC, IAT_SENSITIVE:IAT_SENSITIVE,
  analyzeFile:analyzeFile, analyzeZip:analyzeZip, summarizeZip:summarizeZip
};

/* ================================================================
 * UI 挂载：全部颜色使用扩展 CSS 变量（--sf-text/--sf-border/
 * --sf-surface-solid/--sf-accent/--sf-accent-2），自动跟随主题与深浅色
 * ================================================================ */
var SF_UI_CSS = [
  ".sfsc-wrap{display:flex;flex-direction:column;gap:14px}",
  ".sfsc-hint{font-size:calc(12px * var(--sf-scale,1));color:var(--sf-text);opacity:.85;background:var(--sf-accent-grad-soft);border:1px solid var(--sf-border);border-radius:10px;padding:10px 14px;line-height:1.6}",
  ".sfsc-hint b{color:var(--sf-accent)}",
  ".sfsc-drop{border:1.6px dashed var(--sf-border);border-radius:14px;background:var(--sf-surface-solid);padding:26px 20px;text-align:center;cursor:pointer;transition:border-color .3s,background .3s;position:relative}",
  ".sfsc-drop:hover,.sfsc-drop.drag{border-color:var(--sf-accent);background:var(--sf-accent-grad-soft)}",
  ".sfsc-dz-icon{width:46px;height:46px;margin:0 auto 10px;border-radius:14px;display:grid;place-items:center;font-size:22px;background:var(--sf-accent-grad-soft);border:1px solid var(--sf-border)}",
  ".sfsc-dz-title{font-size:calc(15px * var(--sf-scale,1));color:var(--sf-text);font-weight:650}",
  ".sfsc-dz-note{font-size:calc(11.5px * var(--sf-scale,1));color:var(--sf-text);opacity:.65;margin-top:9px;line-height:1.7}",
  ".sfsc-dirlink{display:inline-block;margin-top:8px;color:var(--sf-accent);cursor:pointer;border:1px dashed var(--sf-border);border-radius:999px;padding:3px 12px;font-size:calc(11.5px * var(--sf-scale,1));transition:all .25s}",
  ".sfsc-dirlink:hover{background:var(--sf-accent-grad-soft);border-color:var(--sf-accent)}",
  ".sfsc-stats{display:flex;gap:9px;flex-wrap:wrap}",
  ".sfsc-stat{flex:1;min-width:110px;background:var(--sf-surface-solid);border:1px solid var(--sf-border);border-radius:11px;padding:9px 12px;text-align:center}",
  ".sfsc-stat b{font-size:calc(19px * var(--sf-scale,1));display:block;color:var(--sf-text)}",
  ".sfsc-stat span{font-size:calc(11px * var(--sf-scale,1));color:var(--sf-text);opacity:.6}",
  ".sfsc-stat.danger b{color:#ff5c5c}.sfsc-stat.susp b{color:#ffa940}.sfsc-stat.safe b{color:#3ddc84}",
  ".sfsc-scanning{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px;color:var(--sf-text);font-size:calc(13px * var(--sf-scale,1))}",
  ".sfsc-spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--sf-border);border-top-color:var(--sf-accent);animation:sfscSpin .9s linear infinite}",
  "@keyframes sfscSpin{to{transform:rotate(360deg)}}",
  ".sfsc-scanning .cur{font-size:calc(11.5px * var(--sf-scale,1));opacity:.6;max-width:90%;word-break:break-all;text-align:center}",
  ".sfsc-results{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto}",
  ".sfsc-item{background:var(--sf-surface-solid);border:1px solid var(--sf-border);border-radius:11px;overflow:hidden;transition:border-color .25s}",
  ".sfsc-item.danger{border-color:rgba(255,92,92,.5)}.sfsc-item.suspicious{border-color:rgba(255,169,64,.45)}",
  ".sfsc-item-head{display:flex;align-items:center;gap:10px;padding:9px 13px;cursor:pointer}",
  ".sfsc-item-ico{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:15px;flex:0 0 30px;background:var(--sf-accent-grad-soft)}",
  ".sfsc-item.danger .sfsc-item-ico{background:rgba(255,92,92,.15)}.sfsc-item.suspicious .sfsc-item-ico{background:rgba(255,169,64,.15)}.sfsc-item.safe .sfsc-item-ico{background:rgba(61,220,132,.13)}",
  ".sfsc-item-name{font-size:calc(12.5px * var(--sf-scale,1));color:var(--sf-text);font-weight:600;flex:1;min-width:0;word-break:break-all;line-height:1.35}",
  ".sfsc-item-meta{font-size:calc(10.5px * var(--sf-scale,1));opacity:.55;margin-top:2px;color:var(--sf-text)}",
  ".sfsc-badge{font-size:calc(11px * var(--sf-scale,1));font-weight:700;padding:3px 10px;border-radius:999px;flex:0 0 auto}",
  ".sfsc-badge.danger{background:rgba(255,92,92,.15);color:#ff5c5c;border:1px solid rgba(255,92,92,.4)}",
  ".sfsc-badge.suspicious{background:rgba(255,169,64,.15);color:#ffa940;border:1px solid rgba(255,169,64,.4)}",
  ".sfsc-badge.safe{background:rgba(61,220,132,.13);color:#3ddc84;border:1px solid rgba(61,220,132,.35)}",
  ".sfsc-detail{display:none;padding:2px 13px 12px}",
  ".sfsc-item.open .sfsc-detail{display:block}",
  ".sfsc-dt{font-size:calc(10.5px * var(--sf-scale,1));opacity:.55;color:var(--sf-text);margin:6px 0 6px;letter-spacing:.3px}",
  ".sfsc-hit{display:flex;gap:8px;align-items:flex-start;background:var(--sf-surface-solid);border:1px solid var(--sf-border);border-radius:8px;padding:6px 10px;margin-bottom:5px}",
  ".sfsc-hit .hsev{font-size:calc(10px * var(--sf-scale,1));font-weight:700;padding:2px 7px;border-radius:999px;flex:0 0 auto;margin-top:1px}",
  ".sfsc-hit .hsev.s3{background:rgba(255,92,92,.15);color:#ff5c5c;border:1px solid rgba(255,92,92,.4)}",
  ".sfsc-hit .hsev.s2{background:rgba(255,169,64,.15);color:#ffa940;border:1px solid rgba(255,169,64,.4)}",
  ".sfsc-hit .hsev.s1{background:rgba(255,211,77,.12);color:#ffd34d;border:1px solid rgba(255,211,77,.35)}",
  ".sfsc-hit .hname{font-size:calc(12px * var(--sf-scale,1));color:var(--sf-text);font-weight:650;line-height:1.35}",
  ".sfsc-hit .hdesc{font-size:calc(11px * var(--sf-scale,1));color:var(--sf-text);opacity:.7;margin-top:2px;line-height:1.5}",
  ".sfsc-hit .hwhere{font-size:calc(10px * var(--sf-scale,1));opacity:.5;color:var(--sf-text);margin-top:3px;word-break:break-all;font-family:Consolas,monospace}",
  ".sfsc-warn{font-size:calc(11.5px * var(--sf-scale,1));color:#ff5c5c;background:rgba(255,92,92,.1);border:1px dashed rgba(255,92,92,.4);border-radius:9px;padding:7px 11px;margin-top:7px;line-height:1.5}",
  ".sfsc-rules{background:var(--sf-surface-solid);border:1px solid var(--sf-border);border-radius:11px;overflow:hidden}",
  ".sfsc-rules summary{cursor:pointer;padding:10px 14px;font-size:calc(12px * var(--sf-scale,1));color:var(--sf-text);font-weight:650;list-style:none;display:flex;align-items:center;gap:8px}",
  ".sfsc-rules summary::-webkit-details-marker{display:none}",
  ".sfsc-rules summary::before{content:'▸';color:var(--sf-accent);transition:transform .25s}",
  ".sfsc-rules[open] summary::before{transform:rotate(90deg)}",
  ".sfsc-rules-body{padding:4px 14px 12px;max-height:300px;overflow-y:auto;border-top:1px solid var(--sf-border)}",
  ".sfsc-rg{margin-bottom:10px}.sfsc-rg-name{font-size:calc(11px * var(--sf-scale,1));font-weight:700;color:var(--sf-accent);margin-bottom:4px}",
  ".sfsc-rg-item{font-size:calc(11px * var(--sf-scale,1));color:var(--sf-text);opacity:.75;padding:1px 0;line-height:1.5}",
  ".sfsc-rg-item .rid{color:var(--sf-accent);opacity:.8;font-family:Consolas,monospace;margin-right:6px}",
  /* 云端 AI 辅助分析 结果行 */
  ".sfsc-ai-result{margin-top:9px;padding-top:9px;border-top:1px dashed var(--sf-border)}",
  ".sfsc-ai-line{display:flex;gap:9px;align-items:flex-start}",
  ".sfsc-ai-badge{font-size:calc(11px * var(--sf-scale,1));font-weight:700;padding:3px 10px;border-radius:999px;flex:0 0 auto;margin-top:1px}",
  ".sfsc-ai-badge.danger{background:rgba(255,92,92,.15);color:#ff5c5c;border:1px solid rgba(255,92,92,.4)}",
  ".sfsc-ai-badge.suspicious{background:rgba(255,169,64,.15);color:#ffa940;border:1px solid rgba(255,169,64,.4)}",
  ".sfsc-ai-badge.safe{background:rgba(61,220,132,.13);color:#3ddc84;border:1px solid rgba(61,220,132,.4)}",
  ".sfsc-ai-sum{font-size:calc(11.5px * var(--sf-scale,1));color:var(--sf-text);opacity:.78;line-height:1.55;word-break:break-word}",
  /* 云端 AI 分析失败一次性提示（明确区分本地/云端，建议关 Max） */
  ".sfsc-ai-fail{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;display:none;max-width:min(560px,92vw);" +
    "background:rgba(20,16,22,.9);border:1px solid rgba(255,140,140,.4);color:#ffd9d9;padding:11px 18px;border-radius:12px;" +
    "font-size:calc(12.5px * var(--sf-scale,1));font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;" +
    "box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);line-height:1.5;text-align:center;pointer-events:none;animation:sf-toast-in .25s ease both}"
].join("\n");

function mountScanner(container){
  var root = document.createElement("div");
  root.className = "sfsc-wrap";
  root.innerHTML =
    '<div class="sfsc-hint">🛡 上传可疑的 <b>程序 / 安装包 / 脚本 / 压缩包</b> 做静态检测。纯本地分析、文件不上传、<b>绝不运行样本</b>。<br>⚠ 扫描基于特征匹配，<b>并非 100% 准确</b>，结果仅供参考，请谨慎对待。</div>' +
    '<div class="sfsc-drop" id="sfscDrop">' +
      '<div class="sfsc-dz-icon">🛡</div>' +
      '<div class="sfsc-dz-title">拖拽文件 / 文件夹到这里，或点击选择</div>' +
      '<div class="sfsc-dz-note">支持 <b>exe / dll / scr / msi / zip / bat / cmd / ps1 / vbs / js / jse / hta / lnk</b> 等 · 单文件建议 ≤ 200MB<br><span class="sfsc-dirlink" id="sfscDirLink">📁 需要从文件夹里选？点击选择文件夹</span></div>' +
    '</div>' +
    '<div class="sfsc-stats" id="sfscStats" style="display:none">' +
      '<div class="sfsc-stat"><b id="sfscN1">0</b><span>扫描文件</span></div>' +
      '<div class="sfsc-stat danger"><b id="sfscN2">0</b><span>报毒</span></div>' +
      '<div class="sfsc-stat susp"><b id="sfscN3">0</b><span>可疑</span></div>' +
      '<div class="sfsc-stat safe"><b id="sfscN4">0</b><span>安全</span></div>' +
    '</div>' +
    '<div class="sfsc-scanning" id="sfscScanning" style="display:none">' +
      '<div class="sfsc-spin"></div><div>正在静态扫描…</div><div class="cur" id="sfscCur">—</div>' +
    '</div>' +
    '<div class="sfsc-results" id="sfscResults"></div>' +
    '<details class="sfsc-rules"><summary>📖 检测特征库（' + RULES.length + ' 条内容规则 + ' + FILE_RULES.length + ' 条文件名规则 + PE/魔数/IAT 启发式）</summary>' +
      '<div class="sfsc-rules-body" id="sfscRulesBody"></div>' +
    '</details>';
  container.appendChild(root);

  var style = document.createElement("style");
  style.textContent = SF_UI_CSS;
  container.appendChild(style);

  var dz = root.querySelector("#sfscDrop");
  var dirLink = root.querySelector("#sfscDirLink");
  var stats = root.querySelector("#sfscStats");
  var scanning = root.querySelector("#sfscScanning");
  var cur = root.querySelector("#sfscCur");
  var results = root.querySelector("#sfscResults");

  /* 规则面板 */
  var groups = {};
  RULES.concat(FILE_RULES).forEach(function(r){
    (groups[r.group] = groups[r.group] || []).push(r);
  });
  var rhtml = "";
  Object.keys(groups).forEach(function(g){
    rhtml += '<div class="sfsc-rg"><div class="sfsc-rg-name">' + g + '</div>';
    groups[g].forEach(function(r){
      rhtml += '<div class="sfsc-rg-item"><span class="rid">' + r.id + '</span>' + r.name + '</div>';
    });
    rhtml += '</div>';
  });
  root.querySelector("#sfscRulesBody").innerHTML = rhtml;

  function pickFiles(opts){
    return new Promise(function(resolve){
      var inp = document.createElement("input");
      inp.type = "file";
      inp.style.position = "fixed"; inp.style.top = "-9999px"; inp.style.left = "-9999px"; inp.style.opacity = "0";
      inp.multiple = true;
      if (opts && opts.directory){ inp.setAttribute("webkitdirectory", ""); inp.setAttribute("directory", ""); }
      inp.addEventListener("change", function(){ var f = inp.files; inp.remove(); resolve(f && f.length ? f : null); });
      inp.addEventListener("cancel", function(){ inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  var SEV_LABEL = {3:["致命","s3"], 2:["高危","s2"], 1:["中危","s1"]};
  var RISK = {danger:["☠ 报毒","danger"], suspicious:["⚠ 可疑","suspicious"], safe:["✓ 安全","safe"]};
  var animDelay = 0;

  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function renderCard(card){
    var rl = RISK[card.risk];
    var item = document.createElement("div");
    item.className = "sfsc-item " + rl[1];
    var sizeTxt = card.size >= 1048576 ? (card.size/1048576).toFixed(2)+" MB" : (card.size/1024).toFixed(1)+" KB";
    var zipNote = card.zipInfo ? " · zip 内 " + card.zipInfo.entries + " 条目（解压扫描 " + card.zipInfo.scanned + "）" : "";
    var sevTxt = (card.sev3?("致命×"+card.sev3+" "):"") + (card.sev2?("高危×"+card.sev2+" "):"") + (card.sev1?("中危×"+card.sev1):"");
    var extras = [];
    if (card.magic) extras.push("真实类型: " + card.magic.real);
    if (card.iat) extras.push("导入 " + card.iat.dlls + " DLL");
    if (extras.length) sizeTxt += " · " + extras.join(" · ");
    var hitsHtml = "";
    (card.hits || []).forEach(function(hh){
      var h = hh.h || hh;
      var sev = SEV_LABEL[h.sev] || ["中危","s1"];
      var where = hh.file ? ("[" + hh.file + "] " + (h.where||"")) : (h.where||"");
      hitsHtml += '<div class="sfsc-hit"><span class="hsev ' + sev[1] + '">' + sev[0] + '</span>' +
        '<div><div class="hname">' + esc(h.name) + '</div>' +
        (h.desc ? '<div class="hdesc">' + esc(h.desc) + '</div>' : '') +
        (where ? '<div class="hwhere">' + esc(where) + '</div>' : '') + '</div></div>';
    });
    var hashRow = card.sha256 ? '<div class="sfsc-hit"><div style="flex:1"><div class="hname">SHA-256 指纹</div><div class="hwhere">' + card.sha256 + '</div></div></div>' : '';
    var warn = card.risk === "danger" ? '<div class="sfsc-warn">⚠ 命中强特征（或多弱信号汇聚），判定为银狐木马 / 恶意程序风险。请勿在任何环境运行，建议隔离并由安全厂商或应急响应团队复核。</div>' : '';
    item.innerHTML =
      '<div class="sfsc-item-head"><div class="sfsc-item-ico">' + (card.risk==="danger"?"☠":card.risk==="suspicious"?"⚠":"✓") + '</div>' +
      '<div class="sfsc-item-name">' + esc(card.name) + '<div class="sfsc-item-meta">' + sizeTxt + zipNote + (sevTxt?(" · "+sevTxt):"") + '</div></div>' +
      '<span class="sfsc-badge ' + rl[1] + '">' + rl[0] + '</span></div>' +
      '<div class="sfsc-detail"><div class="sfsc-dt">命中特征（' + (card.hits?card.hits.length:0) + ' 项）</div>' + hitsHtml + (hashRow?'<div class="sfsc-dt">文件指纹</div>'+hashRow:'') + warn + '</div>';
    item.querySelector(".sfsc-item-head").addEventListener("click", function(){ item.classList.toggle("open"); });
    item.style.animation = "none";
    results.appendChild(item);
    animDelay++;
  }

  // ===== 银狐扫描文件 AI 辅助分析（独立子开关，仅发本地提取的可疑特征摘要）=====
  var AI_FILE_FAIL_KEY = 'sf_ai_file_fail_shown';
  var AI_FILE_FAIL_TTL = 10 * 60 * 1000; // 10 分钟内整段限流期只提示一次
  function maybeShowAiFileFailOnce(detail){
    var ts = 0;
    try { ts = parseInt(sessionStorage.getItem(AI_FILE_FAIL_KEY) || '0', 10) || 0; } catch (e) {}
    var now = Date.now();
    if (now - ts < AI_FILE_FAIL_TTL) return;
    try { sessionStorage.setItem(AI_FILE_FAIL_KEY, String(now)); } catch (e) {}
    showAiFileFailToast(detail);
  }
  function showAiFileFailToast(detail){
    var t = root.querySelector('#sfscAiFail');
    if (!t){
      t = document.createElement('div');
      t.id = 'sfscAiFail';
      t.className = 'sfsc-ai-fail';
      root.appendChild(t);
    }
    t.textContent = '本地扫描正常 · 云端 AI 分析失败（' + (detail || '额度或密钥问题') + '）· 建议关闭 Max 模式';
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ if (t) t.style.display = 'none'; }, 5000);
  }
  // 构造「可疑特征摘要」（不发整文件，仅元数据 + 命中特征）
  function buildFileSummary(card){
    var L = [];
    L.push('文件名: ' + card.name);
    L.push('大小: ' + (card.size >= 1048576 ? (card.size/1048576).toFixed(2)+' MB' : (card.size/1024).toFixed(1)+' KB'));
    if (card.magic) L.push('真实类型(魔数): ' + card.magic.real);
    if (card.iat) L.push('导入表: ' + card.iat.dlls + ' 个 DLL / ' + card.iat.funcs + ' 个函数（注入类 ' + card.iat.cnt.inject + ' / 下载类 ' + card.iat.cnt.download + ' / 键盘截屏类 ' + card.iat.cnt.keylog + ' / 执行持久化类 ' + card.iat.cnt.exec + '）');
    if (card.sha256) L.push('SHA-256: ' + card.sha256);
    L.push('本地风险等级: ' + (card.risk === 'danger' ? '报毒(命中强特征)' : '可疑(命中弱特征)'));
    L.push('命中特征(' + (card.hits ? card.hits.length : 0) + ' 项):');
    (card.hits || []).forEach(function(hh){
      var h = hh.h || hh;
      var where = hh.file ? ('[' + hh.file + '] ' + (h.where || '')) : (h.where || '');
      L.push('  - [' + (h.id || '?') + '] ' + h.name + (where ? (' @ ' + where) : ''));
    });
    return L.join('\n');
  }
  function aiFileEnabled(){
    // 优先读实时缓存，回退到 chrome.storage.sync
    if (window.__sfSettings && typeof window.__sfSettings.aiScanFileAnalyse === 'boolean')
      return window.__sfSettings.aiMaxMode === true && window.__sfSettings.aiScanFileAnalyse === true;
    return false;
  }
  function maybeAiAnalyzeFile(card, itemEl){
    if (!itemEl) return;
    // 子开关依赖 Max：aiMaxMode + aiScanFileAnalyse 同时开
    var go = aiFileEnabled();
    if (!go){
      // 缓存未就绪时尝试读 storage（首扫兜底）
      try {
        chrome.storage.sync.get({ aiMaxMode:false, aiScanFileAnalyse:false }, function(s){
          if (s.aiMaxMode === true && s.aiScanFileAnalyse === true) doAiFileAnalyze(card, itemEl);
        });
      } catch (e) {}
      return;
    }
    doAiFileAnalyze(card, itemEl);
  }
  function doAiFileAnalyze(card, itemEl){
    var summary = buildFileSummary(card);
    try {
      chrome.runtime.sendMessage({ type:'sf-ai-analyze-file', name: card.name, summary: summary }, function(r){
        if (chrome.runtime.lastError) return; // 静默（如后台未唤醒）
        if (!r || !r.ok){
          // 仅「需用户干预」类错误提示一次：明确区分本地正常 / 云端失败，建议关 Max
          if (r && r.needAction) maybeShowAiFileFailOnce(r.err);
          return; // 其余失败静默，不影响本地判定
        }
        appendAiFileResult(itemEl, r);
      });
    } catch (e) { /* 静默 */ }
  }
  function appendAiFileResult(itemEl, r){
    var detail = itemEl.querySelector('.sfsc-detail');
    if (!detail) return;
    if (detail.querySelector('.sfsc-ai-result')) return; // 防重复
    var levelTxt = {安全:'安全', 低:'低', 中:'中', 高:'高'}[r.level] || r.level || '低';
    var box = document.createElement('div');
    box.className = 'sfsc-ai-result';
    box.innerHTML = '<div class="sfsc-dt">云端 AI 辅助分析</div>' +
      '<div class="sfsc-ai-line"><span class="sfsc-ai-badge ' + levelCls(r.level) + '">' + esc(levelTxt) + '</span>' +
      '<div class="sfsc-ai-sum">' + esc((r.summary || '').slice(0, 240)) + '</div></div>';
    detail.appendChild(box);
  }
  function levelCls(lv){
    if (lv === '高' || lv === 'danger') return 'danger';
    if (lv === '中') return 'suspicious';
    return 'safe';
  }

  async function runScan(files){
    var list = Array.prototype.slice.call(files);
    results.innerHTML = "";
    stats.style.display = "flex";
    scanning.style.display = "flex";
    animDelay = 0;
    var nDanger=0, nSusp=0, nSafe=0, nTotal=0;
    var n1=root.querySelector("#sfscN1"), n2=root.querySelector("#sfscN2"), n3=root.querySelector("#sfscN3"), n4=root.querySelector("#sfscN4");
    for (var i=0;i<list.length;i++){
      var f = list[i];
      var name = (f.webkitRelativePath && f.webkitRelativePath !== "") ? f.webkitRelativePath : f.name;
      nTotal++; n1.textContent = nTotal;
      cur.textContent = name;
      var buf = null;
      try { if (f.size <= 200*1048576) buf = await f.arrayBuffer(); } catch(e){ buf = null; }
      var isZip = /\.zip$/i.test(name) && buf && buf.byteLength > 4 &&
        (new Uint8Array(buf,0,4))[0]===0x50 && (new Uint8Array(buf,0,4))[1]===0x4b;
      var card = null;
      if (isZip){
        var zr = await analyzeZip(name, f.size, buf);
        if (zr) card = summarizeZip(zr);
      }
      if (!card) card = await analyzeFile(name, f.size, buf, {mtime: f.lastModified || 0});
      if (card.risk === "danger") nDanger++; else if (card.risk === "suspicious") nSusp++; else nSafe++;
      n2.textContent = nDanger; n3.textContent = nSusp; n4.textContent = nSafe;
      renderCard(card);
      // AI 辅助分析（仅 suspicious/danger 且开启子开关）：在卡片渲染后异步补强，不阻塞本地判定
      if (card.risk === "suspicious" || card.risk === "danger") {
        var itemEl = results.lastElementChild;
        maybeAiAnalyzeFile(card, itemEl);
      }
      await new Promise(function(r){ setTimeout(r, 10); });
    }
    scanning.style.display = "none";
  }

  ["dragenter","dragover"].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.add("drag"); }); });
  ["dragleave","drop"].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.remove("drag"); }); });
  dz.addEventListener("drop", function(e){ var f = e.dataTransfer.files; if (f && f.length) runScan(f); });
  dz.addEventListener("click", function(){ pickFiles().then(function(f){ if (f) runScan(f); }); });
  dirLink.addEventListener("click", function(e){ e.stopPropagation(); pickFiles({directory:true}).then(function(f){ if (f) runScan(f); }); });
}

window.SFScanner = {
  mounted: false,
  mount: function(container){
    if (!container || this.mounted) return;
    this.mounted = true;
    mountScanner(container);
  }
};

})();
