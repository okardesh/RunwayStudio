const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-debug-'));
const storage = new Map();
global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
global.crypto ||= require('node:crypto').webcrypto;
let activity = async () => ({ success: true, log: 'Done' });
global.window = { electronAPI: { executeActivity: (...args) => activity(...args) } };
const node = (id, activityId = 'get-text', properties = {}, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
const variable = (name, defaultValue = '', type = 'String') => ({ id: name, name, defaultValue, type, scope: 'Main' });
async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/engine/executor';export * from './src/store/debugStore';export * from './src/engine/watchExpressions';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  const { executeWorkflow, resumeDebug, requestStop, useDebugStore: debug, evaluateWatchExpression: evaluate, debugValue } = require(path.join(out, 'engine.cjs'));
  const run = (nodes, variables = [], options = {}) => executeWorkflow(nodes, [], variables, () => {}, () => {}, () => {}, { debug: true, projectName: 'Debug fixture', ...options });
  let passed = 0; const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
  await test('Watch grammar reads variables, members, arrays, JSON properties and primitive types', async () => {
    const context = { textResult: ' Esra ', items: [{ amount: 42 }], count: 0, valid: false, empty: null };
    for (const [expression, expected] of [['textResult', ' Esra '], ['{{textResult}}.Length', 6], ['textResult.Trim().ToUpper()', 'ESRA'], ['items[0].amount', 42], ['items.Count', 1], ['items[0]["amount"]', 42], ['count', 0], ['valid', false], ['empty', null]]) assert.equal(evaluate(expression, context).value, expected, expression);
    assert.match(evaluate('missing', context).error, /Not in scope/); assert.match(evaluate('empty.Length', context).error, /null/);
  });
  await test('Watches reject assignments, arbitrary calls, inherited properties and getters', async () => {
    let touched = 0; const object = { get unsafe() { touched++; return 'bad'; }, toString() { touched++; return 'bad'; } }; const context = { count: 0, object };
    for (const expression of ['count = 7', 'object.toString()', 'object.ToString()', 'object.unsafe', 'object.constructor', 'object.__proto__', 'fetch("x")']) assert.ok(evaluate(expression, context).error, expression);
    debugValue(object); assert.equal(touched, 0); assert.equal(context.count, 0);
  });
  await test('Get Text outputs are live before a breakpoint; watches can be added while paused', async () => {
    debug.getState().addWatch('textResult'); activity = async () => ({ success: true, log: 'Read', outputs: { textResult: 'Esra', total: 42, valid: false } });
    let pauses = 0;
    assert.equal(await run([node('Get Text'), node('Log Message', 'log-message')], [variable('textResult')], { hasBreakpoint: id => id === 'Log Message', onPause: () => {
      pauses++; const s = debug.getState(); assert.equal(s.phase, 'paused'); assert.equal(s.locals.find(v => v.name === 'textResult').detail, 'Esra'); assert.equal(s.locals.find(v => v.name === 'total').type, 'Number'); assert.equal(s.locals.find(v => v.name === 'valid').detail, 'false'); assert.equal(s.locals.find(v => v.name === 'textResult').changedBy, 'Get Text'); assert.equal(s.locals.find(v => v.name === 'textResult').changed, true);
      debug.getState().addWatch('textResult.Length'); assert.equal(debug.getState().results.find(r => r.expression === 'textResult.Length').value.detail, '4'); resumeDebug('continue');
    } }), 'completed'); assert.equal(pauses, 1); assert.equal(debug.getState().phase, 'completed');
  });
  await test('Step Into stops before the next activity with refreshed values', async () => {
    activity = async (_id, props) => ({ success: true, log: 'Assigned', outputs: { textResult: props.value || 'first' } }); const seen = [];
    assert.equal(await run([node('first', 'assign', { value: 'one' }), node('second', 'assign', { value: 'two' }), node('third', 'log-message')], [variable('textResult')], { hasBreakpoint: id => id === 'second', onPause: id => { seen.push([id, debug.getState().locals.find(v => v.name === 'textResult').detail]); resumeDebug(seen.length === 1 ? 'step-into' : 'continue'); } }), 'completed');
    assert.deepEqual(seen, [['second', 'one'], ['third', 'two']]);
  });
  await test('Step Over executes a container and pauses with its child outputs', async () => {
    activity = async () => ({ success: true, log: 'Assigned', outputs: { textResult: 'from child' } }); const seen = [];
    const nodes = [node('container', 'sequence', {}, { isContainer: true, childIds: ['child'] }), node('child', 'assign', {}, { parentId: 'container' }), node('after', 'log-message')];
    assert.equal(await run(nodes, [variable('textResult', 'before')], { hasBreakpoint: id => id === 'container', onPause: id => { seen.push([id, debug.getState().locals.find(v => v.name === 'textResult').detail]); resumeDebug(seen.length === 1 ? 'step-over' : 'continue'); } }), 'completed');
    assert.deepEqual(seen, [['container', 'before'], ['after', 'from child']]);
  });
  await test('Collection snapshots stay immutable and capture in-place mutations', async () => {
    let first;
    const nodes = [node('create', 'create-list', { output: 'items' }), node('add', 'add-to-collection', { collection: 'items', value: 'one' }), node('inspect', 'log-message')];
    await run(nodes, [], { hasBreakpoint: id => ['add', 'inspect'].includes(id), onPause: id => { const row = debug.getState().locals.find(v => v.name === 'items'); if (id === 'add') first = row; else { assert.match(row.detail, /one/); assert.equal(row.changedBy, 'add'); } resumeDebug('continue'); } });
    assert.equal(first.detail, '[]');
  });
  await test('Loop locals are scoped to their loop and disappear afterward', async () => {
    debug.getState().addWatch('item'); const seen = []; activity = async () => ({ success: true, log: 'Done' });
    const nodes = [node('Invoice loop', 'for-each', { collection: '["one","two"]' }, { isContainer: true, childIds: ['child'], loopVariable: { name: 'item', type: 'String' } }), node('child', 'log-message', {}, { parentId: 'Invoice loop' })];
    assert.equal(await run(nodes, [], { hasBreakpoint: id => id === 'child', onPause: () => { const row = debug.getState().locals.find(v => v.name === 'item'); seen.push(row.detail); assert.equal(row.scope, 'Invoice loop'); resumeDebug('continue'); } }), 'completed');
    assert.deepEqual(seen, ['one', 'two']); assert.ok(!debug.getState().locals.some(v => v.name === 'item')); assert.match(debug.getState().results.find(r => r.expression === 'item').error, /Not in scope/);
  });
  await test('Shadowed globals regain their value and scope after a loop', async () => {
    const nodes = [node('loop', 'for-each', { collection: '["local"]' }, { isContainer: true, childIds: ['body'], loopVariable: { name: 'item', type: 'String' } }), node('body', 'log-message', {}, { parentId: 'loop' })];
    await run(nodes, [variable('item', 'global')]); const row = debug.getState().locals.find(v => v.name === 'item'); assert.equal(row.detail, 'global'); assert.equal(row.scope, 'Main');
  });
  await test('Stop unblocks a synchronous pause and retains the last debug snapshot', async () => {
    let calls = 0; activity = async () => { calls++; return { success: true, log: 'Unexpected' }; };
    assert.equal(await run([node('paused')], [variable('textResult', 'before')], { hasBreakpoint: () => true, onPause: requestStop }), 'stopped'); assert.equal(calls, 0); assert.equal(debug.getState().phase, 'stopped'); assert.equal(debug.getState().locals[0].detail, 'before');
  });
  await test('Error sessions expose their last values and regular Run clears stale debug data', async () => {
    activity = async () => ({ success: false, log: 'Expected failure' }); assert.equal(await run([node('error')], [variable('value', 'last')]), 'error'); assert.equal(debug.getState().phase, 'error'); assert.equal(debug.getState().locals[0].detail, 'last');
    activity = async () => ({ success: true, log: 'Done' }); await run([node('normal')], [], { debug: false }); assert.equal(debug.getState().phase, 'idle'); assert.equal(debug.getState().locals.length, 0);
  });
  await test('Known credentials are masked in locals and watches', async () => {
    debug.getState().addWatch('apiToken'); debug.getState().addWatch('response.password');
    activity = async () => ({ success: true, log: 'Read', outputs: { response: { password: 'hidden-value', status: 'OK' }, apiToken: 'secret-value' } });
    await run([node('read')], [variable('apiToken', 'secret-value')]); const s = debug.getState(); assert.equal(s.locals.find(v => v.name === 'apiToken').redacted, true); assert.ok(!s.locals.find(v => v.name === 'response').detail.includes('hidden-value')); assert.equal(s.results.find(r => r.expression === 'response.password').value.redacted, true);
  });
  await test('Large previews are bounded but watches evaluate full values', async () => {
    debug.getState().addWatch('longText.Length'); activity = async () => ({ success: true, log: 'Read', outputs: { longText: 'x'.repeat(9000) } }); await run([node('read')]);
    assert.equal(debug.getState().locals.find(v => v.name === 'longText').truncated, true); assert.equal(debug.getState().results.find(r => r.expression === 'longText.Length').value.detail, '9000');
  });
  await test('Only watch expressions persist; finished sessions release the evaluator', async () => {
    const saved = JSON.parse(storage.get('runway.studio.watch-expressions.v1')); assert.ok(saved.every(v => typeof v === 'string')); assert.ok(!storage.get('runway.studio.watch-expressions.v1').includes('secret-value'));
    debug.getState().addWatch('afterFinish'); assert.match(debug.getState().results.find(r => r.expression === 'afterFinish').error, /Start a Debug/); debug.getState().removeWatch('afterFinish'); assert.ok(!debug.getState().watches.includes('afterFinish'));
  });
  await test('Watch persistence failure keeps the current session usable', async () => {
    const original = localStorage.setItem; localStorage.setItem = () => { throw Error('Quota'); }; try { debug.getState().addWatch('sessionOnly'); assert.match(debug.getState().storageWarning, /session/); } finally { localStorage.setItem = original; }
  });
  await realBrowserTest(run, debug);
  console.log(passed + ' debugger scenarios passed, plus real browser Get Text');
  await uiTest(); console.log('Artifacts: ' + out);
}

