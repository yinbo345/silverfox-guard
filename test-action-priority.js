// 集成测试：方案 B — Max 模式下云端模型通过 tool-use 操作设置（白名单校验 + 本地执行）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const OPT_HTML = fs.readFileSync(path.join(__dirname, 'ui/options.html'), 'utf8');
const AI_JS = fs.readFileSync(path.join(__dirname, 'ui/ai.js'), 'utf8');

// stub fetch：根据场景返回不同云端响应
let fetchMode = 'none';
let fetchCount = 0;
function fakeFetch(url, opts) {
  fetchCount++;
  const body = JSON.parse(opts.body || '{}');
  let payload;
  if (fetchMode === 'toolcall') {
    payload = { choices: [{ message: { content: '好的，已为你关闭警告与通知。', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'action__offWarn', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'action__offNotify', arguments: '{}' } }
    ] } }] };
  } else if (fetchMode === 'evil') {
    payload = { choices: [{ message: { content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'action__deleteEverything', arguments: '{}' } }
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
  assert('找到 showWarning / notify 控件', !!warn && !!notify);

  // 场景1：Max + 复合意图「帮我安静点」→ 模型 toolcall offWarn+offNotify → 本地执行
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  warn.checked = true; notify.checked = true;
  fetchMode = 'toolcall';
  input.value = '帮我安静点';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+复合意图：showWarning 被关', warn.checked === false);
  assert('Max+复合意图：notify 被关', notify.checked === false);

  // 场景2：Max + 模型试图越权（白名单外工具）→ 必须拒绝、不执行任何破坏性操作
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  const guardBefore = window.document.getElementById('enabledGlobal');
  guardBefore.checked = true;
  fetchMode = 'evil';
  input.value = '随便说点什么';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+越权工具：enabledGlobal 未被改动（拒绝执行）', guardBefore.checked === true);

  // 场景3：Max + 纯问答 → 模型返回文本、不调工具
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  fetchMode = 'text';
  input.value = '银狐木马是什么';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+纯问答：未误关任何设置', warn.checked === false && notify.checked === false && guardBefore.checked === true);

  // 场景4：明确死词「关闭防护」在 Max 下仍走第0步本地、不调云端（回归）
  sf.setConfig({ maxMode: true, localModelEnabled: false, cloudEnhance: false, enabledGlobal: true });
  const g2 = window.document.getElementById('enabledGlobal'); g2.checked = true;
  fetchMode = 'none';
  fetchCount = 0;
  input.value = '关闭防护';
  sendBtn.dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  assert('Max+死词关闭防护：防护被关（本地第0步）', g2.checked === false);
  assert('Max+死词关闭防护：未调用云端 fetch（第0步截胡）', fetchCount === 0);

  console.log(all ? '\nALL PASS ✅' : '\nSOME FAIL ❌');
  process.exit(all ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e.message, e.stack); process.exit(2); });
