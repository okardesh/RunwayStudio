/** Isolated reference gateway for the Robot transport/UI tests. Production Maestro uses its Python adapter. */
import { randomUUID, createHash } from 'node:crypto';
import { validatePortablePackage } from '../../src/shared/portableWorkflowPackage';
import { initializeArguments } from '../../src/shared/invokedWorkflows';
import type { RobotJobRequest, RobotJobView } from '../../src/shared/robotJobs';

export interface GatewayRobot { id: string; name: string; online: boolean; listenerUrl: string; apiKey: string }
export interface GatewayPackage { workflowId: string; name: string; version: string; definition: unknown }
export interface RobotJobsDependencies {
  // Must verify the Studio key and derive its tenant from the authenticated identity.
  authorize: (request: Request) => Promise<{ tenantId: string } | null>;
  robots: (tenantId: string) => Promise<GatewayRobot[]>;
  packages: (tenantId: string) => Promise<GatewayPackage[]>;
  callbackUrl: (jobId: string) => string;
}
interface Ticket { tenant: string; robot: GatewayRobot; id: string; state: 'pending' | 'submitted'; fingerprint: string }
/** Reference Runway adapter. Persist tickets using the host's job repository for multi-process deployments. */
export class RobotJobsGateway {
  private tickets = new Map<string, Ticket>();
  constructor(private deps: RobotJobsDependencies) {}
  private async robot(ticket: Ticket, method: 'GET' | 'POST', suffix = '', body?: unknown) {
    const url = new URL(ticket.robot.listenerUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Robot listener URL is invalid.');
    url.pathname = '/api/robot/jobs' + suffix; url.search = ''; url.hash = '';
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'X-API-Key': ticket.robot.apiKey, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw Error('Robot did not accept the request.');
    return result;
  }
  async handle(request: Request): Promise<Response> {
    const reply = (body: unknown, status = 200) => Response.json(body, { status });
    const identity = await this.deps.authorize(request);
    if (!identity) return reply({ ok: false, error: 'Unauthorized.' }, 401);
    const tenant = identity.tenantId, url = new URL(request.url), base = '/api/v1/robot-jobs';
    try {
      if (url.pathname === base + '/catalog' && request.method === 'GET') {
        const [robots, packages] = await Promise.all([this.deps.robots(tenant), this.deps.packages(tenant)]);
        const choices = [];
        for (const p of packages) {
          // Only immutable, validated, portable versions can be launched from Studio.
          try { const { manifest, definition } = await validatePortablePackage(p.definition); if (manifest.version === p.version) choices.push({ workflowId: p.workflowId, name: p.name, version: p.version, packageId: manifest.id, inputArguments: definition.arguments.filter(a => a.direction === 'In') }); } catch { /* Legacy packages require republishing. */ }
        }
        return reply({ ok: true, schemaVersion: 1, robots: robots.map(({ id, name, online }) => ({ id, name, online })), packages: choices });
      }
      if (url.pathname === base && request.method === 'POST') {
        const data = await request.json() as RobotJobRequest;
        if (!data || !/^[a-zA-Z0-9_-]{1,120}$/.test(data.requestId) || typeof data.robotId !== 'string' || typeof data.workflowId !== 'string' || typeof data.version !== 'string' || typeof data.packageId !== 'string' || !data.inputs || typeof data.inputs !== 'object' || Array.isArray(data.inputs) || JSON.stringify(data.inputs).length > 500000) return reply({ ok: false, error: 'Invalid job request.' }, 400);
        const key = tenant + ':' + data.requestId;
        let ticket = this.tickets.get(key);
        const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
        if (ticket && ticket.fingerprint !== fingerprint) return reply({ ok: false, error: 'Request ID already belongs to another job.' }, 409);
        if (!ticket) {
          if (this.tickets.size >= 1000) return reply({ ok: false, error: 'Job tracking capacity reached.' }, 503);
          const [robots, packages] = await Promise.all([this.deps.robots(tenant), this.deps.packages(tenant)]);
          const robot = robots.find(r => r.id === data.robotId && r.online), pkg = packages.find(p => p.workflowId === data.workflowId && p.version === data.version);
          if (!robot || !pkg) return reply({ ok: false, error: 'Robot or package version is unavailable.' }, 409);
          const { manifest, definition } = await validatePortablePackage(pkg.definition);
          if (manifest.id !== data.packageId || manifest.version !== data.version) return reply({ ok: false, error: 'Package version changed. Refresh the catalog.' }, 409);
          if (Object.keys(data.inputs).some(k => !definition.arguments.some(a => a.direction === 'In' && a.name === k))) return reply({ ok: false, error: 'Unknown input argument.' }, 400);
          try { initializeArguments(definition.arguments, definition.variables, data.inputs); }
          catch { return reply({ ok: false, error: 'Inputs do not match the published package arguments.' }, 400); }
          // Reserve after awaits only if another request has not already reserved the same key.
          ticket = this.tickets.get(key);
          if (ticket && ticket.fingerprint !== fingerprint) return reply({ ok: false, error: 'Request ID conflict.' }, 409);
          if (!ticket) {
            ticket = { tenant, fingerprint, robot, id: randomUUID(), state: 'pending' }; this.tickets.set(key, ticket);
            try {
              await this.robot(ticket, 'POST', '', { jobId: ticket.id, workflowId: data.workflowId, definition: pkg.definition, inputs: data.inputs, callbackUrl: this.deps.callbackUrl(ticket.id) });
              ticket.state = 'submitted';
            } catch { /* Acceptance may have happened. Never automatically dispatch a new job. */ }
          }
        }
        return reply({ ok: true, jobId: ticket.id }, 202);
      }
      const match = url.pathname.match(/^\/api\/v1\/robot-jobs\/([a-zA-Z0-9_-]{1,120})(\/stop)?$/);
      if (match && (request.method === 'GET' && !match[2] || request.method === 'POST' && match[2])) {
        const ticket = [...this.tickets.values()].find(t => t.tenant === tenant && t.id === match[1]);
        if (!ticket) return reply({ ok: false, error: 'Job not found.' }, 404);
        const result = await this.robot(ticket, match[2] ? 'POST' : 'GET', '/' + ticket.id + (match[2] ?? ''));
        const job = result.job as RobotJobView;
        if (job?.jobId !== ticket.id) throw Error('Robot returned a different job.');
        ticket.state = 'submitted';
        return reply({ ok: true, job });
      }
      return reply({ ok: false, error: 'Robot Jobs endpoint not found.' }, 404);
    } catch { return reply({ ok: false, error: 'Robot Jobs request could not be completed. Check the connection; an existing job may still be running.' }, 502); }
  }
}
