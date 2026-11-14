const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), net = require('node:net');
const { pathToFileURL } = require('node:url'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-robot-jobs-'));
global.crypto ||= require('node:crypto').webcrypto;
const node = (id, activityId, properties = {}, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { label: id, activityId, properties, ...extra } });
const arg = (name, direction = 'In', type = 'String', required = true) => ({ id: name, name, direction, type, required, defaultValue: '' });
const def = (name, nodes, args = []) => ({ projectName: name, nodes, edges: [], variables: [], arguments: args, uiTargets: [] });
const waitFor = async (test, timeout = 8000) => { const until = Date.now() + timeout; while (!await test()) { if (Date.now() > until) throw Error('Timed out waiting for fixture state'); await new Promise(r => setTimeout(r, 20)); } };
async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './tests/robot-jobs/gatewayFixture'; export * from './src/shared/portableWorkflowPackage'; export * from './Robot/src/jobRegistry'; export * from './Robot/src/workflowRuntime';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  const e = require(path.join(out, 'engine.cjs'));
  const pack = async (version, childNodes) => {
    const child = def('Child', childNodes, [arg('greeting'), arg('result', 'Out', 'String', false)]);
    const main = def('Robot Jobs fixture', [node('child', 'invoke-workflow', { workflowFile: 'child.rpa.json', inArguments: { greeting: '{{greeting}}' }, outArguments: { result: 'result' } })], [arg('greeting'), arg('count', 'In', 'Int32'), arg('result', 'Out', 'String', false)]);
    return e.buildPortablePackage(main, path.join(out, 'main.rpa.json'), [], version, async () => ({ path: path.join(out, 'child.rpa.json'), definition: child }));
  };
  const good = await pack('1.0.0', [node('log', 'log-message', { message: '{{greeting}}' }), node('return', 'assign', { to: 'result', value: '{{greeting}}' })]);
  const bad = await pack('2.0.0', [node('fail', 'throw', { message: 'Expected failure' })]);
  const slow = await pack('3.0.0', [node('hold', 'delay', { duration: 5 }), node('must-not-run', 'log-message', { message: 'MUST NOT RUN' })]);
  const packages = [good, bad, slow].map(definition => ({ workflowId: 'published', name: 'Robot Jobs fixture', version: definition.portablePackage.version, definition }));
  let release, calls = [], callbacks = [], held = false;
  const native = async (id, p) => { calls.push(id + ':' + (p.message ?? '')); if (id === 'delay') { held = true; await new Promise(r => release = r); held = false; } return { success: id !== 'throw', log: id === 'throw' ? 'Expected failure' : String(p.message ?? 'Activity finished') }; };
  const completions = [];
  const registry = new e.RobotJobRegistry(native, async (trigger, view) => completions.push(view));
  const trigger = (jobId, definition = slow) => ({ jobId, definition, inputs: { greeting: 'Fixture value', count: 2 }, callbackUrl: 'http://fixture/callback' });
  registry.submit(trigger('active')); await waitFor(() => held); assert.equal(registry.get('active').status, 'running'); assert.ok(registry.get('active').logs.length > 0);
  registry.submit(trigger('queued', good)); assert.equal(registry.get('queued').status, 'queued'); await registry.stop('queued'); assert.equal(registry.get('queued').status, 'stopped');
  registry.submit(trigger('active')); assert.throws(() => registry.submit({ ...trigger('active'), inputs: { greeting: 'different' } }), /different/);
  await registry.stop('active'); assert.equal(registry.get('active').status, 'stopping'); release(); await waitFor(() => registry.get('active').status === 'stopped'); await waitFor(() => !registry.running);
  assert.ok(!calls.some(c => c.includes('MUST NOT RUN'))); assert.equal(completions.length, 2);
  console.log('PASS Live logs before completion, idempotent submission, ID conflict, queued stop and cooperative active stop across Invoke');
  const controller = new AbortController(), retried = def('Retry cancellation', [node('retry', 'retry-scope', { maxRetries: 4, retryDelay: 10000 }, { isContainer: true, childIds: ['failure'] }), node('failure', 'throw', {}, { parentId: 'retry' })]);
  let retries = 0; const retrying = e.executeRobotWorkflow(retried, {}, async () => { retries++; setTimeout(() => controller.abort(), 10); return { success: false, log: 'Retry failure' }; }, () => {}, { signal: controller.signal, live: true });
  await assert.rejects(retrying, /stopped/); assert.equal(retries, 1);
  const secretDef = def('Secret test', [node('log', 'log-message', { message: '{{apiKey}}' }), node('copy', 'assign', { to: 'alias', value: '{{apiKey}}' })], [arg('apiKey'), arg('alias', 'Out', 'String', false)]);
  registry.submit({ jobId: 'secret', definition: secretDef, inputs: { apiKey: 'PRIVATE-FIXTURE-SECRET' }, callbackUrl: 'http://fixture/callback' }); await waitFor(() => registry.get('secret').status === 'success');
  assert.ok(!JSON.stringify(registry.get('secret')).includes('PRIVATE-FIXTURE-SECRET'));
  console.log('PASS Retry-delay cancellation without another activity; secret masking in live logs and aliased outputs');

  let finishCleanup, cleaning = false;
  const finalizing = new e.RobotJobRegistry(native, async () => {}, undefined, () => ({ activeCount: 0, events: [], assertHealthy() {}, close: () => { cleaning = true; return new Promise(resolve => finishCleanup = resolve); } }));
  finalizing.submit(trigger('finalizing', good)); await waitFor(() => cleaning);
  assert.equal(finalizing.get('finalizing').status, 'running'); finishCleanup(); await waitFor(() => finalizing.get('finalizing').status === 'success'); assert.deepEqual(finalizing.get('finalizing').transactions, []);
  console.log('PASS Job stays active until transaction cleanup and history metadata are finalized');

  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const robotPort = probe.address().port; await new Promise(r => probe.close(r));
  let gateway, serverUrl, offline = false, dropLaunchResponse = false;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/license/')) return res.end(JSON.stringify({ ok: true, authenticated: true, canUseRobots: true, apiKey: 'robot-fixture-key' }));
    if (req.url.endsWith('/complete')) { callbacks.push(JSON.parse(text)); return res.end('{"ok":true}'); }
    if (offline) { res.writeHead(503); return res.end('{"ok":false}'); }
    const result = await gateway.handle(new Request(serverUrl + req.url, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: text || '{}' }) }));
    if (dropLaunchResponse && req.method === 'POST' && req.url === '/api/v1/robot-jobs') { dropLaunchResponse = false; res.destroy(); return; }
    res.writeHead(result.status); res.end(await result.text());
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); serverUrl = 'http://127.0.0.1:' + server.address().port;
  gateway = new e.RobotJobsGateway({ authorize: async req => req.headers.get('X-API-Key') === 'studio-fixture-key' ? { tenantId: 'tenant-a' } : req.headers.get('X-API-Key') === 'other-key' ? { tenantId: 'tenant-b' } : null,
    robots: async () => [{ id: 'r1', name: 'Fixture Robot', online: true, listenerUrl: 'http://127.0.0.1:' + robotPort + '/api/robot/jobs', apiKey: 'robot-fixture-key' }, { id: 'offline', name: 'Offline Robot', online: false, listenerUrl: 'http://invalid', apiKey: 'hidden' }], packages: async () => packages, callbackUrl: id => serverUrl + '/api/v1/robot-jobs/' + id + '/complete' });
  const request = async (route, method = 'GET', payload, key = 'studio-fixture-key') => fetch(serverUrl + '/api/v1/robot-jobs' + route, { method, headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const profile = path.join(out, 'robot-profile'); fs.mkdirSync(profile); global.robotIpc = new Map(); let ready; global.robotReady = new Promise(r => ready = r); global.robotRegisterReady = ready; global.robotNative = native;
  fs.writeFileSync(path.join(out, 'electron.mjs'), `const hooks=new Map();export const app={isPackaged:false,getPath:()=>${JSON.stringify(profile)},whenReady:()=>Promise.resolve(),on:(name,fn)=>hooks.set(name,fn),quit:()=>hooks.get('before-quit')?.()};export const ipcMain={handle:(name,fn)=>{globalThis.robotIpc.set(name,fn);if(name==='robot:connect')globalThis.robotRegisterReady();}};export class BrowserWindow{on(){}loadFile(){}show(){}focus(){}hide(){}}export class Notification{show(){}}export class Tray{setToolTip(){}setContextMenu(){}}export const nativeImage={createFromPath:()=>({})},Menu={buildFromTemplate:v=>v},dialog={},safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};globalThis.robotQuit=()=>app.quit();`);
  fs.writeFileSync(path.join(out, 'native.mjs'), 'export const executeActivity=(id,p)=>globalThis.robotNative(id,p);');
  await esbuild.build({ entryPoints: [path.join(root, 'Robot/src/main.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(out, 'robot.mjs'), plugins: [{ name: 'fixture', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(out, 'electron.mjs') })); b.onResolve({ filter: /electron\/automation\/index\.js$/ }, () => ({ path: path.join(out, 'native.mjs') })); } }] });
  process.env.RUNWAY_ROBOT_PORT = String(robotPort);
  try {
    await import(pathToFileURL(path.join(out, 'robot.mjs')).href); await global.robotReady;
    assert.deepEqual(await global.robotIpc.get('robot:connect')(null, serverUrl), { ok: true });
    assert.equal((await request('/catalog', 'GET', undefined, 'bad-key')).status, 401);
    const catalog = await (await request('/catalog')).json(); assert.equal(catalog.packages.length, 3); assert.ok(!JSON.stringify(catalog).includes('robot-fixture-key')); assert.ok(!JSON.stringify(catalog).includes('listenerUrl'));
    const raw = { requestId: crypto.randomUUID(), robotId: 'r1', workflowId: 'published', version: '1.0.0', packageId: good.portablePackage.id, inputs: { greeting: 'HTTP fixture', count: 4 } };
    assert.equal((await request('', 'POST', { ...raw, robotId: 'offline' })).status, 409);
    assert.equal((await request('', 'POST', { ...raw, packageId: 'stale' })).status, 409);
    assert.equal((await request('', 'POST', { ...raw, inputs: { ...raw.inputs, count: 'bad' } })).status, 400);
    const submitted = await (await request('', 'POST', raw)).json(); assert.ok(submitted.jobId);
    assert.equal((await (await request('', 'POST', raw)).json()).jobId, submitted.jobId);
    assert.equal((await request('', 'POST', { ...raw, inputs: { greeting: 'changed', count: 4 } })).status, 409);
    assert.equal((await request('/' + submitted.jobId, 'GET', undefined, 'other-key')).status, 404);
    assert.equal((await fetch('http://127.0.0.1:' + robotPort + '/api/robot/jobs/' + submitted.jobId)).status, 401);
    await waitFor(async () => (await (await request('/' + submitted.jobId)).json()).job.status === 'success');
    const view = (await (await request('/' + submitted.jobId)).json()).job; assert.equal(view.outputs.result, 'HTTP fixture'); assert.equal(view.workflowCalls.length, 2);
    console.log('PASS Production HTTP listener + Runway adapter: authenticated catalog, pinned version, typed input, tenant isolation, duplicate prevention and nested Out results');
    await uiTest(serverUrl, async (url, key, tenant, method, payload) => {
      assert.equal(new URL(url).origin, serverUrl); assert.equal(key, 'studio-fixture-key');
      try { const r = await fetch(url, { method, headers: { 'X-API-Key': key, 'X-Tenant-Id': tenant, 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); return { status: r.status, body: await r.text() }; }
      catch { return { status: 0, networkError: true, body: '' }; }
    }, { setOffline: value => offline = value, dropLaunch: () => dropLaunchResponse = true, held: () => held, release: () => release() });
    assert.ok(callbacks.some(c => c.status === 'success')); assert.ok(callbacks.some(c => c.status === 'failed')); assert.ok(callbacks.some(c => c.status === 'stopped'));
    const sourceArg = process.argv.find(a => a.startsWith('--maestro-source='));
    if (sourceArg) {
      await waitFor(async () => !(await (await fetch('http://127.0.0.1:' + robotPort + '/health')).json()).activeJob);
      await maestroTest(sourceArg.slice('--maestro-source='.length), packages, robotPort, native, { held: () => held, release: () => release(), calls: () => calls });
    }
  } finally { release?.(); global.robotQuit?.(); await new Promise(r => server.close(r)); }
  console.log('All Robot Jobs checks passed. Artifacts: ' + out);
}
async function uiTest(serverUrl, bridge, control) {
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useExecutionHistoryStore} from './src/store/executionHistoryStore';import {useRobotJobsStore} from './src/store/robotJobsStore';window.fixture={workflow:useWorkflowStore,history:useExecutionHistoryStore,jobs:useRobotJobsStore};window.electronAPI={requestRobotJobs:(...a)=>window.fixtureRequest(...a),requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'studio-fixture-key'})}),getRunwayApiKey:async()=> 'studio-fixture-key',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[]};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('fixtureRequest', (_url, ...args) => bridge(serverUrl + new URL(_url).pathname, ...args));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click(); const panel = page.locator('.robot-jobs'); await panel.getByLabel('Package version', { exact: true }).selectOption({ label: 'Robot Jobs fixture · 1.0.0' });
    const source = await page.evaluate(() => JSON.stringify(fixture.workflow.getState().nodes));
    await panel.getByLabel('Input greeting', { exact: true }).fill('UI captured value'); await panel.getByLabel('Input count', { exact: true }).fill('not-a-number');
    await panel.getByRole('button', { name: 'Start job', exact: true }).click(); await panel.getByRole('alert').filter({ hasText: 'valid Int32' }).waitFor(); assert.equal(await page.evaluate(() => fixture.jobs.getState().jobs.length), 0);
    await panel.getByLabel('Input count', { exact: true }).fill('12'); await panel.getByRole('button', { name: 'Start job', exact: true }).click();
    await page.waitForFunction(() => fixture.jobs.getState().jobs[0]?.status === 'success'); await panel.getByLabel('Robot job logs', { exact: true }).getByText('UI captured value', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => fixture.history.getState().runs[0].arguments.outputs.result), 'UI captured value');
    await panel.getByRole('button', { name: 'View in Run History', exact: true }).click(); await page.locator('.run-history .rj-logs').getByText('UI captured value', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click(); await panel.getByLabel('Package version', { exact: true }).selectOption({ label: 'Robot Jobs fixture · 2.0.0' });
    await panel.getByLabel('Input greeting', { exact: true }).fill('failure'); await panel.getByLabel('Input count', { exact: true }).fill('3'); await panel.getByRole('button', { name: 'Start job', exact: true }).click();
    await page.waitForFunction(() => fixture.jobs.getState().jobs[0]?.status === 'failed'); assert.equal(await page.evaluate(() => fixture.history.getState().runs[0].status), 'error');
    await panel.getByLabel('Package version', { exact: true }).selectOption({ label: 'Robot Jobs fixture · 3.0.0' }); await panel.getByLabel('Input greeting', { exact: true }).fill('slow'); await panel.getByLabel('Input count', { exact: true }).fill('5');
    await control.dropLaunch(); await panel.getByRole('button', { name: 'Start job', exact: true }).click(); await panel.getByRole('button', { name: 'Recover launch', exact: true }).waitFor(); await waitFor(control.held);
    await panel.getByRole('button', { name: 'Recover launch', exact: true }).click(); await page.waitForFunction(() => fixture.jobs.getState().jobs[0]?.status === 'running');
    await panel.getByLabel('Robot job logs', { exact: true }).getByText('Starting Child / hold', { exact: true }).waitFor();
    await control.setOffline(true); await page.waitForFunction(() => !!fixture.jobs.getState().jobs[0]?.connectionError); assert.equal(await page.evaluate(() => fixture.history.getState().runs[0].status), 'running');
    await control.setOffline(false); await page.waitForFunction(() => !fixture.jobs.getState().jobs[0]?.connectionError);
    await page.screenshot({ path: path.join(out, 'robot-jobs-dark.png'), animations: 'disabled' }); await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'robot-jobs-light.png'), animations: 'disabled' });
    await panel.getByRole('button', { name: 'Stop job', exact: true }).click(); await page.waitForFunction(() => fixture.jobs.getState().jobs[0]?.status === 'stopping'); assert.equal(await panel.getByRole('button', { name: 'Stop job', exact: true }).isDisabled(), true);
    await page.reload(); await page.locator('.app-header').waitFor(); await page.getByRole('button', { name: 'Jobs', exact: true }).click(); await page.waitForFunction(() => fixture.jobs.getState().jobs[0]?.status === 'stopping');
    control.release(); await page.waitForFunction(() => fixture.jobs.getState().jobs[0]?.status === 'stopped'); assert.equal(await page.evaluate(() => fixture.history.getState().runs[0].status), 'stopped');
    assert.ok(!await page.evaluate(() => JSON.stringify(fixture.jobs.getState().jobs).includes('MUST NOT RUN')));
    assert.equal(await page.evaluate(() => JSON.stringify(fixture.workflow.getState().nodes)), source);
    assert.ok(!await page.evaluate(() => localStorage.getItem('runway.execution-history.v1').includes('studio-fixture-key')));
    await page.setViewportSize({ width: 1100, height: 750 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); await page.screenshot({ path: path.join(out, 'robot-jobs-compact.png'), animations: 'disabled' });
    assert.deepEqual(errors, []); console.log('PASS Studio UI: typed forms, success/failure/stop in Run History, live logs, uncertain launch recovery, disconnect/reconnect, reload monitoring, Dark/Light/compact, unchanged canvas and credential-free history');
  } finally { await browser.close(); }
}
async function maestroTest(source, packages, robotPort, native, control) {
  const { spawn } = require('node:child_process');
  const python = process.env.RUNWAY_TEST_PYTHON || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  if (process.argv.includes('--assets')) {
    const engine = require(path.join(out, 'engine.cjs'));
    const definition = def('Asset HTTP fixture', [node('url', 'get-asset', { assetName: 'ERP_URL', assetType: 'String', output: 'url' }), node('number', 'get-asset', { assetName: 'Retries', assetType: 'Int32', output: 'total' }), node('credential', 'get-credential', { assetName: 'ERP_Login', usernameOutput: 'x', passwordOutput: 'y' }), node('log', 'log-message', { message: '{{y.ToUpper()}}' }), node('return', 'assign', { to: 'echo', value: '{{y}}' })], [arg('url', 'Out', 'String', false), arg('total', 'Out', 'Int32', false), arg('echo', 'Out', 'String', false)]);
    const bundle = await engine.buildPortablePackage(definition, path.join(out, 'assets.rpa.json'), [], '4.0.0', async () => { throw Error('No dependency'); });
    packages = [...packages, { workflowId: 'assets', name: 'Asset HTTP fixture', version: '4.0.0', definition: bundle }];
  }
  if (process.argv.includes('--queues')) {
    const engine = require(path.join(out, 'engine.cjs'));
    for (const [version, mode] of [['5.0.0', 'success'], ['6.0.0', 'Application'], ['7.0.0', 'Business'], ['8.0.0', 'stop']]) {
      const definition = def('Queue HTTP ' + mode, [node('add', 'add-queue-item', { queueName: 'Invoices', reference: '{{reference}}', content: '{"amount":42}' }), node('get', 'get-transaction-item', { queueName: 'Invoices', output: 'transaction', hasItemOutput: 'hasTransaction' }), ...(mode === 'stop' ? [node('hold', 'delay', { duration: 5 })] : []), node('set', 'set-transaction-status', { transaction: '{{transaction}}', status: mode === 'success' || mode === 'stop' ? 'Successful' : 'Failed', errorType: mode, reason: 'Expected ' + mode })], [arg('reference')]);
      const bundle = await engine.buildPortablePackage(definition, path.join(out, 'queue.rpa.json'), [], version, async () => { throw Error('No dependency'); });
      packages = [...packages, { workflowId: 'queue', name: 'Queue HTTP ' + mode, version, definition: bundle }];
    }
  }
  if (process.argv.includes('--transaction-scope')) {
    const engine = require(path.join(out, 'engine.cjs'));
    for (const [version, mode] of [['9.0.0', 'success'], ['10.0.0', 'Application'], ['11.0.0', 'Business'], ['12.0.0', 'recovery-failure'], ['13.0.0', 'stop']]) {
      const processing = mode === 'success' ? node('process', 'log-message', { message: '{{transaction.content.amount}}' }) : mode === 'stop' ? node('hold', 'delay', { duration: 5 }) : node('process', mode === 'Business' ? 'business-rule-exception' : 'throw', { message: 'Expected ' + mode });
      processing.data.parentId = 'scope';
      const definition = def('Scope HTTP ' + mode, [node('add', 'add-queue-item', { queueName: 'ScopeInvoices', reference: '{{reference}}', content: '{"amount":42}' }), node('get', 'get-transaction-item', { queueName: 'ScopeInvoices', output: 'transaction' }), node('scope', 'transaction-scope', { transaction: '{{transaction}}', failureBehavior: 'Continue', workflowFile: 'recovery.rpa.json', inArguments: { error: '{{transactionError}}' }, outArguments: { ready: 'ready' } }, { isContainer: true, childIds: ['process'] }), processing], [arg('reference')]);
      if (mode === 'stop') definition.nodes[2].data.childIds = ['hold'];
      const recovery = def('Scope recovery', [node('recovery-step', mode === 'recovery-failure' ? 'throw' : 'log-message', { message: 'RECOVERY {{error.type}}' }), node('return', 'assign', { to: 'ready', value: 'recovered' })], [arg('error', 'In', 'Object'), arg('ready', 'Out', 'String', false)]);
      const bundle = await engine.buildPortablePackage(definition, path.join(out, 'scope.rpa.json'), [], version, async () => ({ path: path.join(out, 'recovery.rpa.json'), definition: recovery }));
      packages = [...packages, { workflowId: 'scope', name: 'Scope HTTP ' + mode, version, definition: bundle }];
    }
  }
  if (process.argv.includes('--human-tasks')) {
    const engine = require(path.join(out, 'engine.cjs'));
    for (const version of ['14.0.0','15.0.0','16.0.0','17.0.0']) {
      const definition = def('Human HTTP '+version, [node('before','log-message',{message:'BEFORE_HUMAN_'+version}),node('prep-add','add-queue-item',{queueName:'HumanPreparations',reference:'prep-'+version,content:'{}'}),node('prep-get','get-transaction-item',{queueName:'HumanPreparations',output:'prep'}),node('prep-set','set-transaction-status',{transaction:'{{prep}}',status:'Successful',output:'prepResult'}),node('create','create-human-task',{title:'Approve invoice',assignee:'role:finance',context:'{"amount":42}',formSchema:'[{"name":"costCenter","label":"Cost center","type":"String","required":true}]',timeoutMinutes:1,output:'task'}),node('wait','wait-for-human-task',{task:'{{task}}',output:'approval'}),node('result','assign',{to:'decision',value:'{{approval.decision}}'}),node('after','log-message',{message:'AFTER_HUMAN_'+version+' {{approval.decision}}'})],[arg('decision','Out','String',false)]);
      const bundle = await engine.buildPortablePackage(definition,path.join(out,'human.rpa.json'),[] ,version,async()=>{throw Error('No calls')}); packages=[...packages,{workflowId:'human',name:'Human HTTP '+version,version,definition:bundle}];
    }
  }
  const config = path.join(out, 'maestro-config.json'); fs.writeFileSync(config, JSON.stringify({ packages, robotUrl: 'http://127.0.0.1:' + robotPort + '/api/robot/jobs' }));
  const start = async () => {
    const child = spawn(python, [path.join(__dirname, 'maestroFixture.py'), source, config], { windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); let errors = '';
    child.stderr.on('data', data => errors += data);
    const url = await new Promise((resolve, reject) => { let stdout = ''; const timer = setTimeout(() => { child.kill(); reject(Error('Maestro fixture startup timeout: ' + errors)); }, 8000);
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(stdout.split('\n')[0]).url); } catch (e) { reject(e); } } }); child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('exit', code => { clearTimeout(timer); reject(Error('Maestro fixture exit: ' + code + ' ' + errors)); });
    });
    return { child, url, errors: () => errors, stop: () => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill(); }) };
  };
  let service = await start();
  if (process.argv.includes('--human-tasks')) { const saved = JSON.parse(fs.readFileSync(config)); saved.port = Number(new URL(service.url).port); fs.writeFileSync(config,JSON.stringify(saved)); }
  const post = async (url, payload) => fetch(url, { method: 'POST', headers: { 'X-API-Key': 'studio-fixture-key', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  try {
    assert.deepEqual(await global.robotIpc.get('robot:connect')(null, service.url), { ok: true });
    if (process.argv.includes('--assets')) await assetHttpTest(service.url, packages.find(p => p.workflowId === 'assets').definition);
    if (process.argv.includes('--queues')) await queueHttpTest(service.url, packages.filter(p => p.workflowId === 'queue'), control);
    if (process.argv.includes('--transaction-scope')) await scopeHttpTest(service.url, packages.filter(p => p.workflowId === 'scope'), control);
    if (process.argv.includes('--human-tasks')) await humanHttpTest(service.url,packages.filter(p=>p.workflowId==='human'),{...control,restart:async()=>{await service.stop();service=await start();}});
    const r = { requestId: crypto.randomUUID(), robotId: 'r1', workflowId: 'published-1.0.0', version: '1.0.0', packageId: packages[0].definition.portablePackage.id, inputs: { greeting: 'Maestro durable result', count: 8 } };
    const created = await (await post(service.url + '/api/v1/robot-jobs', r)).json(); assert.ok(created.jobId);
    await waitFor(async () => (await (await fetch(service.url + '/api/v1/robot-jobs/' + created.jobId, { headers: { 'X-API-Key': 'studio-fixture-key' } })).json()).job?.status === 'success');
    await uiTest(service.url, async (url, key, tenant, method, payload) => {
      try { const result = await fetch(url, { method, headers: { 'X-API-Key': key, 'X-Tenant-Id': 'default', 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); return { status: result.status, body: await result.text() }; }
      catch { return { status: 0, networkError: true, body: '' }; }
    }, { ...control, setOffline: value => post(service.url + '/fixture/control', { offline: value }), dropLaunch: () => post(service.url + '/fixture/control', { drop: true }) });
    await waitFor(async () => !(await (await fetch('http://127.0.0.1:' + robotPort + '/health')).json()).activeJob);
    assert.equal(service.errors(), '');
    await service.stop(); service = await start();
    const recovered = await (await post(service.url + '/api/v1/robot-jobs', r)).json(); assert.equal(recovered.jobId, created.jobId);
    const persisted = await (await fetch(service.url + '/api/v1/robot-jobs/' + created.jobId, { headers: { 'X-API-Key': 'studio-fixture-key' } })).json(); assert.equal(persisted.job.outputs.result, 'Maestro durable result');
    const isolated = await fetch(service.url + '/api/v1/robot-jobs/' + created.jobId, { headers: { 'X-API-Key': 'studio-fixture-key', 'X-Tenant-Id': 'other' } }); assert.equal(isolated.status, 404);
    console.log('PASS Real Maestro storage functions/schema, Python route adapter, production Robot and Studio UI; callback persistence, stopped state, durable idempotency/results after server restart and tenant-filtered lookup');
  } finally { await service.stop(); }
}
async function assetHttpTest(url, bundle) {
  const request = async (route, body) => {
    const r = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-API-Key': 'studio-fixture-key', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const save = (profileId, name, type, value, revision = 0) => request('/api/v1/studio-assets/values', { profileId, name, type, value, revision });
  for (const [id, target, total] of [['development', 'https://dev.example', 42], ['production', 'https://prod.example', 7]]) {
    assert.equal((await request('/api/v1/studio-assets/profiles', { id, name: id, enabled: true })).status, 200);
    assert.equal((await save(id, 'ERP_URL', 'String', target)).status, 200); assert.equal((await save(id, 'Retries', 'Int32', total)).status, 200);
    assert.equal((await save(id, 'ERP_Login', 'Credential', { username: id + '-private-user', password: id + '-private-password' })).status, 200);
  }
  const submit = async environmentId => {
    const r = await request('/api/v1/robot-jobs', { requestId: crypto.randomUUID(), robotId: 'r1', workflowId: 'assets-4.0.0', version: '4.0.0', packageId: bundle.portablePackage.id, inputs: {}, environmentId });
    if (r.status !== 202) return r;
    let view; await waitFor(async () => { view = (await request('/api/v1/robot-jobs/' + r.body.jobId)).body.job; return view?.status === 'success' || view?.status === 'failed'; });
    assert.equal(view.status, 'success', view.error); return { status: 202, view };
  };
  const dev = (await submit('development')).view, prod = (await submit('production')).view;
  assert.equal(dev.environment.id, 'development'); assert.equal(dev.outputs.url, 'https://dev.example'); assert.equal(dev.outputs.total, 42); assert.equal(dev.outputs.echo, '[REDACTED]');
  assert.equal(prod.environment.id, 'production'); assert.equal(prod.outputs.url, 'https://prod.example'); assert.equal(prod.outputs.total, 7);
  for (const profile of ['development', 'production']) { const text = JSON.stringify(profile === 'development' ? dev : prod).toLowerCase(); assert.ok(!text.includes(profile + '-private-user')); assert.ok(!text.includes(profile + '-private-password')); }
  const denied = await request('/api/v1/robot-jobs/' + dev.jobId + '/assets/resolve', { name: 'ERP_Login', type: 'Credential' }); assert.equal(denied.status, 401);
  assert.equal((await save('development', 'ERP_URL', 'String', 'https://updated.example', 1)).status, 200); assert.equal((await submit('development')).view.outputs.url, 'https://updated.example');
  await request('/api/v1/studio-assets/profiles', { id: 'production', name: 'production', enabled: false }); assert.equal((await submit('production')).status, 400);
  await request('/api/v1/studio-assets/values', { profileId: 'development', name: 'Retries', revision: 1, delete: true }); assert.equal((await submit('development')).status, 400);
  console.log('PASS Production Robot → Python Maestro scoped credential retrieval, pinned environments, typed assets, redacted callbacks/history, updates without republish and missing/disabled preflight');
}
async function queueHttpTest(url, packages, control) {
  const request = async (route, body) => {
    const r = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-API-Key': 'studio-fixture-key', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const configure = async (revision, enabled = true) => assert.equal((await request('/api/v1/studio-queues/configure', { profileId: 'default', name: 'Invoices', enabled, maxRetries: 1, retryDelaySeconds: 3600, leaseSeconds: 30, revision })).status, 200);
  await configure(0);
  const catalog = (await request('/api/v1/robot-jobs/catalog')).body;
  assert.deepEqual(catalog.packages.find(p => p.version === '5.0.0').requiredQueues[0].operations, ['add', 'claim', 'complete']);
  for (const pkg of packages) {
    const reference = 'INV-' + pkg.version;
    const created = await request('/api/v1/robot-jobs', { requestId: crypto.randomUUID(), robotId: 'r1', workflowId: 'queue-' + pkg.version, version: pkg.version, packageId: pkg.definition.portablePackage.id, inputs: { reference }, environmentId: 'default' });
    assert.equal(created.status, 202, JSON.stringify(created.body));
    if (pkg.version === '8.0.0') {
      await waitFor(control.held); assert.equal((await request('/api/v1/robot-jobs/' + created.body.jobId + '/stop', {})).status, 200); control.release();
    }
    let view; await waitFor(async () => { view = (await request('/api/v1/robot-jobs/' + created.body.jobId)).body.job; return ['success', 'failed', 'stopped'].includes(view?.status); });
    assert.equal(view.status, pkg.version === '8.0.0' ? 'stopped' : 'success', view.error);
    const expected = pkg.version === '5.0.0' ? 'successful' : pkg.version === '7.0.0' ? 'failed' : 'retry';
    assert.equal(view.transactions.at(-1).status, expected, JSON.stringify(view.transactions));
    assert.ok(!/leaseToken|lease_hash|leaseToken|assetContext/.test(JSON.stringify(view)));
    const items = (await request('/api/v1/studio-queues?profileId=default&queueName=Invoices')).body.items;
    assert.equal(items.find(item => item.reference === reference).status, expected);
    assert.equal((await request('/api/v1/robot-jobs/' + created.body.jobId + '/queues/operate', { operation: 'claim', queueName: 'Invoices', requestId: 'denied' })).status, 401);
    await waitFor(async () => !(await (await fetch(new URL('/health', 'http://127.0.0.1:' + process.env.RUNWAY_ROBOT_PORT))).json()).activeJob);
  }
  await configure(1, false);
  const pkg = packages[0]; assert.equal((await request('/api/v1/robot-jobs', { requestId: crypto.randomUUID(), robotId: 'r1', workflowId: 'queue-' + pkg.version, version: pkg.version, packageId: pkg.definition.portablePackage.id, inputs: { reference: 'disabled' } })).status, 400);
  console.log('PASS Production Robot → Maestro queue grants, success, Application retry, final Business failure, controlled stop, persisted transaction history and disabled queue preflight');
}
async function scopeHttpTest(url, packages, control) {
  const request = async (route, body) => { const r = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-API-Key': 'studio-fixture-key', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data; };
  await request('/api/v1/studio-queues/configure', { profileId: 'default', name: 'ScopeInvoices', maxRetries: 1, retryDelaySeconds: 3600, leaseSeconds: 30 });
  const catalog = await request('/api/v1/robot-jobs/catalog'); assert.ok(catalog.packages.find(p => p.version === '9.0.0').requiredQueues[0].operations.includes('complete'));
  for (const pkg of packages) {
    const reference = 'SCOPE-' + pkg.version;
    const created = await request('/api/v1/robot-jobs', { requestId: crypto.randomUUID(), robotId: 'r1', workflowId: 'scope-' + pkg.version, version: pkg.version, packageId: pkg.definition.portablePackage.id, inputs: { reference } });
    if (pkg.version === '13.0.0') { await waitFor(control.held); await request('/api/v1/robot-jobs/' + created.jobId + '/stop', {}); control.release(); }
    let view; await waitFor(async () => { view = (await request('/api/v1/robot-jobs/' + created.jobId)).job; return ['success', 'failed', 'stopped'].includes(view?.status); });
    assert.equal(view.status, pkg.version === '13.0.0' ? 'stopped' : pkg.version === '12.0.0' ? 'failed' : 'success', view.error);
    const item = (await request('/api/v1/studio-queues?profileId=default&queueName=ScopeInvoices')).items.find(v => v.reference === reference);
    assert.equal(item.status, pkg.version === '9.0.0' ? 'successful' : pkg.version === '11.0.0' ? 'failed' : 'retry');
    if (pkg.version === '10.0.0') assert.ok(view.transactions.some(v => v.phase === 'recovery-completed'));
    if (pkg.version === '12.0.0') assert.ok(view.transactions.some(v => v.phase === 'recovery-failed'));
    if (['9.0.0', '11.0.0', '13.0.0'].includes(pkg.version)) assert.ok(!view.transactions.some(v => v.phase === 'recovery-started'));
    assert.ok(!JSON.stringify(view).includes('leaseToken'));
    await waitFor(async () => !(await (await fetch('http://127.0.0.1:' + process.env.RUNWAY_ROBOT_PORT + '/health')).json()).activeJob);
  }
  console.log('PASS Robot Jobs → Maestro Transaction Scope auto-commit grants, Business final failure, queue retry, packaged recovery and recovery failure/Stop history');
}
async function humanHttpTest(url, packages, control) {
  const request=async(route,body,token)=>{const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-API-Key':'studio-fixture-key','X-Runway-Task-Token':token??''},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()}};
  const personal=(await request('/api/v1/human-tasks/operators',{id:'onur',name:'Onur',roles:['finance']})).body.personalToken;assert.ok(personal);
  assert.equal((await request('/api/v1/studio-queues/configure',{name:'HumanPreparations',profileId:'default',maxRetries:1,retryDelaySeconds:0,leaseSeconds:30})).status,200);
  for (const pkg of packages) {
    const created=await request('/api/v1/robot-jobs',{requestId:crypto.randomUUID(),robotId:'r1',workflowId:'human-'+pkg.version,version:pkg.version,packageId:pkg.definition.portablePackage.id,inputs:{}});assert.equal(created.status,202,JSON.stringify(created.body));
    let view;await waitFor(async()=>{view=(await request('/api/v1/robot-jobs/'+created.body.jobId)).body.job;return view?.status==='waiting'||view?.status==='failed'},15000);assert.equal(view.status,'waiting',view.error);await waitFor(async()=>!(await(await fetch('http://127.0.0.1:'+process.env.RUNWAY_ROBOT_PORT+'/health')).json()).activeJob);
    const task=view.waitingTask.id;assert.equal(control.calls().filter(v=>v==='log-message:BEFORE_HUMAN_'+pkg.version).length,1);
    if(pkg.version==='14.0.0')await control.restart();
    const expected=pkg.version==='14.0.0'?'Approved':pkg.version==='15.0.0'?'Rejected':pkg.version==='16.0.0'?'TimedOut':'Cancelled';
    if(expected==='Cancelled'){assert.equal((await request('/api/v1/robot-jobs/'+view.jobId+'/stop',{})).status,200)}
    else if(expected==='TimedOut'){await request('/fixture/control',{expireTask:task})}
    else {const body={taskId:task,requestId:crypto.randomUUID(),decision:expected,fields:{costCenter:'FIN'},comment:'HTTP review'};assert.equal((await request('/api/v1/human-tasks/decide',body)).status,403);assert.equal((await request('/api/v1/human-tasks/decide',body,personal)).status,200);assert.equal((await request('/api/v1/human-tasks/decide',body,personal)).status,200)}
    await waitFor(async()=>{view=(await request('/api/v1/robot-jobs/'+view.jobId)).body.job;return ['success','failed','stopped'].includes(view?.status)},20000);assert.equal(view.status,expected==='Cancelled'?'stopped':'success',view.error);
    assert.equal(control.calls().filter(v=>v==='log-message:BEFORE_HUMAN_'+pkg.version).length,1);if(expected!=='Cancelled'){assert.equal(view.outputs.decision,expected);assert.ok(view.humanTasks.some(v=>v.phase==='resumed'&&v.decision===expected))}else assert.ok(!control.calls().some(v=>v.includes('AFTER_HUMAN_'+pkg.version)));
    assert.ok(view.transactions.some(v=>v.queueName==='HumanPreparations'&&v.status==='successful'));assert.ok(!JSON.stringify(view).includes(personal));await waitFor(async()=>!(await(await fetch('http://127.0.0.1:'+process.env.RUNWAY_ROBOT_PORT+'/health')).json()).activeJob);
  }
  console.log('PASS Real Maestro/Robot human task create → durable wait → server restart → approval/reject/timeout/resume; Robot released, no earlier activity replay, cancellation and personal identity audit');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
