const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-history-'));
const memory = new Map();
global.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
global.crypto ||= require('node:crypto').webcrypto;
let execute = async () => ({ success: true, log: 'Done', outputs: { result: 'OK' } });
let captures = 0;
global.window = { electronAPI: { executeActivity: (...args) => execute(...args), captureFailureScreenshot: async () => { captures++; return { image: 'data:image/jpeg;base64,fixture' }; } } };
const node = (id, activityId = 'fixture', extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties: {}, ...extra } });
const noop = () => {};

async function main() {
  await esbuild.build({ stdin: { contents: `export * from './src/engine/executor'; export * from './src/store/executionHistoryStore'; export * from './src/engine/runwayConnection';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  const { executeWorkflow, requestStop, useExecutionHistoryStore: history, getSavedServerUrl } = require(path.join(out, 'engine.cjs'));
  const run = (nodes, variables = [], options = {}) => executeWorkflow(nodes, [], variables, noop, noop, noop, { projectName: 'Fixture', ...options });
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
  await test('Resolved inputs, outputs, immutable snapshots and persistence', async () => {
    await run([node('one', 'fixture', { properties: { text: '{{value}}' } })], [{ name: 'value', defaultValue: 'hello' }]);
    const r = history.getState().runs[0];
    assert.equal(r.status, 'completed'); assert.equal(r.steps[0].inputs.text, 'hello'); assert.equal(r.steps[0].outputs.result, 'OK');
    assert.ok(r.steps[0].endedAt >= r.steps[0].startedAt); assert.equal(JSON.parse(memory.get('runway.execution-history.v1'))[0].status, 'completed');
  });
  await test('Native failure preserves error, screenshot and failing node', async () => {
    execute = async () => ({ success: false, log: 'Target not found' });
    assert.equal(await run([node('failure')]), 'error');
    const s = history.getState().runs[0].steps[0]; assert.match(s.error, /Target not found/); assert.ok(s.screenshot); assert.equal(s.status, 'error');
  });
  await test('Bridge exception is recorded and completes the run', async () => {
    execute = async () => { throw Error('IPC disconnected'); };
    assert.equal(await run([node('exception')]), 'error'); assert.match(history.getState().runs[0].steps[0].error, /IPC disconnected/);
  });
  await test('Recovered retry retains separate failed and successful attempts', async () => {
    let attempt = 0; execute = async () => ({ success: ++attempt > 1, log: attempt === 1 ? 'Transient failure' : 'Recovered' });
    const parent = node('retry', 'retry-scope', { isContainer: true, childIds: ['child'], properties: { maxRetries: 1, retryDelay: 0 } });
    assert.equal(await run([parent, node('child', 'fixture', { parentId: 'retry' })]), 'completed');
    const r = history.getState().runs[0]; assert.equal(r.steps.length, 3); assert.equal(r.steps[1].status, 'error'); assert.equal(r.steps[2].status, 'completed'); assert.notEqual(r.steps[1].id, r.steps[2].id);
  });
  await test('Caught failure does not mark its run as failed', async () => {
    execute = async (id) => ({ success: id !== 'bad', log: id === 'bad' ? 'Caught failure' : 'Handled' });
    const parent = node('try', 'try-catch', { isContainer: true, branches: [{ kind: 'try', childIds: ['bad'] }, { kind: 'catch', childIds: ['handler'] }] });
    assert.equal(await run([parent, node('bad', 'bad', { parentId: 'try' }), node('handler', 'handler', { parentId: 'try' })]), 'completed');
    assert.equal(history.getState().runs[0].steps[1].status, 'error');
  });
  await test('Stop unblocks debug and does not execute the paused activity', async () => {
    let calls = 0; execute = async () => { calls++; return { success: true, log: 'Done' }; };
    const pending = run([node('paused')], [], { debug: true, hasBreakpoint: () => true, onPause: () => setTimeout(requestStop, 0) });
    assert.equal(await pending, 'stopped'); assert.equal(calls, 0); assert.equal(history.getState().runs[0].steps[0].status, 'stopped');
  });
  await test('Screenshots can be disabled and are capped per run', async () => {
    execute = async () => ({ success: false, log: 'Failure' }); history.getState().setCaptureScreenshots(false);
    let before = captures; await run([node('disabled')]); assert.equal(captures, before);
    history.getState().setCaptureScreenshots(true);
    await run([node('retry', 'retry-scope', { isContainer: true, childIds: ['child'], properties: { maxRetries: 5, retryDelay: 0 } }), node('child', 'fixture', { parentId: 'retry' })]);
    assert.equal(captures - before, 3);
  });
  await test('Credential values are masked in resolved properties and errors', async () => {
    execute = async () => ({ success: false, log: 'Rejected fixture-secret' });
    await run([node('private', 'fixture', { properties: { text: '{{password}}', password: 'fixture-secret' } })], [{ name: 'password', defaultValue: 'fixture-secret' }]);
    assert.ok(!JSON.stringify(history.getState().runs[0]).includes('fixture-secret'));
  });
  await test('Collection snapshots are independent across steps', async () => {
    await run([node('create', 'create-list', { properties: { output: 'items' } }), node('add', 'add-to-collection', { properties: { collection: 'items', value: 'first' } })]);
    const steps = history.getState().runs[0].steps; assert.deepEqual(steps[0].outputs.items, []); assert.deepEqual(steps[1].outputs.items, ['first']);
  });
  await test('History retention, storage limits and clearing', async () => {
    execute = async () => ({ success: true, log: 'Done' });
    for (let i = 0; i < 22; i++) await run([node('retention')]);
    assert.equal(history.getState().runs.length, 20); assert.ok(memory.get('runway.execution-history.v1').length <= 1500000);
    history.getState().clear(); assert.equal(history.getState().runs.length, 0); assert.equal(memory.has('runway.execution-history.v1'), false);
  });
  await test('Fixed Runway IP keeps the configured port and base path', async () => {
    assert.equal(getSavedServerUrl(), 'http://10.211.55.2:5050'); memory.set('runway.studio.serverUrl', 'http://172.20.10.12:5050/runway/'); assert.equal(getSavedServerUrl(), 'http://10.211.55.2:5050/runway');
  });
  await test('Activity recording limit does not stop execution', async () => {
    let calls = 0; execute = async () => { calls++; return { success: true, log: 'Done' }; };
    await run(Array.from({ length: 305 }, (_, i) => node('bounded-' + i)));
    assert.equal(calls, 305); assert.equal(history.getState().runs[0].steps.length, 300); assert.equal(history.getState().runs[0].truncated, true);
  });
  await test('Storage failure never fails a workflow', async () => {
    const original = localStorage.setItem; localStorage.setItem = () => { throw Error('Quota exceeded'); };
    try { assert.equal(await run([node('quota')]), 'completed'); assert.match(history.getState().storageWarning, /session/); }
    finally { localStorage.setItem = original; }
  });
  await test('Large snapshots fit the persistence budget', async () => {
    const now = Date.now(); const huge = { id: 'huge', projectName: 'Large', filePath: null, startedAt: now, status: 'completed', debug: false,
      steps: Array.from({ length: 300 }, (_, i) => ({ id: String(i), nodeId: 'n', activityId: 'fixture', label: 'n', startedAt: now, status: 'completed', inputs: 'x'.repeat(8000), outputs: 'y'.repeat(8000) })) };
    history.getState().publish(huge, true); assert.ok(memory.get('runway.execution-history.v1').length <= 1500000); assert.equal(JSON.parse(memory.get('runway.execution-history.v1'))[0].truncated, true);
  });
  console.log(`${passed} engine scenarios passed`);

  // Render the actual panel with an isolated fixture, without connecting to Runway.
  await esbuild.build({ stdin: { contents: `
    import React from 'react';
    import App from './src/App';
    import {createRoot} from 'react-dom/client';
    import {BottomPanel} from './src/components/BottomPanel/BottomPanel';
    import {Toolbar} from './src/components/Toolbar/Toolbar';
    import {SequenceCanvas} from './src/components/SequenceCanvas/SequenceCanvas';
    import {useExecutionHistoryStore} from './src/store/executionHistoryStore';
    import {useWorkflowStore} from './src/store/workflowStore';
    import {useUiStore} from './src/store/uiStore';
    import './src/App.css';
    window.fixture={history:useExecutionHistoryStore,workflow:useWorkflowStore,ui:useUiStore};
    window.copiedText='';window.electronAPI={copyText:async text=>{if(window.copyFails)return false;window.copiedText=text;return true;},requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=>'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],requestStudioAssets:async()=>({status:200,body:JSON.stringify({ok:true,profiles:[],assets:[]})}),saveWorkflow:async()=>({path:'C:/fixture.rpa.json'}),executeActivity:async()=>({success:false,log:'Fixture target not found'})};
    useUiStore.getState().setActiveBottomPanelTab('history');
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', outfile: path.join(out, 'panel.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="panel.css"></head><body style="margin:0;font-family:Segoe UI"><div id="root"></div><script src="panel.js"></script></body></html>');
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
    await page.getByText('No runs yet.', { exact: false }).waitFor();
    await page.evaluate(() => {
      const step = { id: 'attempt-1', nodeId: 'node-1', label: 'Read invoice amount', activityId: 'get-text', startedAt: Date.now() - 234, endedAt: Date.now(), status: 'error', inputs: { selector: '#invoice-total' }, error: ['Target not found: #invoice-total','Selector: Esra'].join(String.fromCharCode(10)), screenshotNote: 'Screenshot capture was disabled.' };
      window.fixture.workflow.setState({ projectName: 'Invoice processing', filePath: null, nodes: [
        { id: 'parent', position: { x: 0, y: 0 }, data: { activityId: 'use-app-browser', label: 'Invoice application', properties: {}, childIds: ['node-1'], isContainer: true, collapsed: true } },
        { id: 'node-1', position: { x: 0, y: 0 }, data: { activityId: 'get-text', label: 'Read invoice amount', parentId: 'parent', properties: {} } }
      ] });
      window.fixture.history.getState().publish({ id: 'run-1', projectName: 'Invoice processing', filePath: null, status: 'error', startedAt: Date.now() - 1000, endedAt: Date.now(), steps: [step] });
    });
    await page.getByRole('button', { name: 'Show on canvas' }).click();
    assert.equal(await page.evaluate(() => window.fixture.workflow.getState().selectedNodeId), 'node-1');
    assert.equal(await page.evaluate(() => window.fixture.workflow.getState().nodes[0].data.collapsed), false);
    await page.locator('.seq-canvas--history-error .seq-card--selected').waitFor();
    const errorText = await page.locator('.rh-error-text').innerText();
    await page.getByRole('button', { name: 'Copy error', exact: true }).click();
    assert.equal(await page.evaluate(() => window.copiedText), errorText);
    await page.getByRole('status').filter({ hasText: /^Copied$/ }).waitFor();
    await page.evaluate(() => { window.copyFails=true; });
    await page.getByRole('button', { name: 'Copy error', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /Copy failed/ }).waitFor();
    await page.evaluate(() => {
      window.copyFails=false;window.copiedText='';
      const range=document.createRange();range.selectNodeContents(document.querySelector('.rh-error-text'));
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    });
    await page.keyboard.press('Control+c');
    await page.waitForFunction(text => window.copiedText === text, errorText);
    assert.equal(await page.evaluate(() => window.fixture.workflow.getState().clipboard), null);
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.keyboard.press('Control+c');
    assert.equal(await page.evaluate(() => window.fixture.workflow.getState().clipboard.node.id), 'node-1');
    console.log('PASS Copy error exact multiline text, clipboard failure feedback, selected text Ctrl+C and activity clipboard without text selection');
    await page.getByRole('checkbox', { name: 'Errors only', exact: true }).check();
    await page.screenshot({ path: path.join(out, 'history-panel.png') });
    await page.getByRole('button', { name: 'Clear history' }).click();
    await page.getByText('No runs yet.', { exact: false }).waitFor();
    await page.evaluate(() => window.fixture.workflow.setState({ nodes: [{ id: 'run-failure', position: { x: 0, y: 0 }, data: { activityId: 'get-text', label: 'Integration failure', properties: {} } }] }));
    await page.getByTitle('Run (F5)', { exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture target not found' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.ui.getState().activeBottomPanelTab), 'history');
    assert.equal(await page.evaluate(() => window.fixture.history.getState().runs[0].filePath), 'C:/fixture.rpa.json');
    await page.getByRole('button', { name: 'Show on canvas' }).click();
    await page.locator('.seq-canvas--history-error .seq-card--selected').waitFor();
    await page.screenshot({ path: path.join(out, 'history-integration.png') });
    assert.deepEqual(errors, []);
    console.log('PASS panel empty state, failure details, canvas selection, filtering and clear');
    console.log('Preview: ' + path.join(out, 'history-panel.png'));
  } finally { await browser.close(); }
  // Exercise the production desktop capture function in Electron, without opening Studio.
  await esbuild.build({ entryPoints: [path.join(root, 'electron/executionScreenshot.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(out, 'capture.cjs') });
  fs.writeFileSync(path.join(out, 'native.cjs'), `const {app,nativeImage}=require('electron'); const fs=require('fs'); app.disableHardwareAcceleration(); app.whenReady().then(async()=>{ const r=await require('./capture.cjs').captureFailureScreenshot(); if(!r.image) throw Error(r.error); const size=nativeImage.createFromDataURL(r.image).getSize(); if(!size.width || !size.height) throw Error('Empty capture'); fs.writeFileSync(${JSON.stringify(path.join(out, 'native-result.json'))},JSON.stringify(size)); app.quit(); }).catch(e=>{console.error(e);app.exit(1)});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const native = require('node:child_process').spawnSync(require('electron'), [path.join(out, 'native.cjs')], { env, windowsHide: true, timeout: 20000, encoding: 'utf8' });
  assert.equal(native.status, 0, native.error?.message || native.stderr || native.stdout);
  const size = JSON.parse(fs.readFileSync(path.join(out, 'native-result.json'), 'utf8'));
  console.log(`PASS native Electron desktop JPEG capture (${size.width} x ${size.height})`);
  console.log('Artifacts: ' + out);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
