"""Studio Robot Jobs routes for okardesh/Maestro's script_server.py (stdlib only)."""
import hashlib
import hmac
import json
import math
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit, urlunsplit

BASE = '/api/v1/robot-jobs'
TERMINAL = {'success', 'failed', 'stopped'}
STATES = TERMINAL | {'queued', 'running', 'stopping'}
SENSITIVE = re.compile(r'password|secret|token|api.?key|credential|authorization', re.I)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@contextmanager
def _db(host):
    conn = sqlite3.connect(host['WORKFLOWS_DB'], timeout=15)
    conn.execute('''CREATE TABLE IF NOT EXISTS studio_robot_jobs (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, bot_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
        version TEXT NOT NULL, package_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        UNIQUE(organization_id, request_id))''')
    conn.commit()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _portable(item):
    definition = item.get('definition')
    manifest = definition.get('portablePackage') if isinstance(definition, dict) else None
    if not isinstance(manifest, dict) or manifest.get('format') != 'runway.portable-workflow' or manifest.get('schemaVersion') != 1:
        raise ValueError('Republish this workflow as a portable package.')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', str(manifest.get('id', ''))) or manifest.get('version') != item.get('version'):
        raise ValueError('Package version is invalid.')
    args = definition.get('arguments', [])
    if not isinstance(args, list) or len(args) > 100:
        raise ValueError('Invalid package arguments.')
    # Robot performs the complete graph/checksum validation before native actions.
    return manifest, [a for a in args if a.get('direction') == 'In']


def _typed(value, kind, depth=0):
    if depth > 10 or not isinstance(kind, str):
        return False
    if kind == 'String':
        return isinstance(value, str)
    if kind == 'Boolean':
        return isinstance(value, bool)
    if kind == 'DateTime':
        try:
            datetime.fromisoformat(value.replace('Z', '+00:00'))
            return True
        except (ValueError, TypeError, AttributeError):
            return False
    if kind == 'Object':
        return True
    if kind in ('Array', 'List') or kind.startswith('List<') and kind.endswith('>') or kind.endswith('[]'):
        element = kind[5:-1] if kind.startswith('List<') else kind[:-2] if kind.endswith('[]') else None
        return isinstance(value, list) and (element is None or all(_typed(v, element, depth + 1) for v in value))
    limits = {'Byte': (0, 255), 'SByte': (-128, 127), 'Int16': (-32768, 32767), 'UInt16': (0, 65535),
              'Int32': (-2147483648, 2147483647), 'UInt32': (0, 4294967295),
              'Int64': (-9007199254740991, 9007199254740991), 'UInt64': (0, 9007199254740991)}
    if kind in limits:
        return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and int(value) == value and limits[kind][0] <= value <= limits[kind][1]
    return kind in ('Single', 'Double', 'Decimal') and isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def _inputs(values, args):
    if not isinstance(values, dict) or len(json.dumps(values, allow_nan=False)) > 500000:
        raise ValueError('Inputs exceed the JSON argument limit.')
    known = {a['name']: a for a in args}
    if any(k not in known for k in values):
        raise ValueError('Unknown In argument.')
    for name, a in known.items():
        if name not in values:
            if a.get('required') and a.get('defaultValue') in (None, ''):
                raise ValueError('A required In argument is missing.')
        elif not _typed(values[name], a.get('type')):
            raise ValueError('Inputs do not match the published package argument types.')


def _masked(value, depth=0, secrets=None):
    if secrets is None:
        secrets = set()
        pending = [(value, 0)]
        while pending:
            item, level = pending.pop()
            if level > 12:
                continue
            if isinstance(item, dict):
                for key, next_value in item.items():
                    if SENSITIVE.search(key) and isinstance(next_value, str) and next_value:
                        secrets.add(next_value)
                    pending.append((next_value, level + 1))
            elif isinstance(item, list):
                pending.extend((v, level + 1) for v in item[:1000])
    if depth > 12:
        return '[Depth limit]'
    if isinstance(value, dict):
        return {k: '[REDACTED]' if SENSITIVE.search(k) else _masked(v, depth + 1, secrets) for k, v in value.items()}
    if isinstance(value, list):
        return [_masked(v, depth + 1, secrets) for v in value[:1000]]
    if isinstance(value, str):
        for secret in sorted(secrets, key=len, reverse=True):
            value = value.replace(secret, '[REDACTED]')
    return value


