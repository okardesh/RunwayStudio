const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-explorer-'));
const storage = new Map();
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
global.crypto ||= require('node:crypto').webcrypto;
let activity = async () => ({ success: true, log: 'Done' });
global.window = { electronAPI: { executeActivity: (...args) => activity(...args) } };
const node = (id, activityId, properties) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties } });
const variable = (name, defaultValue = '') => ({ id: name, name, defaultValue, type: 'String', scope: 'Main' });

async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/engine/testRunner';export * from './src/engine/executor';export * from './src/store/workflowStore';export * from './src/store/executionHistoryStore';export * from './src/store/testExplorerStore';export * from './src/shared/workflowTests';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  const e = require(path.join(out, 'engine.cjs')), workflow = e.useWorkflowStore, history = e.useExecutionHistoryStore, library = e.useTestExplorerStore;
  const load = (nodes = [node('Read', 'get-text', { selector: '#{{element}}', output: 'textResult' })], variables = [variable('element'), variable('textResult')]) => workflow.getState().loadWorkflow({ nodes, edges: [], variables, projectName: 'Test fixture' }, 'C:/fixture/test.rpa.json');
  const makeTest = (rows = [{ name: 'Success', inputs: { element: 'one' }, expected: { textResult: 'Welcome' } }, { name: 'Mismatch', inputs: { element: 'two' }, expected: { textResult: 'Welcome' } }]) => ({ id: crypto.randomUUID(), workflowKey: e.testWorkflowKey('C:/fixture/test.rpa.json', 'Test fixture'), name: 'Greeting extraction', rows: rows.map(row => ({ id: crypto.randomUUID(), ...row })) });
  let passed = 0; const test = async (name, fn) => { history.getState().clear(); await fn(); passed++; console.log('PASS ' + name); };
  await test('Typed expectations compare deep JSON values and safe Watch expressions', async () => {
    const expected = { value: { a: 1, b: [false, null] }, 'text.Trim()': 'Hi', 'items.Count': 2, count: 0 };
    assert.ok(e.assertTestValues(expected, { value: { b: [false, null], a: 1 }, text: ' Hi ', items: [1, 2], count: 0 }, []).every(a => a.passed));
    assert.equal(e.assertTestValues({ count: '0' }, { count: 0 }, [])[0].passed, false);
    assert.equal(e.assertTestValues({ value: {} }, { value: new Date() }, [])[0].passed, false);
    assert.equal(e.assertTestValues({ value: [] }, { value: new Array(2) }, [])[0].passed, false);
    assert.equal(e.assertTestValues({ missing: null }, {}, [])[0].passed, false);
    assert.equal(e.assertTestValues({ 'value.constructor': null }, { value: {} }, [])[0].passed, false);
    assert.throws(() => e.parseTestObject('[]'), /JSON object/); assert.throws(() => e.parseTestObject('{"n":1e999}'), /finite/);
  });
  await test('Library saves validated definitions and storage failure never claims success', async () => {
    const definition = makeTest(); library.getState().save(definition); definition.rows[0].expected.textResult = 'mutated';
    assert.equal(library.getState().tests.find(t => t.id === definition.id).rows[0].expected.textResult, 'Welcome');
    const before = JSON.stringify(library.getState().tests), original = localStorage.setItem;
    localStorage.setItem = () => { throw Error('Quota'); };
    try { assert.throws(() => library.getState().save(makeTest()), /could not be saved/); assert.throws(() => library.getState().remove(definition.id), /could not be saved/); } finally { localStorage.setItem = original; }
    assert.equal(JSON.stringify(library.getState().tests), before);
    assert.throws(() => library.getState().save(makeTest([{ name: 'No checks', inputs: {}, expected: {} }])), /expected values/);
  });
  await test('Different rows generate passed and failed history without changing the canvas or saving files', async () => {
    load(); const before = JSON.stringify([workflow.getState().nodes, workflow.getState().variables, workflow.getState().filePath, workflow.getState().isDirty]);
    activity = async (_id, properties) => ({ success: true, log: 'Read', outputs: { textResult: properties.selector === '#one' ? 'Welcome' : 'Ready' } });
    const definition = makeTest(); await e.runWorkflowTests([definition]);
    const runs = history.getState().runs; assert.equal(runs.length, 2); assert.deepEqual(runs.map(r => r.test.status), ['failed', 'passed']);
    assert.ok(runs.every(r => r.status === 'completed' && r.test.testId === definition.id)); assert.equal(new Set(runs.map(r => r.test.batchId)).size, 1);
    assert.equal(runs[0].test.assertions[0].actual, 'Ready'); assert.equal(runs[0].test.assertions[0].expected, 'Welcome');
    assert.equal(JSON.stringify([workflow.getState().nodes, workflow.getState().variables, workflow.getState().filePath, workflow.getState().isDirty]), before);
    assert.match(library.getState().progress, /1 passed · 1 failed/); assert.equal(library.getState().active, false);
    assert.ok(JSON.parse(storage.get('runway.execution-history.v1')).some(r => r.test.status === 'failed'));
  });
  await test('All rows preflight before side effects and tests cannot cross workflows', async () => {
    load(); let calls = 0; activity = async () => { calls++; return { success: true }; };
    const invalid = makeTest(); invalid.rows[1].inputs = { undeclared: 'bad' }; await assert.rejects(e.runWorkflowTests([invalid]), /Unknown input variable/);
    invalid.workflowKey = 'draft:other'; await assert.rejects(e.runWorkflowTests([invalid]), /different workflow/);
    assert.equal(calls, 0); assert.equal(history.getState().runs.length, 0);
  });
  await test('Each row resets mutable defaults and can assert complete collections', async () => {
    load([node('Add', 'add-to-collection', { collection: 'items', value: 'x' })], [variable('items', [])]);
    const definition = makeTest([1, 2].map(n => ({ name: 'Row ' + n, inputs: {}, expected: { items: ['x'], 'items.Count': 1 } })));
    await e.runWorkflowTests([definition]); assert.ok(history.getState().runs.every(r => r.test.status === 'passed'));
    assert.deepEqual(workflow.getState().variables[0].defaultValue, []);
  });
  await test('Execution errors remain errors and do not become assertion mismatches', async () => {
    load(); activity = async () => ({ success: false, log: 'Expected native failure' }); await e.runWorkflowTests([makeTest()]);
    assert.ok(history.getState().runs.every(r => r.status === 'error' && r.test.status === 'error' && !r.test.assertions.length));
  });
  await test('Stop ends the batch after its current activity and concurrent runs are rejected', async () => {
    load(); let release, started; const gate = new Promise(r => release = r), ready = new Promise(r => started = r); let calls = 0;
    activity = async () => { calls++; started(); await gate; return { success: true, log: 'Done', outputs: { textResult: 'Welcome' } }; };
    const pending = e.runWorkflowTests([makeTest()]); await ready;
    await assert.rejects(e.runWorkflowTests([makeTest()]), /Stop the current/);
    await assert.rejects(e.executeWorkflow([], [], [], () => {}, () => {}, () => {}), /already running/);
    e.stopTestRun(); release(); await pending; assert.equal(calls, 1); assert.equal(history.getState().runs[0].test.status, 'stopped'); assert.match(library.getState().progress, /Stopped/); assert.equal(library.getState().active, false);
  });
  await test('Test details mask credentials and regular Run does not inherit test metadata', async () => {
    load(undefined, [variable('element'), variable('textResult'), variable('apiToken')]); activity = async () => ({ success: true, log: 'Read', outputs: { textResult: 'secret-value' } });
    await e.runWorkflowTests([makeTest([{ name: 'Credentials', inputs: { apiToken: 'secret-value' }, expected: { apiToken: 'secret-value', textResult: 'secret-value' } }])]);
    const run = history.getState().runs[0]; assert.equal(run.test.status, 'passed'); assert.ok(!JSON.stringify(run).includes('secret-value'));
    await e.executeWorkflow([node('normal', 'log-message', { message: 'ok' })], [], [], () => {}, () => {}, () => {}); assert.equal(history.getState().runs[0].test, undefined);
  });
  await realBrowser(e, load, makeTest, history);
  console.log(passed + ' Test Explorer scenarios passed, plus real browser data rows');
  await uiTest(); console.log('Artifacts: ' + out);
}

