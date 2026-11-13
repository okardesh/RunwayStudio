const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-analyzer-'));
global.localStorage = { getItem: () => null, setItem: () => { throw Error('Analyzer must not persist data'); }, removeItem: () => {} };
global.crypto ||= require('node:crypto').webcrypto;
global.window = { electronAPI: { executeActivity: () => { throw Error('Analyzer must not execute activities'); }, saveWorkflow: () => { throw Error('Analyzer must not save workflows'); } } };
const node = (id, activityId = 'log-message', properties = { message: '"Hello"' }, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
const variable = (name, scope = 'Main') => ({ id: crypto.randomUUID(), name, scope, type: 'String', defaultValue: '' });
const source = (nodes = [], extra = {}) => ({ nodes, edges: [], variables: [], arguments: [], targets: [], projectName: 'Analyzer fixture', filePath: 'C:/fixture/analyzer.rpa.json', ...extra });

async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/engine/workflowAnalyzer';export * from './src/engine/analyzeCurrentWorkflow';export * from './src/store/workflowAnalyzerStore';export * from './src/store/workflowStore';export * from './src/store/executionHistoryStore';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  const e = require(path.join(out, 'engine.cjs'));
  const findings = input => e.analyzeWorkflow(input).findings;
  const has = (list, code, id) => list.some(f => f.code === code && (!id || f.nodeId === id));
  let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
  test('Empty and valid workflows are analyzed without execution, persistence or source mutation', () => {
    assert.ok(has(findings(source()), 'WA002'));
    const fixture = source([node('Read', 'get-text', { selector: '#greeting', output: 'textResult' }), node('Log', 'log-message', { message: 'textResult' }), node('Code', 'run-script-code', { language: 'JavaScript', code: 'throw Error("MUST NOT RUN")' })]);
    const before = JSON.stringify(fixture); const result = e.analyzeWorkflow(fixture);
    assert.equal(JSON.stringify(fixture), before); assert.ok(!result.findings.some(f => f.code === 'WA207'));
    assert.equal(e.useExecutionHistoryStore.getState().runs.length, 0);
    assert.equal(findings(source([node('ok')])).length, 0);
  });
  test('Required fields, numeric zero, false options and output names are validated', () => {
    const result = findings(source([node('Missing', 'get-text', { selector: '', output: '' }), node('Zero', 'retry-scope', { maxRetries: 0, retryDelay: 0 }, { isContainer: true }), node('Bad number', 'delay', { duration: -1 }), node('Output', 'get-text', { selector: '#a', output: '{{textResult}}' })]));
    assert.ok(has(result, 'WA150', 'Missing')); assert.ok(!result.some(f => f.nodeId === 'Zero' && ['WA150', 'WA151', 'WA152'].includes(f.code)));
    assert.ok(has(result, 'WA154', 'Output'));
    const delay = findings(source([node('Bad number', 'delay', { milliseconds: -1, duration: -1 })])); assert.ok(delay.some(f => f.code === 'WA151'));
    assert.ok(!findings(source([node('Checkbox', 'check-checkbox', { selector: '#a', checked: false })])).some(f => f.code === 'WA150'));
  });
  test('Desktop targets and shared selectors use current library values', () => {
    const target = { id: 't', name: 'Greeting', selector: '#fresh', targetType: 'browser', application: 'Fixture', updatedAt: 1 };
    const bound = node('Bound', 'get-text', { selector: '', output: 'textResult' }, { targetBindings: { selector: 't' } });
    assert.ok(!findings(source([bound], { targets: [target] })).some(f => f.code === 'WA140' || f.code === 'WA150'));
    assert.ok(has(findings(source([bound])), 'WA140', 'Bound'));
    assert.ok(has(findings(source([node('Desktop', 'use-app-browser', { targetType: 'desktop' }, { isContainer: true })])), 'WA130'));
    assert.ok(has(findings(source([node('App', 'use-app-browser', {}, { isContainer: true })])), 'WA131'));
  });
  test('Explicit references error, ambiguous Log Message names warn and quoted literals stay literal', () => {
    const result = findings(source([node('Explicit', 'log-message', { message: 'Result {{textReslt}}' }), node('Bare', 'log-message', { message: 'textReslt' }), node('Literal', 'log-message', { message: '"{{textReslt}}"' }), node('Malformed', 'log-message', { message: '{{not valid}}' })]));
    assert.ok(result.some(f => f.nodeId === 'Explicit' && f.code === 'WA207' && f.severity === 'error'));
    assert.ok(result.some(f => f.nodeId === 'Bare' && f.code === 'WA207' && f.severity === 'warning'));
    assert.ok(!result.some(f => f.nodeId === 'Literal')); assert.ok(has(result, 'WA209', 'Malformed'));
  });
  test('Outputs and assignments are recognized in execution order; future outputs warn', () => {
    const result = findings(source([node('Before', 'log-message', { message: 'textResult' }), node('Read', 'get-text', { selector: '#x', output: 'textResult' }), node('After', 'log-message', { message: '{{textResult}}' }), node('Assign', 'assign', { to: 'approved', value: true }), node('Use', 'log-message', { message: '{{approved}}' })]));
    assert.ok(has(result, 'WA205', 'Before')); assert.ok(!result.some(f => ['After', 'Use'].includes(f.nodeId) && f.code.startsWith('WA20')));
  });
  test('Conditional branch outputs are only guaranteed when every path assigns them', () => {
    const fixture = source([node('If', 'if', {}, { isContainer: true, branches: [{ id: 'yes', kind: 'if', condition: 'true', childIds: ['A'] }, { id: 'no', kind: 'else', condition: '', childIds: [] }] }), node('A', 'assign', { to: 'result', value: 'yes' }, { parentId: 'If', branchId: 'yes' }), node('Use', 'log-message', { message: '{{result}}' })]);
    assert.ok(has(findings(fixture), 'WA205', 'Use'));
    fixture.nodes[0].data.branches[1].childIds = ['B']; fixture.nodes.push(node('B', 'assign', { to: 'result', value: 'no' }, { parentId: 'If', branchId: 'no' }));
    assert.ok(!has(findings(fixture), 'WA205', 'Use'));
  });
  test('Loop variables are scoped, empty-loop outputs stay conditional and declared shadows are restored', () => {
    const fixture = source([node('Loop', 'for-each', { collection: '[1,2]' }, { isContainer: true, childIds: ['Inside', 'Write'], loopVariable: { name: 'item', type: 'Int32' } }), node('Inside', 'log-message', { message: '{{item}}' }, { parentId: 'Loop' }), node('Write', 'assign', { to: 'result', value: '{{item}}' }, { parentId: 'Loop' }), node('Outside', 'log-message', { message: '{{item}} {{result}}' })]);
    const result = findings(fixture); assert.ok(!has(result, 'WA206', 'Inside')); assert.ok(has(result, 'WA206', 'Outside')); assert.ok(has(result, 'WA205', 'Outside'));
    fixture.variables = [variable('item')]; assert.ok(!has(findings(fixture), 'WA206', 'Outside'));
  });
  test('Duplicate declarations, argument collisions and local argument limits are reported', () => {
    const result = findings(source([node('Arg', 'log-message', { message: '{{input}}' })], { variables: [variable('duplicate'), variable('duplicate'), variable('bad name')], arguments: [{ name: 'input', direction: 'In', type: 'String', defaultValue: '', required: true }, { name: 'duplicate', direction: 'Out', type: 'String', defaultValue: '', required: false }] }));
    for (const code of ['WA200', 'WA201', 'WA203', 'WA204']) assert.ok(has(result, code), code);
  });
  test('Broken ownership, missing activities and edges, hierarchy cycles and unsupported nesting are detected', () => {
    const result = findings(source([node('Parent', 'use-app-browser', { url: 'about:blank' }, { isContainer: true, childIds: ['missing', 'Child'] }), node('Child', 'retry-scope', {}, { isContainer: true, parentId: 'Other' }), node('CycleA', 'sequence', {}, { parentId: 'CycleB' }), node('CycleB', 'sequence', {}, { parentId: 'CycleA' }), node('Orphan', 'log-message', { message: '"ok"' }, { parentId: 'absent' }), node('Unknown', 'missing-activity')], { edges: [{ id: 'edge', source: 'Parent', target: 'absent' }] }));
    for (const code of ['WA102', 'WA110', 'WA111', 'WA112', 'WA114', 'WA115', 'WA160', 'WA161']) assert.ok(has(result, code), code);
    assert.ok(has(findings(source([node('A'), node('A')])), 'WA101'));
  });
  test('Branches and direct loop controls are checked against the current executor', () => {
    const result = findings(source([node('If', 'if', {}, { isContainer: true, branches: [{ id: 'a', kind: 'if', condition: '', childIds: [] }, { id: 'b', kind: 'else', condition: '', childIds: [] }, { id: 'c', kind: 'else', condition: '', childIds: [] }] }), node('Try', 'try-catch', {}, { isContainer: true, branches: [] }), node('Break', 'break'), node('Unsupported', 'invoke-workflow', { workflowFile: 'other.rpa.json' })]));
    for (const code of ['WA120', 'WA121', 'WA122', 'WA126', 'WA103']) assert.ok(has(result, code), code);
  });
  test('Signatures ignore canvas view changes but track properties, targets and workflow identity', () => {
    const fixture = source([node('Read', 'get-text', { selector: '#x' })]); const original = e.analysisSignature(fixture);
    fixture.nodes[0].position.x = 50; fixture.nodes[0].data.collapsed = true; fixture.nodes[0].data.breakpoint = true;
    assert.equal(e.analysisSignature(fixture), original); fixture.nodes[0].data.properties.selector = '#y'; assert.notEqual(e.analysisSignature(fixture), original);
    const next = e.analysisSignature(fixture); fixture.filePath = 'C:/other.rpa.json'; assert.notEqual(e.analysisSignature(fixture), next);
  });
  test('Finding and activity limits are explicit and the current-workflow command does not create history', () => {
    const report = e.analyzeWorkflow(source(Array.from({ length: 2100 }, (_, i) => node('n' + i, 'missing')))); assert.ok(report.truncated); assert.ok(report.findings.length <= 500);
    const blocked = localStorage.setItem; localStorage.setItem = () => {};
    try { e.useWorkflowStore.getState().loadWorkflow({ ...source([node('Good')]), projectName: 'Current' }); } finally { localStorage.setItem = blocked; }
    const result = e.analyzeCurrentWorkflow(); assert.equal(result.projectName, 'Current'); assert.equal(e.useExecutionHistoryStore.getState().runs.length, 0);
  });
  console.log(passed + ' analyzer scenarios passed');
  await uiTest(); console.log('Artifacts: ' + out);
}

