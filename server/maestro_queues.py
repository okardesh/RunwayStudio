"""Durable environment-scoped transactions. Delivery is leased and at-least-once."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs
import maestro_assets

BASE = '/api/v1/studio-queues'


class QueueError(ValueError):
    pass


@contextmanager
def database(host, tenant):
    with maestro_assets.database(host, tenant) as conn:
        with conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_queues(tenant TEXT,profile_id TEXT,name TEXT,enabled INTEGER,max_retries INTEGER,retry_delay INTEGER,lease_seconds INTEGER,revision INTEGER,PRIMARY KEY(tenant,profile_id,name))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_queue_items(id TEXT PRIMARY KEY,tenant TEXT,profile_id TEXT,queue TEXT,reference TEXT,content TEXT,status TEXT,attempt INTEGER DEFAULT 0,retries INTEGER DEFAULT 0,ready_at INTEGER,lease_until INTEGER,owner TEXT,lease_hash TEXT,claim_request TEXT,error_type TEXT,reason TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(tenant,profile_id,queue,reference))''')
            conn.execute('CREATE INDEX IF NOT EXISTS studio_queue_ready ON studio_queue_items(tenant,profile_id,queue,status,ready_at,created_at)')
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_queue_requests(tenant TEXT,owner TEXT,request_id TEXT,fingerprint TEXT,result TEXT,PRIMARY KEY(tenant,owner,request_id))''')
            conn.execute('CREATE TABLE IF NOT EXISTS studio_job_queue_grants(job_id TEXT PRIMARY KEY,refs TEXT)')
        yield conn


def now():
    return int(time.time() * 1000)


def signing_key(host):
    file = Path(host['WORKFLOWS_DB']).resolve().parent / 'studio-queues.key'
    try:
        fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(secrets.token_bytes(32))
    key = file.read_bytes()
    if len(key) != 32:
        raise QueueError('Queue signing key is unavailable.')
    return key


def public(row):
    return {'id': row['id'], 'queueName': row['queue'], 'environmentId': row['profile_id'], 'reference': row['reference'], 'status': row['status'], 'attempt': row['attempt'], 'retryCount': row['retries'], 'readyAt': row['ready_at'], 'leaseUntil': row['lease_until'], 'errorType': row['error_type'], 'reason': row['reason'], 'updatedAt': row['updated_at']}


def fail(conn, row, kind, reason):
    config = conn.execute('SELECT max_retries,retry_delay FROM studio_queues WHERE tenant=? AND profile_id=? AND name=?', (row['tenant'], row['profile_id'], row['queue'])).fetchone()
    retry = kind == 'Application' and row['retries'] < config[0]
    status = 'retry' if retry else 'failed'
    conn.execute('''UPDATE studio_queue_items SET status=?,retries=retries+?,ready_at=?,lease_until=NULL,owner=NULL,lease_hash=NULL,claim_request=NULL,error_type=?,reason=?,updated_at=? WHERE id=?''', (status, int(retry), now() + config[1] * 1000 if retry else now(), kind, reason[:2000], now(), row['id']))


def reap(conn, tenant, profile_id):
    for row in conn.execute("SELECT * FROM studio_queue_items WHERE tenant=? AND profile_id=? AND status='in_progress' AND lease_until<=?", (tenant, profile_id, now())).fetchall():
        fail(conn, row, 'Application', 'Transaction lease expired before its result was committed.')


def release_owner(conn, tenant, owner):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='studio_queue_items'").fetchone():
        return []
    conn.row_factory = sqlite3.Row
    released = []
    for row in conn.execute("SELECT * FROM studio_queue_items WHERE tenant=? AND owner=? AND status='in_progress'", (tenant, owner)).fetchall():
        fail(conn, row, 'Application', 'Run ended before the transaction result was committed.')
        released.append(public(conn.execute('SELECT * FROM studio_queue_items WHERE id=?', (row['id'],)).fetchone()))
    return released


def requirements(definition):
    refs = {}
    complete = False
    for file in definition.get('portablePackage', {}).get('workflows', []):
        for node in file.get('definition', {}).get('nodes', []):
            data = node.get('data', {}); activity = data.get('activityId')
            if activity in ('set-transaction-status', 'transaction-scope'):
                complete = True
            if activity not in ('add-queue-item', 'get-transaction-item'):
                continue
            name = data.get('properties', {}).get('queueName')
            if not isinstance(name, str) or not maestro_assets.NAME.fullmatch(name):
                raise QueueError('Queue names must be static central references.')
            ops = refs.setdefault(name, [])
            operation = 'add' if activity == 'add-queue-item' else 'claim'
            if operation not in ops:
                ops.append(operation)
    if complete:
        for ops in refs.values():
            if 'claim' in ops:
                ops.append('complete')
    return [{'name': name, 'operations': operations} for name, operations in refs.items()]


def prepare_grant(conn, tenant, profile_id, definition, job_id):
    refs = requirements(definition)
    for ref in refs:
        q = conn.execute('SELECT enabled FROM studio_queues WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, ref['name'])).fetchone()
        if not q or not q[0]:
            raise QueueError('A required queue is missing or disabled in the selected environment.')
    conn.execute('INSERT INTO studio_job_queue_grants VALUES (?,?)', (job_id, json.dumps(refs)))


def operate(host, tenant, profile_id, owner, payload, allowed=None):
    operation = payload.get('operation'); request_id = payload.get('requestId')
    if operation not in ('add', 'claim', 'complete', 'renew', 'release', 'releaseAll') or not isinstance(request_id, str) or not maestro_assets.NAME.fullmatch(request_id):
        raise QueueError('Invalid queue operation or request ID.')
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
    with database(host, tenant) as conn:
        conn.row_factory = sqlite3.Row
        with conn:
            conn.execute('BEGIN IMMEDIATE')
            # Serialize job lifetime with terminal callback cleanup. Authorization above
            # the database lock alone could allow a late claim after cleanup committed.
            if allowed is not None:
                ticket = conn.execute('SELECT snapshot FROM studio_robot_jobs WHERE id=? AND organization_id=?', (owner.removeprefix('job:'), tenant)).fetchone()
                if not ticket or json.loads(ticket[0]).get('status') in ('success', 'failed', 'stopped'):
                    raise QueueError('This Robot job has ended.')
            previous = conn.execute('SELECT fingerprint,result FROM studio_queue_requests WHERE tenant=? AND owner=? AND request_id=?', (tenant, owner, request_id)).fetchone()
            if previous:
                if previous[0] != fingerprint:
                    raise QueueError('Request ID was reused with different data.')
                result = json.loads(previous[1])
            else:
                # Existing leases can finish even when an operator disables an environment.
                if operation in ('add', 'claim'):
                    maestro_assets.profile(conn, tenant, profile_id)
                reap(conn, tenant, profile_id)
                result = {'item': None}
                if operation == 'releaseAll':
                    result['released'] = release_owner(conn, tenant, owner)
                else:
                    name = payload.get('queueName')
                    if not isinstance(name, str) or not maestro_assets.NAME.fullmatch(name):
                        raise QueueError('Invalid queue name.')
                    permission = 'claim' if operation in ('renew', 'release') else operation
                    if allowed is not None and not any(r['name'] == name and permission in r['operations'] for r in allowed):
                        raise QueueError('This package cannot perform that queue operation.')
                    config = conn.execute('SELECT * FROM studio_queues WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, name)).fetchone()
                    if not config or operation in ('add', 'claim') and not config['enabled']:
                        raise QueueError('Queue is missing or disabled.')
                    item = None
                    if operation == 'add':
                        reference, content = payload.get('reference'), payload.get('content')
                        if not isinstance(reference, str) or not reference.strip() or len(reference) > 200 or not isinstance(content, dict):
                            raise QueueError('A reference and JSON object content are required.')
                        reference = reference.strip()
                        text = json.dumps(content, sort_keys=True, allow_nan=False, separators=(',', ':'))
                        if len(text) > 100000:
                            raise QueueError('Queue content exceeds 100 KB.')
                        item = conn.execute('SELECT * FROM studio_queue_items WHERE tenant=? AND profile_id=? AND queue=? AND reference=?', (tenant, profile_id, name, reference)).fetchone()
                        if item and item['content'] != text:
                            raise QueueError('This reference already belongs to different queue content.')
                        if not item:
                            item_id = str(uuid.uuid4())
                            conn.execute('INSERT INTO studio_queue_items(id,tenant,profile_id,queue,reference,content,status,ready_at,created_at,updated_at) VALUES (?,?,?,?,?,?,\'new\',?,?,?)', (item_id, tenant, profile_id, name, reference, text, now(), now(), now()))
                            item = conn.execute('SELECT * FROM studio_queue_items WHERE id=?', (item_id,)).fetchone()
                        else:
                            result['duplicate'] = True
                    elif operation == 'claim':
                        item = conn.execute("SELECT * FROM studio_queue_items WHERE tenant=? AND profile_id=? AND queue=? AND status IN ('new','retry') AND ready_at<=? ORDER BY created_at,id LIMIT 1", (tenant, profile_id, name, now())).fetchone()
                        if item:
                            token = hmac.new(signing_key(host), (owner + ':' + request_id + ':' + item['id']).encode(), hashlib.sha256).hexdigest()
                            conn.execute("UPDATE studio_queue_items SET status='in_progress',attempt=attempt+1,owner=?,lease_hash=?,claim_request=?,lease_until=?,updated_at=? WHERE id=?", (owner, hashlib.sha256(token.encode()).hexdigest(), request_id, now() + config['lease_seconds'] * 1000, now(), item['id']))
                            item = conn.execute('SELECT * FROM studio_queue_items WHERE id=?', (item['id'],)).fetchone()
                    else:
                        item = conn.execute('SELECT * FROM studio_queue_items WHERE id=? AND tenant=? AND profile_id=? AND queue=?', (payload.get('itemId'), tenant, profile_id, name)).fetchone()
                        if not item or item['status'] != 'in_progress' or item['owner'] != owner or item['lease_until'] <= now() or not hmac.compare_digest(item['lease_hash'] or '', hashlib.sha256(str(payload.get('leaseToken', '')).encode()).hexdigest()):
                            raise QueueError('Transaction lease is expired or belongs to another run.')
                        if operation == 'renew':
                            conn.execute('UPDATE studio_queue_items SET lease_until=?,updated_at=? WHERE id=?', (now() + config['lease_seconds'] * 1000, now(), item['id']))
                        elif operation == 'release':
                            fail(conn, item, 'Application', 'Run ended before the transaction result was committed.')
                        elif payload.get('status') == 'Successful':
                            conn.execute("UPDATE studio_queue_items SET status='successful',owner=NULL,lease_hash=NULL,claim_request=NULL,lease_until=NULL,error_type=NULL,reason=NULL,updated_at=? WHERE id=?", (now(), item['id']))
                        elif payload.get('status') == 'Failed' and payload.get('errorType') in ('Application', 'Business'):
                            reason = payload.get('reason', '')
                            if not isinstance(reason, str) or len(reason) > 2000:
                                raise QueueError('Transaction error reason exceeds 2,000 characters.')
                            fail(conn, item, payload['errorType'], reason)
                        else:
                            raise QueueError('Choose Successful or Failed with an Application/Business error type.')
                        item = conn.execute('SELECT * FROM studio_queue_items WHERE id=?', (item['id'],)).fetchone()
                    if item:
                        result['item'] = public(item)
                        result['leaseSeconds'] = config['lease_seconds']
                conn.execute('INSERT INTO studio_queue_requests VALUES (?,?,?,?,?)', (tenant, owner, request_id, fingerprint, json.dumps(result)))
            if result.get('item'):
                current = conn.execute('SELECT * FROM studio_queue_items WHERE id=?', (result['item']['id'],)).fetchone()
                result['item']['content'] = json.loads(current['content'])
                if operation == 'claim':
                    token = hmac.new(signing_key(host), (owner + ':' + request_id + ':' + current['id']).encode(), hashlib.sha256).hexdigest()
                    if current['status'] != 'in_progress' or current['owner'] != owner or current['claim_request'] != request_id or current['lease_until'] <= now() or not hmac.compare_digest(current['lease_hash'], hashlib.sha256(token.encode()).hexdigest()):
                        raise QueueError('The original claim is no longer owned by this run.')
                    result['leaseToken'] = token
            return result


def handle(handler, method, parsed, host):
    if parsed.path != BASE and not parsed.path.startswith(BASE + '/'):
        return False
    if not host['_is_valid_api_key'](handler.headers.get('X-API-Key', '').strip()):
        handler._respond(401, {'ok': False, 'error': 'Invalid or missing X-API-Key.'}); return True
    tenant = host['get_request_tenant_id'](handler, parsed)
    try:
        if method == 'GET' and parsed.path == BASE:
            query = parse_qs(parsed.query); profile_id = query.get('profileId', ['default'])[0]; name = query.get('queueName', [''])[0]
            with database(host, tenant) as conn:
                conn.row_factory = sqlite3.Row
                with conn:
                    conn.execute('BEGIN IMMEDIATE'); reap(conn, tenant, profile_id)
                    queues = []
                    for row in conn.execute('SELECT * FROM studio_queues WHERE tenant=? AND profile_id=? ORDER BY name', (tenant, profile_id)):
                        counts = {r[0]: r[1] for r in conn.execute('SELECT status,COUNT(*) FROM studio_queue_items WHERE tenant=? AND profile_id=? AND queue=? GROUP BY status', (tenant, profile_id, row['name']))}
                        queues.append({'name': row['name'], 'enabled': bool(row['enabled']), 'maxRetries': row['max_retries'], 'retryDelaySeconds': row['retry_delay'], 'leaseSeconds': row['lease_seconds'], 'revision': row['revision'], 'counts': counts})
                    items = [dict(public(r), content=json.loads(r['content'])) for r in conn.execute('SELECT * FROM studio_queue_items WHERE tenant=? AND profile_id=? AND queue=? ORDER BY updated_at DESC LIMIT 100', (tenant, profile_id, name))]
            handler._respond(200, {'ok': True, 'queues': queues, 'items': items}); return True
        p = handler._read_json_body() if method == 'POST' else None
        if not isinstance(p, dict):
            raise QueueError('A JSON object is required.')
        profile_id = p.get('profileId', 'default')
        if parsed.path == BASE + '/operate':
            session = handler.headers.get('X-Runway-Queue-Session', '')
            if not maestro_assets.NAME.fullmatch(session):
                raise QueueError('A queue run session is required.')
            result = operate(host, tenant, profile_id, 'studio:' + session, p)
            handler._respond(200, {'ok': True, **result}); return True
        if parsed.path != BASE + '/configure':
            raise QueueError('Unknown queue endpoint.')
        with database(host, tenant) as conn:
            with conn:
                conn.execute('BEGIN IMMEDIATE'); maestro_assets.profile(conn, tenant, profile_id)
                name = p.get('name'); retries, delay, lease = p.get('maxRetries', 2), p.get('retryDelaySeconds', 10), p.get('leaseSeconds', 300)
                if not isinstance(name, str) or not maestro_assets.NAME.fullmatch(name) or type(retries) is not int or not 0 <= retries <= 10 or type(delay) is not int or not 0 <= delay <= 3600 or type(lease) is not int or not 30 <= lease <= 3600 or not isinstance(p.get('enabled', True), bool):
                    raise QueueError('Invalid queue settings (retry 0–10, delay 0–3600 s, lease 30–3600 s).')
                old = conn.execute('SELECT revision FROM studio_queues WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, name)).fetchone()
                if p.get('revision', 0) != (old[0] if old else 0):
                    raise QueueError('Queue settings changed. Refresh before saving.')
                conn.execute('INSERT INTO studio_queues VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant,profile_id,name) DO UPDATE SET enabled=excluded.enabled,max_retries=excluded.max_retries,retry_delay=excluded.retry_delay,lease_seconds=excluded.lease_seconds,revision=excluded.revision', (tenant, profile_id, name, int(p.get('enabled', True)), retries, delay, lease, (old[0] if old else 0) + 1))
        handler._respond(200, {'ok': True})
    except (ValueError, TypeError) as error:
        handler._respond(400, {'ok': False, 'error': str(error) if isinstance(error, QueueError) else 'Queue request was rejected.'})
    except Exception:
        handler._respond(503, {'ok': False, 'error': 'Queue operation could not be confirmed. Recover the same request; do not start duplicate work.'})
    return True