async function realBrowserTest(run, debug) {
  await esbuild.build({ entryPoints: [path.join(root, 'electron/automation/browser.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['playwright-core'], outfile: path.join(out, 'browser.cjs') });
  const p = path.join(out, 'browser.cjs'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
  const { runBrowserActivity } = require(p); fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><meta charset="utf-8"><div id="value">Live İstanbul 42</div>');
  try {
    assert.equal((await runBrowserActivity('open-browser', { url: pathToFileURL(path.join(out, 'fixture.html')).href, headless: true })).success, true);
    activity = async (id, props) => id === 'log-message' ? { success: true, log: props.message } : runBrowserActivity(id, props);
    let checked = false; assert.equal(await run([node('Read text', 'get-text', { selector: '#value', output: 'textResult' }), node('Log text', 'log-message', { message: 'textResult' })], [variable('textResult')], { hasBreakpoint: id => id === 'Log text', onPause: () => { assert.equal(debug.getState().locals.find(v => v.name === 'textResult').detail, 'Live İstanbul 42'); checked = true; require(path.join(out, 'engine.cjs')).resumeDebug('continue'); } }), 'completed'); assert.equal(checked, true);
    console.log('PASS Real browser Get Text updates locals before the next breakpoint');
  } finally { await runBrowserActivity('close-browser', {}); }
}

async function uiTest() {
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useUiStore} from './src/store/uiStore';import {useDebugStore} from './src/store/debugStore';window.fixture={workflow:useWorkflowStore,ui:useUiStore,debug:useDebugStore};window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],saveWorkflow:async()=>({path:'C:/fixture/debug.rpa.json'}),executeActivity:async(id,p)=>({success:true,log:'Done',outputs:id==='get-text'?{textResult:'Invoice INV-42'}:id==='assign'?{[p.to]:p.value}:{}})};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.evaluate(() => { const n = (id, activityId, label, properties, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label, properties, ...extra } }); fixture.workflow.getState().loadWorkflow({ projectName: 'Invoice processing', nodes: [n('read', 'get-text', 'Read invoice number', { selector: '#invoice', output: 'textResult' }), n('assign', 'assign', 'Approve invoice', { to: 'textResult', value: 'Approved' }, { breakpoint: true }), n('log', 'log-message', 'Log invoice status', { message: 'textResult', level: 'Info' })], edges: [], variables: [{ id: 'text', name: 'textResult', type: 'String', defaultValue: '', scope: 'Main' }] }, 'C:/fixture/debug.rpa.json'); });
    await page.locator('.app-header').getByRole('button', { name: 'Debug', exact: true }).click();
    await page.getByRole('textbox', { name: 'Watch expression', exact: true }).fill('textResult'); await page.locator('.dbg-add-watch').getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTitle('Debug workflow', { exact: true }).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'paused');
    assert.equal(await page.evaluate(() => fixture.debug.getState().locals[0].detail), 'Invoice INV-42'); assert.equal(await page.evaluate(() => fixture.ui.getState().activeBottomPanelTab), 'debug');
    await page.getByRole('textbox', { name: 'Watch expression', exact: true }).fill('textResult.Length'); await page.locator('.dbg-add-watch').getByRole('button', { name: 'Add', exact: true }).click();
    assert.equal(await page.evaluate(() => fixture.debug.getState().results.find(r => r.expression === 'textResult.Length').value.detail), '14');
    await page.getByTitle(/Step Into \(F11\)/).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'paused' && fixture.debug.getState().activityName === 'Log invoice status');
    assert.equal(await page.evaluate(() => fixture.debug.getState().locals[0].detail), 'Approved'); assert.equal(await page.evaluate(() => fixture.debug.getState().locals[0].changedBy), 'Approve invoice');
    await page.getByRole('textbox', { name: 'Watch expression', exact: true }).fill('missing.Length'); await page.locator('.dbg-add-watch').getByRole('button', { name: 'Add', exact: true }).click(); await page.getByText('Not in scope: missing', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'debug-dark.png'), animations: 'disabled' }); await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'debug-light.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 700 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); await page.screenshot({ path: path.join(out, 'debug-compact.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Remove watch missing.Length', exact: true }).click(); await page.getByTitle('Continue (F5)', { exact: true }).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'completed');
    await page.reload(); await page.locator('.app-header').waitFor(); await page.getByRole('button', { name: 'Locals & Watch', exact: true }).click(); assert.equal(await page.evaluate(() => fixture.debug.getState().watches.includes('textResult.Length')), true); assert.equal(await page.evaluate(() => fixture.debug.getState().locals.length), 0);
    assert.deepEqual(errors, []); console.log('PASS UI Debug, breakpoint, Watch add/remove, Step Into, Continue, persistence, Dark/Light and compact layout');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
