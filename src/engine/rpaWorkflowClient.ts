import type { RunwayConnection } from './runwayConnection';

export interface RpaWorkflowArgument {
  name: string;
  type: string;
  required?: boolean;
  direction: 'In' | 'Out';
}

export interface RpaWorkflowPublishPayload {
  id?: string;
  name: string;
  version?: string;
  description?: string;
  inputArguments: RpaWorkflowArgument[];
  outputArguments: RpaWorkflowArgument[];
  definition: Record<string, unknown>;
}

export interface PublishedRpaWorkflow {
  id: string;
  name: string;
  version: string;
  description?: string;
  inputArguments: RpaWorkflowArgument[];
  outputArguments: RpaWorkflowArgument[];
  definition: Record<string, unknown>;
  publishedAt: number;
  publishedBy: string;
  organizationId: string;
}

interface PublishResponse {
  ok?: boolean;
  workflow?: PublishedRpaWorkflow;
  error?: string;
  message?: string;
}

function assertPublishPayload(payload: RpaWorkflowPublishPayload) {
  if (!payload.name.trim()) throw new Error('Enter a workflow name before publishing.');
  if (!payload.definition || typeof payload.definition !== 'object' || Array.isArray(payload.definition)) {
    throw new Error('The workflow definition is invalid.');
  }
}

function publishUrl(connection: RunwayConnection) {
  const url = new URL('/api/v1/rpa-workflows/publish', `${connection.serverUrl}/`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Runway server URL must use HTTP or HTTPS.');
  return url.toString();
}

function readResponse(text: string): PublishResponse {
  try { return text ? JSON.parse(text) as PublishResponse : {}; }
  catch { return { message: text }; }
}

function errorFor(status: number, payload: PublishResponse) {
  const detail = payload.error ?? payload.message;
  if (status === 400) return detail ?? 'Runway rejected the workflow data. Check the name and definition.';
  if (status === 401) return 'Runway rejected the configured API key. Reconnect Studio and try again.';
  if (status === 403) return 'The configured tenant is not allowed to publish RPA workflows.';
  if (status >= 500) return 'Runway is unavailable. Try publishing again shortly.';
  return detail ?? `Publishing failed (${status}).`;
}

export async function publishRpaWorkflow(
  connection: RunwayConnection,
  payload: RpaWorkflowPublishPayload,
): Promise<PublishedRpaWorkflow> {
  assertPublishPayload(payload);
  if (!connection.accessToken) throw new Error('No Runway API key is configured. Reconnect Studio and try again.');
  const url = publishUrl(connection);

  const requestPayload = { ...payload, version: payload.version?.trim() || '1.0.0' };
  let status: number;
  let responsePayload: PublishResponse;
  try {
    const publishFromElectron = (window as any).electronAPI?.publishRunwayWorkflow as undefined | ((url: string, apiKey: string, tenantId: string, publishPayload: RpaWorkflowPublishPayload) => Promise<{ networkError: boolean; status: number; body: string }>);
    if (publishFromElectron) {
      const result = await publishFromElectron(url, connection.accessToken, connection.organizationId, requestPayload);
      if (result.networkError) throw new Error();
      status = result.status;
      responsePayload = readResponse(result.body);
    } else {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': connection.accessToken,
          'X-Tenant-Id': connection.organizationId,
        },
        body: JSON.stringify(requestPayload),
      });
      status = response.status;
      responsePayload = readResponse(await response.text());
    }
  } catch {
    throw new Error('Could not reach Runway. Check the connection and try again.');
  }

  if (status < 200 || status >= 300 || responsePayload.ok !== true || !responsePayload.workflow?.id || !responsePayload.workflow.version) {
    throw new Error(status >= 200 && status < 300 ? 'Runway returned an invalid publishing response.' : errorFor(status, responsePayload));
  }
  return responsePayload.workflow;
}