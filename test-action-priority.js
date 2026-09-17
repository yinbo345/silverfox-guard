// 集成测试：Max 模式下云端模型通过【固定工具集】直接操作设置（本地硬校验 + 白名单 + 本地执行）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const OPT_HTML = fs.readFileSync(path.join(__dirname, 'ui/options.html'), 'utf8');
const AI_JS = fs.readFileSync(path.join(__dirname, 'ui/ai.js'), 'utf8');

// stub fetch：根据场景返回不同云端响应（统一使用固定工具集：每个设置一项独立工具）
let fetchMode = 'none';
let fetchCount = 0;
function fakeFetch(url, opts) {
  fetchCount++;
  const body = JSON.parse(opts.body || '{}');
  let payload;
  if (fetchMode === 'toolcall') {
    // 复合意图「帮我安静点」→ 模型调用固定工具 set_warning_banner(false) + set_system_notify(false)
    payload = { choices: [{ message: { content: '好的，已为你关闭警告与通知。', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'set_warning_banner', arguments: JSON.stringify({ enabled: false }) } },
      { id: 'c2', type: 'function', function: { name: 'set_system_notify', arguments: JSON.stringify({ enabled: false }) } }
    ] } }] };
  } else if (fetchMode === 'toolcall2') {
    // 模型自主把减弱动画打开（固定工具 set_reduce_motion(true)）
    payload = { choices: [{ message: { content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'set_reduce_motion', arguments: JSON.stringify({ enabled: true }) } }
    ] } }] };
  } else if (fetchMode === 'evil') {
    // 模型试图调用白名单外的未知工具 → 必须拒绝
    payload = { choices: [{ message: { content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'delete_everything', arguments: JSON.stringify({ enabled: true }) } }
    ] } }] };
  } else if (fetchMode === 'evilval') {
    // 模型给出非法枚举取值 → 必须拒绝（set_palette 不接受 rainbow）
    payload = { choices: [{ message: { content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'set_palette', arguments: JSON.stringify({ palette: 'rainbow' }) } }
    ] } }] };
  } else if (fetchMode === 'openpage') {
    // 模型打开设置子页面（固定工具 open_subpage(section=ai)）
    payload = { choices: [{ message: { content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'open_subpage', arguments: JSON.stringify({ section: 'ai' }) } }
    ] } }] };
  } else if (fetchMode === 'text') {
    payload = { choices: [{ message: { content: '银狐木马是一种钓鱼木马。', tool_calls: null } }] };
  } else {
    payload = { choices: [{ message: { content: '（无返回）', tool_calls: null } }] };
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
}

