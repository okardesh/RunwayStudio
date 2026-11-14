const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-assets-'));
const python = process.env.RUNWAY_TEST_PYTHON || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
global.crypto ||= require('node:crypto').webcrypto;
const n = (id, activityId, properties = {}, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { activityId, label: id, properties, ...extra } });
const d = nodes => ({ projectName: 'Asset fixture', nodes, edges: [], variables: [], arguments: [], uiTargets: [] });
async function main() {
  const py = spawnSync(python, [path.join(__dirname, 'backend.py')], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }); console.log(py.stdout); if (py.status !== 0) throw Error(py.stderr);
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/engine/executor';export * from './src/shared/assets';export * from './src/shared/portableWorkflowPackage';export * from './src/engine/workflowAnalyzer';export * from './Robot/src/workflowRuntime';export * from './src/store/executionHistoryStore';export * from './src/store/debugStore';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  global.localStorage = { values: new Map(), getItem(k) { return this.values.get(k) ?? null; }, setItem(k, v) { this.values.set(k, String(v)); }, removeItem(k) { this.values.delete(k); } };
  global.window = { electronAPI: { executeActivity: async (id, p) => ({ success: true, log: id === 'log-message' ? String(p.message) : 'Done', outputs: {} }) } };
  const e = require(path.join(out, 'engine.cjs'));
  const username = 'credential-private-user', password = 'credential-private-password';
  const resolve = async (name, type) => ({ type, revision: 1, value: name === 'ERP_URL' ? 'https://development.example' : name === 'API_SECRET' ? 'api-private-value' : { username, password } });
  const definition = d([n('url', 'get-asset', { assetName: 'ERP_URL', assetType: 'String', output: 'url' }), n('login', 'get-credential', { assetName: 'ERP_Login', usernameOutput: 'x', passwordOutput: 'y' }), n('log', 'log-message', { message: '{{y.ToUpper()}}' }), n('copy', 'assign', { to: 'alias', value: '{{y}}' }), n('last', 'log-message', { message: '{{alias}}' }, { breakpoint: true }), n('ordinary', 'log-message', { message: '"Ready for delivery"' })]);
  const logs = [];
  e.useDebugStore.getState().addWatch?.('y.ToUpper()');
  let paused;
  const run = e.executeWorkflow(definition.nodes, [], [], () => {}, () => {}, (text) => logs.push(text), { projectName: 'Asset fixture', debug: true, assetContext: { resolve, environment: { id: 'development', name: 'Development' } }, hasBreakpoint: id => id === 'last', onPause: () => { paused = true; } });
  for (let i = 0; i < 100 && !paused; i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(paused); const debug = e.useDebugStore.getState(); assert.ok(!JSON.stringify(debug.locals).includes(password)); assert.ok(!JSON.stringify(debug.locals).includes(username));
  assert.equal(debug.results.find(r => r.expression === 'y.ToUpper()').value.detail, '[REDACTED]');
  e.resumeDebug('continue'); assert.equal(await run, 'completed');
  const history = e.useExecutionHistoryStore.getState().runs; assert.equal(history[0].environment.id, 'development');
  for (const secret of [username, password, password.toUpperCase()]) { assert.ok(!JSON.stringify(history).includes(secret)); assert.ok(!logs.join('\n').includes(secret)); }
  assert.ok(logs.join('\n').includes('Ready for delivery'));
  console.log('PASS Local Debug/Locals/Watch, credential aliases and transformed logs stay masked; environment saved in history');
  const bundle = await e.buildPortablePackage(definition, path.join(out, 'main.rpa.json'), [], '1.0.0', async () => { throw Error('No child'); });
  assert.ok(!JSON.stringify(bundle).includes(password)); const robotLogs = []; let calls = 0;
  await assert.rejects(e.executeRobotWorkflow(bundle, {}, async () => { calls++; return { success: true, log: 'unexpected' }; }, () => {}), /asset context/); assert.equal(calls, 0);
  await e.executeRobotWorkflow(bundle, {}, async (id, props) => ({ success: true, log: String(props.message ?? 'Done') }), (_level, message) => robotLogs.push(message), { live: true, resolveAsset: resolve });
  for (const secret of [username, password, password.toUpperCase()]) assert.ok(!robotLogs.join('\n').includes(secret));
  assert.ok(robotLogs.join('\n').includes('Ready for delivery'));
  await assert.rejects(e.executeAssetActivity('get-credential', { assetName: 'ERP_Login', usernameOutput: 'x', passwordOutput: 'x' }, resolve, () => {}), /distinct/);
  assert.throws(() => e.assetRequirement('get-asset', { assetName: '{{dynamic}}' }), /static/);
  const source = { ...definition, targets: [], filePath: null, assets: { profileId: 'production', catalog: { profiles: [{ id: 'production', name: 'Production', enabled: true }], assets: [] } } };
  assert.ok(e.analyzeWorkflow(source).findings.some(f => f.code === 'WA402'));
  console.log('PASS Portable packages contain references only; Robot preflight, scoped resolver, secret log masking and Analyzer checks');
  await uiTest(); console.log('All asset checks passed. Artifacts: ' + out);
}
async function uiTest() {
  await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';window.calls=[];window.catalog={profiles:[{id:'default',name:'Default',enabled:true},{id:'development',name:'Development',enabled:true}],assets:[]};window.electronAPI={requestRunwayLicense:async()=>({status:200,body:JSON.stringify({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture'})}),getRunwayApiKey:async()=> 'fixture',storeRunwayApiKey:async()=>true,getDotNetTypes:async()=>[],requestStudioAssets:async(url,_key,_tenant,method,p)=>{if(method==='GET')return {status:200,body:JSON.stringify({ok:true,...window.catalog})};window.calls.push(p);if(url.endsWith('/profiles'))window.catalog.profiles.push({id:p.name.toLowerCase(),...p});else if(p.delete)window.catalog.assets=window.catalog.assets.filter(a=>a.name!==p.name);else{window.catalog.assets=window.catalog.assets.filter(a=>a.name!==p.name);window.catalog.assets.push({name:p.name,type:p.type,profileId:p.profileId,revision:(p.revision||0)+1,updatedAt:1,...(['Secret','Credential'].includes(p.type)?{}:{value:p.value})})}return {status:200,body:'{"ok":true}'}},requestRobotJobs:async()=>({status:200,body:JSON.stringify({ok:true,schemaVersion:1,robots:[],packages:[],environments:window.catalog.profiles})})};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', outfile: path.join(out, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  const { chromium } = require('playwright-core'); const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(pathToFileURL(path.join(out, 'index.html')).href); await page.locator('.app-header').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Assets', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Audit', exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Assets and environments' }).count(), 0);
    await page.getByLabel('Run environment', { exact: true }).selectOption('development');
    assert.equal(await page.getByLabel('Run environment', { exact: true }).inputValue(), 'development');
    assert.ok(await page.evaluate(() => Object.values(localStorage).includes('development')));
    await page.screenshot({ path: path.join(out, 'environment-dark.png') }); await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.screenshot({ path: path.join(out, 'environment-light.png') });
    await page.getByRole('button', { name: 'Jobs', exact: true }).click(); await page.getByLabel('Job environment', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await page.setViewportSize({ width: 1100, height: 750 }); assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    console.log('PASS Studio consumes Runway assets, local/Robot Job environment selection, no Assets/Audit management or writes, Dark/Light and compact layout');
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
