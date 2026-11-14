"""Tenant-scoped, append-only operational audit. Payload values are never accepted."""
import base64
import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from urllib.parse import parse_qs

BASE = '/api/v1/audit'
SOURCES = {'assets', 'human', 'operators', 'jobs', 'workflows', 'triggers'}
HUMAN_ACTIONS = {'Created': 'created', 'Waiting': 'waiting', 'Approved': 'approved', 'Rejected': 'rejected', 'TimedOut': 'timed_out', 'Cancelled': 'cancelled'}

def ensure(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS studio_audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,tenant TEXT NOT NULL,at INTEGER NOT NULL,actor TEXT NOT NULL,source TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,outcome TEXT NOT NULL,profile_id TEXT,job_id TEXT,metadata TEXT NOT NULL)''')
    conn.execute('CREATE INDEX IF NOT EXISTS studio_audit_tenant_time ON studio_audit_events(tenant,at DESC,id DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS studio_audit_filters ON studio_audit_events(tenant,actor,action,at)')
    conn.execute("CREATE TRIGGER IF NOT EXISTS studio_audit_no_update BEFORE UPDATE ON studio_audit_events BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END")
    conn.execute("CREATE TRIGGER IF NOT EXISTS studio_audit_no_delete BEFORE DELETE ON studio_audit_events BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END")

@contextmanager
def database(host):
    conn = sqlite3.connect(host['WORKFLOWS_DB'], timeout=15)
    try:
        with conn: ensure(conn)
        yield conn
    finally: conn.close()

def exists(conn, table): return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None

def identity(conn, tenant, headers, host):
    token = headers.get('X-Runway-Task-Token', '')
    if token:
        row = conn.execute('SELECT id FROM studio_human_operators WHERE tenant=? AND token_hash=? AND enabled=1', (tenant, hashlib.sha256(token.encode()).hexdigest())).fetchone() if exists(conn, 'studio_human_operators') else None
        if not row: raise PermissionError('A valid personal task token is required for audit attribution.')
        return 'user:' + row[0]
    return 'admin:shared-key' if host['_is_valid_api_key'](headers.get('X-API-Key', '').strip()) else 'unknown:unattributed'

def safe_metadata(metadata):
    result = {}
    # An allowlist, not recursive key-name masking: unknown fields and all payloads are omitted.
    integers = {'revisionBefore','revisionAfter','roleCountBefore','roleCountAfter','count'}
    booleans = {'enabled','legacyUserUnknown'}
    enums = {'assetType': {'String','Boolean','Int32','Double','Object','Secret','Credential'}, 'status': {'queued','running','waiting','stopping','stopped','success','failed'}, 'decision': {'Approved','Rejected','TimedOut'}}
    for key, value in (metadata or {}).items():
        if key in integers and type(value) is int and 0 <= value <= 2147483647: result[key] = value
        elif key in booleans and type(value) is bool: result[key] = value
        elif key in enums and isinstance(value, str) and value in enums[key]: result[key] = value
    return result

def record(conn, tenant, actor, source, action, target_type, target_id, *, outcome='success', profile_id=None, job_id=None, metadata=None, event_key=None, at=None):
    ensure(conn)
    if source not in SOURCES or not re.fullmatch(r'[a-z][a-z0-9_.]{1,79}', action) or outcome not in ('success','failed','denied','requested','observed'): raise ValueError('Invalid audit event.')
    if not isinstance(actor, str) or not re.fullmatch(r'(user|robot|system|admin|unknown):[^\r\n\x00]{1,160}', actor): raise ValueError('Invalid audit identity.')
    identifier = lambda value: str(value)[:255].replace('\x00', '') if value is not None else None
    conn.execute('INSERT OR IGNORE INTO studio_audit_events(event_key,tenant,at,actor,source,action,target_type,target_id,outcome,profile_id,job_id,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (event_key or 'event:' + str(uuid.uuid4()), tenant, int(at if at is not None else time.time()*1000), actor, source, action, identifier(target_type), identifier(target_id), outcome, identifier(profile_id), identifier(job_id), json.dumps(safe_metadata(metadata))))

def request_event(conn, host, handler, parsed, action, target_type, target_id, metadata=None):
    tenant = host['get_request_tenant_id'](handler, parsed)
    record(conn, tenant, identity(conn, tenant, handler.headers, host), 'triggers' if target_type == 'trigger' else 'workflows', action, target_type, target_id, metadata=metadata)

def import_legacy(conn):
    if exists(conn, 'studio_asset_audit'):
        for row in conn.execute('SELECT rowid,tenant,profile_id,name,action,at FROM studio_asset_audit WHERE NOT EXISTS(SELECT 1 FROM studio_audit_events WHERE event_key=\'asset:\'||studio_asset_audit.rowid)').fetchall():
            action = {'profile-update': 'environment.updated', 'asset-save': 'asset.saved', 'asset-delete': 'asset.deleted'}.get(row[4])
            if action: record(conn, row[1], 'unknown:legacy', 'assets', action, 'environment' if row[4] == 'profile-update' else 'asset', row[3], profile_id=row[2], at=row[5], event_key='asset:'+str(row[0]), metadata={'legacyUserUnknown': True})
    if exists(conn, 'studio_human_audit'):
        for row in conn.execute('SELECT id,tenant,task_id,actor,action,at FROM studio_human_audit WHERE NOT EXISTS(SELECT 1 FROM studio_audit_events WHERE event_key=\'human:\'||studio_human_audit.id)').fetchall():
            human_event(conn, *row)

def human_event(conn, row_id, tenant, task_id, actor, action, at):
    action_name = HUMAN_ACTIONS.get(action)
    if not action_name: return
    job = conn.execute('SELECT job_id FROM studio_human_tasks WHERE id=? AND tenant=?', (task_id, tenant)).fetchone() if exists(conn, 'studio_human_tasks') else None
    identity = 'user:' + actor if action in ('Approved', 'Rejected') else 'robot:worker' if action in ('Created', 'Waiting') else 'system:scheduler'
    record(conn, tenant, identity, 'human', 'human.' + action_name, 'human-task', task_id, job_id=job[0] if job else None, at=at, event_key='human:' + str(row_id))

def query(conn, tenant, params):
    def integer(name, default):
        raw = params.get(name, [str(default)])[0]
        if not re.fullmatch(r'\d{1,16}', raw): raise ValueError('Invalid audit pagination or date.')
        return int(raw)
    limit = integer('limit', 50)
    if not 1 <= limit <= 100: raise ValueError('Page size must be 1–100.')
    maximum = conn.execute('SELECT COALESCE(MAX(id),0) FROM studio_audit_events WHERE tenant=?', (tenant,)).fetchone()[0]
    snapshot = min(integer('snapshot', maximum), maximum)
    conditions, values = ['tenant=?', 'id<=?'], [tenant, snapshot]
    for name, column in [('actor','actor'),('action','action'),('source','source')]:
        value = params.get(name, [''])[0]
        if value:
            if len(value) > 200: raise ValueError('Audit filter is too long.')
            conditions.append(column+'=?'); values.append(value)
    start, end = integer('from', 0), integer('to', 9999999999999999)
    if start >= end: raise ValueError('Start date must be before end date.')
    conditions += ['at>=?', 'at<?']; values += [start, end]
    cursor = params.get('cursor', [''])[0]
    if cursor:
        try:
            stamp, id = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor)%4)))
            if type(stamp) is not int or type(id) is not int or stamp < 0 or id < 1: raise ValueError()
        except Exception: raise ValueError('Invalid audit cursor.')
        conditions.append('(at<? OR (at=? AND id<?))'); values += [stamp, stamp, id]
    rows = conn.execute('SELECT id,at,actor,source,action,target_type,target_id,outcome,profile_id,job_id,metadata FROM studio_audit_events WHERE '+' AND '.join(conditions)+' ORDER BY at DESC,id DESC LIMIT ?', (*values, limit+1)).fetchall()
    events = [{'id': r[0], 'at': r[1], 'actor': r[2], 'source': r[3], 'action': r[4], 'targetType': r[5], 'targetId': r[6], 'outcome': r[7], 'profileId': r[8], 'jobId': r[9], 'metadata': json.loads(r[10])} for r in rows[:limit]]
    next_cursor = base64.urlsafe_b64encode(json.dumps([rows[limit-1][1], rows[limit-1][0]]).encode()).decode().rstrip('=') if len(rows)>limit else None
    return {'ok': True, 'events': events, 'snapshot': snapshot, 'nextCursor': next_cursor, 'actors': [r[0] for r in conn.execute('SELECT DISTINCT actor FROM studio_audit_events WHERE tenant=? ORDER BY actor LIMIT 500', (tenant,))], 'actions': [r[0] for r in conn.execute('SELECT DISTINCT action FROM studio_audit_events WHERE tenant=? ORDER BY action', (tenant,))], 'sources': sorted(SOURCES)}

def handle(handler, method, parsed, host):
    if parsed.path != BASE: return False
    if method != 'GET': handler._respond(405, {'ok': False, 'error': 'Audit is read-only.'}); return True
    if not host['_is_valid_api_key'](handler.headers.get('X-API-Key', '').strip()): handler._respond(403, {'ok': False, 'error': 'Administrative audit access required.'}); return True
    tenant = host['get_request_tenant_id'](handler, parsed)
    try:
        with database(host) as conn:
            with conn:
                conn.execute('BEGIN IMMEDIATE'); actor = identity(conn, tenant, handler.headers, host); import_legacy(conn)
            with conn:
                conn.execute('BEGIN'); result = query(conn, tenant, parse_qs(parsed.query, keep_blank_values=True)); result['identity'] = actor
        handler._respond(200, result)
    except PermissionError as error: handler._respond(403, {'ok': False, 'error': str(error)})
    except ValueError as error: handler._respond(400, {'ok': False, 'error': str(error)})
    except Exception: handler._respond(503, {'ok': False, 'error': 'Audit could not be read.'})
    return True