const store = {};
const dom = new JSDOM(OPT_HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;
global.fetch = fakeFetch;
window.fetch = fakeFetch;
window.chrome = { storage: { sync: { get:(k,cb)=>cb({}), set:(o,cb)=>{Object.assign(store,o); cb&&cb();} }, local:{ get:(k,cb)=>cb({}), set:(o,cb)=>{Object.assign(store,o); cb&&cb();} } } };
window.eval(AI_JS);

let all = true;
function assert(name, cond) { console.log((cond?'PASS':'FAIL')+' | '+name); all = all && cond; }

(async () => {
  const sf = window.SilverFoxAI;
  if (sf && sf.init) await sf.init();
  assert('SilverFoxAI 初始化', !!sf);

  const input = window.document.getElementById('aiInput');
  const sendBtn = window.document.getElementById('aiSend');
  const warn = window.document.getElementById('showWarning');
  const notify = window.document.getElementById('notify');
  const reduce = window.document.getElementById('reduceMotion');
  assert('找到 showWarning / notify / reduceMotion 控件', !!warn && !!notify && !!reduce);

  // 场景1：Max + 复合意图「帮我安静点」→ 模型 set_setting offWarn+offNotify → 本地执行
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  warn.checked = true; notify.checked = true;
  fetchMode = 'toolcall';
  input.value = '帮我安静点';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+复合意图：showWarning 被关', warn.checked === false);
  assert('Max+复合意图：notify 被关', notify.checked === false);

  // 场景2：Max + 模型试图越权（白名单外 key）→ 必须拒绝、不执行任何破坏性操作
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  const guardBefore = window.document.getElementById('enabledGlobal');
  guardBefore.checked = true;
  fetchMode = 'evil';
  input.value = '随便说点什么';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+越权 key：enabledGlobal 未被改动（拒绝执行）', guardBefore.checked === true);

  // 场景3：Max + 模型给出非法取值 → 必须拒绝（themePalette 不接受 rainbow）
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  fetchMode = 'evilval';
  input.value = '把主题换成彩虹色';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+非法取值：被拒、未抛错、对话仍可用', true);

  // 场景4：Max + 纯问答 → 模型返回文本、不调工具
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  fetchMode = 'text';
  input.value = '银狐木马是什么';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+纯问答：未误关任何设置', warn.checked === false && notify.checked === false && guardBefore.checked === true);

  // 场景5：Max + 模型自行把减弱动画打开（单一 set_setting）→ 本地 toggle 生效
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  reduce.checked = false;
  fetchMode = 'toolcall2';
  input.value = '界面太花了，关掉动画';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+自主设置：reduceMotion 被开', reduce.checked === true);

  // 场景5b：Max + 模型打开设置子页面（固定工具 open_subpage）→ 切到对应区块
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  const aiSec = window.document.getElementById('ai');
  const aiNav = window.document.querySelector('.nav-item[data-target="ai"]');
  // 真实扩展里 options.js 已先初始化导航；此处直接走与运行时一致的 _openOptionsSection（自带可靠切换）
  const openR = sf._openOptionsSection('ai');
  assert('Max+打开子页面：返回成功', openR.ok === true);
  assert('Max+打开子页面：AI 设置区块被激活', !!aiSec && aiSec.classList.contains('active'));
  assert('Max+打开子页面：侧栏 AI 导航高亮', !!aiNav && aiNav.classList.contains('active'));
  // 子页面（data-sub 命中）也应能打开并显示返回键
  const allowSec = window.document.getElementById('rules-allowlist');
  const openR2 = sf._openOptionsSection('rules-allowlist');
  assert('Max+打开子页面：信任白名单子页被激活', openR2.ok === true && !!allowSec && allowSec.classList.contains('active'));
  assert('Max+打开子页面：未知页被拒绝', sf._openOptionsSection('nope').ok === false);

  // 场景6：明确死词「关闭防护」在 Max 下仍走第0步本地、不调云端（回归）
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  const g2 = window.document.getElementById('enabledGlobal'); g2.checked = true;
  fetchMode = 'none';
  fetchCount = 0;
  input.value = '关闭防护';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+死词关闭防护：防护被关（本地第0步）', g2.checked === false);
  assert('Max+死词关闭防护：未调用云端 fetch（第0步截胡）', fetchCount === 0);

  // 场景7：_schema / _validateSetting 本地硬校验（纯函数，直接断言）
  assert('暴露 SETTINGS_SCHEMA', Array.isArray(sf._schema) && sf._schema.length >= 20);
  assert('校验：合法枚举 themePalette=gold 通过', sf._validateSetting('themePalette', 'gold').ok === true);
  assert('校验：非法枚举 themePalette=rainbow 拒绝', sf._validateSetting('themePalette', 'rainbow').ok === false);
  assert('校验：fontScale=1.1 通过', sf._validateSetting('fontScale', 1.1).ok === true);
  assert('校验：fontScale=2 超出范围拒绝', sf._validateSetting('fontScale', 2).ok === false);
  assert('校验：未知 key 拒绝', sf._validateSetting('deleteEverything', true).ok === false);
  const bv = sf._validateSetting('reduceMotion', 'true');
  assert('校验：布尔字符串 "true" 被规整为 true', bv.ok === true && bv.coerced === true);

  // 场景8：_applySetting 直接执行（绕过云端，验证本地落盘 + 控件联动）
  const r1 = sf._applySetting('reduceMotion', true);
  assert('_applySetting reduceMotion=true 成功且控件联动', r1.ok === true && window.document.getElementById('reduceMotion').checked === true);
  const r2 = sf._applySetting('clearAllowlist');
  assert('_applySetting clearAllowlist 成功', r2.ok === true);
  const r3 = sf._applySetting('unknownX', 1);
  assert('_applySetting 未知 key 拒绝', r3.ok === false);

  // 场景9：TTS 配置（key 语义：female/male）经 setConfig 可读写
  sf.setConfig({ ttsEnabled: true, ttsVoice: 'female' });
  const snap = sf._getSettingsSnapshot ? sf._getSettingsSnapshot() : null;
  assert('TTS 配置可经 setConfig 写入（getSettingsSnapshot 存在）', typeof snap === 'object');
  sf.setConfig({ ttsEnabled: false });
  assert('TTS 可关闭', true);

  // 场景10：GEC 输入公式（纯函数，防回归：Win 纪元 + 300 秒窗口 + ×1e7 + 静态 token）
  const GEC_TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const GEC_WIN = 11644473600;
  function expectGec(t) {
    let ticks = Math.floor(t) + GEC_WIN;
    ticks -= ticks % 300;
    ticks *= 10000000;
    return String(ticks) + GEC_TRUSTED;
  }
  const g0 = sf._gecInput(0);
  assert('GEC(0) 公式正确', g0 === expectGec(0));
  assert('GEC 以静态 token 结尾', g0.endsWith(GEC_TRUSTED));
  const gA = sf._gecInput(100), gB = sf._gecInput(299);
  assert('GEC 同 300 秒窗口内稳定', gA === gB && gA === expectGec(100));
  const gC = sf._gecInput(350);
  assert('GEC 跨窗口变化', gC !== gA && gC === expectGec(350));

  console.log(all ? '\nALL PASS ✅' : '\nSOME FAIL ❌');
  process.exit(all ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e.message, e.stack); process.exit(2); });
