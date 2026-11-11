export type LicenseAction = 'register' | 'heartbeat' | 'release';

export interface LicenseRequest {
  serverUrl: string;
  action: LicenseAction;
  deviceName: string;
  organizationId: string;
}

export interface LicenseTransportResult {
  status: number;
  body: string;
  error?: { code: string; message: string };
}

export const LICENSE_TIMEOUT_MS = 10_000;

export function normalizeRunwayServerUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Enter the Runway server address.');
  let url: URL;
  try { url = new URL(value.includes('://') ? value : `http://${value}`); }
  catch { throw new Error('Enter a valid Runway server address, such as http://172.20.10.12:5050.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an http:// or https:// server address without credentials, query parameters or a fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

export async function postLicenseRequest(
  request: LicenseRequest,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<LicenseTransportResult> {
  let serverUrl: string;
  try {
    serverUrl = normalizeRunwayServerUrl(request.serverUrl);
    if (!['register', 'heartbeat', 'release'].includes(request.action)
      || typeof request.deviceName !== 'string' || !request.deviceName.trim() || request.deviceName.length > 512
      || typeof request.organizationId !== 'string' || !request.organizationId.trim() || request.organizationId.length > 512) {
      throw new Error('Invalid Runway license request.');
    }
  } catch (error) {
    return { status: 0, body: '', error: { code: 'INVALID_REQUEST', message: (error as Error).message } };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? LICENSE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetch ?? fetch)(`${serverUrl}/api/license/${request.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-Id': request.organizationId },
      body: JSON.stringify({
        organizationId: request.organizationId,
        clientType: 'Developer Studio',
        deviceName: request.deviceName,
        ...(request.action === 'register' ? { consume: true } : {}),
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (error as { code?: string })?.code;
    const timeout = controller.signal.aborted || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code ?? '');
    const message = timeout
      ? `Runway Server at ${serverUrl} did not respond within ${timeoutMs / 1000} seconds. Check that the Mac server is running and reachable from this Windows network.`
      : code === 'ECONNREFUSED'
        ? `Runway Server refused the connection at ${serverUrl}. Check the server port and that Runway is listening for network connections.`
        : ['ENOTFOUND', 'EAI_AGAIN'].includes(code ?? '')
          ? `The Runway server name could not be resolved: ${serverUrl}. Check the address.`
          : `Could not reach Runway Server at ${serverUrl}. Check the address, server and network connection.`;
    return { status: 0, body: '', error: { code: timeout ? 'TIMEOUT' : code ?? 'NETWORK_ERROR', message } };
  } finally { clearTimeout(timer); }
}
