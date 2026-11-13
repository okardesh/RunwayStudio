const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), net = require('node:net');
const { pathToFileURL } = require('node:url'); const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-portable-'));
global.crypto ||= require('node:crypto').webcrypto;
const n = (id, activityId, properties = {}, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
const a = (name, direction = 'In', type = 'String', required = false, defaultValue = '') => ({ id: name, name, direction, type, required, defaultValue });
const v = (name, defaultValue = '', type = 'String') => ({ id: name, name, type, scope: 'Main', defaultValue });
const d = (projectName, nodes, args = [], variables = [], uiTargets = []) => ({ projectName, nodes, edges: [], variables, arguments: args, uiTargets });
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
function resign(definition) { const p = definition.portablePackage, { id, ...content } = p; p.id = 'sha256:' + require('node:crypto').createHash('sha256').update(canonical(content)).digest('hex'); return definition; }
async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/shared/portableWorkflowPackage';export * from './src/shared/invokedWorkflows';export * from './src/engine/rpaWorkflowClient';export * from './Robot/src/workflowRuntime';export * from './electron/workflowFiles';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'runtime.cjs') });
  const e = require(path.join(out, 'runtime.cjs'));
  const load = async (requested, caller) => { const file = await e.readInvokedWorkflow(requested, caller); return { path: file.path, definition: e.parseWorkflowDefinition(file.content) }; };
  const target = { id: 'shared', name: 'Greeting', selector: '#current', application: 'Fixture', targetType: 'browser', updatedAt: 10 };
  const parentPath = path.join(out, 'parent.rpa.json'), childPath = path.join(out, 'child.rpa.json'), leafPath = path.join(out, 'leaf.rpa.json');
  const leaf = d('Greeting reader', [n('read', 'get-text', { selector: '#stale', output: 'text' }, { targetBindings: { selector: 'shared' } })], [a('text', 'Out')], [], [{ ...target, selector: '#old', updatedAt: 1 }]);
  const child = d('Worker', [n('leaf', 'invoke-workflow', { workflowFile: 'leaf.rpa.json', outArguments: { text: 'text' } }), n('number', 'assign', { to: 'number', value: '{{inputNumber}}' })], [a('inputNumber', 'In', 'Int32', true), a('text', 'Out'), a('number', 'Out', 'Int32')]);
  const parent = d('Portable parent', [n('worker', 'invoke-workflow', { workflowFile: 'child.rpa.json', inArguments: { inputNumber: '{{inputNumber}}' }, outArguments: { text: 'greeting', number: 'number' } })], [a('inputNumber', 'In', 'Int32', true), a('greeting', 'Out'), a('number', 'Out', 'Int32')]);
  const write = () => { for (const [file, def] of [[parentPath, parent], [childPath, child], [leafPath, leaf]]) fs.writeFileSync(file, JSON.stringify(def)); };
  const build = () => e.buildPortablePackage(parent, parentPath, [target], '2.1.0', load);
  let nativeCalls = []; const native = async (id, props) => { nativeCalls.push({ id, props }); return id === 'throw' ? { success: false, log: 'Expected activity error' } : { success: true, log: id === 'log-message' ? String(props.message) : 'Done', ...(id === 'get-text' ? { outputs: { [props.output]: 'Robot fixture text' } } : {}) }; };
  let passed = 0; const test = async (name, fn) => { write(); nativeCalls = []; await fn(); passed++; console.log('PASS ' + name); };
  await test('Compiler packages only reachable workflows and targets, rewrites paths and preserves source files', async () => {
    fs.writeFileSync(path.join(out, 'unrelated.txt'), 'Must not be included'); const before = JSON.stringify(parent), beforeFiles = [parentPath, childPath, leafPath].map(p => fs.readFileSync(p, 'utf8'));
    const bundle = await build(); assert.equal(bundle.portablePackage.workflows.length, 3); assert.equal(bundle.portablePackage.uiTargets.length, 1); assert.equal(bundle.portablePackage.uiTargets[0].selector, '#current');
    assert.ok(!JSON.stringify(bundle).includes(out)); assert.ok(!JSON.stringify(bundle).includes('unrelated.txt')); assert.equal(bundle.nodes[0].data.properties.workflowFile, 'package://wf-1');
    assert.equal(JSON.stringify(parent), before); assert.deepEqual([parentPath, childPath, leafPath].map(p => fs.readFileSync(p, 'utf8')), beforeFiles);
    assert.equal((await build()).portablePackage.id, bundle.portablePackage.id);
    assert.notEqual((await e.buildPortablePackage(parent, parentPath, [target], '2.2.0', load)).portablePackage.id, bundle.portablePackage.id);
  });
  await test('Serialized package runs without any source files and returns nested typed In/Out values', async () => {
    const bundle = JSON.parse(JSON.stringify(await build())); for (const file of [parentPath, childPath, leafPath]) fs.unlinkSync(file);
    const logs = [], inputs = { inputNumber: 42 }; const result = await e.executeRobotWorkflow(bundle, inputs, native, (level, message) => logs.push({ level, message }));
    assert.deepEqual({ ...result.outputs }, { greeting: 'Robot fixture text', number: 42 }); assert.deepEqual(inputs, { inputNumber: 42 }); assert.deepEqual(result.calls.map(c => c.depth), [0, 1, 2]); assert.ok(result.calls.every(c => c.status === 'completed'));
    assert.equal(result.package.id, bundle.portablePackage.id); assert.equal(nativeCalls[0].props.selector, '#current'); assert.ok(logs.some(l => l.message.includes('2.1.0')));
  });
  await test('Manifest validation rejects corruption, missing references, cycles and local path fallbacks before actions', async () => {
    const good = await build(); const corrupt = clone(good); corrupt.portablePackage.workflows[1].definition.projectName = 'Tampered'; await assert.rejects(e.executeRobotWorkflow(corrupt, { inputNumber: 1 }, native, () => {}), /integrity/);
    const missing = clone(good); missing.nodes[0].data.properties.workflowFile = 'package://wf-999'; missing.portablePackage.workflows[0].definition.nodes[0].data.properties.workflowFile = 'package://wf-999'; resign(missing); await assert.rejects(e.executeRobotWorkflow(missing, { inputNumber: 1 }, native, () => {}), /could not be read/);
    const cycle = clone(good); cycle.nodes[0].data.properties.workflowFile = 'package://wf-0'; cycle.portablePackage.workflows[0].definition.nodes[0].data.properties.workflowFile = 'package://wf-0'; resign(cycle); await assert.rejects(e.executeRobotWorkflow(cycle, { inputNumber: 1 }, native, () => {}), /recursive/);
    const local = clone(good); local.nodes[0].data.properties.workflowFile = 'C:/secret/child.rpa.json'; local.portablePackage.workflows[0].definition.nodes[0].data.properties.workflowFile = 'C:/secret/child.rpa.json'; resign(local); await assert.rejects(e.executeRobotWorkflow(local, { inputNumber: 1 }, native, () => {}), /filesystem/);
    assert.equal(nativeCalls.length, 0);
  });
  await test('Compiler rejects missing files, mapping errors, conflicting targets and unsupported Robot activities', async () => {
    fs.unlinkSync(childPath); await assert.rejects(build(), /could not be read/); write();
    const bad = clone(parent); bad.nodes[0].data.properties.inArguments = {}; await assert.rejects(e.buildPortablePackage(bad, parentPath, [target], '1', load), /not mapped/);
    await assert.rejects(e.buildPortablePackage(d('Unsupported', [n('while', 'while', { condition: 'true' })]), parentPath, [], '1', load), /does not support/);
    const conflictRoot = clone(parent); conflictRoot.nodes.push(n('root-read', 'get-text', { selector: '#root', output: 'result' }, { targetBindings: { selector: target.id } })); conflictRoot.uiTargets = [{ ...target, selector: '#root' }]; await assert.rejects(e.buildPortablePackage(conflictRoot, parentPath, [], '1', load), /Conflicting/);
    await assert.rejects(e.buildPortablePackage(parent, parentPath, [], '1', load, ['shared']), /deleted/);
  });
  await test('Typed collection copies are isolated across calls and caller inputs are unchanged', async () => {
    const listChild = d('List worker', [n('add', 'add-to-collection', { collection: 'items', value: 'child' }), n('copy', 'assign', { to: 'result', value: '{{items}}' })], [a('items', 'In', 'List<String>', true), a('result', 'Out', 'List<String>')]); fs.writeFileSync(childPath, JSON.stringify(listChild));
    const listRoot = d('List parent', [n('list', 'invoke-workflow', { workflowFile: 'child.rpa.json', inArguments: { items: '{{items}}' }, outArguments: { result: 'result' } })], [a('items', 'In', 'List<String>', true), a('result', 'Out', 'List<String>')]);
    const bundle = await e.buildPortablePackage(listRoot, parentPath, [], '1', load), inputs = { items: ['parent'] };
    const first = await e.executeRobotWorkflow(bundle, inputs, native, () => {}), second = await e.executeRobotWorkflow(bundle, inputs, native, () => {});
    assert.deepEqual(first.outputs.result, ['parent', 'child']); assert.deepEqual(second.outputs.result, first.outputs.result); assert.deepEqual(inputs.items, ['parent']);
    await assert.rejects(e.executeRobotWorkflow(bundle, { items: [1] }, native, () => {}), /String/);
  });
  await test('Failed child calls do not transfer partial outputs and errors can be caught in the parent', async () => {
    fs.writeFileSync(childPath, JSON.stringify(d('Failing child', [n('set', 'assign', { to: 'value', value: 'partial' }), n('fail', 'throw', { message: 'Expected' })], [a('value', 'Out')])));
    const call = n('call', 'invoke-workflow', { workflowFile: 'child.rpa.json', outArguments: { value: 'result' } }, { parentId: 'try', branchId: 'try' });
    const caught = d('Catch parent', [n('try', 'try-catch', {}, { isContainer: true, branches: [{ id: 'try', kind: 'try', condition: '', childIds: ['call'] }, { id: 'catch', kind: 'catch', condition: '', childIds: [] }] }), call], [a('result', 'Out', 'String', false, 'before')]);
    const bundle = await e.buildPortablePackage(caught, parentPath, [], '1', load); const result = await e.executeRobotWorkflow(bundle, {}, native, () => {}); assert.equal(result.outputs.result, 'before'); assert.equal(result.calls[1].status, 'error');
  });
  await test('Robot control blocks invoke per-item children, retain typed collections, retry and restore loop scope', async () => {
    fs.writeFileSync(childPath, JSON.stringify(d('Number worker', [n('copy', 'assign', { to: 'number', value: '{{input}}' })], [a('input', 'In', 'Int32', true), a('number', 'Out', 'Int32')])));
    const controls = d('Control parent', [n('retry', 'retry-scope', { maxRetries: 1, retryDelay: 0 }, { isContainer: true, childIds: ['request'] }), n('request', 'http-request', { url: 'http://fixture.invalid' }, { parentId: 'retry' }), n('loop', 'for-each', { collection: '{{items}}' }, { isContainer: true, childIds: ['call','append'], loopVariable: { name: 'item', type: 'Int32' } }), n('call', 'invoke-workflow', { workflowFile: 'child.rpa.json', inArguments: { input: '{{item}}' }, outArguments: { number: 'number' } }, { parentId: 'loop' }), n('append', 'add-to-collection', { collection: 'result', value: '{{number}}' }, { parentId: 'loop' }), n('restore', 'assign', { to: 'savedItem', value: '{{item}}' }), n('if', 'if', {}, { isContainer: true, branches: [{ id: 'yes', kind: 'if', condition: '{{result.Count}} == 2', childIds: ['log'] }, { id: 'no', kind: 'else', condition: '', childIds: [] }] }), n('log', 'log-message', { message: '"Both items processed"' }, { parentId: 'if', branchId: 'yes' })], [a('items', 'In', 'List<Int32>', true), a('result', 'Out', 'List<Int32>', false, '[]'), a('savedItem', 'Out')], [v('item', 'global')]);
    const bundle = await e.buildPortablePackage(controls, parentPath, [], '1', load), logs = []; let attempts = 0;
    const result = await e.executeRobotWorkflow(bundle, { items: [1, 2] }, async (id, p) => id === 'http-request' && ++attempts === 1 ? { success: false, log: 'Retry me' } : native(id, p), (_level, message) => logs.push(message));
    assert.deepEqual(result.outputs.result, [1, 2]); assert.equal(result.outputs.savedItem, 'global'); assert.equal(attempts, 2); assert.ok(logs.includes('Both items processed'));
  });
  await test('Legacy single workflows preserve Log Message literals and shared targets; unpackaged invokes fail clearly', async () => {
    const logs = []; await e.executeRobotWorkflow({ nodes: [n('log', 'log-message', { message: 'textResult' }), n('literal', 'log-message', { message: '"{{other}}"' })], variables: [{ name: 'textResult', defaultValue: 'Legacy value' }] }, {}, native, (_level, message) => logs.push(message)); assert.ok(logs.includes('Legacy value')); assert.ok(logs.includes('{{other}}'));
    await assert.rejects(e.executeRobotWorkflow(parent, { inputNumber: 1 }, native, () => {}), /portable package/);
  });
  await test('Publish transport preserves the package and rejects version mismatches before upload', async () => {
    const bundle = await build(); let uploads = 0; global.window = { electronAPI: { publishRunwayWorkflow: async (_url, _key, _tenant, payload) => { uploads++; return { status: 200, body: JSON.stringify({ ok: true, workflow: { id: 'published', version: payload.version, definition: payload.definition } }) }; } } };
    const payload = { name: 'Portable parent', version: '2.1.0', inputArguments: [], outputArguments: [], definition: bundle }, connection = { serverUrl: 'http://127.0.0.1', accessToken: 'fixture', organizationId: 'default' };
    const saved = await e.publishRpaWorkflow(connection, payload); assert.equal(saved.definition.portablePackage.id, bundle.portablePackage.id); assert.equal((await e.executeRobotWorkflow(saved.definition, { inputNumber: 9 }, native, () => {})).outputs.number, 9);
    await assert.rejects(e.publishRpaWorkflow(connection, { ...payload, version: 'wrong' }), /version/); assert.equal(uploads, 1);
  });
  await test('Robot logs redact secret inputs even when passed through renamed child arguments', async () => {
    const secretRoot = d('Secret parent', [n('child', 'invoke-workflow', { workflowFile: 'child.rpa.json', inArguments: { value: '{{apiToken}}' }, outArguments: { result: 'result' } })], [a('apiToken', 'In', 'String', true), a('result', 'Out')]);
    fs.writeFileSync(childPath, JSON.stringify(d('Alias worker', [n('copy', 'assign', { to: 'result', value: '{{value}}' }), n('log', 'log-message', { message: 'result' })], [a('value', 'In', 'String', true), a('result', 'Out')])));
    const logs = []; const result = await e.executeRobotWorkflow(await e.buildPortablePackage(secretRoot, parentPath, [], '1', load), { apiToken: 'private-fixture-token' }, native, (_level, message) => logs.push(message)); assert.equal(result.outputs.result, 'private-fixture-token'); assert.ok(!logs.join('').includes('private-fixture-token'));
  });
  await test('Production browser Get Text runs from a packaged child after source files are removed', async () => {
    await esbuild.build({ entryPoints: [path.join(root, 'electron/automation/browser.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['playwright-core'], outfile: path.join(out, 'browser.cjs') });
    const p = path.join(out, 'browser.cjs'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
    const { runBrowserActivity } = require(p); fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><meta charset="utf-8"><div id="current">Paket İstanbul 42</div>');
    try { assert.equal((await runBrowserActivity('open-browser', { url: pathToFileURL(path.join(out, 'fixture.html')).href, headless: true })).success, true); const bundle = await build(); for (const file of [parentPath, childPath, leafPath]) fs.unlinkSync(file); const result = await e.executeRobotWorkflow(bundle, { inputNumber: 42 }, runBrowserActivity, () => {}); assert.equal(result.outputs.greeting, 'Paket İstanbul 42'); assert.equal(result.outputs.number, 42); }
    finally { await runBrowserActivity('close-browser', {}); }
  });
  write(); const bundle = await build(); await robotListenerTest(bundle); await uiTest(e, parent, parentPath, target, out);
  console.log(passed + ' portable package scenarios passed, plus Robot listener and UI'); console.log('Artifacts: ' + out);
}

async function robotListenerTest(bundle) {
  const profile = path.join(out, 'robot-profile'); fs.mkdirSync(profile);
  global.robotIpc = new Map(); let ready; global.robotReady = new Promise(resolve => ready = resolve); global.robotRegisterReady = ready;
  const electronStub = path.join(out, 'electron-stub.mjs'), nativeStub = path.join(out, 'native-stub.mjs');
  fs.writeFileSync(electronStub, `const hooks=new Map();export const app={isPackaged:false,getPath:()=>${JSON.stringify(profile)},whenReady:()=>Promise.resolve(),on:(name,fn)=>hooks.set(name,fn),quit:()=>hooks.get('before-quit')?.()};export const ipcMain={handle:(name,fn)=>{globalThis.robotIpc.set(name,fn);if(name==='robot:connect')globalThis.robotRegisterReady();}};export class BrowserWindow{on(){}loadFile(){}show(){}focus(){}hide(){}}export class Notification{show(){}}export class Tray{setToolTip(){}setContextMenu(){}}export const nativeImage={createFromPath:()=>({})},Menu={buildFromTemplate:value=>value},dialog={},safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};globalThis.robotQuit=()=>app.quit();`);
  fs.writeFileSync(nativeStub, `export const executeActivity=(id,props)=>globalThis.robotNative(id,props);`);
  let nativeCalls = 0; global.robotNative = async (id, props) => { nativeCalls++; return { success: true, log: id === 'log-message' ? String(props.message) : 'Read', outputs: id === 'get-text' ? { [props.output]: 'Robot fixture text' } : {} }; };
  await esbuild.build({ entryPoints: [path.join(root, 'Robot/src/main.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(out, 'robot-main.mjs'), plugins: [{ name: 'robot-fixture-bridges', setup(build) { build.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub })); build.onResolve({ filter: /electron\/automation\/index\.js$/ }, () => ({ path: nativeStub })); } }] });
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const pending = new Map(), received = [];
  const server = http.createServer(async (req, res) => { let text = ''; for await (const chunk of req) text += chunk; const body = text ? JSON.parse(text) : {}; res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/license/')) res.end(JSON.stringify({ ok: true, authenticated: true, canUseRobots: true, apiKey: 'fixture-robot-key' }));
    else { received.push(body); pending.get(body.jobId)?.(body); res.end('{"ok":true}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const serverUrl = 'http://127.0.0.1:' + server.address().port;
  const previousPort = process.env.RUNWAY_ROBOT_PORT; process.env.RUNWAY_ROBOT_PORT = String(port);
  try {
    await import(pathToFileURL(path.join(out, 'robot-main.mjs')).href); await global.robotReady;
    assert.deepEqual(await global.robotIpc.get('robot:connect')(null, serverUrl), { ok: true });
    const submit = async (jobId, definition, inputs) => {
      let timeout; const completion = new Promise((resolve, reject) => { pending.set(jobId, resolve); timeout = setTimeout(() => reject(Error('Robot callback timeout')), 8000); });
      try { const response = await fetch('http://127.0.0.1:' + port + '/api/robot/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'fixture-robot-key' }, body: JSON.stringify({ jobId, workflowId: 'fixture-published', definition, inputs, callbackUrl: serverUrl + '/callback' }) }); assert.equal(response.status, 202); return await completion; }
      finally { clearTimeout(timeout); pending.delete(jobId); }
    };
    const success = await submit('portable-success', bundle, { inputNumber: 7 }); assert.equal(success.status, 'success'); assert.deepEqual(success.outputs, { greeting: 'Robot fixture text', number: 7 }); assert.equal(success.package.id, bundle.portablePackage.id); assert.equal(success.workflowCalls.length, 3);
    const before = nativeCalls, broken = clone(bundle); broken.portablePackage.version = 'tampered'; const failed = await submit('portable-failed', broken, { inputNumber: 7 }); assert.equal(failed.status, 'failed'); assert.match(failed.error, /integrity/); assert.equal(nativeCalls, before); assert.equal(failed.outputs, undefined);
    const health = await (await fetch('http://127.0.0.1:' + port + '/health')).json(); assert.equal(health.connected, true);
    assert.equal(received.length, 2); console.log('PASS Production Robot listener/queue, fixture license registration, portable job callback with outputs/version/call chain, and tampered package failure before actions');
  } finally { global.robotQuit?.(); await new Promise(resolve => server.close(resolve)); if (previousPort === undefined) delete process.env.RUNWAY_ROBOT_PORT; else process.env.RUNWAY_ROBOT_PORT = previousPort; }
}
async function uiTest(e, parent, parentPath, target, out) {
  const before = ['parent.rpa.json','child.rpa.json','leaf.rpa.json'].map(file => fs.readFileSync(path.join(out, file), 'utf8'));
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useUiTargetStore} from './src/store/uiTargetStore';window.fixture={workflow:useWorkflowStore,targets:useUiTargetStore};window.uploads=[];window.failReads=false;window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],readInvokedWorkflow:async(path,caller)=>{if(window.failReads)throw Error('Fixture read failure');return window.readFixture(path,caller)},publishRunwayWorkflow:async(_url,_key,_tenant,payload)=>{window.uploads.push(payload);return {status:200,body:JSON.stringify({ok:true,workflow:{id:'fixture-published',version:payload.version,definition:payload.definition}})}}};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.exposeFunction('readFixture', e.readInvokedWorkflow);
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.evaluate(({ parent, parentPath, target }) => { fixture.workflow.getState().loadWorkflow(parent, parentPath); fixture.targets.setState({ targets: [target] }); }, { parent, parentPath, target });
    await page.getByRole('button', { name: 'Publish', exact: true }).click(); const modal = page.getByRole('dialog', { name: 'Publish workflow', exact: true }); await modal.getByRole('textbox', { name: 'Version', exact: true }).fill('3.0.0');
    await modal.getByRole('button', { name: 'Prepare package', exact: true }).click(); await modal.getByText('3 workflows · 1 UI targets · version 3.0.0', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => uploads.length), 0);
    await page.screenshot({ path: path.join(out, 'portable-publish-dark.png'), animations: 'disabled' }); await page.getByRole('button', { name: 'Light', exact: true }).evaluate(button => button.click()); await page.screenshot({ path: path.join(out, 'portable-publish-light.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 750 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); await page.screenshot({ path: path.join(out, 'portable-publish-compact.png'), animations: 'disabled' });
    const downloadPromise = page.waitForEvent('download'); await modal.getByRole('button', { name: 'Download package', exact: true }).click(); const download = await downloadPromise; assert.match(download.suggestedFilename(), /\.runway\.json$/); const downloaded = JSON.parse(fs.readFileSync(await download.path(), 'utf8')); await e.validatePortablePackage(downloaded);
    await modal.getByRole('button', { name: 'Publish', exact: true }).click(); await modal.getByText('Published as fixture-published, version 3.0.0.', { exact: true }).waitFor();
    const payload = await page.evaluate(() => uploads[0]); assert.equal(payload.definition.portablePackage.id, downloaded.portablePackage.id); const executed = await e.executeRobotWorkflow(payload.definition, { inputNumber: 12 }, async (_id, p) => ({ success: true, log: 'Read', outputs: { [p.output]: 'UI text' } }), () => {}); assert.equal(executed.outputs.number, 12); assert.equal(executed.outputs.greeting, 'UI text');
    await page.evaluate(() => fixture.targets.setState({ targets: fixture.targets.getState().targets.map(t => ({ ...t, selector: '#changed' })) })); await modal.getByText('Package is out of date. Refresh it before publishing or downloading.', { exact: true }).waitFor(); assert.equal(await modal.getByRole('button', { name: 'Publish again', exact: true }).isDisabled(), true);
    await modal.getByRole('button', { name: 'Refresh package', exact: true }).click(); await modal.getByText('3 workflows · 1 UI targets · version 3.0.0', { exact: true }).waitFor(); await modal.getByRole('button', { name: 'Publish', exact: true }).click(); await page.waitForFunction(() => uploads.length === 2); assert.notEqual(await page.evaluate(() => uploads[1].definition.portablePackage.id), downloaded.portablePackage.id);
    await page.evaluate(() => { window.failReads = true; }); await modal.getByRole('button', { name: 'Refresh package', exact: true }).click(); await modal.getByRole('alert').waitFor(); await modal.getByRole('button', { name: 'Publish', exact: true }).click(); await modal.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => uploads.length), 2);
    assert.deepEqual(['parent.rpa.json','child.rpa.json','leaf.rpa.json'].map(file => fs.readFileSync(path.join(out, file), 'utf8')), before); assert.deepEqual(errors, []);
    console.log('PASS UI prepare/review/download/publish, executable exported package, version and target snapshots, stale gating/refresh, read errors before upload, Dark/Light/compact and unchanged source files');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