def _bot(host, tenant, bot_id, active=False):
    with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
        row = host['_get_license_registration'](conn, tenant, 'robot', bot_id)
    if not row or not row[9] or active and (not row[4] or int(row[8] or 0) < int(time.time() * 1000)):
        raise ValueError('Robot is not connected or has no registered listener.')
    return row


def _call(host, tenant, bot_id, method, suffix='', payload=None):
    row = _bot(host, tenant, bot_id)
    address = urlsplit(row[9])
    if address.scheme not in ('http', 'https') or not address.netloc or address.username or address.password:
        raise ValueError('Invalid registered Robot listener.')
    url = urlunsplit((address.scheme, address.netloc, '/api/robot/jobs' + suffix, '', ''))
    key = str(row[10] or host['_get_active_api_key']())
    request = Request(url, data=None if payload is None else json.dumps(payload, allow_nan=False).encode(), method=method,
                      headers={'X-API-Key': key, 'Content-Type': 'application/json'})
    with build_opener(NoRedirect()).open(request, timeout=12) as response:
        text = response.read(4_000_001)
        if len(text) > 4_000_000:
            raise ValueError('Robot response is too large.')
        result = json.loads(text)
    if result.get('ok') is not True:
        raise ValueError('Robot did not accept the request.')
    return result


def _save(host, tenant, job):
    job = _masked(job)
    with _db(host) as conn:
        previous = conn.execute('SELECT snapshot FROM studio_robot_jobs WHERE id=? AND organization_id=?', (job['jobId'], tenant)).fetchone()
        if not previous:
            raise ValueError('Job not found.')
        previous = json.loads(previous[0])
        if previous['status'] in TERMINAL:
            return previous
        conn.execute('UPDATE studio_robot_jobs SET snapshot=? WHERE id=? AND organization_id=?', (json.dumps(job), job['jobId'], tenant))
        conn.execute('''UPDATE rpa_jobs SET status=?, outputs=?, log=?, error=?, started_at=?, completed_at=?
                        WHERE id=? AND organization_id=?''', (job['status'], json.dumps(job.get('outputs', {})), json.dumps(job['logs']), job.get('error', ''), job['startedAt'], job.get('completedAt'), job['jobId'], tenant))
    return job


def _valid_view(job, job_id):
    return (isinstance(job, dict) and job.get('jobId') == job_id and job.get('status') in STATES
            and isinstance(job.get('startedAt'), (int, float)) and isinstance(job.get('logs'), list)
            and len(job['logs']) <= 2000 and all(isinstance(l, dict) and isinstance(l.get('sequence'), int)
            and isinstance(l.get('timestamp'), str) and l.get('level') in ('info', 'error')
            and isinstance(l.get('message'), str) for l in job['logs']))


