/* ai.js — 银狐防护 AI 助手（悬浮球，不归入侧边栏分类）
 * 定位：扩展「使用助手」，解答用户关于本扩展的设置/主题/字号/检测开关等问题。
 * 不分析当前网页内容（不读取页面 DOM / 不上传页面文本），仅在设置页内对话。
 *
 * 模型路由（由近及远）：
 *   1) 关键词规则引擎（0 延迟兜底，命中即回，离线可用，零体积）
 *   2) 云端 GLM-4.7-Flash（仅当「允许云端增强」开启时兜底；默认关闭，避免免费模型额度耗尽）
 *
 * 说明：浏览器扩展（MV3）内无法直接本地运行 0.5B 大模型——Transformers.js 的
 * 运行库是 ESM（依赖 import.meta），普通 <script> 加载会报 SyntaxError，而扩展页
 * CSP 又禁止远程 module import。故本地"智能"层以关键词规则引擎实现，云端作为补充。
 */
'use strict';

(function () {
  const GLM_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const GLM_DEFAULT_KEY = '86924bafc9aa40f2bf1de9d0fad24546.eWHPPTOQpLioa3qj';
  const GLM_MODEL = 'glm-4.7-flash';

  /* 模型提供商表 —— 切换 provider 即切换 endpoint / 默认模型 / 是否需要密钥
   * zhipu 走内置免费 Key；其余需用户填自己的 Key。custom 为 OpenAI 兼容，需填基址。
   * 默认值：provider='zhipu'、model='glm-4.7-flash'（即内置免费模型，重置即回到这里）。 */
  const PROVIDERS = {
    zhipu:    { label: '智谱 GLM（默认免费）', endpoint: GLM_ENDPOINT, defaultModel: 'glm-4.7-flash', builtinKey: GLM_DEFAULT_KEY, showBaseUrl: false },
    deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-chat', showBaseUrl: false },
    openai:   { label: 'OpenAI 兼容', endpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini', showBaseUrl: false },
    moonshot: { label: 'Kimi / Moonshot', endpoint: 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k', showBaseUrl: false },
    custom:   { label: '自定义（OpenAI 兼容）', endpoint: '', defaultModel: '', showBaseUrl: true }
  };
  const DEFAULT_PROVIDER = 'zhipu';
  const DEFAULT_MODEL = 'glm-4.7-flash';

  // 把 provider + model 解析为真正请求用的 endpoint / key / model
  function resolveModelCfg(provider, model) {
    const p = PROVIDERS[provider] || PROVIDERS.custom;
    let endpoint = p.endpoint || '';
    if (provider === 'custom') {
      const base = (cfg.baseUrls && cfg.baseUrls.custom || '').replace(/\/+$/, '');
      endpoint = base ? base + '/chat/completions' : '';
    }
    const key = (cfg.keys && cfg.keys[provider] && cfg.keys[provider].trim()) || p.builtinKey || '';
    return { endpoint: endpoint, key: key, model: model || p.defaultModel || cfg.model, provider: provider, label: p.label };
  }

  // 判定用户这句话属于哪种场景，用于「场景→模型」路由规则
  function classifyScenario(text) {
    const t = (text || '').toLowerCase();
    if (/(你好|您好|hi|hello|在吗|你是谁|谢谢|感谢|哈喽|早安|晚安|辛苦了)/.test(t)) return 'casual';
    if (/(主题|配色|外观|材质|琉声|字体|字号|背景|防护|拦截|警告|横幅|开关|启用|设置|密钥|备案|灵敏度|同步|白名单|急救|扫描|版本|更新)/.test(text)) return 'settings';
    // 合并自学规则：如果用户常用的某种说法曾被归纳为某场景，后续同类 wording 直接走该场景
    for (const rule of getLearnedRules()) {
      const kws = rule.keywords || [];
      for (const kw of kws) {
        if (t.indexOf(kw.toLowerCase()) !== -1) return rule.scenario || 'fallback';
      }
    }
    return 'fallback';
  }

  const SCENARIO_LABELS = { fallback: '兜底对话（本地未命中）', settings: '设置 / 操作解答', casual: '闲聊问候' };

  // 性格档 → 语气/风格约束（OOBE 可选，默认均衡）
  const PERSONA_RULES = {
    balanced: '你的性格是「均衡」：全面稳妥，信息准确、表达亲切，是该扩展默认之选。',
    efficient: '你的性格是「高效」：简洁直接、直奔主题，少客套少废话；能用一句话说清就绝不用两句，优先给结论与执行结果。',
    gentle: '你的性格是「温柔」：耐心细致、语气温和，解释充分、步步引导，像朋友一样照顾对方的理解节奏，不居高临下。',
    pro: '你的性格是「严谨」：专业克制、重依据，用词得体，涉及设置项时说明作用与边界，不夸大、不模糊。',
    humorous: '你的性格是「幽默」：轻松俏皮、适度玩梗，但绝不拿安全风险开玩笑；专业度不打折扣，只是语气更讨喜。'
  };
  function buildSystem(version) {
    const persona = (cfg && PERSONA_RULES[cfg.aiPersona]) ? PERSONA_RULES[cfg.aiPersona] : PERSONA_RULES.balanced;
    const quietMode = (cfg && cfg.remindMode === 'quiet');
    const remindRule = quietMode
      ? '当前用户偏好「安静提醒」：除直接回答问题外，不要主动展开额外建议、不要顺带推销扩展功能、不要发送非请求的操作提示；只给被问到的那部分内容，点到为止。'
      : '在不打扰的前提下，可适度主动给出一条最相关的实用建议（如顺手提示一个相关设置入口），但不要堆砌。';
    return [
      '你是「银狐防护 · SilverFox Guard」浏览器扩展的内置使用助手，名为「银狐小助」。',
      persona,
      remindRule,
      '你的职责仅限帮助用户理解和使用本扩展的功能与设置，包括：',
      '1）解释各个设置项（全局防护开关、网页内警告横幅、自动拦截可疑下载、备案核验、灵敏度、个性化里的字体/主题/深浅色/字号/材质/自定义背景/减弱动画、AI 助手本身等）的作用与开启方式；',
      '2）说明扩展的检测逻辑大类（域名仿冒、备案缺失、低质量站点、可执行文件直链、网盘分发、混淆 JS、虚拟机检测、社工话术、仿冒官网、跳转 iframe、域名结构异常），但只做原理科普，不替用户判定某个具体网站是否危险；',
      '3）指导用户如何举报误报、使用白名单、使用「银狐急救」下载 360 系统急救箱、查看更新日志。',
      '重要边界（必须严格遵守）：',
      '- 你不会、也不能分析用户当前打开的网页内容、不读取页面文本、不基于网页做安全结论；如果用户粘贴某个网址让你判断是否钓鱼，你只能说明「可交由扩展实时检测，或前往官方渠道核实」，不得自行下结论。',
      '- 你不是安全专家，不提供超出本扩展范围的杀毒/投资/隐私建议；遇到此类问题，建议用户使用专业杀毒软件或官方渠道。',
      '- 回答用简体中文，简洁、口语化、分点清晰；不要使用英文长句或机翻腔。',
      '- 当前扩展版本为 ' + (version || '未知') + '。',
      '- 不要编造扩展没有的功能。',
      '- 调用工具后，用你自己的话自然回复用户（一句即可，自然地告知已办好或补充说明皆可），但不要复述任何工具名称或调用过程（如「调用 open_subpage」「set_xxx」等），也不要在回复里出现方括号包裹的工具指令；严禁输出「已为你打开」「已执行」之类的机械确认模板句——必须是你自然组织的中文口语。',
      '- 严禁敷衍式回复：执行完工具后绝不允许只回「好的」「好的，已为您完成」「已操作」这类空话；必须说一句有信息量、像人话的内容（例如说明改了什么、顺带一句实用提醒、或接一句相关引导），但同样不要复述工具名。',
      '- 当用户想修改设置（开/关防护、警告、拦截、通知、备案核验、主题、字体、字号、材质、灵敏度、云端/Max/本地引擎开关、TTS 语音、清空白名单/关键词/危险域名、逐项开/关检测维度、打开设置子页面等）时，调用对话中随附「固定工具清单」里的对应固定工具直接完成，而不是只告诉用户步骤；可一次调用多个工具满足复合意图（如「帮我安静点」同时关警告与通知）。',
      '- 重要区分（务必遵守）：仅当用户【命令式】要求你直接改某项设置（如「换成深色」「字号大一点」「关闭警告横幅」「开启防护」「帮我安静点」「打开 AI 设置页」）时才调用对应的固定工具；若用户是【疑问式】问怎么改、某设置干什么、原理是什么（如「怎么换主题」「字号在哪调」「检测原理是什么」），或只是闲聊/打招呼/感谢，一律直接文本回复，绝不调用任何工具。'
    ].join('\n');
  }

  /* 本地关键词规则引擎（0 延迟兜底） */
  const LOCAL_RULES = [
    {
      keywords: ['你好', '您好', 'hi', 'hello', '在吗', '你是谁', '介绍', '功能'],
      answer: '你好，我是银狐小助。我可以帮你了解银狐防护的设置、主题、字号、检测开关等用法。\n\n我还能直接帮你改设置，比如说：\n• 「换成深色 / 浅色」\n• 「字号大一点 / 小一点 / 恢复默认」\n• 「暖金主题 / 赛博霓虹 / 暗夜深空」\n• 「用得意黑字体」「切琉声材质」\n• 「开启防护 / 关闭警告横幅 / 开启下载拦截」\n\n直接下指令就行，我马上帮你改好～'
    },
    {
      keywords: ['主题', '配色', '外观', '深色', '浅色', '暗黑', '护眼'],
      answer: '换主题：设置页「个性化」→「外观主题」里选经典 / 暖金国风 / 赛博霓虹 / 极简雾灰 / 暗夜深空，每套都含深、浅两种变体。\n\n深浅色切换在「个性化」→「深浅色模式」：深色护眼、浅色明亮（仅设置页与弹窗生效，欢迎页和网页警告横幅保持深色以醒目）。'
    },
    {
      keywords: ['材质', '琉声', '液态玻璃', '磨砂', '玻璃'],
      answer: '材质在「个性化」→「界面材质」：\n• 磨砂玻璃（默认）：静态模糊 + 半透明，稳重清晰；\n• 琉声（液态玻璃）：更强折射感与多层高光，更有质感。\n注意：Pixel 主题下材质强制不切换，始终走磨砂玻璃。'
    },
    {
      keywords: ['自定义背景', '背景图', '上传背景', '换背景'],
      answer: '设置页「个性化」→「自定义背景」：点「上传图片」，选一张本地图片即可作为设置页与弹窗背景（自动压缩以保证流畅）。不想要了点「清除」恢复默认。Pixel 主题下背景不生效。'
    },
    {
      keywords: ['字号', '字体', '大小', '放大', '缩小', '太小', '太大'],
      answer: '调整字号：设置页「个性化」→「字号」滑块，范围 85%–140%。\n若喜欢醒目字体，可把「字体」切到「得意黑 Smiley Sans」（内置、无需联网）。'
    },
    {
      keywords: ['字体', '得意黑', 'smiley'],
      answer: '字体切换在「个性化」→「字体」：跟随系统（默认）/ 得意黑 Smiley Sans。得意黑是内置字体，启用后界面更醒目、更适合做海报展示。'
    },
    {
      keywords: ['检测', '怎么判', '判定', '逻辑', '原理', '识别', '分析'],
      answer: '银狐防护基于网页代码特征本地分析（不上传页面），主要看这些维度：\n1. 域名仿冒（拼写/连字符变体、含品牌词）；\n2. ICP 备案缺失或异常；\n3. 低质量 / 新建站点特征；\n4. 可执行文件（.exe/.scr 等）直链；\n5. 网盘 / 压缩包分发；\n6. 混淆 JS、虚拟机检测；\n7. 社工话术（发票 / 补贴 / 工资表）；\n8. 仿冒官网、跳转 iframe、域名结构异常。\n命中越多风险分越高。具体某个网址安不安全，请交给扩展实时检测或走官方渠道核实。'
    },
    {
      keywords: ['误报', '误判', '白名单', '信任', '放行', '加白'],
      answer: '遇到误报：把该域名加进「信任域名白名单」即可放行（设置页相关分类里）。白名单只在本地生效，不影响检测逻辑本身。'
    },
    {
      keywords: ['急救', '360', '中招', '中毒', '木马', '杀毒', '系统急救'],
      answer: '怀疑电脑中招：用「银狐急救」下载 360 系统急救箱（设置页入口，官方直链）。解压后双击主程序 .exe；若 .exe 被病毒拦住无法运行，改双击同目录下的 .com 文件（Windows 最底层 DOS 程序，银狐类病毒通常只拦 .exe 不拦 .com）。'
    },
    {
      keywords: ['更新', '版本', '更新日志', 'changelog', '新版本'],
      answer: '查看版本与更新：设置页「关于」→「查看各版本变更记录」。更新成功后会自动弹提示，点「查看本次更新内容」可看详情。当前版本号在「关于」页顶部。'
    },
    {
      keywords: ['开关', '启用', '关闭防护', '防护关', '全局'],
      answer: '总开关在设置页顶部「全局防护」。关闭后扩展不再分析网页与拦截下载（仅自己浏览用）。网页内警告横幅、自动拦截等子开关也在对应分类里单独控制。'
    },
    {
      keywords: ['备案', 'icp', '核验'],
      answer: '备案核验在设置项里：开启后扩展会查询站点 ICP 备案情况，缺失或异常会作为风险加分项。该查询走公开接口，可单独关闭。'
    },
    {
      keywords: ['灵敏度', '严格', '宽松', '阈值'],
      answer: '灵敏度设置决定判定松紧：高灵敏度更易触发警告（适合谨慎场景），低灵敏度更少打扰（适合老练用户）。可在对应分类里调整。'
    },
    {
      keywords: ['下载', '拦截下载', '自动拦截', '拦下载'],
      answer: '「自动拦截可疑下载」开启后，扩展会禁用页面里伪装成按钮 / 卡片的可疑下载入口（不仅是 <a> 链接，连 div/button 伪装的也拦）。普通官网下载不受影响。'
    },
    {
      keywords: ['ai', '模型', 'glm', '本地', '离线', '网络出错', '失败', '限额', '超限', 'max模式', 'max', '云端优先'],
      answer: 'AI 助手有三种工作状态：\n• 关键词规则引擎（本地）：0 延迟兜底，离线可用，覆盖扩展的设置 / 主题 / 字号 / 检测开关 / 急救箱等常见问答；\n• 允许云端增强：仅当本地规则未命中时，才把问题文本（不含网页内容）发到云端 GLM 兜底；\n• Max 模式：开启后系统优先调用云端模型辅助（更聪明、更自由），并自动关闭「本地规则引擎」与「允许云端增强」开关，仅保留云端 AI 辅助；云端遇到处理不了的问题时再回退本地规则。\n操作方式：在「AI 设置」里切换对应开关；或用语音指令（如「开启 Max 模式」「关闭 Max 模式」「开启云端增强」）。三者都不分析你正在浏览的网页。'
    },
    {
      keywords: ['隐私', '上传', '数据', '联网', '安全吗'],
      answer: '检测完全在本地完成，不上传你浏览的页面内容。可选的备案核验 / 域名年龄查询与上一版一致且可关。AI 对话默认走本地关键词规则（不上云）；仅在开启「允许云端增强」或「Max 模式」时，本地规则未命中的提问才会把问题文本发到智谱接口，不附带网页内容。Max 模式下云端优先，但同样不上传网页。'
    },
    {
      keywords: ['举报', '反馈', '建议', '提交', '投诉'],
      answer: '想反馈或举报：设置页「关于」里有「意见反馈 / 举报误报」入口（走 GitHub Issue 或官方渠道）。误报了也可直接在「信任域名白名单」里加域名放行。'
    },
    {
      keywords: ['安全吗', '是不是钓鱼', '是不是诈骗', '这个网站', '靠谱吗', '能信吗', '真假'],
      answer: '我不能直接判定某个具体网址是否钓鱼（也不分析你正在打开的网页）。判断方法：\n1）交给扩展实时检测——访问时它会自动分析并给出风险分；\n2）核对官网域名（拼写 / 连字符变体 / 是否含品牌词仿冒）；\n3）查 ICP 备案与域名年龄；\n4）走官方或可信渠道核实。遇到可疑下载，优先用「银狐急救」全盘查杀。'
    },
    {
      keywords: ['卡', '卡顿', '变卡', '慢', '占用', '内存', '性能', '耗电', '流畅'],
      answer: '性能方面：检测在本地轻量运行，对日常浏览几乎无感。若觉得设置页卡顿，可开启「减弱动画」；老旧设备建议材质用「磨砂玻璃」而非「琉声」（后者折射计算略重）。'
    },
    {
      keywords: ['卸载', '关掉扩展', '删除扩展', '怎么关', '停用'],
      answer: '关闭 / 卸载：浏览器地址栏输入 edge://extensions（Edge）或 chrome://extensions（Chrome），找到「银狐防护 · SilverFox Guard」，点「移除」即可；想临时停用可先关「全局防护」总开关。'
    },
    {
      keywords: ['快捷键', '快捷键', '热键'],
      answer: '目前扩展没有独立的全局快捷键——它在后台常驻，访问网页时自动检测，无需手动触发。设置类的快捷操作（换主题 / 调字号 / 开防护）可以直接对我说，我来帮你改。'
    },
    {
      keywords: ['是什么', '干嘛的', '干什么', '介绍下', '介绍一下', '做什么'],
      answer: '银狐防护（SilverFox Guard）是一款浏览器扩展，专门识别并拦截「银狐（游蛇）」类木马投毒网站：访问网页时本地分析域名仿冒、备案异常、可疑下载入口、社工话术等风险特征，命中即弹警告横幅并锁定伪装成按钮的木马下载。所有检测在本地完成，不上传你的网页内容。'
    },
    {
      keywords: ['检测维度', '检测项', '检测什么', '评分项', '逐项', '域名仿冒', '仿冒检测', '检测项目', '哪些检测', '维度', '逐项开关', '维度开关', '检测项开关', '逐项开'],
      answer: '「检测维度」列出独立评分的每一项风险特征，可逐项开关：域名仿冒（品牌词拼写变体 / 连字符陷阱）、备案异常、可疑下载入口（伪装成按钮 / 卡片的木马直链）、社工话术、域名年龄过新等。每项命中都贡献风险分，总分超阈值即判危。不想某项参与判定，直接关掉即可。'
    },
    {
      keywords: ['拦截行为', '提醒方式', '弹窗', '浮层', '系统通知', 'toast', '禁用链接', '跳转', '处置方式', '怎么提醒', '弹窗提醒'],
      answer: '「拦截行为」决定命中风险后如何提醒与处置，三者可单独开关：\n• 弹出警告浮层：页面上盖一层美观警告（可关）；\n• 自动禁用下载 / 跳转链接：命中后锁死页面全部下载与重定向（推荐开）；\n• Windows 系统弹窗：右下角弹系统通知 toast，更易引起注意（默认开）。'
    },
    {
      keywords: ['白名单', '信任域名', '自定义关键词', '黑名单', '放行', '误报加白', '加白', '规则', '规则白名单', '信任'],
      answer: '「规则与白名单」三件套：\n• 信任域名白名单：把确定安全的域名加进去，不再分析、不再拦截；误报时首选这里加放行；\n• 自定义关键词：你指定某些词命中即判危或放行；\n• 黑名单：指定域名强制判危。\n白名单优先于检测，加错也不影响其他站点。'
    },
    {
      keywords: ['统计', '拦截次数', '拦截了多少', '查杀记录', '防护统计', '拦了多少', '记录', '拦截记录'],
      answer: '「防护统计」展示累计已拦截的风险站点数与可疑下载次数，按时间排列。想看详细记录就在这里；数据仅存本地，不上传。'
    },
    {
      keywords: ['中招', '中毒', '感染了', '急救', '360', '急救箱', '怎么杀', '杀毒', '木马', '银狐病毒', '中招了', '感染'],
      answer: '怀疑已中银狐（游蛇）木马：进设置页「银狐急救」→ 点「下载 360 系统急救箱」（官方绿色版，无需安装、不依赖已装杀软）。解压后双击主程序 .exe；若 .exe 被病毒拦住打不开，改双击同目录的 .com 文件（Windows 最底层程序，银狐一般只屏蔽 .exe）。急救箱全盘查杀后重启。'
    },
    {
      keywords: ['扫描', '样本', '上传文件', '查杀文件', '静态检测', '扫文件', '上传查杀', '扫描文件', '本地扫描', '消毒'],
      answer: '「银狐扫描」可上传文件 / 文件夹做静态检测：本地用 60+ 规则（压缩包 / 网盘 / 可执行直链 / 品牌词仿冒等）比对，不上传文件。适合拿到可疑安装包、想先验证再运行。结果只显示在本地。'
    },
    {
      keywords: ['背景', '换背景', '自定义背景', '上传背景', '壁纸', '设置背景', '改背景', '背景图'],
      answer: '「个性化 → 自定义背景」可上传一张图片作设置页背景（自动压缩存储，不影响检测）。留空则用主题默认背景。网页内警告横幅始终保持深色设计以醒目，不随背景变。'
    },
    {
      keywords: ['版本', '更新', '更新日志', '更新了啥', '最新版', '改动', 'changelog', '升级', '更新说明'],
      answer: '版本与更新日志在「关于」里，逐版本列出改动。当前在架版本可在 Edge 扩展商店页查看，GitHub Release 也同步发布。需要我帮你跳到「关于」看详情可以说一声。'
    },
    {
      keywords: ['密钥', 'key', 'api key', '填密钥', '换密钥', 'glm key', '怎么填密钥', '申请密钥', '智谱', 'bigmodel', 'token', 'key怎么'],
      answer: 'AI 接口密钥在「AI 设置」里填：默认已内置免费模型 GLM-4.7-Flash 的 Key，开箱即用；想用自己的额度，去智谱 BigModel 开放平台申请 GLM 系列 Key 粘贴进来即可。密钥只在你本机调用智谱接口时用，不上传其他服务器。'
    },
    {
      keywords: ['字号怎么', '字体怎么', '字太小', '字太小了', '怎么调字', '怎么换字体', '字大', '字小', '调字体', '调字号', '字太大'],
      answer: '调字号 / 字体在「个性化」：\n• 字体大小：滑块 85%–140% 实时调节（得意黑内置 110% 最佳）；\n• 切换字体：得意黑 Smiley Sans（内置）或跟随系统。\n直接对我说「字号大一点 / 换成得意黑」也行，我帮你改。'
    },
    {
      keywords: ['主题怎么', '怎么换主题', '材质怎么', '琉声怎么开', '怎么开琉声', '主题选', '材质选', '换皮肤'],
      answer: '外观在「个性化」：\n• 外观主题：经典 / 暖金国风 / 赛博霓虹 / 极简雾灰 / 暗夜深空，每套深 + 浅变体；\n• 深浅色：深色护眼 / 浅色明亮（仅设置页与弹窗，警告横幅保持深色）；\n• 界面材质：琉声（液态玻璃折射）或磨砂玻璃。\n直接说「暖金主题 / 用琉声材质」我来切。'
    },
    {
      keywords: ['误报', '误判', '错判', '假阳性', '报错了', '不该拦', '拦错了', '误拦', '白名单放行', '乱拦'],
      answer: '遇到误报：最快是在「规则与白名单 → 信任域名」加该域名放行；也可在「检测维度」关掉误伤的那一项（如某合法站总被品牌词误判，就关掉对应仿冒项）。仍怀疑是规则问题，可在「关于」里走「举报误报」反馈。'
    },
    {
      keywords: ['浏览器', 'edge', 'chrome', '360', '支持', '哪些浏览器', '火狐', '适配', 'opera', '可用', '装在哪'],
      answer: '银狐防护基于 Chromium 扩展规范，Edge / Chrome / 360 极速浏览器等 Chromium 内核浏览器均可安装；Firefox 因 API 差异暂不支持。手机版 Edge 可加载但暂不维护移动界面。'
    },
    {
      keywords: ['原理', '怎么检测', '怎么知道', '检测逻辑', '怎么识别', '识别原理', '怎么判断', '判危', '怎么分析'],
      answer: '检测在本地进行，不依赖云端：访问网页时提取域名（拼写变体 / 连字符陷阱 / 品牌词仿冒）、页面里的可疑下载入口（伪装成按钮 / 卡片的直链）、社工话术、备案情况、域名年龄等特征，逐项打分汇总成风险分，超阈值即判危并弹警告、锁定木马下载入口。所有分析在你本机完成。'
    },
    {
      keywords: ['同步', '备份', '多设备', '换电脑', '设置同步', '导入', '导出', '漫游', '换设备'],
      answer: '设置通过浏览器账号的扩展同步（chrome.storage.sync）漫游：同一浏览器账号登录的多台设备会自动同步你的开关 / 主题 / 白名单。换电脑只要登录同一账号即可恢复。注意信任白名单等也一并同步。'
    }
  ];

  /* 本地自然语言理解：意图抽取（同义词归一，支持口语变体）+ 评分式问答匹配 */
  const INTENT_WORDS = {
    dark: ['深色', '暗色', '暗黑', '护眼', '夜间', '黑底', '暗的', '暗色调', '调暗'],
    light: ['浅色', '明亮', '白天', '白底', '亮的', '亮色', '调亮'],
    gold: ['暖金', '国风', '金色', '金风', '金色国风', '鎏金', '金'],
    neon: ['赛博', '霓虹', '赛博朋克', 'cyber'],
    mist: ['雾灰', '极简', '简约', '性冷淡', '北欧', '性极简', '素雅'],
    space: ['深空', '星空', '暗夜', '宇宙', '银河', '星河'],
    classic: ['经典', '默认', '普通', '标准'],
    liquid: ['琉声', '液态玻璃', '液体玻璃', '液态', '璃声', 'liu', '折射'],
    frosted: ['磨砂', '毛玻璃', '磨砂玻璃', '毛玻'],
    smiley: ['得意黑', 'smiley', '思源黑', '黑体'],
    system: ['系统字体', '跟随系统', '系统默认字体', '默认字体', '系统字'],
    size: ['字号', '字体大小', '字大小', '文字大小', '字', '调大', '调小', '放大', '缩小', '字太小', '字很大', '字号太小', '字体调', '字大', '字小', '调字体', '调字号'],
    bigger: ['大一点', '放大', '调大', '加大', '大一些', '大点', '再大', '变大', '大些', '大号', '放大些', '再大点', '大一圈', '调大点', '大些'],
    smaller: ['小一点', '缩小', '调小', '减小', '小一些', '小点', '再小', '变小', '小些', '缩小些', '再小点', '小一圈', '调小点', '小些'],
    reset: ['恢复默认', '还原', '重置', '复原', '出厂', '默认大小', '回到默认', '还原默认'],
    enabledGlobal: ['防护', '全局防护', '总开关', '关防护', '停防护', '防护关'],
    showWarning: ['警告', '横幅', '警告横幅', '提示横幅', '警告提示', '风险横幅'],
    autoBlockDownloads: ['下载拦截', '拦截下载', '可疑下载', '拦下载', '下载保护'],
    reduceMotion: ['动画', '动效', '过渡动画'],
    notify: ['系统通知', '右下角', 'win弹窗', 'windows通知', '弹窗提醒', 'toast', '系统弹窗'],
    icpApiVerify: ['备案查询', '查备案', '备案核验', 'icp', '备案'],
    cloudEnhance: ['云端增强', '云端', '云增强', 'glm增强', '云兜底'],
    localModelEnabled: ['本地模型', '本地引擎', '本地规则', '规则引擎', '离线引擎'],
    maxMode: ['max模式', 'max', '最强模式', '云端优先', '全力模式'],
    sensHigh: ['高灵敏', '灵敏度高', '严格', '最严', '检测灵敏度高', '灵敏度为高', '检测灵敏度为高', '调高灵敏度', '灵敏度调高'],
    sensMed: ['中灵敏', '灵敏度中', '适中', '默认灵敏', '检测灵敏度中', '灵敏度为中', '检测灵敏度为中', '灵敏度调中'],
    sensLow: ['低灵敏', '灵敏度低', '宽松', '最松', '检测灵敏度低', '灵敏度为低', '检测灵敏度为低', '调低灵敏度', '灵敏度调低'],
    enable: ['开启', '打开', '启用', '开', '开起'],
    disable: ['关掉', '关闭', '关', '关起']
  };

  // ================= 本地自学习引擎 =================
  // 完全离线运行：所有数据只存 chrome.storage.local，不上传任何云端。
  // 学习内容包括：
  //   • 从「未命中对话」提取高频短语 → 自动生成新规则
  //   • 从「已命中对话」提取用户口语词 → 扩充 INTENT_WORDS 提升匹配
  //   • 统计规则命中/未解决率 → 自动降权可疑规则
  const LEARN = {
    enabled: true,
    log: [],          // 最近对话记录（内存缓存，最多 200 条）
    rules: [],        // 自学规则 [{id, scenario, keywords, weight, source, created}]
    words: {},        // 自学口语词 {intent: [word]}
    stats: {},        // 规则统计 {ruleId: {hit, miss, lastWrong}}
    meta: { lastLearn: 0, learnedRuleCount: 0, learnedWordCount: 0 },
    dirty: false
  };
  let learnTimer = null;

  async function loadLearnData() {
    const d = await storeLocalGet({
      sfLearnEnabled: true,
      sfLearnLog: [],
      sfLearnedRules: [],
      sfLearnedWords: {},
      sfRuleStats: {},
      sfLearnMeta: { lastLearn: 0, learnedRuleCount: 0, learnedWordCount: 0 }
    });
    if (typeof d.sfLearnEnabled === 'boolean') LEARN.enabled = d.sfLearnEnabled;
    LEARN.log = Array.isArray(d.sfLearnLog) ? d.sfLearnLog : [];
    LEARN.rules = Array.isArray(d.sfLearnedRules) ? d.sfLearnedRules : [];
    LEARN.words = d.sfLearnedWords || {};
    LEARN.stats = d.sfRuleStats || {};
    LEARN.meta = d.sfLearnMeta || { lastLearn: 0, learnedRuleCount: 0, learnedWordCount: 0 };
  }

  function scheduleLearn() {
    if (!LEARN.enabled || learnTimer) return;
    learnTimer = setTimeout(() => { learnTimer = null; runLearner(); }, 3000);
  }

  function getLearnedRules() {
    return LEARN.enabled ? LEARN.rules : [];
  }
  function getLearnedWords() {
    return LEARN.enabled ? LEARN.words : {};
  }

  // 判断助手回复是否为「脏数据」——空 / 纯空白 / 模型明确无产出，不进入学习
  function isDirtyAnswer(answer) {
    if (answer == null) return true;
    const s = String(answer).trim();
    if (!s) return true;
    // 云端模型偶尔返回「无错误」「无返回内容」等无效产出，视为脏数据不学习
    if (/^（?无(返回内容|错误|结果|输出)|无(返回内容|错误|结果|输出)|\(?无返回内容\)?$/.test(s)) return true;
    return false;
  }

  function learnFromTurn(text, info) {
    if (!LEARN.enabled) return;
    // 防脏数据：助手回复为空 / 纯空格 / 模型无产出时，不写入学习日志，避免污染规则挖掘
    if (isDirtyAnswer(info.answer)) return;
    const entry = {
      q: text,
      t: Date.now(),
      intent: info.intent || null,
      scenario: info.scenario || null,
      action: info.action || null,
      ruleId: info.ruleId || null,
      hit: !!info.hit,
      cloud: !!info.cloud,
      cloudAction: !!info.cloudAction,   // 云端模型是否实际修改了设置（回灌学习用）
      provider: info.provider || null,
      branch: info.branch || null,
      solved: info.solved !== false,
      answer: info.answer || null        // 留存助手回复，供后续指令挖掘（云端回灌）
    };
    LEARN.log.push(entry);
    if (LEARN.log.length > 200) LEARN.log = LEARN.log.slice(-200);
    storeLocalSet({ sfLearnLog: LEARN.log });
    scheduleLearn();
  }

  function runLearner() {
    if (!LEARN.enabled || LEARN.log.length < 5) return;
    const now = Date.now();
    LEARN.meta.lastLearn = now;
    const recent = LEARN.log.slice(-100);

    // 1) 规则校正：统计命中与未解决
    const stats = Object.assign({}, LEARN.stats);
    recent.forEach((e) => {
      const id = e.ruleId || e.scenario;
      if (!id) return;
      if (!stats[id]) stats[id] = { hit: 0, miss: 0, lastWrong: 0 };
      if (e.hit) stats[id].hit += 1;
      if (!e.solved) { stats[id].miss += 1; stats[id].lastWrong = e.t; }
    });
    LEARN.stats = stats;

    // 2) 自动生成新规则：从未命中日志提取高频短语
    const miss = recent.filter((e) => !e.hit && e.q && e.q.length >= 4);
    const phraseCount = {};
    miss.forEach((e) => {
      const q = e.q.toLowerCase();
      for (let len = 3; len <= 6 && len <= q.length; len++) {
        for (let i = 0; i <= q.length - len; i++) {
          const p = q.substring(i, i + len);
          if (/[\u4e00-\u9fa5]/.test(p) || /[a-z0-9]{3,}/.test(p)) {
            phraseCount[p] = (phraseCount[p] || 0) + 1;
          }
        }
      }
    });
    const existingKws = new Set();
    [...LOCAL_RULES, ...LEARN.rules].forEach((r) => {
      (r.keywords || []).forEach((k) => existingKws.add(String(k).toLowerCase()));
    });
    const scenarios = {};
    recent.forEach((e) => { if (e.scenario) scenarios[e.scenario] = (scenarios[e.scenario] || 0) + 1; });
    const topScenario = Object.keys(scenarios).sort((a, b) => scenarios[b] - scenarios[a])[0] || 'fallback';
    Object.keys(phraseCount).forEach((p) => {
      if (phraseCount[p] >= 3 && !existingKws.has(p)) {
        const rule = {
          id: 'learned_' + now + '_' + Math.random().toString(36).slice(2, 7),
          scenario: topScenario,
          keywords: [p],
          weight: Math.min(phraseCount[p] * 0.3, 3),
          source: 'learned',
          created: now
        };
        LEARN.rules.push(rule);
        LEARN.meta.learnedRuleCount += 1;
        existingKws.add(p);
      }
    });
    if (LEARN.rules.length > 50) {
      LEARN.rules.sort((a, b) => (b.weight || 0) - (a.weight || 0));
      LEARN.rules = LEARN.rules.slice(0, 50);
    }

    // 3) 口语词积累：从「本地命中」与「云端模型实际修改设置(cloudAction)」两类日志
    //    提取不在基础词库的共现短语——云端改设置时也回灌学习，提升后续识别率
    const baseWords = new Set();
    Object.values(INTENT_WORDS).forEach((arr) => arr.forEach((w) => baseWords.add(w)));
    const intentDocs = {};
    recent.filter((e) => ((e.hit && e.intent) || (e.cloudAction && e.intent))).forEach((e) => {
      if (!intentDocs[e.intent]) intentDocs[e.intent] = [];
      intentDocs[e.intent].push(e.q);
    });
    Object.entries(intentDocs).forEach(([intent, qs]) => {
      const counts = {};
      qs.forEach((q) => {
        const t = q.toLowerCase();
        for (let len = 2; len <= 4 && len <= t.length; len++) {
          for (let i = 0; i <= t.length - len; i++) {
            const p = t.substring(i, i + len);
            if (!baseWords.has(p)) counts[p] = (counts[p] || 0) + 1;
          }
        }
      });
      const learned = LEARN.words[intent] || [];
      Object.keys(counts).forEach((p) => {
        if (counts[p] >= 2 && !learned.includes(p) && !baseWords.has(p)) learned.push(p);
      });
      if (learned.length) LEARN.words[intent] = learned;
    });
    Object.keys(LEARN.words).forEach((k) => {
      if (LEARN.words[k].length > 20) LEARN.words[k] = LEARN.words[k].slice(-20);
    });
    LEARN.meta.learnedWordCount = Object.values(LEARN.words).reduce((a, b) => a + b.length, 0);

    // 4) 持久化学习结果
    storeLocalSet({
      sfLearnedRules: LEARN.rules,
      sfLearnedWords: LEARN.words,
      sfRuleStats: LEARN.stats,
      sfLearnMeta: LEARN.meta
    });
  }


  function extractIntents(text) {
    const set = new Set();
    // 基础意图词
    for (const k in INTENT_WORDS) {
      for (const w of INTENT_WORDS[k]) {
        if (text.indexOf(w) !== -1) { set.add(k); break; }
      }
    }
    // 合并自学口语词
    const learned = getLearnedWords();
    for (const k in learned) {
      for (const w of learned[k]) {
        if (text.indexOf(w) !== -1) { set.add(k); break; }
      }
    }
    return set;
  }

  function localMatch(q) {
    const t = (q || '').toLowerCase();
    const rules = [...LOCAL_RULES, ...getLearnedRules()];
    let best = null, bestScore = 0;
    for (const rule of rules) {
      let s = 0;
      const weight = rule.weight || 1;
      for (const kw of rule.keywords || []) {
        if (t.indexOf(kw.toLowerCase()) !== -1) s += (kw.length * weight);  // 长词更具体，权重更高；自学规则随命中次数加权
      }
      if (s > bestScore) { bestScore = s; best = rule; }
    }
    return bestScore >= 1 ? best : null;   // 取评分最高的规则；无任何关键词命中才走兜底
  }

  /* 本地指令层：识别「换主题 / 调字号 / 开防护」等命令，直接操作设置控件并落盘 storage。
     优先级高于关键词问答——用户说"换成深色"是命令，说"主题怎么换"才是提问。 */
  function $(id) { return document.getElementById(id); }
  // 写设置：同时落盘 chrome.storage.sync，并同步到 options 页的 settings 缓存
  // （window.__sfSettings），否则 AI 改完设置后用户再手动改同一项并点「保存设置」，
  // collectSettings 会读到旧缓存值把手动改动覆盖掉。
  function storeSet(kv) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) chrome.storage.sync.set(kv);
    if (typeof window !== 'undefined' && window.__sfSettings) {
      for (const k in kv) window.__sfSettings[k] = kv[k];
    }
  }
  // 自学习数据存 local（量大且不需跨设备同步，避免占 sync 配额）
  function storeLocalSet(kv) { if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.set(kv); }
  function storeLocalGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.get(keys, resolve);
      else resolve(typeof keys === 'object' && keys !== null ? keys : {});
    });
  }
  function fireChange(el) { if (el) el.dispatchEvent(new Event('change', { bubbles: true })); }
  function setToggle(id, on, key) {
    const el = $(id); if (!el) return false;
    el.checked = on; fireChange(el);
    if (key) storeSet({ [key]: on });   // 部分控件（如全局防护/警告横幅/下载拦截）的 change 处理器不落盘，这里兜底写一次
    return true;
  }
  // 主题键存的是 'dark'/'light' 字符串（options.js 的 change 处理器即如此），不能用布尔兜底覆盖，单独写正确值
  function setTheme(dark) {
    const el = $('themeLight'); if (!el) return false;
    el.checked = !dark; fireChange(el);
    storeSet({ theme: dark ? 'dark' : 'light' });
    return true;
  }
  function clickSel(sel) { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; }
  function pickPalette(p) { return clickSel('.theme-opt[data-palette="' + p + '"]'); }
  function pickFont(f) { return clickSel('.font-opt[data-font="' + f + '"]'); }
  function pickMaterial(m) {
    if (document.documentElement.classList.contains('theme-pixel')) return 'pixel'; // Pixel 主题锁定磨砂玻璃
    return clickSel('#materialSeg button[data-material="' + m + '"]');
  }
  function setFontScale(v) {
    const el = $('fontScale'); if (!el) return false;
    v = Math.max(0.85, Math.min(1.40, v));
    el.value = Math.round(v * 100);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    storeSet({ fontScale: v });
    return true;
  }
  function nudgeFontScale(d) { const el = $('fontScale'); const cur = (el ? parseFloat(el.value) / 100 : 1) || 1; return setFontScale(cur + d); }
  function setReduceMotion(on) {
    const el = $('reduceMotion'); if (!el) return false;
    el.checked = on; fireChange(el);
    // 开启时 options.js 会弹确认框，需替用户点确认才能真正生效
    const modal = $('rmModal');
    if (on && modal && modal.classList.contains('show')) { const c = $('rmConfirm'); if (c) c.click(); }
    storeSet({ reduceMotion: on });
    return true;
  }
  // 灵敏度：点选 #sensitivity 下对应 data-v 的按钮并落盘
  function pickSensitivity(v) {
    const btn = document.querySelector('#sensitivity button[data-v="' + v + '"]');
    if (!btn) return false;
    btn.click();
    storeSet({ sensitivity: v });
    return true;
  }
  // 像素主题：先解锁（写 pixelUnlocked），再点选主题按钮
  function unlockPixel() {
    storeSet({ pixelUnlocked: true });
    document.documentElement.classList.add('pixel-unlocked');
    return pickPalette('pixel');
  }
  // 清空多行文本框类设置（白名单 / 自定义关键词 / 危险域名）
  function clearLines(id) {
    const el = $(id); if (!el) return false;
    el.value = '';
    fireChange(el);
    if (id === 'allowlist') storeSet({ allowlist: [] });
    else if (id === 'customKeywords') storeSet({ customKeywords: [] });
    else if (id === 'customBadDomains') storeSet({ customBadDomains: [] });
    return true;
  }

  const ACTIONS = [
    { id: 'dark', need: ['dark'], phrases: ['切换深色', '换成深色', '调成深色', '改深色', '深色模式', '切到深色', '黑底', '暗一点', '调暗', '换成黑底'], run: () => setTheme(true), done: '已切换到深色模式（护眼）。', tip: '深浅色仅作用于设置页与弹窗，网页警告横幅保持深色以醒目。' },
    { id: 'light', need: ['light'], phrases: ['切换浅色', '换成浅色', '调成浅色', '改浅色', '浅色模式', '切到浅色', '白底', '亮一点', '调亮', '换成白底'], run: () => setTheme(false), done: '已切换到浅色模式（明亮）。', tip: '深浅色仅作用于设置页与弹窗。' },
    { id: 'classic', need: ['classic'], phrases: ['经典主题', '切经典', '换经典', '恢复经典', '默认主题', '变回经典', '普通主题'], run: () => pickPalette('classic'), done: '已切换为「经典」主题。' },
    { id: 'gold', need: ['gold'], phrases: ['暖金主题', '切暖金', '换暖金', '国风主题', '金色主题', '金色', '金风'], run: () => pickPalette('gold'), done: '已切换为「暖金国风」主题。' },
    { id: 'neon', need: ['neon'], phrases: ['赛博主题', '切赛博', '霓虹主题', '换霓虹', '赛博霓虹', '赛博朋克'], run: () => pickPalette('neon'), done: '已切换为「赛博霓虹」主题。' },
    { id: 'mist', need: ['mist'], phrases: ['极简主题', '切雾灰', '雾灰主题', '换雾灰', '极简雾灰', '性冷淡', '北欧', '素雅'], run: () => pickPalette('mist'), done: '已切换为「极简雾灰」主题。' },
    { id: 'space', need: ['space'], phrases: ['深空主题', '暗夜主题', '星空主题', '切深空', '换深空', '银河', '星河'], run: () => pickPalette('space'), done: '已切换为「暗夜深空」主题。' },
    { id: 'smiley', need: ['smiley'], phrases: ['用得意黑', '换得意黑', '切得意黑', '开启得意黑', '得意黑字体', '用smiley', '换黑体'], run: () => pickFont('smiley'), done: '已切换为「得意黑 Smiley Sans」字体（内置，无需联网）。' },
    { id: 'system', need: ['system'], phrases: ['用系统字体', '系统字体', '跟随系统字体', '换回系统字体', '系统默认字体'], run: () => pickFont('system'), done: '已切换回「跟随系统」字体。' },
    { id: 'liquid', need: ['liquid'], phrases: ['琉声材质', '液态玻璃材质', '切琉声', '换琉声', '用琉声', '液体玻璃', '开琉声', '璃声'], run: () => pickMaterial('liquid'), done: '已切换为「琉声（液态玻璃）」材质。', tip: 'Pixel 主题下材质强制为磨砂玻璃，无法切换。' },
    { id: 'frosted', need: ['frosted'], phrases: ['磨砂玻璃材质', '切磨砂', '换磨砂', '用磨砂', '毛玻璃', '磨砂玻璃'], run: () => pickMaterial('frosted'), done: '已切换为「磨砂玻璃」材质（默认）。' },
    { id: 'sizeUp', need: ['size', 'bigger'], phrases: ['字号大一点', '放大字号', '字号调大', '字号加大', '字再大点', '大一圈', '调大点', '字大点', '放大些'], run: () => nudgeFontScale(0.1), done: '字号已调大。' },
    { id: 'sizeDown', need: ['size', 'smaller'], phrases: ['字号小一点', '缩小字号', '字号调小', '字号减小', '字再小点', '小一圈', '调小点', '字小点', '缩小些'], run: () => nudgeFontScale(-0.1), done: '字号已调小。' },
    { id: 'sizeReset', need: ['size', 'reset'], phrases: ['字号恢复', '字号还原', '字号重置', '恢复默认字号', '复原字号', '默认大小', '回到默认字号'], run: () => setFontScale(1), done: '字号已恢复默认（100%）。' },
    { id: 'onGuard', need: ['enabledGlobal', 'enable'], phrases: ['开启全局防护', '打开防护', '防护打开', '开启防护', '启用防护', '防护开', '开防护', '打开总开关'], run: () => setToggle('enabledGlobal', true, 'enabledGlobal'), done: '已开启全局防护。' },
    { id: 'offGuard', need: ['enabledGlobal', 'disable'], phrases: ['关闭全局防护', '关掉防护', '防护关闭', '关闭防护', '防护关', '停防护'], run: () => setToggle('enabledGlobal', false, 'enabledGlobal'), done: '已关闭全局防护（仅自己浏览用，不再分析网页与拦截下载）。' },
    { id: 'onWarn', need: ['showWarning', 'enable'], phrases: ['开启警告', '显示横幅', '打开横幅', '开启警告横幅', '警告开', '横幅开', '打开警告'], run: () => setToggle('showWarning', true, 'showWarning'), done: '已开启网页内警告横幅。' },
    { id: 'offWarn', need: ['showWarning', 'disable'], phrases: ['关闭警告', '隐藏横幅', '关掉横幅', '关闭警告横幅', '警告关', '横幅关'], run: () => setToggle('showWarning', false, 'showWarning'), done: '已关闭网页内警告横幅。' },
    { id: 'onBlock', need: ['autoBlockDownloads', 'enable'], phrases: ['开启下载拦截', '打开下载拦截', '拦截打开', '开启拦截下载', '拦截开', '下载保护开', '开拦下载'], run: () => setToggle('autoBlockDownloads', true, 'autoBlockDownloads'), done: '已开启自动拦截可疑下载。' },
    { id: 'offBlock', need: ['autoBlockDownloads', 'disable'], phrases: ['关闭下载拦截', '关掉下载拦截', '拦截关闭', '关闭拦截下载', '拦截关', '下载保护关', '关拦下载'], run: () => setToggle('autoBlockDownloads', false, 'autoBlockDownloads'), done: '已关闭自动拦截可疑下载。' },
    { id: 'onNotify', need: ['notify', 'enable'], phrases: ['开启系统通知', '打开系统通知', '开启弹窗提醒', '右下角弹窗开', '开系统弹窗', '打开toast'], run: () => setToggle('notify', true, 'notify'), done: '已开启 Windows 系统弹窗提醒（命中风险时右下角 toast）。' },
    { id: 'offNotify', need: ['notify', 'disable'], phrases: ['关闭系统通知', '关掉系统通知', '关弹窗提醒', '右下角弹窗关', '关系统弹窗', '关闭toast'], run: () => setToggle('notify', false, 'notify'), done: '已关闭 Windows 系统弹窗提醒。' },
    { id: 'onIcp', need: ['icpApiVerify', 'enable'], phrases: ['开启备案核验', '打开备案查询', '开启icp', '开备案', '打开备案核验'], run: () => setToggle('icpApiVerify', true, 'icpApiVerify'), done: '已开启 ICP 备案权威核验。' },
    { id: 'offIcp', need: ['icpApiVerify', 'disable'], phrases: ['关闭备案核验', '关掉备案查询', '关闭icp', '关备案', '关闭备案核验'], run: () => setToggle('icpApiVerify', false, 'icpApiVerify'), done: '已关闭 ICP 备案权威核验（仅做页面文字扫描）。' },
    { id: 'rescue', phrases: ['下载急救箱', '下急救箱', '360急救箱', '中招下载', '下载360', '急救箱下载', '下360'], run: () => clickSel('#rescueBtn'), done: '已为你触发 360 系统急救箱下载（官方绿色版）。', tip: '解压后双击主程序 .exe；若被病毒拦住打不开，改双击同目录的 .com 文件。' },
    { id: 'reduceOn', phrases: ['减弱动画', '关掉动画', '关闭动画', '不要动画', '去掉动画', '关动效', '没动画'], run: () => setReduceMotion(true), done: '已减弱全部动画效果。' },
    { id: 'reduceOff', phrases: ['恢复动画', '开启动画', '打开动画', '要动画', '开动画', '开动效', '有动画'], run: () => setReduceMotion(false), done: '已恢复全部动画效果。' },
    // —— 以下为「全部设置项可操作」补充：灵敏度 / 云端增强 / 本地模型 / 像素彩蛋 / 白名单与自定义词清空 ——
    { id: 'sensHigh', need: ['sensHigh'], phrases: ['灵敏度高', '最高的灵敏度', '调高灵敏度', '灵敏度调到高', '严格检测', '高灵敏', '检测更严', '灵敏度设为高', '灵敏度为高', '灵敏度调高', '检测灵敏度高', '检测灵敏度为高', '调整灵敏度高', '调整检测灵敏度高', '把灵敏度调高', '把检测灵敏度调高', '灵敏度调整为高', '检测灵敏度调为高'], run: () => pickSensitivity('high'), done: '检测灵敏度已设为「高」（更严格，误报可能略增）。' },
    { id: 'sensMed', need: ['sensMed'], phrases: ['灵敏度中', '中等灵敏度', '灵敏度调到中', '适中灵敏度', '默认灵敏度', '灵敏度正常', '中灵敏', '灵敏度设为中', '灵敏度为中', '灵敏度调中', '检测灵敏度中', '检测灵敏度为中', '调整灵敏度中', '调整检测灵敏度中', '把灵敏度调中', '把检测灵敏度调中', '灵敏度调整为中', '检测灵敏度调为中'], run: () => pickSensitivity('medium'), done: '检测灵敏度已设为「中」（推荐）。' },
    { id: 'sensLow', need: ['sensLow'], phrases: ['灵敏度低', '最低的灵敏度', '调低灵敏度', '灵敏度调到低', '宽松检测', '低灵敏', '检测宽松', '灵敏度设为低', '灵敏度为低', '灵敏度调低', '检测灵敏度低', '检测灵敏度为低', '调整灵敏度低', '调整检测灵敏度低', '把灵敏度调低', '把检测灵敏度调低', '灵敏度调整为低', '检测灵敏度调为低'], run: () => pickSensitivity('low'), done: '检测灵敏度已设为「低」（更宽松，漏报风险略增）。' },
    { id: 'cloudOn', need: ['cloudEnhance', 'enable'], phrases: ['开云端增强', '打开云端', '允许云端', '开启glm', '开云端glm', '启用云端增强', '开云增强'], run: () => setToggle('cloudEnhance', true, 'cloudEnhance'), done: '已开启云端 GLM 增强（免费模型，有每分钟额度）。', tip: '开启后未命中本地规则的问题会走云端兜底，回复更自由。' },
    { id: 'cloudOff', need: ['cloudEnhance', 'disable'], phrases: ['关云端增强', '关闭云端', '禁用云端', '关掉glm', '关云端glm', '关闭云端增强', '关云增强'], run: () => setToggle('cloudEnhance', false, 'cloudEnhance'), done: '已关闭云端 GLM 增强（仅本地规则引擎应答，零消耗）。' },
    { id: 'maxOn', need: ['maxMode', 'enable'], phrases: ['开max模式', '开启max', '打开max模式', '启用max', 'max模式开', '开最强模式', '开启最强模式'], run: () => setToggle('aiMaxMode', true, 'aiMaxMode'), done: '已开启 Max 模式：云端模型可理解你的意图并直接调用设置操作（如「帮我安静点」会同时关警告与通知），本地指令层仍作安全网始终可用。', tip: 'Max 模式下本地规则问答库退场，改由云端模型应答与操作；关闭 Max 即恢复本地引擎。' },
    { id: 'maxOff', need: ['maxMode', 'disable'], phrases: ['关max模式', '关闭max', '关掉max模式', '禁用max', 'max模式关', '关最强模式', '关闭最强模式'], run: () => setToggle('aiMaxMode', false, 'aiMaxMode'), done: '已关闭 Max 模式，恢复本地规则引擎应答。' },
    { id: 'localOn', need: ['localModelEnabled', 'enable'], phrases: ['开本地模型', '打开本地引擎', '开启本地规则', '启用本地模型', '开规则引擎'], run: () => setToggle('localModelEnabled', true, 'localModelEnabled'), done: '已开启本地关键词规则引擎（离线、0 延迟）。' },
    { id: 'localOff', need: ['localModelEnabled', 'disable'], phrases: ['关本地模型', '关闭本地引擎', '禁用本地规则', '关规则引擎', '关掉本地模型'], run: () => setToggle('localModelEnabled', false, 'localModelEnabled'), done: '已关闭本地关键词规则引擎（仅云端兜底，需开云端增强）。' },
    { id: 'pixelUnl', phrases: ['解锁像素', '像素主题', '切像素', '换像素', '隐藏主题', '彩蛋主题', '像素风'], run: () => unlockPixel(), done: '已解锁并切换为「Pixel 隐藏主题」。', tip: 'Pixel 主题下材质锁定为磨砂玻璃。再喊「恢复经典」即可退出。' },
    { id: 'clearAllow', phrases: ['清空白名单', '清空信任', '清除信任域名', '信任列表清空', '白名单清空', '清空放行'], run: () => clearLines('allowlist'), done: '已清空信任域名白名单。' },
    { id: 'clearKw', phrases: ['清空自定义关键词', '清除自定义词', '清空关键词', '自定义关键词清空', '清掉自定义词'], run: () => clearLines('customKeywords'), done: '已清空自定义风险关键词。' },
    { id: 'clearBad', phrases: ['清空危险域名', '清除自定义危险域名', '清空自定义域名', '危险域名清空', '自定义域名清空'], run: () => clearLines('customBadDomains'), done: '已清空自定义危险域名。' }
  ];

  /* ============ Max 自主设置：通用 set_setting 工具 + 本地硬校验 ============
   * 云端模型不再依赖写死的 41 条指令集，而是拿到「可操作设置清单」(SETTINGS_SCHEMA)
   * 与当前设置快照，自行把用户意图映射成 key+value，调用通用工具 set_setting(key,value)。
   * 本地对 key（白名单）与 value（类型 / 枚举 / 范围）做硬校验，越权或非法一律拒绝，
   * 绝无任意代码执行权。41 条 ACTIONS 仍作为第 0 步本地最高优先级安全网。 */
  const SETTINGS_SCHEMA = [
    { key: 'enabledGlobal',     label: '全局防护总开关',   type: 'bool',  desc: '是否开启银狐防护（分析网页、拦截下载）。' },
    { key: 'showWarning',       label: '网页警告横幅',     type: 'bool',  desc: '命中风险时在网页内弹出警告横幅。' },
    { key: 'autoBlockDownloads',label: '自动拦截可疑下载', type: 'bool',  desc: '锁定伪装成按钮 / 卡片的木马下载入口。' },
    { key: 'notify',            label: 'Windows 系统弹窗', type: 'bool',  desc: '命中风险时右下角弹系统通知 toast。' },
    { key: 'icpApiVerify',      label: '备案核验',         type: 'bool',  desc: '查询站点 ICP 备案，缺失 / 异常作风险加分。' },
    { key: 'localModelEnabled', label: '本地规则引擎',     type: 'bool',  desc: '内置关键词规则引擎（离线秒回）。' },
    { key: 'cloudEnhance',      label: '云端增强兜底',     type: 'bool',  desc: '本地未命中时调用云端大模型兜底。' },
    { key: 'aiMaxMode',         label: 'Max 模式',         type: 'bool',  desc: '云端模型优先辅助并可直接操作设置。' },
    { key: 'reduceMotion',      label: '减弱动画效果',     type: 'bool',  desc: '关闭全部界面动画与过渡。' },
    { key: 'aiCloudWebAnalyse', label: '后台 AI 分析网页', type: 'bool',  desc: '浏览网页时后台自动送云端 AI 研判（仅品牌域名与页面特征摘要，不含正文）。' },
    { key: 'aiScanFileAnalyse', label: '云端 AI 分析文件', type: 'bool',  desc: '银狐扫描可疑文件时送云端 AI 辅助研判（仅本地特征摘要，不含文件正文）。' },
    { key: 'aiEnabled',         label: 'AI 助手悬浮球',    type: 'bool',  desc: '设置页右下角是否显示 AI 悬浮球。' },
    { key: 'aiTtsVoice',        label: '朗读音色',         type: 'enum',  allowed: ['female', 'male'], desc: 'female=晓晓女声，male=云希男声。' },
    { key: 'theme',             label: '深浅色模式',       type: 'enum',  allowed: ['dark', 'light'], desc: 'dark=深色护眼，light=浅色明亮。' },
    { key: 'themePalette',      label: '外观主题',         type: 'enum',  allowed: ['classic', 'gold', 'neon', 'mist', 'space', 'pixel'], desc: '经典 / 暖金国风 / 赛博霓虹 / 极简雾灰 / 暗夜深空 / Pixel 彩蛋。' },
    { key: 'material',          label: '界面材质',         type: 'enum',  allowed: ['frosted', 'liquid'], desc: 'frosted=磨砂玻璃，liquid=琉声液态玻璃。' },
    { key: 'fontMode',          label: '字体',             type: 'enum',  allowed: ['system', 'smiley'], desc: 'system=跟随系统，smiley=得意黑。' },
    { key: 'sensitivity',       label: '检测灵敏度',       type: 'enum',  allowed: ['high', 'medium', 'low'], desc: 'high=严格，medium=适中，low=宽松。' },
    { key: 'fontScale',         label: '字号缩放',         type: 'range', min: 0.85, max: 1.40, desc: '界面字号缩放系数，0.85~1.40。' },
    { key: 'clearAllowlist',    label: '清空信任白名单',   type: 'clear', desc: '清空信任域名白名单（value 任意）。' },
    { key: 'clearKeywords',     label: '清空自定义关键词', type: 'clear', desc: '清空自定义风险关键词（value 任意）。' },
    { key: 'clearBadDomains',   label: '清空危险域名',     type: 'clear', desc: '清空自定义危险域名（value 任意）。' }
  ];

  // key → 具体操作（复用本地控件修改函数，保证与手动改一致）。绝无任意代码执行。
  const SETTINGS_APPLIER = {
    enabledGlobal:     (v) => setToggle('enabledGlobal', v, 'enabledGlobal'),
    showWarning:       (v) => setToggle('showWarning', v, 'showWarning'),
    autoBlockDownloads:(v) => setToggle('autoBlockDownloads', v, 'autoBlockDownloads'),
    notify:            (v) => setToggle('notify', v, 'notify'),
    icpApiVerify:      (v) => setToggle('icpApiVerify', v, 'icpApiVerify'),
    localModelEnabled: (v) => setToggle('localModelEnabled', v, 'localModelEnabled'),
    cloudEnhance:      (v) => setToggle('cloudEnhance', v, 'cloudEnhance'),
    aiMaxMode:         (v) => setToggle('aiMaxMode', v, 'aiMaxMode'),
    reduceMotion:      (v) => setReduceMotion(v),
    aiCloudWebAnalyse: (v) => setToggle('aiCloudWebAnalyse', v, 'aiCloudWebAnalyse'),
    aiScanFileAnalyse: (v) => setToggle('aiScanFileAnalyse', v, 'aiScanFileAnalyse'),
    aiEnabled:         (v) => setToggle('aiEnabled', v, 'aiEnabled'),
    aiTtsVoice:        (v) => { const el = document.getElementById('ttsVoice'); if (!el) return false; el.value = (v === 'male' ? 'male' : 'female'); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
    theme:             (v) => setTheme(v === 'light'),
    themePalette:      (v) => pickPalette(v),
    material:          (v) => pickMaterial(v),
    fontMode:          (v) => pickFont(v),
    sensitivity:       (v) => pickSensitivity(v),
    fontScale:         (v) => setFontScale(typeof v === 'number' ? v : parseFloat(v)),
    clearAllowlist:    () => clearLines('allowlist'),
    clearKeywords:     () => clearLines('customKeywords'),
    clearBadDomains:   () => clearLines('customBadDomains')
  };

  function getSettingsSnapshot() {
    const snap = {};
    const g = (id) => { const e = $(id); return e ? e.checked : undefined; };
    snap.enabledGlobal = g('enabledGlobal');
    snap.showWarning = g('showWarning');
    snap.autoBlockDownloads = g('autoBlockDownloads');
    snap.notify = g('notify');
    snap.icpApiVerify = g('icpApiVerify');
    snap.localModelEnabled = g('localModelEnabled');
    snap.cloudEnhance = g('cloudEnhance');
    snap.aiMaxMode = g('aiMaxMode');
    snap.reduceMotion = g('reduceMotion');
    snap.aiCloudWebAnalyse = g('aiCloudWebAnalyse');
    snap.aiScanFileAnalyse = g('aiScanFileAnalyse');
    snap.aiEnabled = g('aiEnabled');
    const tl = $('themeLight'); snap.theme = tl ? (tl.checked ? 'light' : 'dark') : undefined;
    const pal = document.querySelector('.theme-opt.active'); snap.themePalette = pal ? pal.dataset.palette : undefined;
    const mat = document.querySelector('#materialSeg button.active'); snap.material = mat ? mat.dataset.material : undefined;
    const fnt = document.querySelector('.font-opt.active'); snap.fontMode = fnt ? fnt.dataset.font : undefined;
    const sbtn = document.querySelector('#sensitivity button.active'); snap.sensitivity = sbtn ? sbtn.dataset.v : undefined;
    const fs = $('fontScale'); snap.fontScale = fs ? parseFloat(fs.value) / 100 : undefined;
    return snap;
  }

  // 本地硬校验：key 白名单 + value 类型 / 枚举 / 范围；返回 {ok, reason, coerced, type}
  function validateSetting(key, value) {
    const s = SETTINGS_SCHEMA.find((x) => x.key === key);
    if (!s) return { ok: false, reason: '未知设置项「' + key + '」（不在可操作范围内）' };
    let v = value;
    if (s.type === 'bool') {
      if (typeof v === 'string') v = /^(true|1|开|启用|开启|是|on)$/i.test(v.trim());
      else v = !!v;
      return { ok: true, coerced: v, type: 'bool' };
    }
    if (s.type === 'enum') {
      const sv = String(v).toLowerCase();
      if (!s.allowed.includes(sv)) return { ok: false, reason: '「' + key + '」取值无效，允许：' + s.allowed.join(' / ') };
      return { ok: true, coerced: sv, type: 'enum' };
    }
    if (s.type === 'range') {
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (isNaN(n)) return { ok: false, reason: '「' + key + '」需为数字' };
      if (n < s.min || n > s.max) return { ok: false, reason: '「' + key + '」超出范围（' + s.min + '~' + s.max + '）' };
      return { ok: true, coerced: n, type: 'range' };
    }
    if (s.type === 'clear') return { ok: true, coerced: true, type: 'clear' };
    return { ok: false, reason: '「' + key + '」类型未支持' };
  }

  function sLabel(key) { const s = SETTINGS_SCHEMA.find((x) => x.key === key); return s ? s.label : key; }

  function applySetting(key, value) {
    const chk = validateSetting(key, value);
    if (!chk.ok) return { ok: false, reason: chk.reason };
    const applier = SETTINGS_APPLIER[key];
    if (!applier) return { ok: false, reason: '「' + key + '」暂不支持自动修改' };
    try {
      const r = applier(chk.coerced);
      if (r === false) return { ok: false, reason: '「' + key + '」操作失败（未找到对应控件）' };
      const msg = sLabel(key) + (chk.type === 'clear' ? ' 已清空' : (chk.type === 'bool' ? (' 已' + (chk.coerced ? '开启' : '关闭')) : (' 已设为 ' + chk.coerced)));
      return { ok: true, msg: msg };
    } catch (e) { return { ok: false, reason: '「' + key + '」执行出错：' + (e && e.message || e) }; }
  }

  /* ============ Max 自主设置：固定工具集（覆盖全开关 + 打开子页面）============
   * 不再用「通用 set_setting + 让模型自己琢磨 key/value」的方式（易调不准、且会把闲聊也当操作）。
   * 改为把每一项可操作设置 / 子页面都做成【固定的、名字自解释的工具】，模型只需按意图挑对工具、填好类型明确的参数，
   * 本地拿到工具名 → 直接映射到对应控件修改函数，绝无任意代码执行权。
   * 这样「调得准」且「聊天不退化」：闲聊/疑问不挂工具，只有命令式才挂这组固定工具。 */

  // 所有固定工具定义（名字即语义，参数类型明确，杜绝模型乱猜 key）
  const FIXED_TOOLS = [
    // —— 防护核心开关 ——
    { name: 'set_global_protection',  label: '全局防护总开关', key: 'enabledGlobal',      param: { name: 'enabled', type: 'boolean', desc: 'true=开启银狐防护（分析网页、拦截下载），false=关闭' } },
    { name: 'set_warning_banner',     label: '网页警告横幅',   key: 'showWarning',        param: { name: 'enabled', type: 'boolean', desc: 'true=开启网页内警告横幅，false=关闭' } },
    { name: 'set_auto_block_download',label: '自动拦截下载',   key: 'autoBlockDownloads', param: { name: 'enabled', type: 'boolean', desc: 'true=锁定伪装成按钮/卡片的木马下载入口，false=关闭' } },
    { name: 'set_system_notify',      label: '系统弹窗',       key: 'notify',             param: { name: 'enabled', type: 'boolean', desc: 'true=命中风险时右下角弹系统通知，false=关闭' } },
    { name: 'set_icp_verify',         label: '备案核验',       key: 'icpApiVerify',       param: { name: 'enabled', type: 'boolean', desc: 'true=开启 ICP 备案核验，false=关闭' } },
    { name: 'set_local_engine',       label: '本地规则引擎',   key: 'localModelEnabled',  param: { name: 'enabled', type: 'boolean', desc: 'true=开启内置关键词规则引擎（离线秒回），false=关闭' } },
    { name: 'set_cloud_enhance',      label: '云端增强兜底',   key: 'cloudEnhance',       param: { name: 'enabled', type: 'boolean', desc: 'true=本地未命中时调用云端大模型兜底，false=关闭' } },
    { name: 'set_max_mode',           label: 'Max 模式',       key: 'aiMaxMode',          param: { name: 'enabled', type: 'boolean', desc: 'true=开启 Max 模式（云端模型可理解意图并直接操作设置），false=关闭' } },
    { name: 'set_reduce_motion',      label: '减弱动画',       key: 'reduceMotion',       param: { name: 'enabled', type: 'boolean', desc: 'true=关闭全部界面动画与过渡，false=恢复' } },
    { name: 'set_cloud_web_analyse',  label: '后台 AI 分析网页',key: 'aiCloudWebAnalyse',  param: { name: 'enabled', type: 'boolean', desc: 'true=浏览时后台自动送云端 AI 研判，false=关闭' } },
    { name: 'set_cloud_file_analyse', label: '云端 AI 分析文件',key: 'aiScanFileAnalyse',  param: { name: 'enabled', type: 'boolean', desc: 'true=扫描可疑文件时送云端 AI 辅助研判，false=关闭' } },
    { name: 'set_ai_fab',             label: 'AI 助手悬浮球',  key: 'aiEnabled',          param: { name: 'enabled', type: 'boolean', desc: 'true=显示 AI 悬浮球，false=隐藏' } },
    { name: 'set_tts',                label: 'AI 语音播报',    key: 'aiTtsEnabled',       param: { name: 'enabled', type: 'boolean', desc: 'true=开启 Edge 神经语音播报，false=关闭' } },
    { name: 'set_tts_voice',          label: '朗读音色',       key: 'aiTtsVoice',         param: { name: 'voice', type: 'string', enum: ['female', 'male'], desc: 'female=晓晓女声（默认），male=云希男声' } },
    // —— 外观 ——
    { name: 'set_theme_mode',         label: '深浅色模式',     key: 'theme',              param: { name: 'mode', type: 'string', enum: ['dark', 'light'], desc: 'dark=深色护眼，light=浅色明亮' } },
    { name: 'set_palette',            label: '外观主题',       key: 'themePalette',       param: { name: 'palette', type: 'string', enum: ['classic', 'gold', 'neon', 'mist', 'space', 'pixel'], desc: 'classic=经典 / gold=暖金国风 / neon=赛博霓虹 / mist=极简雾灰 / space=暗夜深空 / pixel=Pixel 彩蛋' } },
    { name: 'set_material',           label: '界面材质',       key: 'material',           param: { name: 'material', type: 'string', enum: ['frosted', 'liquid'], desc: 'frosted=磨砂玻璃，liquid=琉声液态玻璃' } },
    { name: 'set_font',               label: '字体',           key: 'fontMode',           param: { name: 'font', type: 'string', enum: ['system', 'smiley'], desc: 'system=跟随系统，smiley=得意黑' } },
    { name: 'set_sensitivity',        label: '检测灵敏度',     key: 'sensitivity',        param: { name: 'level', type: 'string', enum: ['high', 'medium', 'low'], desc: 'high=严格，medium=适中，low=宽松' } },
    { name: 'set_font_scale',         label: '字号缩放',       key: 'fontScale',          param: { name: 'scale', type: 'number', desc: '界面字号缩放系数，0.85~1.40（如 1.1 表示 110%）' } },
    // —— 清空类（无参数）——
    { name: 'clear_allowlist',        label: '清空信任白名单', key: 'clearAllowlist' },
    { name: 'clear_keywords',         label: '清空自定义关键词',key: 'clearKeywords' },
    { name: 'clear_bad_domains',      label: '清空危险域名',   key: 'clearBadDomains' },
    // —— 检测维度（26 项逐个开关）——
    { name: 'set_detect_dimension',   label: '检测维度开关',   dimension: true,
      param: { name: 'dimension', type: 'string',
        enum: ['domainImpersonation','icpMissing','icpStolen','codeEngineering','linkAnalysis','crossDomainDownload','blacklistedPayload','domainAge','lowQuality','execDownload','cloudDiskDist','obfuscatedJs','vmDetection','socialEngineering','fakeOfficial','redirectIframe','noahKit','downloadRedirector','runtimeDownload','domainStructure','brandedExe','passwordArchive','lureTheme','fakeUpdate','friendlyLinks','doubleExt'],
        desc: '要开关的检测维度 id，如 domainImpersonation（域名仿冒）/ icpMissing（缺备案）/ lowQuality（低质量）/ execDownload（直链可执行）/ obfuscatedJs（混淆JS）/ vmDetection（沙箱探测）等' } },
    // —— 打开子页面 ——
    { name: 'open_subpage',           label: '打开设置子页面', open: true,
      param: { name: 'section', type: 'string',
        enum: ['general','detect','behavior','rules','rules-allowlist','rules-keywords','rules-baddomains','stats','rescue','scanner','ai','personal','about','changelog'],
        desc: '要打开的设置页：general=常规 / detect=检测维度 / behavior=拦截行为 / rules=规则与白名单 / rules-allowlist=信任白名单 / rules-keywords=自定义关键词 / rules-baddomains=危险域名 / stats=防护统计 / rescue=银狐急救 / scanner=银狐扫描 / ai=AI设置 / personal=个性化 / about=关于 / changelog=更新日志' } }
  ];

  // 子页面：友好 key → 实际 DOM id / 标签
  const SUBPAGE_MAP = {
    general: { id: 'general', label: '常规' }, detect: { id: 'detect', label: '检测维度' },
    behavior: { id: 'behavior', label: '拦截行为' }, rules: { id: 'rules', label: '规则与白名单' },
    'rules-allowlist': { id: 'rules-allowlist', label: '信任白名单' }, 'rules-keywords': { id: 'rules-keywords', label: '自定义关键词' },
    'rules-baddomains': { id: 'rules-baddomains', label: '危险域名' }, stats: { id: 'stats', label: '防护统计' },
    rescue: { id: 'rescue', label: '银狐急救' }, scanner: { id: 'scanner', label: '银狐扫描' },
    ai: { id: 'ai', label: 'AI 设置' }, personal: { id: 'personal', label: '个性化' },
    about: { id: 'about', label: '关于' }, changelog: { id: 'changelog', label: '更新日志' }
  };

  // 中文别名 → 英文 key（模型常传中文 label，如「银狐急救」「更新日志」，需容错）
  const SUBPAGE_ALIAS = {
    '常规': 'general', '通用': 'general', '基础': 'general', '检测维度': 'detect', '维度': 'detect',
    '拦截行为': 'behavior', '拦截': 'behavior', '规则': 'rules', '规则与白名单': 'rules', '白名单规则': 'rules',
    '信任白名单': 'rules-allowlist', '白名单': 'rules-allowlist', '自定义关键词': 'rules-keywords', '关键词': 'rules-keywords',
    '危险域名': 'rules-baddomains', '危险网站': 'rules-baddomains', '防护统计': 'stats', '统计': 'stats',
    '银狐急救': 'rescue', '急救': 'rescue', '急救箱': 'rescue', '360急救': 'rescue',
    '银狐扫描': 'scanner', '扫描': 'scanner', '木马扫描': 'scanner',
    'AI设置': 'ai', 'AI': 'ai', 'AI助手': 'ai', '人工智能': 'ai', '个性化': 'personal', '主题': 'personal', '外观': 'personal',
    '关于': 'about', '关于我们': 'about', '更新日志': 'changelog', '日志': 'changelog', '改动': 'changelog', '版本': 'changelog'
  };

  // 打开设置子页面（优先复用既有导航逻辑，并自带不依赖监听器的可靠直接切换，确保任何时机都生效）
  function openOptionsSection(sectionKey) {
    if (!sectionKey) return { ok: false, reason: '未指定要打开的子页面' };
    // 归一化：去空格、兼容「银狐急救」类中文别名、大小写
    const raw = String(sectionKey).trim();
    const norm = SUBPAGE_ALIAS[raw] || raw;
    const m = SUBPAGE_MAP[norm] || SUBPAGE_MAP[String(norm).toLowerCase()];
    if (!m) return { ok: false, reason: '未知子页面「' + raw + '」（可选：' + Object.keys(SUBPAGE_MAP).join(' / ') + '）' };
    const targetId = (m.id === 'changelog') ? 'changelog' : m.id;

    // 当前是否就在 options 设置页（AI 浮球可能注入在任意普通网页，那里没有这些 DOM）
    const inOptions = !!document.getElementById(targetId) ||
                      !!document.querySelector('.nav-item[data-target="' + targetId + '"]');

    if (!inOptions) {
      // 不在设置页：打开 options 页并带 #sec=<id> 锚点，由 options.js 启动时读取并跳转
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          const url = chrome.runtime.getURL('ui/options.html') + '#sec=' + encodeURIComponent(targetId);
          if (chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url: url, active: true });
          } else if (chrome.runtime && chrome.runtime.sendMessage) {
            // 兜底：让 background 开页（部分环境 content script 无 tabs 权限）
            chrome.runtime.sendMessage({ type: 'SF_OPEN_OPTIONS_SECTION', section: targetId });
          } else {
            window.open(url, '_blank');
          }
          return { ok: true, msg: '' };
        }
      } catch (e) {}
      return { ok: false, reason: '无法打开设置页（环境不支持）' };
    }

    // —— 以下为已在 options 页内：直接切换 ——
    if (targetId === 'changelog') {
      if (typeof showChangelog === 'function') { showChangelog(); return { ok: true, msg: '' }; }
      return { ok: false, reason: '更新日志不可用' };
    }
    const sec = document.getElementById(m.id);
    const navItem = document.querySelector('.nav-item[data-target="' + m.id + '"]');
    const card = document.querySelector('[data-sub="' + m.id + '"]');
    // 直接切换（不依赖 click 监听是否就绪，保证一定生效），并触发非线性入场动画
    document.querySelectorAll('.sec').forEach((s) => { s.classList.remove('active'); s.classList.remove('sec-in'); });
    if (sec) {
      sec.classList.add('active');
      void sec.offsetWidth;            // 强制回流，确保入场动画重新触发
      sec.classList.add('sec-in');
      if (navItem) navItem.classList.add('active');
      const tt = document.getElementById('secTitle'); if (tt && navItem) tt.textContent = navItem.dataset.title || m.label;
      const td = document.getElementById('secDesc'); if (td && navItem) td.textContent = navItem.dataset.desc || '';
      const bb = document.getElementById('backBtn');
      if (bb) bb.hidden = !card;   // 子页面（data-sub 命中）才显示返回键
    }
    // 若既有导航逻辑已就绪，再走一次 click 让其完整同步标题/描述与返回态
    if (navItem && typeof navItem.click === 'function') {
      try { navItem.click(); } catch (e) {}
    } else if (card && typeof card.click === 'function') {
      try { card.click(); } catch (e) {}
    }
    if (sec) return { ok: true, msg: '' };
    return { ok: false, reason: '未找到「' + m.label + '」入口' };
  }

  // 切换某项检测维度（仅在「保存设置」时持久化，故改完触发 saveBtn 保存）
  function setDetectDimension(id, enabled) {
    const cb = document.querySelector('input[data-cat="' + id + '"]');
    if (!cb) return false;
    cb.checked = !!enabled;
    const sb = document.getElementById('saveBtn');
    if (sb) sb.click();
    return true;
  }

  function dimLabel(id) {
    const cats = (window.SF_ANALYZER && window.SF_ANALYZER.CATEGORIES) || [];
    const c = cats.find((x) => x.id === id);
    return c ? c.label : id;
  }

  // 固定工具分发：工具名 → 对应控件修改函数（本地白名单，模型无任意代码执行权）
  function dispatchFixedTool(name, args) {
    const spec = FIXED_TOOLS.find((t) => t.name === name);
    if (!spec) return { ok: false, reason: '未知工具「' + name + '」' };
    if (spec.open) return openOptionsSection(args && args.section);
    if (spec.dimension) {
      const ok = setDetectDimension(args && args.dimension, args && args.enabled);
      const label = dimLabel(args && args.dimension);
      return ok ? { ok: true, msg: (args && args.enabled ? '已开启' : '已关闭') + '检测维度「' + label + '」' } : { ok: false, reason: '未找到检测维度「' + (args && args.dimension) + '」' };
    }
    if (!spec.key) return { ok: false, reason: '该工具无可操作设置' };
    const value = spec.param ? args[spec.param.name] : undefined;
    return applySetting(spec.key, value);
  }

  // 固定工具清单（追加到系统提示，明确告诉模型有哪些固定工具、何时用）
  function maxSettingsBlock() {
    const grp = (title, names) => '- ' + title + '：' + names.join(' / ');
    const lines = [
      grp('防护开关', ['set_global_protection', 'set_warning_banner', 'set_auto_block_download', 'set_system_notify', 'set_icp_verify', 'set_local_engine', 'set_cloud_enhance', 'set_max_mode', 'set_reduce_motion', 'set_cloud_web_analyse', 'set_cloud_file_analyse', 'set_ai_fab', 'set_tts', 'set_tts_voice']),
      grp('外观', ['set_theme_mode(dark/light)', 'set_palette(经典/暖金/霓虹/雾灰/深空/Pixel)', 'set_material(磨砂/琉声)', 'set_font(系统/得意黑)', 'set_sensitivity(严格/适中/宽松)', 'set_font_scale(0.85~1.40)']),
      grp('清空', ['clear_allowlist', 'clear_keywords', 'clear_bad_domains']),
      grp('检测维度', ['set_detect_dimension(dimension=维度id, enabled=true/false)']),
      grp('打开页面', ['open_subpage(section=常规/检测维度/拦截行为/规则与白名单/信任白名单/自定义关键词/危险域名/防护统计/银狐急救/银狐扫描/AI设置/个性化/关于/更新日志)'])
    ];
    return '【固定工具清单】用户命令式要求改设置 / 打开设置页时，只能调用下列固定工具之一（可一次调用多个满足复合意图，如「帮我安静点」同时调用 set_warning_banner(false) 与 set_system_notify(false)）；不要只复述步骤，也不要自创工具名。\n' + lines.join('\n') +
      '\n注意：所有工具名与参数均已固定，按意图选对工具即可，参数类型明确（布尔填 true/false，枚举填给定取值，数字填数值）；清空类与打开页面无需多余参数。检测维度可逐项开/关（dimension 取维度 id）。';
  }

  // 由 FIXED_TOOLS 生成 OpenAI 兼容的 tools 数组（每个工具参数类型明确，规避 anyOf 在部分模型上的兼容坑）
  function buildFixedTools() {
    return FIXED_TOOLS.map((t) => {
      const func = { name: t.name, description: (t.desc || t.label || t.name), strict: false };
      if (t.param) {
        const p = { type: 'object', properties: {}, required: [t.param.name], additionalProperties: false };
        if (t.param.type === 'boolean') {
          p.properties[t.param.name] = { type: 'boolean', description: t.param.desc || 'true 或 false' };
        } else if (t.param.type === 'string' && t.param.enum) {
          p.properties[t.param.name] = { type: 'string', enum: t.param.enum, description: t.param.desc || '取值见枚举' };
        } else if (t.param.type === 'number') {
          p.properties[t.param.name] = { type: 'number', description: t.param.desc || '数值' };
        } else {
          p.properties[t.param.name] = { type: 'string', description: t.param.desc || '' };
        }
        func.parameters = p;
      } else {
        func.parameters = { type: 'object', properties: {}, required: [], additionalProperties: false };
      }
      return { type: 'function', function: func };
    });
  }

  function matchActions(q) {
    const intents = extractIntents(q || '');
    const t = (q || '').toLowerCase();
    const hits = [];
    for (const a of ACTIONS) {
      let hit = false;
      if (a.phrases && a.phrases.some((p) => t.indexOf(p) !== -1)) hit = true;
      else if (a.need && a.need.every((n) => intents.has(n))) hit = true;
      if (hit && hits.indexOf(a) === -1) hits.push(a);
    }
    return hits;
  }

  let cfg = {
    enabled: false, apiKey: '', version: '', localModelEnabled: true, cloudEnhance: false,
    maxMode: false, cloudWebAnalyse: false,
    ttsEnabled: false, ttsVoice: 'female',
    provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, keys: {}, baseUrls: {}, rules: []
  };
  let fab, panel, logEl, inputEl, sendBtn, closeBtn;
  let history = [];
  let cloudFallback = false; // Max 模式云端失败后回退本地，避免下方云端块重复调用

  function el(id) { return document.getElementById(id); }

  function appendMsg(role, text, tag) {
    if (!logEl) return;
    const row = document.createElement('div');
    row.className = 'ai-msg ' + (role === 'user' ? 'ai-u' : 'ai-a');
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.textContent = text;
    if (tag) {
      const t = document.createElement('span');
      t.className = 'ai-tag';
      t.textContent = tag;
      bubble.appendChild(t);
    }
    row.appendChild(bubble);
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
    if (role === 'assistant' && tag !== '回退') speakTTS(text);
  }

  // ── 免费 TTS：微软 Edge 神经语音（与 Edge「大声朗读」同源）──────────────
  // 通过官方 WebSocket 端点合成 MP3 本地播放。仅暴露两个精挑音色，不暴露几十种中文神经音；
  // 免费、无需密钥、不上传内容至我们服务器（仅连微软官方合成端点）。
  // 仅在用户开启「AI 语音播报」时生效；失败静默，绝不回退到机械的 Web Speech 本地语音。
  const EDGE_TTS_TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  // Sec-MS-GEC-Version：微软会随 Chromium 更新而废弃旧版本号（过期即握手 403 无声）。
  // 跟随 rany2/edge-tts 上游当前有效值；若日后试听再次无声，优先来这里升级该版本号。
  const EDGE_TTS_GEC_VER = '1-143.0.3650.75';
  const EDGE_TTS_WS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
  const TTS_VOICES = {
    female: { id: 'zh-CN-XiaoxiaoNeural', label: '女生 · 晓晓（温柔自然）' },
    male:   { id: 'zh-CN-YunxiNeural',    label: '男生 · 云希（清亮自然）' }
  };
  // GEC 输入串（纯函数，便于测试）：Unix秒 + 11644473600 → 向下取整 300 秒窗口 → ×1e7（100ns ticks）
  function edgeTtsGecInput(nowSec) {
    let ticks = Math.floor(nowSec) + 11644473600;
    ticks -= ticks % 300;
    ticks *= 10000000;
    return String(ticks) + EDGE_TTS_TRUSTED;
  }
  // 生成标准 UUID4 的 32 位 hex（无连字符），与 rany2/edge-tts 的 ConnectionId 一致
  function edgeTtsConnId() {
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // 生成 Sec-MS-GEC 令牌（SHA-256，**必须大写**，与微软/rany2 一致；小写会被握手拒绝）
  async function edgeTtsGenGec() {
    const str = edgeTtsGecInput(Date.now() / 1000);
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    throw new Error('no crypto.subtle');
  }
  // 合成：返回 MP3 的 Blob URL（失败时 reject）。
  function edgeTtsSynthesize(text, voiceId) {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket === 'undefined') return reject(new Error('no WebSocket'));
      let ws = null;
      let cancelled = false;
      const timer = setTimeout(() => { cancelled = true; if (ws) try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, 30000);
      edgeTtsGenGec().then((gec) => {
        if (cancelled) return;
        const connId = edgeTtsConnId();
        const url = EDGE_TTS_WS + '?TrustedClientToken=' + EDGE_TTS_TRUSTED + '&ConnectionId=' + connId + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + EDGE_TTS_GEC_VER;
        try { ws = new WebSocket(url); } catch (e) { clearTimeout(timer); return reject(e); }
        ws.binaryType = 'arraybuffer';
        const uuid = '00000000-0000-0000-0000-000000000000';
        const date = new Date().toString();
        const chunks = [];
        let gotAudio = false;
        ws.onopen = () => {
          ws.send('X-Timestamp:' + date + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
          const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='" + voiceId + "'>" + safe + '</voice></speak>';
          ws.send('X-RequestId:' + uuid + '\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n' + ssml);
        };
        ws.onmessage = (ev) => {
          const d = ev.data;
          if (typeof d === 'string') {
            if (d.indexOf('Path:turn.end') !== -1) { ws.close(); return; }
            // 诊断：打印服务端返回的任何文本帧（含可能的错误 JSON），便于定位 1006/403 根因
            console.warn('[银狐] TTS 服务端帧：', d.slice(0, 300));
            return;
          }
          const b = new Uint8Array(d);
          const hl = (b[0] << 8) | b[1];
          const h = new TextDecoder().decode(b.slice(2, 2 + hl));
          const a = b.slice(2 + hl);
          if (h.indexOf('Path:audio') !== -1 && h.indexOf('metadata') === -1) { chunks.push(a); gotAudio = true; }
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('ws connect error (check network/CSP)')); };
        ws.onclose = (ev) => {
          clearTimeout(timer);
          if (gotAudio && chunks.length) {
            try { resolve(URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }))); } catch (e) { reject(e); }
          } else reject(new Error('no audio, ws close code=' + (ev && ev.code) + (ev && ev.reason ? ' (' + ev.reason + ')' : '')));
        };
      }).catch((e) => { clearTimeout(timer); reject(e); });
    });
  }
  // 播放 TTS：AI 回复时调用，朗读整段文本（女生/男生由设置决定）。
  function speakTTS(text) {
    if (!cfg.ttsEnabled) return;
    const t = String(text || '').trim();
    if (!t) return;
    if (/^（?无(返回内容|错误|结果|输出)/.test(t)) return;
    const key = (cfg.ttsVoice && TTS_VOICES[cfg.ttsVoice]) ? cfg.ttsVoice : 'female';
    const voiceId = TTS_VOICES[key].id;
    edgeTtsSynthesize(t, voiceId).then((url) => {
      try {
        const a = new Audio();
        a.src = url;
        a.play().catch(() => {});
        a.onended = () => { try { URL.revokeObjectURL(url); } catch (e) {} };
        a.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} };
      } catch (e) {}
    }).catch(() => {}); // 静默失败，绝不回退机械音
  }

  function setBusy(busy) {
    if (sendBtn) sendBtn.disabled = busy;
    if (inputEl) inputEl.disabled = busy;
    if (busy) {
      const row = document.createElement('div');
      row.className = 'ai-msg ai-a';
      row.id = 'aiTyping';
      const bubble = document.createElement('div');
      bubble.className = 'ai-bubble ai-typing';
      bubble.textContent = '思考中…';
      row.appendChild(bubble);
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      const t = el('aiTyping');
      if (t) t.remove();
    }
  }

  // 通用 set_setting 工具（Max 模式 tool-use）已在本文件上方 buildMaxTools() 定义，
  // 配套 SETTINGS_SCHEMA / applySetting 做本地硬校验，模型无任意代码执行权。

  async function callCloud(text, override) {
    const provider = (override && override.provider) || cfg.provider;
    const model = (override && override.model) || cfg.model;
    const mcfg = resolveModelCfg(provider, model);
    if (!mcfg.endpoint) throw new Error('自定义模型未配置 API 基址，请在「AI 设置」填写后重试。');
    if (!mcfg.key) throw new Error('未配置「' + mcfg.label + '」的 API Key，请在「AI 设置」填写后重试。');
    let sys = buildSystem(cfg.version);
    if (override && override.systemExtra) sys += '\n\n' + override.systemExtra;
    const messages = [{ role: 'system', content: sys }]
      .concat(history.slice(-12).map((m) => ({ role: m.role, content: m.content })));
    const body = { model: mcfg.model, messages: messages, max_tokens: 800, temperature: 0.5, stream: false };
    // Max 模式下带 tools，让模型可调用本地预定义的操作（白名单校验后执行）
    if (override && override.tools) {
      body.tools = override.tools;
      body.tool_choice = 'auto';
    }
    const resp = await fetch(mcfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mcfg.key },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      let msg = '请求失败（HTTP ' + resp.status + '）';
      try { const j = await resp.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
      if (resp.status === 429) msg = '云端模型调用频率超限（免费模型有每分钟额度）。';
      if (resp.status === 401) msg = 'API Key 无效或已失效，请在「AI 设置」检查密钥。';
      const err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    return {
      text: msg.content || '（无返回内容）',
      toolCalls: msg.tool_calls || null,        // OpenAI 兼容：tool_calls 数组
      tag: '云端·' + mcfg.model
    };
  }

  async function send() {
    const text = (inputEl && inputEl.value || '').trim();
    if (!text) return;
    cloudFallback = false;   // 每轮重置，避免上一轮的回退标记污染本轮
    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    inputEl.value = '';
    autoGrow();
    setBusy(true);
    const turnText = text;
    function finish(branch, extra) {
      learnFromTurn(turnText, Object.assign({ branch }, extra || {}));
    }

    // 0) 本地指令（可操作设置，绝对最高优先级）：无论本地引擎是否开启、是否 Max 模式，
    //    只要命中 ACTIONS 就立即本地执行并返回，绝不走云端（改设置类指令不应被云端/Max 接管）。
    //    支持一句话多个指令，识别「换成深色 / 字大点 / 开启防护 / 关闭防护」等。

    // 0.1) 本地「打开设置子页面」意图：无论是否 Max / 云端，只要用户说「打开/去/进入/切换到 XX页」，
    //      本地直接识别并跳转（不在设置页时新开标签页带 #sec 锚点），不依赖云端模型是否调工具。
    //      这是此前「AI 会说但不跳转」的根因修复点——云端模型未必稳定返回 open_subpage 工具调用。
    {
      const openIntent = /(打开|去|进入|切换到?|切到|转到|看看|前往|打开一下|帮我打开|帮我把|打开那个)/;
      if (openIntent.test(text)) {
        // 在文本里找页面别名（SUBPAGE_ALIAS 已含中文名与缩写）
        let hitSection = null;
        // 按别名长度降序匹配，避免「急救」先命中而漏掉「银狐急救」
        const aliasKeys = Object.keys(SUBPAGE_ALIAS).sort((a, b) => b.length - a.length);
        for (const k of aliasKeys) { if (text.indexOf(k) !== -1) { hitSection = SUBPAGE_ALIAS[k]; break; } }
        // 也兼容英文 id 直写（如 rescue / changelog）
        if (!hitSection) {
          const lower = text.toLowerCase();
          for (const id of Object.keys(SUBPAGE_MAP)) {
            if (new RegExp('\\b' + id + '\\b').test(lower)) { hitSection = id; break; }
          }
        }
        if (hitSection) {
          const r = openOptionsSection(hitSection);
          const label = (SUBPAGE_MAP[hitSection] && SUBPAGE_MAP[hitSection].label) || hitSection;
          if (r.ok) {
            appendMsg('assistant', '已为你打开「' + label + '」。', '本地·已操作');
          } else {
            appendMsg('assistant', (r.reason || '未能打开该页面') + '（可手动在扩展设置里查看）', '本地·已操作');
          }
          history.push({ role: 'assistant', content: '已为你打开「' + label + '」。' });
          setBusy(false);
          if (inputEl) inputEl.focus();
          finish('action', { action: 'open_subpage:' + hitSection, hit: true, solved: true });
          return;
        }
      }
    }

    {
      const acts = matchActions(text);
      if (acts.length) {
        const parts = [];
        for (const a of acts) {
          const res = a.run();
          if (res === 'pixel') parts.push('当前是 Pixel 隐藏主题，材质已锁定为磨砂玻璃，无法切换为琉声。');
          else if (res === false) parts.push('抱歉，没能找到对应的设置控件（可能当前页面版本不完整）。');
          else parts.push(a.done + (a.tip ? '\n' + a.tip : ''));
        }
        const reply = parts.join('\n\n');
        appendMsg('assistant', reply, '本地·已执行');
        history.push({ role: 'assistant', content: reply });
        setBusy(false);
        if (inputEl) inputEl.focus();
        finish('action', { action: acts.map((a) => a.id).join(','), hit: true, solved: true });
        return;
      }
    }

    // 0.5) Max 模式：本地指令未命中时优先调用云端模型辅助，并开放 tool-use 让模型直接操作设置。
    //      模型只能从白名单(ACTIONS)里选操作，本地校验后才执行——模型无任意代码执行权。
    //      云端处理不了再回退到下方本地规则与兜底。
    if (cfg.maxMode) {
      try {
        const scenario = classifyScenario(text);
        const rule = (cfg.rules || []).find((r) => r.scenario === scenario);
        const ovProvider = (rule && rule.provider) || cfg.provider;
        const ovModel = (rule && rule.model) || cfg.model;
        const ovCfg = resolveModelCfg(ovProvider, ovModel);
        if (!ovCfg.key) throw new Error('未配置「' + ovCfg.label + '」的可用 Key，无法在 Max 模式下调用云端');
        // 闲聊/问候类不挂工具，保证模型能正常文本聊天；
        // 仅当用户【命令式】要求改设置时才挂这组固定工具，避免把疑问/闲聊误当成操作去调工具。
        const looksCmd = /(开|关|启|停|换|设|调|改|切|增|减|打|帮我|恢复|默认|安静|深色|浅色|暖金|霓虹|雾灰|深空|像素|得意黑|磨砂|琉声|字号|灵敏度|防护|警告|横幅|拦截|通知|备案|语音|音色|主题|材质|字体|打开|白名单|关键词|危险域名|检测维度|维度)/.test(text);
        const useTools = scenario !== 'casual' && looksCmd;
        const ans = await callCloud(text, {
          provider: ovProvider, model: ovModel,
          tools: useTools ? buildFixedTools() : undefined,
          systemExtra: maxSettingsBlock()
        });
        const hasText = !!(ans.text && ans.text.trim() && !/^（?无(返回内容|错误|结果|输出)/.test(ans.text));
        // 解析模型返回的 tool_calls：按固定工具名分发到本地预定义的控件修改函数（本地白名单校验），模型无任意代码执行权
        const performed = [];
        let rejected = 0; const rejReasons = [];
        if (ans.toolCalls && ans.toolCalls.length) {
          for (const tc of ans.toolCalls) {
            const fname = tc.function && tc.function.name;
            let args = {};
            try { args = JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (e) { args = {}; }
            const res = dispatchFixedTool(fname, args);
            if (res.ok) performed.push(res.msg);
            else { rejected++; rejReasons.push(res.reason || ('「' + fname + '」执行失败')); }
          }
        }
        // 工具执行后，始终用模型自己生成的文本作为回复（AI 自己说话，不输出机械固定文案）。
        // 仅当「模型既无文本、工具也没执行任何事」时才视为异常，回退本地规则。
        if (hasText || performed.length || rejected) {
          let reply = '';
          if (hasText) reply += ans.text.trim();
          if (rejected) reply += (reply ? '\n\n' : '') + '（已忽略 ' + rejected + ' 个无效操作' + (rejReasons.length ? '：' + rejReasons.join('；') : '') + '）';
          reply = reply.trim();
          if (!reply) {
            // 极少数情况：模型既没说话、工具也没成功也没被拒 —— 给一句极简兜底，不写死"已为你打开"
            reply = '好的。';
          }
          appendMsg('assistant', reply, performed.length ? '云端·已操作' : (ans.tag || '云端·Max'));
          history.push({ role: 'assistant', content: reply });
          finish('cloud', { maxMode: true, provider: ovProvider, scenario: scenario, hit: false, cloud: true, cloudAction: performed.length > 0, answer: ans.text, solved: true });
          setBusy(false);
          if (inputEl) inputEl.focus();
          return;
        }
        cloudFallback = true;   // 云端既没说话也没操作，落到本地规则/兜底
      } catch (e) {
        // 云端处理不了 → 回退到下方本地规则与兜底；标记避免下方云端块重复调用
        cloudFallback = true;
        appendMsg('assistant', '（云端暂无法处理，已回退本地规则）' + (e && e.message ? '：' + e.message : ''), '回退');
      }
    }

    // 1) 关键词规则（0 延迟兜底，离线可用，评分式取最相关，避免答非所问）
    if (cfg.localModelEnabled) {
      const rule = localMatch(text);
      if (rule) {
        appendMsg('assistant', rule.answer, '本地');
        history.push({ role: 'assistant', content: rule.answer });
        setBusy(false);
        if (inputEl) inputEl.focus();
        finish('local', { scenario: rule.scenario, ruleId: rule.id, hit: true, solved: true });
        return;
      }
    }

    // 2) 云端模型兜底：
    //    - 内置免费模型（智谱 GLM，自带 Key）始终可用作兜底，不依赖「云端增强」开关；
    //    - 用户自带 Key 的模型，仅当「云端增强」开启时才允许调用（避免误耗额度）；
    //    - 选中了非免费的模型却没填 Key：给出明确报错（而不是含糊兜底）；
    //    - 其余情况回落到本地提示。
    const scenario = classifyScenario(text);
    const rule = (cfg.rules || []).find((r) => r.scenario === scenario);
    const ovProvider = (rule && rule.provider) || cfg.provider;
    const ovModel = (rule && rule.model) || cfg.model;
    const ovCfg = resolveModelCfg(ovProvider, ovModel);
    const hasUsableKey = !!ovCfg.key;             // 内置免费或已填 Key 均可
    const isFreeFallback = (ovProvider === 'zhipu'); // 智谱内置免费，随时可用
    if (hasUsableKey && (cfg.cloudEnhance || isFreeFallback) && !cloudFallback) {
      try {
        const ans = await callCloud(text, { provider: ovProvider, model: ovModel });
        const ansText = ans.text.trim();
        appendMsg('assistant', ansText, ans.tag);
        history.push({ role: 'assistant', content: ansText });
        let cloudAction = false;
        if (cfg.localModelEnabled) {
          const cActs = matchActions(ansText);
          if (cActs.length) {
            for (const a of cActs) { try { a.run(); } catch (e) {} }
            cloudAction = true;
          }
        }
        cloudFallback = false;
        finish('cloud', { provider: ovProvider, scenario: scenario, hit: false, cloud: true, cloudAction: cloudAction, answer: ansText, solved: true });
      } catch (e) {
        const emsg = e && e.message ? e.message : '网络请求出错，请稍后再试。';
        appendMsg('assistant', emsg);
        history.push({ role: 'assistant', content: emsg });
        cloudFallback = false;
        finish('cloud', { provider: ovProvider, scenario: scenario, hit: false, cloud: true, answer: emsg, solved: false });
      } finally {
        setBusy(false);
        if (inputEl) inputEl.focus();
      }
      return;
    }
    // 选中了非免费模型但没填 Key：明确提示，而非含糊的本地兜底
    if (!hasUsableKey && !isFreeFallback) {
      const msg = '未配置「' + ovCfg.label + '」的 API Key，请在「AI 设置」填写后重试。'
        + (cfg.cloudEnhance ? '' : '（当前未开启「云端增强」，自带 Key 的模型也不会调用。）');
      appendMsg('assistant', msg);
      history.push({ role: 'assistant', content: msg });
      setBusy(false);
      if (inputEl) inputEl.focus();
      finish('nokey', { provider: ovProvider, scenario: scenario, hit: false, solved: false });
      return;
    }

    // 3) 都没命中 → 智能兜底：根据输入推测意图，给出可操作的方向（而不是生硬甩锅）
    const tips = [];
    if (/深|浅|主题|配色|材质|琉声|字体|字号|背景/.test(text)) tips.push('想直接改外观？说「换成深色 / 暖金主题 / 字号大一点 / 用琉声材质」这类指令，我马上帮你改');
    if (/防护|拦截|警告|横幅|开关|启用/.test(text)) tips.push('想改防护设置？说「开启防护 / 关闭警告横幅 / 开启下载拦截」即可');
    if (/误报|白名单|举报|急救|360|中招|安全|病毒/.test(text)) tips.push('误报、白名单、急救箱等用法，可以直接问我「误报了怎么办」「怎么举报」「怎么急救」');
    const fallback = '没太听懂你的意思～我目前是本地规则引擎（不上云、不分析网页），擅长两件事：\n• 直接改设置：说「换成深色 / 暖金主题 / 字号大一点 / 开启防护 / 用琉声材质」\n• 解答用法：说「怎么换主题 / 字号怎么调 / 误报了怎么办 / 检测原理是什么」' +
      (tips.length ? '\n\n' + tips.join('\n') : '') +
      '\n\n如果想更自由地聊天问答，可在「AI 设置」里打开「允许云端 GLM 增强」（免费模型，有每分钟额度）。';
    appendMsg('assistant', fallback, '提示');
    history.push({ role: 'assistant', content: '（未配置可用模型）' });
    setBusy(false);
    if (inputEl) inputEl.focus();
    finish('fallback', { scenario: scenario, hit: false, solved: false });
  }

  function autoGrow() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  // 语音输入：用浏览器原生 Web Speech API 做语音转文字（零配置、支持中文）。
  // 不支持的浏览器（如 Firefox）自动隐藏麦克风按钮；识别中按钮高亮，结果追加进输入框。
  function setupVoiceInput() {
    const mic = el('aiMic');
    if (!mic || !inputEl) return;
    const SR = (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition));
    if (!SR) { mic.hidden = true; return; }   // 环境不支持则隐藏按钮
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    let listening = false;
    let finalText = '';
    function setListening(on) {
      listening = on;
      mic.classList.toggle('is-recording', on);
      mic.title = on ? '正在聆听…再次点击停止' : '语音输入（Web Speech API）';
    }
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      inputEl.value = (finalText + interim).trim();
      autoGrow();
    };
    rec.onerror = (e) => {
      if (e && e.error === 'not-allowed') {
        appendMsg('assistant', '麦克风权限被拒绝，无法使用语音输入。可在浏览器站点设置里允许麦克风后重试。', '提示');
      }
      setListening(false);
    };
    rec.onend = () => {
      if (listening) { setListening(false); rec.start(); }   // 持续监听直到用户再次点击停止
    };
    mic.onclick = (e) => {
      e.stopPropagation();
      if (!listening) {
        finalText = inputEl.value ? inputEl.value + ' ' : '';
        try { rec.start(); setListening(true); }
        catch (err) { /* 已在聆听中，忽略 */ }
      } else {
        rec.stop();
        setListening(false);
        if (inputEl.value.trim()) inputEl.focus();
      }
    };
  }

  function RM() { return document.documentElement.classList.contains('reduce-motion'); }
  // 用单一监听器管理面板的开合动画结束，避免快速连点时多个 animationend 互相干扰
  function attachPanelEnd(cb) {
    if (!panel) return;
    if (panel._sfEnd) panel.removeEventListener('animationend', panel._sfEnd);
    panel._sfEnd = (e) => {
      if (e.target !== panel) return;   // 只认面板自身的动画，忽略子元素冒泡
      panel.removeEventListener('animationend', panel._sfEnd);
      panel._sfEnd = null;
      cb();
    };
    panel.addEventListener('animationend', panel._sfEnd);
  }

  function openPanel() {
    if (!panel || !fab) return;
    // eslint-disable-next-line no-console
    console.log('[SF AI] openPanel');
    fab.dataset.open = '1';
    if (logEl && !logEl.children.length) {
      appendMsg('assistant', '你好，我是银狐小助。关于扩展的设置、主题、字号、检测开关等用法，都可以问我～\n\n我还能直接帮你改设置，比如「换成深色」「字号大一点」「开启防护」「用得意黑字体」，直接说就行。', '本地');
    }
    if (RM()) { panel.hidden = false; fab.hidden = true; if (inputEl) inputEl.focus(); return; }
    // 非线性形变：球缩没 + 窗口从球位置"长大"出来（圆角由圆变方、带过冲）
    panel.hidden = false;
    fab.hidden = false;                 // 先留在 DOM 里播放缩没动画
    fab.classList.add('is-morphing');
    panel.classList.remove('is-closing');
    void panel.offsetWidth;            // 强制回流，确保动画重放
    panel.classList.add('is-morphing');
    attachPanelEnd(() => {
      fab.hidden = true;               // 动画结束后真正移出布局
      fab.classList.remove('is-morphing');
    });
    if (inputEl) inputEl.focus();
  }
  function closePanel() {
    if (!panel || !fab) return;
    // eslint-disable-next-line no-console
    console.log('[SF AI] closePanel');
    delete fab.dataset.open;
    if (RM()) { panel.hidden = true; fab.hidden = !cfg.enabled; return; }
    // 非线性形变：窗口缩回成球 + 球弹回
    fab.hidden = false;
    panel.classList.remove('is-morphing');
    void panel.offsetWidth;
    panel.classList.add('is-closing');
    fab.classList.remove('is-morphing');
    fab.classList.add('is-morphing-back');
    attachPanelEnd(() => {
      panel.hidden = true;
      panel.classList.remove('is-closing');
      fab.classList.remove('is-morphing-back');
      // 收起后：仅当 AI 仍启用才把悬浮球留回来；关闭总开关时由 setVisible 保持隐藏
      fab.hidden = !cfg.enabled;
    });
  }
  function setVisible(on) {
    cfg.enabled = !!on;   // 同步总开关状态，供 closePanel 判断 fab 是否恢复
    if (fab) fab.hidden = !on;
    if (!on && panel && !panel.hidden) closePanel();
  }

  async function init(options) {
    cfg = Object.assign(cfg, options || {});
    fab = el('aiFab');
    panel = el('aiPanel');
    logEl = el('aiLog');
    inputEl = el('aiInput');
    sendBtn = el('aiSend');
    closeBtn = el('aiClose');

    // eslint-disable-next-line no-console
    console.log('[SF AI] init', { enabled: cfg.enabled, hasFab: !!fab, hasPanel: !!panel, hasClose: !!closeBtn });

    if (!fab || !panel) return;
    fab.hidden = !cfg.enabled;

    // 悬浮球点击：打开面板（onclick 单一绑定，避免重复 init 叠加监听；stopPropagation 防全局关闭监听误关）
    fab.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      openPanel();
    };

    // 关闭按钮：onclick 单一绑定（stopPropagation 阻止冒泡到 document 全局关闭监听）
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e && e.stopPropagation();
        // eslint-disable-next-line no-console
        console.log('[SF AI] close triggered');
        closePanel();
      };
    }
    if (sendBtn) sendBtn.onclick = send;

    // 语音输入：Web Speech API（浏览器原生、零配置、支持中文）；不支持时按钮自动隐藏
    setupVoiceInput();

    // 点击面板外部收起：用 setOpen 状态标志判定，避免同一次点击链误关
    // 打开后延迟一帧再开启外部关闭监听，确保本次打开点击不会立即触发关闭
    let outsideCloseArmed = false;
    function armOutsideClose() {
      // 下一拍才武装：跳过打开瞬间的冒泡点击
      setTimeout(() => { outsideCloseArmed = true; }, 0);
    }
    function disarmOutsideClose() { outsideCloseArmed = false; }

    document.addEventListener('click', (e) => {
      if (!outsideCloseArmed) return;
      if (panel.hidden) { disarmOutsideClose(); return; }
      if (panel.contains(e.target)) return;
      if (e.target === fab || (fab && fab.contains(e.target))) return;
      closePanel();
      disarmOutsideClose();
    });
    // 打开面板时武装外部关闭；关闭时解除
    const _open = openPanel;
    openPanel = function () { _open(); armOutsideClose(); };
    const _close = closePanel;
    closePanel = function () { _close(); disarmOutsideClose(); };

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel && !panel.hidden) closePanel(); });

    // 同步最新 open/close（含外部关闭武装逻辑）到导出对象
    if (window.SilverFoxAI) { window.SilverFoxAI.open = openPanel; window.SilverFoxAI.close = closePanel; }

    if (inputEl) {
      inputEl.addEventListener('input', autoGrow);
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
    }

    // 加载本地自学习数据（完全离线，不上云）
    await loadLearnData();
  }

  // 实时同步设置变更（切换 provider / model / keys / cloudEnhance 后由设置页调用），
  // 避免 AI 悬浮球内 cfg 停留在初始值导致「切换别家仍是免费模型」。
  function setConfig(patch) {
    if (!patch) return;
    cfg = Object.assign(cfg, patch);
    // 同步「分析当前网页」按钮显隐（Max + 子开关）
    if (window.SilverFoxAI && window.SilverFoxAI._syncAnalyzeBtn) window.SilverFoxAI._syncAnalyzeBtn();
  }

  window.SilverFoxAI = {
    init: init, setConfig: setConfig, setVisible: setVisible, open: openPanel, close: closePanel,
    _schema: SETTINGS_SCHEMA, _validateSetting: validateSetting, _applySetting: applySetting, _getSettingsSnapshot: getSettingsSnapshot,
    _fixedTools: FIXED_TOOLS, _dispatchFixedTool: dispatchFixedTool, _openOptionsSection: openOptionsSection, _buildFixedTools: buildFixedTools,
    // 供设置页试听 / 外部调用：合成文本并返回 MP3 Blob URL（voiceKey: 'female' | 'male'）
    synthesize: function (text, voiceKey) {
      const key = (voiceKey && TTS_VOICES[voiceKey]) ? voiceKey : 'female';
      return edgeTtsSynthesize(text, TTS_VOICES[key].id);
    },
    previewTTS: function (voiceKey) {
      return window.SilverFoxAI.synthesize('这是银狐防护 AI 语音播报的试听示例，你可以选择喜欢的音色。', voiceKey);
    },
    _gecInput: edgeTtsGecInput
  };
})();