async function uiTest() {
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useUiStore} from './src/store/uiStore';import {useWorkflowAnalyzerStore} from './src/store/workflowAnalyzerStore';import {useUiTargetStore} from './src/store/uiTargetStore';import {useExecutionHistoryStore} from './src/store/executionHistoryStore';window.calls={execute:0,save:0};window.fixture={workflow:useWorkflowStore,ui:useUiStore,analyzer:useWorkflowAnalyzerStore,targets:useUiTargetStore,history:useExecutionHistoryStore};window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],executeActivity:async()=>{calls.execute++;throw Error('No execution allowed');},saveWorkflow:async()=>{calls.save++;throw Error('No workflow save allowed');}};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 980 } }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.evaluate(() => {
      const n = (id, activityId, properties, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
      fixture.workflow.getState().loadWorkflow({ projectName: 'Invoice validation', nodes: [n('Read invoice', 'use-app-browser', { url: 'about:blank' }, { isContainer: true, collapsed: true, childIds: ['Invoice number'] }), n('Invoice number', 'get-text', { selector: '', output: 'textResult' }, { parentId: 'Read invoice' }), n('Log result', 'log-message', { message: 'textReslt' })], edges: [], variables: [], arguments: [] }, 'C:/fixture/invoice.rpa.json');
    });
    await page.getByRole('button', { name: 'Errors', exact: true }).click(); await page.getByText('Check this workflow before running it', { exact: true }).waitFor();
    const before = await page.evaluate(() => JSON.stringify([fixture.workflow.getState().nodes, fixture.workflow.getState().variables, fixture.workflow.getState().filePath, fixture.workflow.getState().isDirty]));
    await page.getByTitle('Analyze workflow (F8)', { exact: true }).click(); await page.getByRole('button', { name: 'Errors 1', exact: true }).waitFor(); await page.getByRole('button', { name: 'Warnings 1', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => JSON.stringify([fixture.workflow.getState().nodes, fixture.workflow.getState().variables, fixture.workflow.getState().filePath, fixture.workflow.getState().isDirty])), before);
    await page.getByRole('region', { name: 'Analysis findings', exact: true }).getByRole('button', { name: /A required property is empty/ }).click();
    assert.equal(await page.evaluate(() => fixture.workflow.getState().selectedNodeId), 'Invoice number'); assert.equal(await page.evaluate(() => fixture.workflow.getState().nodes[0].data.collapsed), false); assert.equal(await page.evaluate(() => fixture.workflow.getState().isDirty), false);
    await page.locator('.seq-canvas--analysis-focus .seq-card--selected').waitFor(); assert.equal(await page.locator('.wa-stale').count(), 0);
    await page.getByRole('button', { name: 'Warnings 1', exact: true }).click(); assert.equal(await page.locator('.wa-finding').count(), 1); await page.getByRole('textbox', { name: 'Search analysis findings', exact: true }).fill('not present'); await page.getByText('No findings match these filters.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search analysis findings', exact: true }).fill(''); await page.getByRole('button', { name: 'All 2', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'analyzer-dark.png'), animations: 'disabled' }); await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'analyzer-light.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 750 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); await page.screenshot({ path: path.join(out, 'analyzer-compact.png'), animations: 'disabled' });
    await page.evaluate(() => fixture.workflow.getState().updateNodeProperties('Invoice number', { selector: '#invoice', output: 'textResult' })); await page.locator('.wa-stale').waitFor(); assert.equal(await page.getByRole('button', { name: 'Show on canvas', exact: true }).isDisabled(), true);
    await page.evaluate(() => fixture.workflow.getState().updateNodeProperties('Log result', { message: 'textResult' })); await page.keyboard.press('F8'); await page.getByText('No issues found by the current rules', { exact: true }).waitFor();
    await page.evaluate(() => fixture.targets.setState({ targets: [{ id: 'new', name: 'New target', application: 'Fixture', selector: '#new', targetType: 'browser', updatedAt: 1 }] })); await page.locator('.wa-stale').waitFor();
    await page.getByRole('button', { name: 'Analyze workflow', exact: true }).click(); await page.getByText('No issues found by the current rules', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls), { execute: 0, save: 0 }); assert.equal(await page.evaluate(() => fixture.history.getState().runs.length), 0);
    await page.reload(); await page.locator('.app-header').waitFor(); await page.getByRole('button', { name: 'Errors', exact: true }).click(); await page.getByText('Check this workflow before running it', { exact: true }).waitFor();
    assert.deepEqual(errors, []); console.log('PASS UI manual analysis/F8, error/warning filters/search, navigation and ancestor expansion, stale edits/targets, clean reanalysis, no execution/save/history, session reset and Dark/Light/compact layout');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
