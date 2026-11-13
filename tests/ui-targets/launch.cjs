const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ui-targets-'));
const storage = new Map();
global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
global.crypto ||= crypto.webcrypto;
let activity = async () => ({ success: true, log: 'Done' });
global.window = { electronAPI: { executeActivity: (...args) => activity(...args), saveWorkflow: async (content, filePath) => { assert.equal(path.dirname(filePath), out); fs.writeFileSync(filePath, content); return { path: filePath }; } } };
const node = (id, selector = '#old') => ({ id, position: { x: 0, y: 0 }, data: { activityId: 'get-text', label: 'Read total', properties: { selector, output: 'total' } } });
const flow = (name, nodes) => ({ projectName: name, nodes, edges: [], variables: [], arguments: [] });
const draft = (selector, name = 'Invoice total') => ({ name, application: 'Invoice portal', selector, targetType: 'browser' });
async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/store/uiTargetStore'; export * from './src/store/workflowStore'; export * from './src/shared/uiTargets'; export * from './src/engine/executor'; export * from './src/engine/fileOps';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'studio.cjs') });
  const { useUiTargetStore: library, useWorkflowStore: workflow, executeWorkflow, saveWorkflow, resolveTargetBindings } = require(path.join(out, 'studio.cjs'));
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
  const id = library.getState().add(draft('#old'));
  await test('Library validates entries, duplicate names and persistent storage', async () => {
    assert.throws(() => library.getState().add(draft('')), /selector/);
    assert.throws(() => library.getState().add(draft('#x', 'invoice TOTAL')), /already/);
    assert.equal(JSON.parse(storage.get('runway.studio.ui-targets.v1')).targets[0].id, id);
  });
  const files = ['A', 'B'].map(name => path.join(out, name + '.rpa.json'));
  for (let i = 0; i < files.length; i++) {
    workflow.getState().loadWorkflow(flow('Workflow ' + i, [node('read-' + i)]), files[i]);
    workflow.getState().bindUiTarget('read-' + i, 'selector', id);
    library.getState().indexWorkflow(workflow.getState().nodes, workflow.getState().projectName, files[i]);
    await saveWorkflow();
  }
  const originals = files.map(file => fs.readFileSync(file, 'utf8'));
  await test('Save retains target IDs and includes a portable target snapshot', async () => {
    const saved = JSON.parse(originals[0]); assert.equal(saved.nodes[0].data.targetBindings.selector, id); assert.equal(saved.uiTargets[0].selector, '#old');
  });
  await test('One update reaches two previously saved workflows without rewriting them', async () => {
    library.getState().update(id, draft('#new'));
    const received = [];
    activity = async (_id, props) => { received.push(props.selector); return { success: true, log: 'Read', outputs: { total: '42' } }; };
    for (let i = 0; i < files.length; i++) {
      workflow.getState().loadWorkflow(JSON.parse(originals[i]), files[i]);
      const s = workflow.getState(); assert.equal(await executeWorkflow(s.nodes, [], [], () => {}, () => {}, () => {}), 'completed');
      assert.equal(fs.readFileSync(files[i], 'utf8'), originals[i]);
    }
    assert.deepEqual(received, ['#new', '#new']); assert.equal(library.getState().targets.find(t => t.id === id).selector, '#new');
  });
  await test('Current library wins over an older workflow bundle', async () => {
    library.getState().importMissing(JSON.parse(originals[0]).uiTargets); assert.equal(library.getState().targets.find(t => t.id === id).selector, '#new');
  });
  await test('Execution snapshots the library so edits cannot change half a run', async () => {
    let release, started; const ready = new Promise(r => { started = r; }); const gate = new Promise(r => { release = r; }); const seen = [];
    activity = async (_id, props) => { seen.push(props.selector); if (seen.length === 1) { started(); await gate; } return { success: true, log: 'Done' }; };
    const nodes = [node('one'), node('two')].map(n => ({ ...n, data: { ...n.data, targetBindings: { selector: id } } }));
    const running = executeWorkflow(nodes, [], [], () => {}, () => {}, () => {}); await ready;
    library.getState().update(id, draft('#later')); release(); await running; assert.deepEqual(seen, ['#new', '#new']);
  });
  await test('Missing targets block all side effects instead of using stale selectors', async () => {
    let calls = 0; activity = async () => { calls++; return { success: true, log: 'Unexpected' }; };
    const missing = node('missing'); missing.data.targetBindings = { selector: 'missing-id' }; const errors = [];
    assert.equal(await executeWorkflow([node('before'), missing], [], [], () => {}, () => {}, (text, level) => { if (level === 'Error') errors.push(text); }), 'error');
    assert.equal(calls, 0); assert.match(errors.join(' '), /UI target missing/);
  });
  await test('Used targets cannot be deleted or change their target type', async () => {
    assert.throws(() => library.getState().remove(id), /Unlink/); assert.throws(() => library.getState().update(id, { ...draft('#later'), targetType: 'desktop' }), /Unlink/);
  });
  await test('Unlink copies the latest selector and later updates leave it alone', async () => {
    workflow.getState().bindUiTarget('read-1', 'selector', null); const detached = workflow.getState().nodes;
    assert.equal(detached[0].data.properties.selector, '#later'); library.getState().update(id, draft('#final'));
    assert.equal(resolveTargetBindings(detached, library.getState().targets)[0].data.properties.selector, '#later');
  });
  await test('Save refreshes the portable snapshot and Robot resolution uses its bundle', async () => {
    workflow.getState().loadWorkflow(JSON.parse(originals[0]), files[0]); await saveWorkflow();
    const saved = JSON.parse(fs.readFileSync(files[0], 'utf8')); assert.equal(saved.uiTargets[0].selector, '#final'); assert.equal(resolveTargetBindings(saved.nodes, saved.uiTargets)[0].data.properties.selector, '#final');
  });
  await test('A fresh library can import an unknown target ID without overwriting other targets', async () => {
    const imported = { ...library.getState().targets[0], id: 'portable-id' }; library.getState().importMissing([imported]);
    assert.equal(library.getState().targets.find(t => t.id === 'portable-id').selector, '#final');
    assert.notEqual(library.getState().targets.find(t => t.id === 'portable-id').name, library.getState().targets.find(t => t.id === id).name);
  });
  await test('Persistence failure does not claim a library update was saved', async () => {
    const original = localStorage.setItem; localStorage.setItem = () => { throw Error('Quota'); };
    try { assert.throws(() => library.getState().update(id, draft('#not-saved')), /could not be saved/); assert.equal(library.getState().targets.find(t => t.id === id).selector, '#final'); }
    finally { localStorage.setItem = original; }
  });
  await test('Older workflow snapshots cannot resurrect a deleted target', async () => {
    const removedId = library.getState().add(draft('#unused', 'Deleted target'));
    const snapshot = { ...library.getState().targets.find(t => t.id === removedId) };
    library.getState().remove(removedId); library.getState().importMissing([snapshot]);
    assert.equal(library.getState().targets.some(t => t.id === removedId), false);
    const bound = node('removed'); bound.data.targetBindings = { selector: removedId };
    assert.throws(() => resolveTargetBindings([bound], library.getState().targets), /UI target missing/);
  });
  // Real production browser engine, a local fixture, and two saved workflow definitions.
  await esbuild.build({ entryPoints: [path.join(root, 'electron/automation/browser.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['playwright-core'], outfile: path.join(out, 'browser.cjs') });
  const browserPath = path.join(out, 'browser.cjs'); fs.writeFileSync(browserPath, fs.readFileSync(browserPath, 'utf8').replaceAll('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
  const { runBrowserActivity } = require(browserPath);
  fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><div id="old">Old target</div><div id="final">Updated target</div>');
  await test('Real Get Text in two saved workflows reads the updated DOM target', async () => {
    try {
      assert.equal((await runBrowserActivity('open-browser', { url: pathToFileURL(path.join(out, 'fixture.html')).href, headless: true })).success, true);
      const read = []; activity = async (id, props) => { const result = await runBrowserActivity(id, props); if (result.outputs) read.push(result.outputs.total); return result; };
      for (const original of originals) { workflow.getState().loadWorkflow(JSON.parse(original)); assert.equal(await executeWorkflow(workflow.getState().nodes, [], [], () => {}, () => {}, () => {}), 'completed'); }
      assert.deepEqual(read, ['Updated target', 'Updated target']);
    } finally { await runBrowserActivity('close-browser', {}); }
  });
  console.log(passed + ' target scenarios passed');
  await checkUi();
  console.log('Artifacts: ' + out);
}

async function checkUi() {
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {useWorkflowStore} from './src/store/workflowStore';import {useUiStore} from './src/store/uiStore';import {useUiTargetStore} from './src/store/uiTargetStore';import {useThemeStore} from './src/store/themeStore';window.fixture={workflow:useWorkflowStore,ui:useUiStore,targets:useUiTargetStore,theme:useThemeStore};window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],publishRunwayWorkflow:async(_url,_key,_tenant,payload)=>{window.published=payload;return {status:200,body:JSON.stringify({ok:true,workflow:{id:'fixture-published',version:'1.0.0'}})}}};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    await page.evaluate(() => { fixture.workflow.getState().loadWorkflow({ projectName: 'Invoice processing', nodes: [{ id: 'read', position: { x: 0, y: 0 }, data: { activityId: 'get-text', label: 'Read invoice total', properties: { selector: '#old', output: 'total' } } }], edges: [], variables: [] }, 'C:/fixture/invoice.rpa.json'); fixture.workflow.getState().setSelectedNode('read'); });
    await page.getByRole('button', { name: 'Save as shared target' }).click();
    await page.locator('.ut-editor').getByLabel('Name', { exact: true }).fill('Invoice total');
    await page.locator('.ut-editor').getByLabel('Application', { exact: true }).fill('Invoice portal');
    await page.getByTitle('Show Output').click(); await page.getByTitle('Show UI Targets').click();
    assert.equal(await page.locator('.ut-editor').getByLabel('Name', { exact: true }).inputValue(), 'Invoice total');
    await page.getByRole('button', { name: 'Save target', exact: true }).click();
    await page.waitForFunction(() => !!fixture.workflow.getState().nodes[0].data.targetBindings?.selector);
    assert.equal(await page.getByLabel('Shared selector', { exact: true }).inputValue(), '#old');
    await page.getByLabel('Target selector', { exact: true }).fill('#invoice-total-v2'); await page.getByRole('button', { name: 'Update target', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.target-selector__resolved')?.value === '#invoice-total-v2');
    assert.equal(await page.getByRole('button', { name: 'Delete unused target', exact: true }).isDisabled(), true);
    await page.screenshot({ path: path.join(out, 'ui-targets-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'ui-targets-light.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 700 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'ui-targets-compact.png'), animations: 'disabled' });
    await page.getByTitle('Publish to Runway RPA Catalog').click(); await page.locator('.publish-modal__publish').click();
    await page.waitForFunction(() => !!window.published);
    assert.equal(await page.evaluate(() => published.definition.nodes[0].data.properties.selector), '#invoice-total-v2'); assert.equal(await page.evaluate(() => published.definition.uiTargets[0].selector), '#invoice-total-v2');
    await page.locator('.publish-modal__close').click();
    await page.getByRole('button', { name: 'Unlink', exact: true }).click(); await page.waitForFunction(() => !fixture.workflow.getState().nodes[0].data.targetBindings?.selector);
    assert.equal(await page.locator('.target-selector .expression-input input').inputValue(), '#invoice-total-v2');
    await page.getByRole('button', { name: 'Delete unused target', exact: true }).click(); await page.waitForFunction(() => fixture.targets.getState().targets.length === 0);
    assert.deepEqual(errors, []); console.log('PASS UI create/bind/update/usage/delete, Dark/Light, compact layout and publish bundle');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
