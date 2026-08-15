import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, Tray } from 'electron';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeActivity } from '../../electron/automation/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const ORGANIZATION_ID = 'default';
const CLIENT_TYPE = 'robot';
const LISTENER_PORT = Number(process.env.RUNWAY_ROBOT_PORT ?? 5050);

type Settings = { serverUrl?: string; deviceId?: string; registeredServerUrl?: string; registrationProtocol?: string };
const REGISTRATION_PROTOCOL = 'hostname-listener-path-v1';
type LicenseResponse = {
  ok?: boolean;
  authenticated?: boolean;
  canUseRobots?: boolean;
  can_use_robots?: boolean;
  license?: { canUseRobots?: boolean; can_use_robots?: boolean };
  apiKey?: string;
  api_key?: string;
  accessToken?: string;
  token?: string;
  message?: string;
  error?: string;
};
type WorkflowNode = { id: string; data?: { activityId?: string; label?: string; properties?: Record<string, unknown>; childIds?: string[]; parentId?: string } };
type Trigger = { jobId: string; workflowId?: string; workflow?: { definition?: WorkflowDefinition } | WorkflowDefinition; definition?: WorkflowDefinition; inputs?: Record<string, unknown>; callbackUrl: string };
type WorkflowDefinition = { nodes?: WorkflowNode[]; edges?: unknown[]; variables?: Array<{ name: string; defaultValue?: unknown }> };
type JobLog = { timestamp: string; level: 'info' | 'error'; message: string };

let tray: Tray | null = null;
let connectionWindow: BrowserWindow | null = null;
let listener: http.Server | null = null;
let isQuitting = false;
let activeJob = false;
const queue: Trigger[] = [];
let connection: { serverUrl: string; apiKey: string; deviceName: string } | null = null;

