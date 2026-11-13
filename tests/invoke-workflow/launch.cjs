const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-invoke-'));
const storage = new Map(); global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
global.crypto ||= require('node:crypto').webcrypto;
let activity = async (id, p) => id === 'throw' ? { success: false, log: 'Expected failure' } : { success: true, log: 'Done', ...(id === 'assign' ? { outputs: { [p.to]: p.value } } : {}) };
global.window = { electronAPI: { executeActivity: (...args) => activity(...args) } };
const n = (id, activityId, properties, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
const v = (name, defaultValue = '', type = 'String') => ({ id: name, name, defaultValue, type, scope: 'Main' });
const arg = (name, direction = 'In', type = 'String', required = false, defaultValue = '') => ({ id: name, name, direction, type, required, defaultValue });
const def = (name, nodes, args = [], variables = []) => ({ projectName: name, nodes, edges: [], variables, arguments: args });
const write = (name, value) => { const file = path.join(out, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
const child = () => def('Read greeting', [n('assign', 'assign', { to: 'outText', value: '{{inText}}' }), n('log', 'log-message', { message: 'outText' })], [arg('inText', 'In', 'String', true), arg('outText', 'Out')]);
const invoke = (file = 'child.rpa.json', extra = {}) => n('call', 'invoke-workflow', { workflowFile: file, inArguments: { inText: '{{callerValue}}' }, outArguments: { outText: 'answer' } }, extra);
async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/engine/executor';export * from './src/shared/invokedWorkflows';export * from './src/store/debugStore';export * from './src/store/executionHistoryStore';export * from './src/engine/analyzeInvocations';export * from './src/engine/workflowAnalyzer';export * from './src/store/workflowStore';export * from './src/engine/testRunner';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  await esbuild.build({ entryPoints: [path.join(root, 'electron/workflowFiles.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'files.cjs') });
  const e = require(path.join(out, 'engine.cjs')), { readInvokedWorkflow } = require(path.join(out, 'files.cjs'));
  const load = async (requested, caller) => { const result = await readInvokedWorkflow(requested, caller); return { path: result.path, definition: e.parseWorkflowDefinition(result.content) }; };
  window.electronAPI.readInvokedWorkflow = readInvokedWorkflow;
  const parentPath = write('parent.rpa.json', def('Parent', [invoke()]));
  const run = (nodes = [invoke()], variables = [v('callerValue', 'Welcome'), v('answer', 'before')], options = {}) => e.executeWorkflow(nodes, [], variables, () => {}, () => {}, () => {}, { projectName: 'Parent', filePath: parentPath, loadWorkflow: load, ...options });
  const history = e.useExecutionHistoryStore, debug = e.useDebugStore;
  let count = 0; const test = async (name, fn) => { history.getState().clear(); write('child.rpa.json', child()); await fn(); count++; console.log('PASS ' + name); };
  await test('Real read-only file resolver handles relative paths and rejects non-workflow files', async () => {
    const loaded = await load('child.rpa.json', parentPath); assert.equal(loaded.definition.projectName, 'Read greeting');
    await assert.rejects(readInvokedWorkflow('child.rpa.json', null), /Save the calling/); await assert.rejects(readInvokedWorkflow('file.xaml', parentPath), /rpa.json/);
    write('invalid.rpa.json', { nodes: [] }); await assert.rejects(load('invalid.rpa.json', parentPath), /valid Studio/);
  });
  await test('In/Out values transfer through real files with linked parent/child history', async () => {
    assert.equal(await run(), 'completed'); const runs = history.getState().runs, parent = runs.find(r => !r.parentRunId), called = runs.find(r => r.parentRunId);
    assert.equal(runs.length, 2); assert.equal(called.parentRunId, parent.id); assert.equal(called.rootRunId, parent.id); assert.equal(called.invocationNodeId, 'call');
    assert.equal(parent.steps[0].outputs.answer, 'Welcome'); assert.equal(called.arguments.inputs.inText, 'Welcome'); assert.equal(called.arguments.outputs.outText, 'Welcome');
  });
  await test('Root arguments initialize typed defaults, support explicit inputs and validate outputs', async () => {
    const options = { arguments: [arg('inNumber', 'In', 'Int32', true), arg('outNumber', 'Out', 'Int32')], initialValues: { inNumber: 42 } };
    assert.equal(await run([n('copy', 'assign', { to: 'outNumber', value: '{{inNumber}}' })], [], options), 'completed');
    assert.equal(history.getState().runs[0].arguments.outputs.outNumber, 42);
    assert.equal(await run([n('copy', 'assign', { to: 'outNumber', value: 'not an integer' })], [], options), 'error');
    assert.equal(await run([n('read', 'log-message', { message: 'inNumber' })], [], { arguments: [arg('inNumber', 'In', 'Int32', true)] }), 'error');
  });
  await test('Structured inputs are deep copied and typed collections reject invalid elements', async () => {
    const definition = def('Collections', [n('add', 'add-to-collection', { collection: 'items', value: 'child' }), n('copy', 'assign', { to: 'result', value: '{{items}}' })], [arg('items', 'In', 'List<String>', true), arg('result', 'Out', 'List<String>')]); write('child.rpa.json', definition);
    const call = invoke(); call.data.properties.inArguments = { items: '{{source}}' }; call.data.properties.outArguments = { result: 'result' };
    assert.equal(await run([call], [v('source', ['parent'], 'List<String>')]), 'completed'); const step = history.getState().runs.find(r => !r.parentRunId).steps[0];
    assert.deepEqual(step.outputs.source, ['parent']); assert.deepEqual(step.outputs.result, ['parent', 'child']);
    assert.throws(() => e.argumentValue([1, 'bad'], 'List<Int32>'), /Int32/); assert.throws(() => e.cloneArgument({ value: NaN }), /finite JSON/);
    let touched = 0; assert.throws(() => e.cloneArgument({ get bad() { touched++; return 1; } }), /accessors/); assert.equal(touched, 0);
  });
  await test('Missing files, missing required mappings, unknown arguments and cycles preflight before all activities', async () => {
    let calls = 0; const original = activity; activity = async (...args) => { calls++; return original(...args); };
    try {
      assert.equal(await run([n('before', 'log-message', { message: '"not executed"' }), invoke('missing.rpa.json')]), 'error'); assert.equal(calls, 0);
      const missing = invoke(); missing.data.properties.inArguments = {}; assert.equal(await run([missing]), 'error'); assert.equal(calls, 0);
      const unknown = invoke(); unknown.data.properties.outArguments = { typo: 'value' }; assert.equal(await run([unknown]), 'error'); assert.equal(calls, 0);
      write('child.rpa.json', def('Bad default', [n('should not run', 'log-message', { message: '"no"' })], [arg('inText', 'In', 'Int32', false, 'not a number'), arg('outText', 'Out')]));
      assert.equal(await run([n('before', 'log-message', { message: '"not executed"' }), invoke()]), 'error'); assert.equal(calls, 0);
      write('child.rpa.json', def('Cycle', [n('recursive', 'invoke-workflow', { workflowFile: 'child.rpa.json' })])); assert.equal(await run(), 'error'); assert.equal(calls, 0);
    } finally { activity = original; }
  });
  await test('Nested calls resolve relative to their caller and snapshot each file for the run', async () => {
    fs.mkdirSync(path.join(out, 'nested'), { recursive: true }); write('nested/leaf.rpa.json', child());
    write('child.rpa.json', def('Middle', [n('inner', 'invoke-workflow', { workflowFile: 'nested/leaf.rpa.json', inArguments: { inText: '{{input}}' }, outArguments: { outText: 'output' } })], [arg('input', 'In', 'String', true), arg('output', 'Out')]));
    const call = invoke(undefined, { breakpoint: true }); call.data.properties.inArguments = { input: '{{callerValue}}' }; call.data.properties.outArguments = { output: 'answer' };
    assert.equal(await run([call], undefined, { debug: true, onPause: () => { write('nested/leaf.rpa.json', def('Changed on disk', [n('wrong', 'throw', { message: 'Should not run' })])); e.resumeDebug('continue'); } }), 'completed');
    const runs = history.getState().runs; assert.equal(runs.length, 3); assert.equal(runs.find(r => !r.parentRunId).steps[0].outputs.answer, 'Welcome'); assert.ok(runs.some(r => r.projectName === 'Read greeting'));
  });
  await test('Step Into shares a call stack, isolates Locals and returns to caller with output values', async () => {
    const seen = [];
    assert.equal(await run([invoke(undefined, { breakpoint: true }), n('after', 'log-message', { message: 'answer' }, { breakpoint: true })], undefined, { debug: true, onPause: (id, location) => {
      const s = debug.getState(); seen.push([id, s.frames.length, location.projectName]);
      if (s.frames.length === 2) { assert.equal(s.locals.find(v => v.name === 'inText').detail, 'Welcome'); assert.ok(!s.locals.some(v => v.name === 'callerValue')); }
      if (id === 'after') assert.equal(s.locals.find(v => v.name === 'answer').detail, 'Welcome');
      e.resumeDebug(id === 'after' ? 'continue' : 'step-into');
    } }), 'completed');
    assert.deepEqual(seen.map(s => s.slice(0, 2)), [['call', 1], ['assign', 2], ['log', 2], ['after', 1]]); assert.equal(debug.getState().frames.length, 0);
  });
  await test('Step Over skips called activities while saved child breakpoints still pause', async () => {
    const seen = []; await run([invoke(undefined, { breakpoint: true }), n('after', 'log-message', { message: 'answer' })], undefined, { debug: true, onPause: id => { seen.push(id); e.resumeDebug(id === 'call' ? 'step-over' : 'continue'); } }); assert.deepEqual(seen, ['call', 'after']);
    const saved = child(); saved.nodes[0].data.breakpoint = true; write('child.rpa.json', saved); const pauses = [];
    await run(undefined, undefined, { debug: true, onPause: id => { pauses.push(id); e.resumeDebug('continue'); } }); assert.deepEqual(pauses, ['assign']);
  });
  await test('Stop in a child unwinds all frames and never copies partial Out values', async () => {
    const saved = child(); saved.nodes[1].data.breakpoint = true; write('child.rpa.json', saved);
    assert.equal(await run(undefined, undefined, { debug: true, onPause: e.requestStop }), 'stopped');
    const runs = history.getState().runs; assert.ok(runs.every(r => r.status === 'stopped')); assert.equal(runs.find(r => !r.parentRunId).steps[0].outputs.answer, 'before'); assert.equal(debug.getState().phase, 'stopped');
  });
  await test('Child failure records its own error without leaking partial outputs; aliases stay redacted', async () => {
    const failing = child(); failing.nodes.push(n('fail', 'throw', { message: 'Expected' })); write('child.rpa.json', failing);
    assert.equal(await run(), 'error'); const runs = history.getState().runs; assert.equal(runs.find(r => !r.parentRunId).steps[0].outputs.answer, 'before'); assert.ok(runs.find(r => r.parentRunId).steps.some(s => s.status === 'error'));
    write('child.rpa.json', child()); history.getState().clear(); const call = invoke(); call.data.properties.inArguments = { inText: '{{apiToken}}' };
    await run([call], [v('apiToken', 'hidden-credential')], { debug: true }); assert.ok(!JSON.stringify(history.getState().runs).includes('hidden-credential')); assert.ok(!JSON.stringify(debug.getState().locals).includes('hidden-credential'));
  });
  await test('Analyzer reads dependencies without executing and recognizes arguments and mapped outputs', async () => {
    const input = { ...def('Parent', [invoke(), n('after', 'log-message', { message: 'answer' })], [], [v('callerValue', 'Welcome')]), targets: [], filePath: parentPath };
    const before = JSON.stringify(input); const checks = await e.analyzeInvocations(input, load); assert.ok(!checks.some(f => f.severity === 'error')); assert.equal(JSON.stringify(input), before);
    assert.ok(!e.analyzeWorkflow(input).findings.some(f => f.code === 'WA207'));
    input.nodes[0].data.properties.inArguments = {}; assert.ok((await e.analyzeInvocations(input, load)).some(f => f.code === 'WA301'));
  });
  await test('Test Explorer passes typed root arguments and asserts mapped subworkflow results', async () => {
    const definition = def('Parent', [invoke()], [arg('callerValue', 'In', 'String', true)]); e.useWorkflowStore.getState().loadWorkflow(definition, parentPath);
    await e.runWorkflowTests([{ id: 't', workflowKey: 'file:' + parentPath.replace(/\\/g, '/').toLowerCase(), name: 'Called result', rows: [{ id: 'r', name: 'Data', inputs: { callerValue: 'Welcome' }, expected: { answer: 'Welcome' } }] }]);
    assert.equal(history.getState().runs.find(r => r.test).test.status, 'passed');
  });
  await test('Real browser Get Text receives an In selector and returns Out text to the caller', async () => {
    await esbuild.build({ entryPoints: [path.join(root, 'electron/automation/browser.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['playwright-core'], outfile: path.join(out, 'browser.cjs') });
    const p = path.join(out, 'browser.cjs'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
    const { runBrowserActivity } = require(p); fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><meta charset="utf-8"><div id="greeting">Merhaba İstanbul 42</div>');
    const original = activity;
    try {
      assert.equal((await runBrowserActivity('open-browser', { url: pathToFileURL(path.join(out, 'fixture.html')).href, headless: true })).success, true);
      write('child.rpa.json', def('Browser reader', [n('Read', 'get-text', { selector: '{{inSelector}}', output: 'outText' })], [arg('inSelector', 'In', 'String', true), arg('outText', 'Out')]));
      const call = invoke(); call.data.properties.inArguments = { inSelector: '#greeting' }; activity = runBrowserActivity;
      assert.equal(await run([call]), 'completed'); assert.equal(history.getState().runs.find(r => !r.parentRunId).steps[0].outputs.answer, 'Merhaba İstanbul 42');
    } finally { activity = original; await runBrowserActivity('close-browser', {}); }
  });
  console.log(count + ' invocation scenarios passed'); await uiTest(); console.log('Artifacts: ' + out);
}

async function uiTest() {
  const childDef = def('Greeting builder', [n('call', 'assign', { to: 'outText', value: '{{inText}}' }), n('childLog', 'log-message', { message: 'outText' })], [arg('inText', 'In', 'String', true), arg('outText', 'Out')]);
  const childPath = write('ui-child.rpa.json', childDef), parentPath = write('ui-parent.rpa.json', def('Greeting parent', []));
  const beforeFiles = [childPath, parentPath].map(p => fs.readFileSync(p, 'utf8'));
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useUiStore} from './src/store/uiStore';import {useDebugStore} from './src/store/debugStore';import {useExecutionHistoryStore} from './src/store/executionHistoryStore';import {useWorkflowAnalyzerStore} from './src/store/workflowAnalyzerStore';window.fixture={workflow:useWorkflowStore,ui:useUiStore,debug:useDebugStore,history:useExecutionHistoryStore,analyzer:useWorkflowAnalyzerStore};window.savedFixture=null;window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],readInvokedWorkflow:(requested,caller)=>window.readFixture(requested,caller),chooseInvokedWorkflow:()=>window.readFixture(${JSON.stringify(childPath)},null),saveWorkflow:async(content)=>{window.savedFixture=JSON.parse(content);return {path:${JSON.stringify(parentPath)}};},executeActivity:async(id,p)=>({success:true,log:'Done',...(id==='assign'?{outputs:{[p.to]:p.value}}:{})})};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const { chromium } = require('playwright-core'), { readInvokedWorkflow } = require(path.join(out, 'files.cjs'));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 980 } }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('readFixture', readInvokedWorkflow); await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.evaluate(({ parentPath }) => {
      const n = (id, activityId, properties, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
      fixture.workflow.getState().loadWorkflow({ projectName: 'Greeting parent', nodes: [n('call', 'invoke-workflow', { workflowFile: '' }, { breakpoint: true }), n('after', 'log-message', { message: 'answer' }, { breakpoint: true })], edges: [], variables: ['callerValue', 'answer'].map(name => ({ id: name, name, type: 'String', defaultValue: name === 'callerValue' ? 'Welcome Ada' : 'before', scope: 'Main' })), arguments: [{ id: 'prefix', name: 'prefix', type: 'String', direction: 'In', required: false, defaultValue: 'Hello' }] }, parentPath);
      fixture.workflow.getState().setSelectedNode('call');
    }, { parentPath });
    await page.getByRole('button', { name: 'Browse workflow…', exact: true }).click(); await page.getByRole('textbox', { name: 'In argument inText', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'In argument inText', exact: true }).fill('{{callerValue}}'); await page.getByRole('combobox', { name: 'Out argument outText', exact: true }).fill('answer');
    await page.getByRole('button', { name: 'Import / refresh arguments', exact: true }).click(); await page.getByRole('textbox', { name: 'In argument inText', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'In argument inText', exact: true }).inputValue(), '{{callerValue}}');
    await page.getByTitle('Analyze workflow (F8)', { exact: true }).click(); await page.waitForFunction(() => fixture.analyzer.getState().report?.dependencyState === 'complete');
    assert.equal(await page.evaluate(() => fixture.analyzer.getState().report.findings.filter(f => f.severity === 'error').length), 0);
    await page.locator('.app-header').getByRole('button', { name: 'Debug', exact: true }).click(); await page.getByTitle('Debug workflow', { exact: true }).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'paused' && fixture.debug.getState().frames.length === 1);
    await page.getByTitle(/Step Into \(F11\)/).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'paused' && fixture.debug.getState().frames.length === 2);
    await page.getByRole('region', { name: 'Invoked workflow debug source', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => fixture.debug.getState().projectName), 'Greeting builder'); assert.equal(await page.evaluate(() => fixture.debug.getState().locals.find(v => v.name === 'inText').detail), 'Welcome Ada');
    await page.getByRole('button', { name: 'Session breakpoint childLog', exact: true }).click(); await page.getByRole('button', { name: 'Session breakpoint childLog', exact: true }).click();
    await page.getByTitle(/Step Into \(F11\)/).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'paused' && fixture.debug.getState().activityName === 'childLog');
    assert.equal(await page.evaluate(() => fixture.debug.getState().locals.find(v => v.name === 'outText').detail), 'Welcome Ada');
    await page.screenshot({ path: path.join(out, 'invoke-debug-dark.png'), animations: 'disabled' }); await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'invoke-debug-light.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 750 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); await page.screenshot({ path: path.join(out, 'invoke-debug-compact.png'), animations: 'disabled' });
    await page.getByTitle('Continue (F5)', { exact: true }).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'paused' && fixture.debug.getState().frames.length === 1);
    assert.equal(await page.evaluate(() => fixture.debug.getState().locals.find(v => v.name === 'answer').detail), 'Welcome Ada'); await page.getByTitle('Continue (F5)', { exact: true }).click(); await page.waitForFunction(() => fixture.debug.getState().phase === 'completed');
    assert.equal(await page.evaluate(() => fixture.workflow.getState().variables.find(v => v.name === 'answer').defaultValue), 'before'); assert.equal(await page.evaluate(() => window.savedFixture.nodes[0].data.properties.outArguments.outText), 'answer');
    await page.getByRole('button', { name: 'Run History', exact: true }).click(); await page.getByRole('button', { name: 'Called: Greeting builder · completed', exact: true }).click(); await page.getByText('Workflow arguments', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'invoke-history.png'), animations: 'disabled' }); await page.getByRole('button', { name: 'Caller: Greeting parent', exact: true }).click();
    await page.evaluate(() => fixture.workflow.getState().updateNodeProperties('call', { ...fixture.workflow.getState().nodes[0].data.properties, inArguments: {} })); await page.keyboard.press('F8'); await page.waitForFunction(() => fixture.analyzer.getState().report?.dependencyState === 'complete'); assert.ok(await page.evaluate(() => fixture.analyzer.getState().report.findings.some(f => f.code === 'WA301')));
    await page.reload(); await page.locator('.app-header').waitFor(); assert.equal(await page.evaluate(() => fixture.workflow.getState().arguments[0].defaultValue), 'Hello'); assert.equal(await page.evaluate(() => fixture.workflow.getState().nodes[0].data.properties.outArguments.outText), 'answer');
    assert.deepEqual([childPath, parentPath].map(p => fs.readFileSync(p, 'utf8')), beforeFiles); assert.deepEqual(errors, []);
    console.log('PASS UI browse/import and mappings, dependency analysis, Step Into/call stack/read-only source/Locals, session breakpoints, return outputs, parent-child history links, argument persistence, Dark/Light/compact and unchanged fixture files');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
