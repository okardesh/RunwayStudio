const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-transaction-scope-'));
global.crypto ||= require('node:crypto').webcrypto;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let native = async (id, p) => ({ success: id !== 'throw', log: id === 'throw' ? String(p.message ?? 'Application failure') : String(p.message ?? 'Done') });
global.window = { electronAPI: { executeActivity: (...args) => native(...args) } };
const n = (id, activityId, properties = {}, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { label: id, activityId, icon: 'x', color: '#14B8A6', properties, ...extra } });
const arg = (name, direction = 'In', type = 'Object') => ({ id: name, name, direction, type, required: direction === 'In', defaultValue: '' });
const def = (name, nodes, args = []) => ({ projectName: name, nodes, edges: [], variables: [], arguments: args, uiTargets: [] });
const claim = () => n('claim', 'get-transaction-item', { queueName: 'Invoices', output: 'transaction', hasItemOutput: 'hasTransaction' });
function workflow(body, props = {}) { return def('Scope fixture', [claim(), n('scope', 'transaction-scope', { transaction: '{{transaction}}', failureBehavior: 'Continue', exceptionOutput: 'transactionError', resultOutput: 'transactionResult', ...props }, { isContainer: true, childIds: body.filter(v => !v.data.parentId || v.data.parentId === 'scope').map(v => v.id) }), ...body.map(v => ({ ...v, data: { ...v.data, parentId: v.data.parentId ?? 'scope' } }))]); }
async function main() {
  await esbuild.build({ stdin: { resolveDir: root, contents: `export * from './src/shared/queues';export * from './src/shared/transactionScope';export * from './src/shared/portableWorkflowPackage';export * from './src/engine/executor';export * from './src/engine/workflowAnalyzer';export * from './src/engine/analyzeInvocations';export * from './src/store/executionHistoryStore';export * from './src/store/debugStore';export * from './Robot/src/workflowRuntime';` }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'engine.cjs') });
  const e = require(path.join(out, 'engine.cjs'));
  function queue(options = {}) {
    let item = { id: crypto.randomUUID(), queueName: 'Invoices', environmentId: 'default', reference: 'INV-42', content: { amount: 42 }, status: 'new', attempt: 0, retryCount: 0, readyAt: 0 };
    const mutations = [], session = new e.QueueRunSession(async p => {
      mutations.push(p);
      if (p.operation === 'claim') { item = { ...item, status: 'in_progress', attempt: item.attempt + 1 }; return { item: structuredClone(item), leaseToken: 'PRIVATE-RECEIPT', leaseSeconds: 30 }; }
      if (p.operation === 'complete') {
        if (options.uncertainCommit) throw new e.QueueTransportError('Acknowledgement lost', true);
        item = { ...item, status: p.status === 'Successful' ? 'successful' : p.errorType === 'Application' ? 'retry' : 'failed', errorType: p.status === 'Failed' ? p.errorType : undefined, reason: p.reason };
        return { item: JSON.parse(JSON.stringify(item)) };
      }
      if (p.operation === 'releaseAll') { if (item.status !== 'in_progress') return { item: null, released: [] }; item.status = 'retry'; return { item: null, released: [structuredClone(item)] }; }
      return { item: structuredClone(item) };
    });
    return { session, mutations, item: () => item };
  }
  const run = async (definition, q, options = {}) => {
    e.useExecutionHistoryStore.setState({ runs: [] });
    const logs = []; const status = await e.executeWorkflow(definition.nodes, [], [], () => {}, () => {}, (text, level) => logs.push({ text, level }), { projectName: definition.projectName, arguments: definition.arguments, filePath: path.join(out, 'main.rpa.json'), queueSession: q.session, ...options });
    return { status, logs, history: e.useExecutionHistoryStore.getState().runs };
  };
  const loaderFor = (definitions) => async file => ({ path: path.join(out, file), definition: definitions[file] });
  let q = queue(), d = workflow([n('process', 'log-message', { message: '{{transaction.content.amount}}' })]);
  let result = await run(d, q); assert.equal(result.status, 'completed', JSON.stringify(result.logs)); assert.ok(result.logs.some(v => v.text.trim() === '42')); assert.equal(q.item().status, 'successful'); assert.equal(q.mutations.filter(p => p.operation === 'complete').length, 1); assert.ok(result.history[0].transactions.some(v => v.phase === 'completed')); assert.ok(!JSON.stringify(result.history).includes('PRIVATE-RECEIPT'));
  console.log('PASS Automatic success commits once; content is usable and receipts stay out of history');

  d = workflow([n('business', 'business-rule-exception', { message: 'Invoice is invalid' })], { workflowFile: 'recovery.rpa.json' });
  const recovery = def('Recovery', [n('repair', 'log-message', { message: 'RECOVER' })]);
  q = queue(); result = await run(d, q, { loadWorkflow: loaderFor({ 'recovery.rpa.json': recovery }) }); assert.equal(result.status, 'completed'); assert.equal(q.item().status, 'failed'); assert.equal(q.item().errorType, 'Business'); assert.ok(!result.logs.some(v => v.text.includes('RECOVER')));
  console.log('PASS Business errors are final and skip recovery');

  const child = def('Process child', [n('fail', 'throw', { message: 'Transient application failure' })]);
  const recoveryWithArguments = def('Recover application', [n('show', 'log-message', { message: '{{error.message}}' }), n('return', 'assign', { to: 'ready', value: 'recovered' })], [arg('error'), arg('ready', 'Out', 'String')]);
  d = workflow([n('invoke', 'invoke-workflow', { workflowFile: 'process.rpa.json', inArguments: {}, outArguments: {} })], { workflowFile: 'recovery.rpa.json', inArguments: { error: '{{transactionError}}' }, outArguments: { ready: 'recoveryResult' } });
  const loadWorkflow = loaderFor({ 'process.rpa.json': child, 'recovery.rpa.json': recoveryWithArguments });
  q = queue(); result = await run(d, q, { loadWorkflow }); assert.equal(result.status, 'completed'); assert.equal(q.item().status, 'retry'); assert.equal(q.item().errorType, 'Application'); assert.ok(result.logs.some(v => v.text.includes('Transient application failure'))); assert.ok(result.history.find(v => !v.parentRunId).transactions.some(v => v.phase === 'recovery-completed'));
  const bundle = await e.buildPortablePackage(d, path.join(out, 'main.rpa.json'), [], '1.0.0', loadWorkflow);
  assert.equal(bundle.portablePackage.workflows.length, 3); assert.ok(bundle.nodes.find(v => v.id === 'scope').data.properties.workflowFile.startsWith('package://'));
  q = queue(); const robotLogs = []; await e.executeRobotWorkflow(bundle, {}, native, (_level, message) => robotLogs.push(message), { queueSession: q.session }); await q.session.close(); assert.equal(q.item().status, 'retry'); assert.ok(q.session.events.some(v => v.phase === 'recovery-completed'));
  console.log('PASS Local and Robot Application failures preserve child errors, use queue retry, and call a packaged typed recovery workflow once');

  const businessChild = def('Business child', [n('reject', 'business-rule-exception', { message: 'Child business rule' })]);
  q = queue(); result = await run(d, q, { loadWorkflow: loaderFor({ 'process.rpa.json': businessChild, 'recovery.rpa.json': recoveryWithArguments }) }); assert.equal(result.status, 'completed'); assert.equal(q.item().errorType, 'Business'); assert.ok(!q.session.events.some(v => v.phase === 'recovery-started'));
  console.log('PASS Business exception identity survives local Invoke boundaries');

  q = queue(); result = await run(d, q, { loadWorkflow: loaderFor({ 'process.rpa.json': child, 'recovery.rpa.json': def('Broken recovery', [n('repair-fail', 'throw', { message: 'Repair failed' })], [arg('error'), arg('ready', 'Out', 'String')]) }) }); assert.equal(result.status, 'error'); assert.equal(q.item().status, 'retry'); assert.ok(q.session.events.some(v => v.phase === 'recovery-failed')); assert.equal(q.mutations.filter(p => p.operation === 'complete').length, 1);
  console.log('PASS Recovery failure fails the run and preserves the already committed transaction failure');

  d = workflow([n('stop', 'log-message', { message: 'DO NOT PROCESS' }, { breakpoint: true })], { workflowFile: 'recovery.rpa.json' });
  q = queue(); result = await run(d, q, { debug: true, loadWorkflow: loaderFor({ 'recovery.rpa.json': recovery }), onPause: () => e.requestStop() }); assert.equal(result.status, 'stopped'); assert.equal(q.item().status, 'retry'); assert.ok(!q.mutations.some(p => p.operation === 'complete')); assert.ok(q.session.events.some(v => v.phase === 'stopped')); assert.ok(!result.logs.some(v => v.text.includes('RECOVER')));
  console.log('PASS Debug Stop releases the claim without committing success or running recovery');

  d = workflow([n('fail', 'throw', { message: 'Temporary' })], { workflowFile: 'recovery.rpa.json', inArguments: { error: '{{transactionError}}' }, outArguments: { ready: 'ready' } });
  const paused = [];
  q = queue(); result = await run(d, q, { debug: true, loadWorkflow: loaderFor({ 'recovery.rpa.json': { ...recoveryWithArguments, nodes: recoveryWithArguments.nodes.map(v => ({ ...v, data: { ...v.data, breakpoint: true } })) } }), onPause: id => { paused.push({ id, frames: e.useDebugStore.getState().frames.map(f => f.projectName), locals: e.useDebugStore.getState().locals }); e.resumeDebug('continue'); } });
  assert.equal(result.status, 'completed'); assert.ok(paused.some(p => p.frames.includes('Recover application'))); assert.ok(paused.some(p => p.locals.some(v => v.name === 'error')));
  console.log('PASS Recovery breakpoints, call stack and Locals expose typed error input');

  q = queue(); result = await run(d, q, { debug: true, loadWorkflow: loaderFor({ 'recovery.rpa.json': { ...recoveryWithArguments, nodes: recoveryWithArguments.nodes.map(v => ({ ...v, data: { ...v.data, breakpoint: true } })) } }), onPause: () => e.requestStop() }); assert.equal(result.status, 'stopped'); assert.equal(q.item().status, 'retry'); assert.ok(q.session.events.some(v => v.phase === 'recovery-stopped')); assert.equal(q.mutations.filter(p => p.operation === 'complete').length, 1);
  console.log('PASS Stop inside recovery preserves the committed failure and records recovery interruption');

  const retryBusiness = workflow([n('retry', 'retry-scope', { maxRetries: 3, retryDelay: 0 }, { isContainer: true, childIds: ['reject'] }), n('reject', 'business-rule-exception', { message: 'Invalid data' }, { parentId: 'retry' })]);
  q = queue(); let visits = 0; assert.equal(await e.executeWorkflow(retryBusiness.nodes, [], [], id => { if (id === 'reject') visits++; }, () => {}, () => {}, { queueSession: q.session }), 'completed'); assert.equal(visits, 1); assert.equal(q.item().errorType, 'Business');
  console.log('PASS Business exception bypasses activity Retry Scope inside a Transaction Scope');

  const privateValue = 'private-vault-value', resolveAsset = async () => ({ type: 'Credential', value: { username: 'fixture-user', password: privateValue } });
  const protectedDefinition = workflow([n('private-message', 'business-rule-exception', { message: '{{y.ToUpper()}}' })]); protectedDefinition.nodes.unshift(n('credential', 'get-credential', { assetName: 'ERP', usernameOutput: 'x', passwordOutput: 'y' }));
  q = queue(); result = await run(protectedDefinition, q, { assetContext: { resolve: resolveAsset } }); assert.equal(result.status, 'completed'); assert.equal(q.item().reason, '[REDACTED]'); assert.ok(!JSON.stringify(result).includes(privateValue.toUpperCase()));
  q = queue(); await e.executeRobotWorkflow(protectedDefinition, {}, native, () => {}, { queueSession: q.session, resolveAsset }); await q.session.close(); assert.equal(q.item().reason, '[REDACTED]');
  console.log('PASS Credential-derived Business messages stay masked in local/Robot transaction failures and history');

  q = queue({ uncertainCommit: true }); result = await run(workflow([n('ok', 'log-message', { message: 'processed' })], { workflowFile: 'recovery.rpa.json' }), q, { loadWorkflow: loaderFor({ 'recovery.rpa.json': recovery }) }); assert.equal(result.status, 'error'); assert.ok(q.session.events.some(v => v.phase === 'commit-unconfirmed')); assert.ok(!q.session.events.some(v => v.phase === 'recovery-started')); const attempts = q.mutations.filter(p => p.operation === 'complete'); assert.equal(attempts.length, 2); assert.equal(attempts[0].requestId, attempts[1].requestId);
  console.log('PASS Uncertain commit fails closed, reuses its request ID and never starts recovery');

  for (const invalid of [n('manual', 'set-transaction-status', { transaction: '{{transaction}}', status: 'Successful' }), n('nested', 'transaction-scope', { transaction: '{{transaction}}' }, { isContainer: true, childIds: [] }), n('get-again', 'get-transaction-item', { queueName: 'Invoices', output: 'another' })]) { q = queue(); result = await run(workflow([invalid]), q); assert.equal(result.status, 'completed'); assert.equal(q.item().status, 'retry'); assert.equal(q.mutations.filter(p => p.operation === 'complete').length, 1); }
  assert.throws(() => e.validateTransactionScope({ transaction: '{{transaction}}', resultOutput: 'transaction' }), /overwrite/);
  console.log('PASS Scope ownership prevents manual double commit, nested scopes, new claims and transaction-variable overwrite');

  d = workflow([n('reject', 'business-rule-exception', { message: 'Final rejection' })], { failureBehavior: 'Stop' }); q = queue(); result = await run(d, q); assert.equal(result.status, 'error'); assert.equal(q.item().status, 'failed');
  const src = { ...d, filePath: null, targets: [] }; assert.ok(!e.analyzeWorkflow(src).findings.some(v => v.code === 'WA411')); const bad = e.analyzeWorkflow({ ...src, nodes: workflow([n('manual', 'set-transaction-status', { transaction: '{{transaction}}', status: 'Successful' })]).nodes }); assert.ok(bad.findings.some(v => v.code === 'WA423'));
  console.log('PASS Stop-after-failure and Analyzer ownership checks');
  await require('./ui.cjs')(root, out);
  console.log('Transaction Scope checks passed. Artifacts: ' + out);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