function settingsPath() { return path.join(app.getPath('userData'), 'robot-settings.json'); }
function credentialPath() { return path.join(app.getPath('userData'), 'robot-credentials.json'); }
function readJson<T>(filePath: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T; } catch { return fallback; } }
function writeJson(filePath: string, value: unknown) { fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); }
function readSettings() { return readJson<Settings>(settingsPath(), {}); }
function saveSettings(settings: Settings) { writeJson(settingsPath(), settings); }
function hostname() {
  return os.hostname();
}
function listenerUrl() {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((network) => network?.family === 'IPv4' && !network.internal)?.address ?? hostname();
  return `http://${address}:${LISTENER_PORT}/api/robot/jobs`;
}
function stableDeviceName() {
  const settings = readSettings();
  if (!settings.deviceId) {
    settings.deviceId = `${os.hostname().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-${crypto.randomUUID()}`;
    saveSettings(settings);
  }
  return settings.deviceId;
}
function readApiKey(serverUrl: string) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const encrypted = readJson<Record<string, string>>(credentialPath(), {})[serverUrl];
  if (!encrypted) return null;
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return null; }
}
function storeApiKey(serverUrl: string, apiKey: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
  const credentials = readJson<Record<string, string>>(credentialPath(), {});
  credentials[serverUrl] = safeStorage.encryptString(apiKey).toString('base64');
  writeJson(credentialPath(), credentials);
}
function normalizeUrl(value: string) {
  const url = new URL(value.trim().replace(/\/+$/, ''));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Enter a Runway URL using HTTP or HTTPS.');
  return url.toString().replace(/\/$/, '');
}
function apiKeyFrom(payload: LicenseResponse) { return payload.apiKey ?? payload.api_key ?? payload.accessToken ?? payload.token; }
function robotAccess(payload: LicenseResponse) {
  return payload.canUseRobots === true || payload.can_use_robots === true || payload.license?.canUseRobots === true || payload.license?.can_use_robots === true;
}
async function licenseRequest(serverUrl: string, action: 'register' | 'heartbeat', machineName: string) {
  const response = await fetch(`${serverUrl}/api/license/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': ORGANIZATION_ID },
    body: JSON.stringify({ organizationId: ORGANIZATION_ID, clientType: CLIENT_TYPE, hostname: machineName, deviceName: machineName, listenerUrl: listenerUrl(), ...(action === 'register' ? { consume: true } : {}) }),
  });
  const text = await response.text();
  let payload: LicenseResponse = {};
  try { payload = text ? JSON.parse(text) as LicenseResponse : {}; } catch { throw new Error(`Runway ${action} returned an invalid response.`); }
  if (!response.ok || payload.ok !== true || (action === 'register' && payload.authenticated !== true)) throw new Error(payload.message ?? payload.error ?? `Runway ${action} failed (${response.status}).`);
  if (!robotAccess(payload)) throw new Error('Runway did not grant Robot license access.');
  return payload;
}
async function connectToRunway(value: string) {
  const serverUrl = normalizeUrl(value);
  const settings = readSettings();
  const deviceName = hostname();
  await startListener();
  let action: 'register' | 'heartbeat' = settings.registeredServerUrl === serverUrl && settings.registrationProtocol === REGISTRATION_PROTOCOL ? 'heartbeat' : 'register';
  let payload = await licenseRequest(serverUrl, action, deviceName);
  if (action === 'heartbeat' && /registration not active/i.test(payload.message ?? payload.error ?? '')) {
    action = 'register';
    payload = await licenseRequest(serverUrl, action, deviceName);
  }
  const apiKey = apiKeyFrom(payload) ?? readApiKey(serverUrl);
  if (!apiKey) throw new Error('Runway did not issue a Robot API key.');
  if (apiKeyFrom(payload)) storeApiKey(serverUrl, apiKey);
  saveSettings({ ...readSettings(), serverUrl, registeredServerUrl: serverUrl, registrationProtocol: REGISTRATION_PROTOCOL });
  connection = { serverUrl, apiKey, deviceName };
  connectionWindow?.hide();
  refreshTray();
  new Notification({ title: 'Runway Robot connected', body: `Listening for workflow jobs on port ${LISTENER_PORT}.` }).show();
}
function readRequest(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > 10 * 1024 * 1024) request.destroy(new Error('Request too large')); });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
function log(logs: JobLog[], level: JobLog['level'], message: string) { logs.push({ timestamp: new Date().toISOString(), level, message }); }
async function executeWorkflow(definition: WorkflowDefinition, inputs: Record<string, unknown>, logs: JobLog[]) {
  const nodes = definition.nodes ?? [];
  const values: Record<string, unknown> = Object.fromEntries((definition.variables ?? []).map((variable) => [variable.name, variable.defaultValue]));
  Object.assign(values, inputs);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const resolveProperties = (properties: Record<string, unknown>) => Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, typeof value === 'string' ? value.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (match, name) => name in values ? String(values[name] ?? '') : match) : value]));
  const runNode = async (node: WorkflowNode): Promise<void> => {
    const data = node.data;
    const activityId = data?.activityId;
    if (!activityId) throw new Error(`Workflow node ${node.id} has no activity ID.`);
    log(logs, 'info', `Starting ${data?.label ?? activityId}`);
    const result = await executeActivity(activityId, resolveProperties(data?.properties ?? {}));
    log(logs, result.success ? 'info' : 'error', result.log);
    if (!result.success) throw new Error(result.log || `${activityId} failed.`);
    Object.assign(values, result.outputs ?? {});
    for (const childId of data?.childIds ?? []) {
      const child = nodesById.get(childId);
      if (child) await runNode(child);
    }
  };
  const topLevel = nodes.filter((node) => !node.data?.parentId);
  if (!topLevel.length) throw new Error('Published workflow has no executable nodes.');
  for (const node of topLevel) await runNode(node);
}
async function report(trigger: Trigger, status: 'success' | 'failed', logs: JobLog[], error?: string) {
  const callbackUrl = new URL(trigger.callbackUrl);
  if (!connection || (callbackUrl.protocol !== 'http:' && callbackUrl.protocol !== 'https:')) return;
  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': connection.apiKey, 'X-Tenant-Id': ORGANIZATION_ID },
      body: JSON.stringify({ jobId: trigger.jobId, workflowId: trigger.workflowId, status, logs, error, completedAt: new Date().toISOString(), apiKey: connection.apiKey }),
    });
    if (!response.ok) console.error(`Runway rejected the ${status} callback for job ${trigger.jobId}: HTTP ${response.status}.`);
  } catch (reason) {
    console.error(`Robot could not report ${status} for job ${trigger.jobId}:`, reason);
  }
}
async function drainQueue() {
  if (activeJob || !connection) return;
  const trigger = queue.shift();
  if (!trigger) return;
  activeJob = true;
  const logs: JobLog[] = [];
  try {
    const definition: WorkflowDefinition | undefined = trigger.definition
      ?? (trigger.workflow && 'definition' in trigger.workflow ? trigger.workflow.definition : trigger.workflow as WorkflowDefinition | undefined);
    if (!definition || typeof definition !== 'object') throw new Error('Trigger is missing a workflow definition.');
    log(logs, 'info', `Robot accepted job ${trigger.jobId}.`);
    await executeWorkflow(definition, trigger.inputs ?? {}, logs);
    log(logs, 'info', `Job ${trigger.jobId} completed successfully.`);
    await report(trigger, 'success', logs);
    new Notification({ title: 'Runway Robot', body: `Job ${trigger.jobId} completed.` }).show();
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : 'Workflow execution failed.';
    log(logs, 'error', error);
    await report(trigger, 'failed', logs, error);
    new Notification({ title: 'Runway Robot', body: `Job ${trigger.jobId} failed.` }).show();
  } finally {
    activeJob = false;
    refreshTray();
    void drainQueue();
  }
}
function startListener(): Promise<void> {
  if (listener?.listening) return Promise.resolve();
  if (listener) throw new Error(`Robot listener is starting on port ${LISTENER_PORT}.`);
  listener = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true, connected: !!connection, activeJob, queued: queue.length });
    if (request.method !== 'POST' || request.url !== '/api/robot/jobs') return send(response, 404, { ok: false, error: 'Not found.' });
    if (!connection || request.headers['x-api-key'] !== connection.apiKey) return send(response, 401, { ok: false, error: 'Unauthorized.' });
    try {
      const trigger = JSON.parse(await readRequest(request)) as Trigger;
      if (!trigger.jobId || !trigger.callbackUrl || (!trigger.definition && !trigger.workflow)) return send(response, 400, { ok: false, error: 'jobId, callbackUrl, and workflow are required.' });
      queue.push(trigger);
      send(response, 202, { ok: true, jobId: trigger.jobId, status: 'queued' });
      refreshTray();
      void drainQueue();
    } catch {
      send(response, 400, { ok: false, error: 'Invalid job JSON.' });
    }
  });
  return new Promise((resolve, reject) => {
    const server = listener!;
    const fail = (error: Error) => { listener = null; reject(new Error(`Robot could not start its listener on port ${LISTENER_PORT}: ${error.message}`)); };
    server.once('error', fail);
    server.listen(LISTENER_PORT, '0.0.0.0', () => { server.removeListener('error', fail); resolve(); });
  });
}
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(connection ? `Runway Robot: ${activeJob ? 'running a job' : 'connected'}` : 'Runway Robot: not connected');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connection ? `Connected to ${connection.serverUrl}` : 'Not connected', enabled: false },
    { label: activeJob ? 'Job running' : `${queue.length} queued job${queue.length === 1 ? '' : 's'}`, enabled: false },
    { type: 'separator' },
    { label: 'Connection settings', click: () => { showConnectionWindow(); } },
    { label: 'Quit Robot', click: () => { isQuitting = true; app.quit(); } },
  ]));
}
function showConnectionWindow() {
  if (!connectionWindow) {
    connectionWindow = new BrowserWindow({ width: 540, height: 650, resizable: false, title: 'Runway Robot', webPreferences: { preload: path.join(__dirname, 'preload.mjs'), contextIsolation: true, nodeIntegration: false } });
    connectionWindow.on('close', (event) => { if (!isQuitting && connection) { event.preventDefault(); connectionWindow?.hide(); } });
  }
  connectionWindow.loadFile(path.join(APP_ROOT, 'public', 'connect.html'));
  connectionWindow.show();
  connectionWindow.focus();
}
app.whenReady().then(async () => {
  tray = new Tray(nativeImage.createFromPath(path.resolve(APP_ROOT, '..', 'public', 'logo.png')));
  refreshTray();
  ipcMain.handle('robot:status', () => ({ connected: !!connection, serverUrl: readSettings().serverUrl, port: LISTENER_PORT, deviceName: hostname() }));
  ipcMain.handle('robot:connect', async (_event, serverUrl: string) => {
    try { await connectToRunway(serverUrl); return { ok: true }; }
    catch (reason) { return { ok: false, message: reason instanceof Error ? reason.message : 'Could not connect Robot.' }; }
  });
  const savedUrl = readSettings().serverUrl;
  if (savedUrl) {
    try { await connectToRunway(savedUrl); } catch { showConnectionWindow(); }
  } else showConnectionWindow();
});
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
app.on('before-quit', () => { isQuitting = true; listener?.close(); });