async function realBrowser(e, load, makeTest, history) {
  await esbuild.build({ entryPoints: [path.join(root, 'electron/automation/browser.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['playwright-core'], outfile: path.join(out, 'browser.cjs') });
  const p = path.join(out, 'browser.cjs'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
  const { runBrowserActivity } = require(p); fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><meta charset="utf-8"><div id="one">Welcome</div><div id="two">Ready</div>');
  try {
    assert.equal((await runBrowserActivity('open-browser', { url: pathToFileURL(path.join(out, 'fixture.html')).href, headless: true })).success, true);
    history.getState().clear(); load(); activity = runBrowserActivity; await e.runWorkflowTests([makeTest()]);
    assert.deepEqual(history.getState().runs.map(r => r.test.status), ['failed', 'passed']);
    console.log('PASS Real Get Text with two input data rows records pass / fail and actual values in Run History');
  } finally { await runBrowserActivity('close-browser', {}); }
}

async function uiTest() {
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useUiStore} from './src/store/uiStore';import {useTestExplorerStore} from './src/store/testExplorerStore';import {useExecutionHistoryStore} from './src/store/executionHistoryStore';window.fixture={workflow:useWorkflowStore,ui:useUiStore,tests:useTestExplorerStore,history:useExecutionHistoryStore};window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],saveWorkflow:async()=>{throw Error('Tests must not save workflows');},executeActivity:async(id,p)=>({success:true,log:'Read',outputs:{textResult:p.selector==='#one'?'Welcome':'Ready'}})};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.evaluate(() => fixture.workflow.getState().loadWorkflow({ projectName: 'Greeting workflow', nodes: [{ id: 'read', position: { x: 0, y: 0 }, data: { activityId: 'get-text', label: 'Read greeting', properties: { selector: '#{{element}}', output: 'textResult' } } }], edges: [], variables: ['element', 'textResult'].map(name => ({ id: name, name, type: 'String', defaultValue: '', scope: 'Main' })) }, 'C:/fixture/greetings.rpa.json'));
    const before = await page.evaluate(() => JSON.stringify([fixture.workflow.getState().nodes, fixture.workflow.getState().variables, fixture.workflow.getState().isDirty]));
    await page.getByRole('button', { name: 'Test Explorer', exact: true }).click(); await page.getByRole('button', { name: 'New test', exact: true }).click();
    await page.getByRole('textbox', { name: 'Test name', exact: true }).fill('Greeting extraction'); await page.getByRole('textbox', { name: 'Data row name', exact: true }).fill('Success');
    await page.getByRole('textbox', { name: 'Test inputs JSON', exact: true }).fill('{invalid'); await page.getByRole('button', { name: 'Save test', exact: true }).click(); await page.locator('.te-error').waitFor();
    await page.getByRole('textbox', { name: 'Test inputs JSON', exact: true }).fill('{"element":"one"}'); await page.getByRole('textbox', { name: 'Expected values JSON', exact: true }).fill('{"textResult":"Welcome", "textResult.Length":7}');
    await page.getByRole('button', { name: 'Add row', exact: true }).click(); await page.getByRole('textbox', { name: 'Data row name', exact: true }).fill('Mismatch');
    await page.getByRole('textbox', { name: 'Test inputs JSON', exact: true }).fill('{"element":"two"}'); await page.getByRole('textbox', { name: 'Expected values JSON', exact: true }).fill('{"textResult":"Welcome"}');
    await page.getByRole('button', { name: 'Save test', exact: true }).click(); await page.getByRole('button', { name: 'Run test', exact: true }).click();
    await page.waitForFunction(() => !fixture.tests.getState().active && fixture.history.getState().runs.length === 2);
    assert.deepEqual(await page.evaluate(() => fixture.history.getState().runs.map(r => r.test.status)), ['failed', 'passed']);
    assert.equal(await page.evaluate(() => JSON.stringify([fixture.workflow.getState().nodes, fixture.workflow.getState().variables, fixture.workflow.getState().isDirty])), before);
    await page.screenshot({ path: path.join(out, 'test-explorer-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'test-explorer-light.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 750 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); await page.screenshot({ path: path.join(out, 'test-explorer-compact.png'), animations: 'disabled' });
    await page.locator('.te-results').getByRole('button', { name: /Greeting extraction \/ Success/ }).click(); await page.getByRole('region', { name: 'Test assertions', exact: true }).getByText('Test passed: Greeting extraction / Success', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Test Explorer', exact: true }).click(); await page.locator('.te-results').getByRole('button', { name: /Greeting extraction \/ Mismatch/ }).click();
    await page.getByRole('region', { name: 'Test assertions', exact: true }).getByText('Ready', { exact: true }).waitFor(); await page.screenshot({ path: path.join(out, 'test-history-failed.png'), animations: 'disabled' });
    await page.reload(); await page.locator('.app-header').waitFor(); assert.equal(await page.evaluate(() => fixture.tests.getState().tests[0].rows.length), 2); assert.equal(await page.evaluate(() => fixture.history.getState().runs[0].test.status), 'failed');
    await page.getByRole('button', { name: 'Test Explorer', exact: true }).click(); await page.locator('.te-list').getByRole('button', { name: /Greeting extraction/ }).click();
    await page.getByRole('button', { name: 'Run all', exact: true }).click(); await page.waitForFunction(() => !fixture.tests.getState().active && fixture.history.getState().runs.length === 4);
    await page.getByRole('button', { name: 'Remove row', exact: true }).click(); await page.getByRole('button', { name: 'Revert', exact: true }).click(); assert.equal(await page.getByRole('combobox', { name: 'Data row', exact: true }).locator('option').count(), 2);
    await page.getByRole('button', { name: 'Delete test', exact: true }).click(); assert.equal(await page.evaluate(() => fixture.tests.getState().tests.length), 0);
    assert.deepEqual(errors, []); console.log('PASS UI create/edit/save/data rows, invalid JSON, Run test/all, history links, persistence, Revert/Delete, Dark/Light and compact layout');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