def handle(handler, method, parsed, host):
    if parsed.path != BASE and not parsed.path.startswith(BASE + '/'):
        return False
    respond = handler._respond
    try:
        match = re.fullmatch(BASE + r'/([a-zA-Z0-9_-]{1,120})(/stop|/complete)?', parsed.path)
        # Completion is authenticated against the Robot registration for this exact job.
        if method == 'POST' and match and match[2] == '/complete':
            with _db(host) as conn:
                ticket = conn.execute('SELECT organization_id, bot_id FROM studio_robot_jobs WHERE id=?', (match[1],)).fetchone()
            if not ticket:
                respond(404, {'ok': False, 'error': 'Job not found.'})
                return True
            row = _bot(host, ticket[0], ticket[1])
            key = str(row[10] or host['_get_active_api_key']())
            if not key or not hmac.compare_digest(handler.headers.get('X-API-Key', ''), key):
                respond(401, {'ok': False, 'error': 'Unauthorized Robot callback.'})
                return True
            payload = handler._read_json_body() or {}
            job = payload.get('job')
            if not _valid_view(job, match[1]) or job['status'] not in TERMINAL:
                raise ValueError('Invalid completion snapshot. Update Robot to the Robot Jobs build.')
            respond(200, {'ok': True, 'job': _save(host, ticket[0], job)})
            return True
        if not host['_is_valid_api_key'](handler.headers.get('X-API-Key', '').strip()):
            respond(401, {'ok': False, 'error': 'Invalid or missing X-API-Key.'})
            return True
        # Uses Maestro's existing public API key and tenant policy; every DB lookup is tenant-filtered.
        tenant = host['get_request_tenant_id'](handler, parsed)
        if method == 'GET' and parsed.path == BASE + '/catalog':
            with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
                robots = host['_list_license_registrations'](conn, tenant, include_inactive=True)
            packages = []
            for item in host['_list_rpa_workflows'](tenant):
                try:
                    manifest, args = _portable(item)
                    packages.append({'workflowId': item['id'], 'name': item['name'], 'version': item['version'], 'packageId': manifest['id'], 'inputArguments': args})
                except (ValueError, TypeError, AttributeError):
                    continue
            respond(200, {'ok': True, 'schemaVersion': 1, 'packages': packages, 'robots': [
                {'id': r['deviceName'], 'name': r['deviceName'], 'online': bool(r.get('isActive') and r.get('listenerUrl'))}
                for r in robots if r.get('clientType') == 'robot']})
            return True
        if method == 'POST' and parsed.path == BASE:
            data = handler._read_json_body()
            if not isinstance(data, dict) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,120}', str(data.get('requestId', ''))):
                raise ValueError('Invalid request ID.')
            fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
            # Durable reservation is made before network dispatch, with a unique tenant/request key.
            with _db(host) as conn:
                conn.execute('BEGIN IMMEDIATE')
                ticket = conn.execute('SELECT id, fingerprint FROM studio_robot_jobs WHERE organization_id=? AND request_id=?', (tenant, data['requestId'])).fetchone()
                if ticket:
                    if ticket[1] != fingerprint:
                        respond(409, {'ok': False, 'error': 'Request ID already belongs to another job.'})
                    else:
                        respond(202, {'ok': True, 'jobId': ticket[0]})
                    return True
                bot_id = data.get('robotId')
                _bot(host, tenant, bot_id, active=True)
                item = next((p for p in host['_list_rpa_workflows'](tenant) if p['id'] == data.get('workflowId') and p['version'] == data.get('version')), None)
                if not item:
                    raise ValueError('Published package version not found.')
                manifest, args = _portable(item)
                if manifest['id'] != data.get('packageId'):
                    raise ValueError('Package changed. Refresh the catalog.')
                _inputs(data.get('inputs'), args)
                job_id, now = str(uuid.uuid4()), int(time.time() * 1000)
                view = {'jobId': job_id, 'status': 'queued', 'startedAt': now, 'logs': []}
                conn.execute('INSERT INTO studio_robot_jobs VALUES (?,?,?,?,?,?,?,?,?)', (job_id, tenant, data['requestId'], fingerprint, bot_id, item['id'], item['version'], manifest['id'], json.dumps(view)))
                conn.execute('''INSERT INTO rpa_jobs (id,organization_id,workflow_id,workflow_name,workflow_version,bot_id,status,inputs,created_at)
                                VALUES (?,?,?,?,?,?,?,?,?)''', (job_id, tenant, item['id'], item['name'], item['version'], bot_id, 'queued', json.dumps(_masked(data['inputs'])), now))
            callback_base = str(host.get('RUNWAY_PUBLIC_URL') or ('http://' + handler.headers.get('Host', ''))).rstrip('/')
            try:
                _call(host, tenant, bot_id, 'POST', payload={'jobId': job_id, 'workflowId': item['id'], 'definition': item['definition'], 'inputs': data['inputs'], 'callbackUrl': callback_base + BASE + '/' + job_id + '/complete'})
            except Exception:
                # No retry: Robot might have accepted before the connection was lost.
                pass
            respond(202, {'ok': True, 'jobId': job_id})
            return True
        if match and (method == 'GET' and not match[2] or method == 'POST' and match[2] == '/stop'):
            with _db(host) as conn:
                ticket = conn.execute('SELECT bot_id,snapshot FROM studio_robot_jobs WHERE id=? AND organization_id=?', (match[1], tenant)).fetchone()
            if not ticket:
                respond(404, {'ok': False, 'error': 'Job not found.'})
                return True
            view = json.loads(ticket[1])
            if view['status'] not in TERMINAL:
                view = _call(host, tenant, ticket[0], method, '/' + match[1] + (match[2] or '' )).get('job')
                if not _valid_view(view, match[1]):
                    raise ValueError('Robot returned invalid job data.')
                view = _save(host, tenant, view)
            respond(200, {'ok': True, 'job': view})
            return True
        respond(404, {'ok': False, 'error': 'Robot Jobs route not found.'})
    except ValueError as error:
        respond(400, {'ok': False, 'error': str(error)})
    except Exception:
        respond(502, {'ok': False, 'error': 'Job status is unavailable. Existing work may still be running; do not launch a duplicate job.'})
    return True
