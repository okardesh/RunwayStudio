const SERVER_URL_KEY = 'runway.studio.serverUrl';
const INSTALLATION_ID_KEY = 'runway.studio.installationId';
const REGISTERED_SERVER_URL_KEY = 'runway.studio.registeredServerUrl';
const REGISTRATION_PROTOCOL_KEY = 'runway.studio.registrationProtocol';
const REGISTRATION_PROTOCOL_VERSION = '3';
const ORGANIZATION_ID = 'default';
const CLIENT_TYPE = 'Developer Studio';
let activeConnectionAttempt: Promise<RunwayConnection> | null = null;

export interface RunwayConnection {
  serverUrl: string;
  installationId: string;
  deviceName: string;
  organizationId: string;
  clientType: typeof CLIENT_TYPE;
  accessToken?: string;
  licenseId?: string;
  licenseExpiresAt?: string;
}

interface LicenseResponse {
  ok?: boolean;
  authenticated?: boolean;
  canUseDevelopers?: boolean;
  can_use_developers?: boolean;
  developer_licenses_remaining?: number;
  apiKey?: string;
  api_key?: string;
  license?: { id?: string; status?: string; expiresAt?: string; apiKey?: string; api_key?: string; canUseDevelopers?: boolean; can_use_developers?: boolean };
  token?: string;
  accessToken?: string;
  message?: string;
  error?: string;
}

function installationId() {
  const existing = localStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const value = globalThis.crypto?.randomUUID?.() ?? `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(INSTALLATION_ID_KEY, value);
  return value;
}

function deviceName() {
  return `runway-studio-${installationId()}`;
}

export function getSavedServerUrl() {
  return localStorage.getItem(SERVER_URL_KEY) ?? 'http://localhost:5050';
}

export function clearSavedConnection() {
  localStorage.removeItem(SERVER_URL_KEY);
}

function normalizeUrl(value: string) {
  const url = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a server URL beginning with http:// or https://.');
  return url;
}

async function readResponse(response: Response): Promise<LicenseResponse> {
  const text = await response.text();
  try { return text ? JSON.parse(text) as LicenseResponse : {}; }
  catch {
    // Do not retry a successful request just because its response was malformed.
    console.warn('Runway returned an unparseable license response:', text.replace(/("(?:apiKey|accessToken|token)"\s*:\s*")[^"]*/gi, '$1[redacted]'));
    return { message: 'Runway returned an unparseable license response.' };
  }
}

function hasDeveloperAccess(payload: LicenseResponse) {
  return payload.license?.canUseDevelopers === true
    || payload.license?.can_use_developers === true
    || payload.canUseDevelopers === true
    || payload.can_use_developers === true
    || (typeof payload.developer_licenses_remaining === 'number' && payload.developer_licenses_remaining > 0);
}

function apiKeyFrom(payload: LicenseResponse) {
  return payload.apiKey ?? payload.api_key ?? payload.accessToken ?? payload.token ?? payload.license?.apiKey ?? payload.license?.api_key;
}

function secureStore() {
  const api = (window as any).electronAPI;
  return api?.getRunwayApiKey && api?.storeRunwayApiKey ? api : null;
}

async function requestLicense(serverUrl: string, deviceName: string, action: 'register' | 'heartbeat') {
  const response = await fetch(`${serverUrl}/api/license/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-Id': ORGANIZATION_ID },
    body: JSON.stringify({
      organizationId: ORGANIZATION_ID,
      clientType: CLIENT_TYPE,
      deviceName,
      ...(action === 'register' ? { consume: true } : {}),
    }),
  });
  return { response, payload: await readResponse(response) };
}

async function createConnection(input: string): Promise<RunwayConnection> {
  const serverUrl = normalizeUrl(input);
  // Keep the last valid address available when the server is temporarily offline.
  localStorage.setItem(SERVER_URL_KEY, serverUrl);
  const id = installationId();
  const name = deviceName();
  const isRegistered = localStorage.getItem(REGISTERED_SERVER_URL_KEY) === serverUrl
    && localStorage.getItem(REGISTRATION_PROTOCOL_KEY) === REGISTRATION_PROTOCOL_VERSION;
  let action: 'register' | 'heartbeat' = isRegistered ? 'heartbeat' : 'register';
  let { response, payload } = await requestLicense(serverUrl, name, action);
  const registrationInactive = action === 'heartbeat'
    && (payload.message ?? payload.error ?? '').toLowerCase().includes('registration not active');
  if (registrationInactive) {
    localStorage.removeItem(REGISTERED_SERVER_URL_KEY);
    localStorage.removeItem(REGISTRATION_PROTOCOL_KEY);
    action = 'register';
    ({ response, payload } = await requestLicense(serverUrl, name, action));
  }
  if (!response.ok || payload.ok !== true || (action === 'register' && payload.authenticated !== true)) {
    throw new Error(payload.message ?? payload.error ?? `Runway Studio ${action} failed (${response.status}).`);
  }
  if (!hasDeveloperAccess(payload)) {
    throw new Error('Runway did not grant Developer Studio license access.');
  }
  const issuedApiKey = apiKeyFrom(payload);
  const credentials = secureStore();
  if (issuedApiKey && credentials) await credentials.storeRunwayApiKey(serverUrl, issuedApiKey);
  const accessToken = issuedApiKey ?? await credentials?.getRunwayApiKey(serverUrl);
  if (!accessToken) {
    throw new Error('Runway confirmed the license but did not issue an API key. Studio cannot publish workflows until Runway publishing access is configured.');
  }
  if (!isRegistered) {
    localStorage.setItem(REGISTERED_SERVER_URL_KEY, serverUrl);
    localStorage.setItem(REGISTRATION_PROTOCOL_KEY, REGISTRATION_PROTOCOL_VERSION);
  }

  const connection: RunwayConnection = {
    serverUrl,
    installationId: id,
    deviceName: name,
    organizationId: ORGANIZATION_ID,
    clientType: CLIENT_TYPE,
    accessToken,
    licenseId: payload.license?.id,
    licenseExpiresAt: payload.license?.expiresAt,
  };
  return connection;
}

export function connectToRunwayServer(input: string): Promise<RunwayConnection> {
  if (activeConnectionAttempt) return activeConnectionAttempt;
  activeConnectionAttempt = createConnection(input).finally(() => { activeConnectionAttempt = null; });
  return activeConnectionAttempt;
}

async function licenseRequest(connection: RunwayConnection, action: 'heartbeat' | 'release') {
  const response = await fetch(`${connection.serverUrl}/api/license/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-Id': connection.organizationId },
    body: JSON.stringify({ organizationId: connection.organizationId, clientType: connection.clientType, deviceName: connection.deviceName }),
    keepalive: action === 'release',
  });
  const payload = await readResponse(response);
  if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? payload.error ?? `License ${action} failed (${response.status}).`);
}

export function heartbeatRunwayLicense(connection: RunwayConnection) {
  return licenseRequest(connection, 'heartbeat');
}

export function releaseRunwayLicense(connection: RunwayConnection) {
  return licenseRequest(connection, 'release');
}
