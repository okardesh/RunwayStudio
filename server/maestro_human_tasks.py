"""Durable approval checkpoints. Only root workflow boundaries are resumable."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs
import maestro_assets
import maestro_audit

BASE = '/api/v1/human-tasks'
TERMINAL = ('success', 'failed', 'stopped')
_workers = set()
_worker_lock = threading.Lock()

def now(): return int(time.time() * 1000)

@contextmanager
def database(host):
    conn = sqlite3.connect(host['WORKFLOWS_DB'], timeout=15); conn.row_factory = sqlite3.Row
    with conn:
        conn.execute('CREATE TABLE IF NOT EXISTS studio_human_operators(tenant TEXT,id TEXT,name TEXT,roles TEXT,token_hash TEXT,enabled INTEGER,revision INTEGER,PRIMARY KEY(tenant,id))')
        conn.execute('CREATE TABLE IF NOT EXISTS studio_human_jobs(id TEXT PRIMARY KEY,tenant TEXT,definition TEXT,callback TEXT,cancelled INTEGER DEFAULT 0)')
        conn.execute('CREATE TABLE IF NOT EXISTS studio_human_tasks(id TEXT PRIMARY KEY,tenant TEXT,job_id TEXT,node_id TEXT,title TEXT,assignee TEXT,context TEXT,schema TEXT,status TEXT,expires_at INTEGER,result TEXT,UNIQUE(job_id,node_id))')
        conn.execute('CREATE TABLE IF NOT EXISTS studio_human_waits(id TEXT PRIMARY KEY,job_id TEXT,cursor INTEGER,task_id TEXT,payload TEXT,phase TEXT,UNIQUE(job_id,cursor))')
        conn.execute('CREATE TABLE IF NOT EXISTS studio_human_audit(id INTEGER PRIMARY KEY,tenant TEXT,task_id TEXT,actor TEXT,action TEXT,at INTEGER,detail TEXT)')
        conn.execute('CREATE TABLE IF NOT EXISTS studio_human_decisions(tenant TEXT,actor TEXT,request_id TEXT,fingerprint TEXT,task_id TEXT,PRIMARY KEY(tenant,actor,request_id))')
    try: yield conn
    finally: conn.close()

def safe(value, depth=0):
    if depth > 20: raise ValueError('Task data is too deeply nested.')
    if isinstance(value, dict):
        for k, v in value.items():
            if re.search(r'password|secret|token|credential|authorization|api.?key', k, re.I) and v not in (None, ''): raise ValueError('Protected fields cannot be persisted in task data.')
            safe(v, depth + 1)
    elif isinstance(value, list):
        for v in value: safe(v, depth + 1)
    text = json.dumps(value, allow_nan=False)
    if len(text) > 500000: raise ValueError('Task data exceeds 500 KB.')
    return text

def nodes(definition):
    package = definition.get('portablePackage', {})
    entry = next((w['definition'] for w in package.get('workflows', []) if w['id'] == package.get('entryWorkflowId')), definition)
    return [n for n in entry.get('nodes', []) if not n['data'].get('parentId')]

def register(conn, tenant, job_id, definition, callback):
    if any(n['data']['activityId'] in ('create-human-task','wait-for-human-task') for n in nodes(definition)):
        conn.execute('INSERT INTO studio_human_jobs VALUES (?,?,?,?,0)', (job_id, tenant, json.dumps(definition), callback))

def task_view(row):
    return {'id': row['id'], 'jobId': row['job_id'], 'title': row['title'], 'assignee': row['assignee'], 'context': json.loads(row['context']), 'formSchema': json.loads(row['schema']), 'status': row['status'], 'expiresAt': row['expires_at'], 'result': json.loads(row['result']) if row['result'] else None}

def audit(conn, tenant, task_id, actor, action, detail=''):
    stamp = now()
    safe_detail = detail if action == 'Waiting' and re.fullmatch(r'[a-f0-9-]{36}', detail or '') else ''
    row = conn.execute('INSERT INTO studio_human_audit(tenant,task_id,actor,action,at,detail) VALUES (?,?,?,?,?,?)', (tenant, task_id, actor, action, stamp, safe_detail))
    maestro_audit.human_event(conn, row.lastrowid, tenant, task_id, actor, action, stamp)

def expire(conn):
    for row in conn.execute("SELECT * FROM studio_human_tasks WHERE status='Pending' AND expires_at<=?", (now(),)).fetchall():
        result = {'taskId': row['id'], 'decision': 'TimedOut', 'fields': {}, 'actor': 'system', 'completedAt': now()}
        conn.execute('UPDATE studio_human_tasks SET status=?,result=? WHERE id=?', ('TimedOut', json.dumps(result), row['id'])); audit(conn, row['tenant'], row['id'], 'system', 'TimedOut')

def create(host, tenant, job_id, data):
    with database(host) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        job = conn.execute('SELECT * FROM studio_human_jobs WHERE id=? AND tenant=?', (job_id, tenant)).fetchone()
        snapshot = conn.execute('SELECT snapshot FROM studio_robot_jobs WHERE id=?', (job_id,)).fetchone()
        if not job or job['cancelled'] or json.loads(snapshot[0])['status'] in TERMINAL: raise ValueError('This job cannot create tasks.')
        node = next((n for n in nodes(json.loads(job['definition'])) if n['id'] == data.get('nodeId') and n['data']['activityId'] == 'create-human-task'), None)
        if not node: raise ValueError('Task activity is not in the pinned main workflow.')
        previous = conn.execute('SELECT * FROM studio_human_tasks WHERE job_id=? AND node_id=?', (job_id, node['id'])).fetchone()
        if previous: return task_view(previous)
        title, assignee, schema = data.get('title'), data.get('assignee'), data.get('formSchema', [])
        if not isinstance(title, str) or not 1 <= len(title) <= 200 or assignee != node['data']['properties'].get('assignee') or not re.fullmatch(r'(user|role):[A-Za-z_][A-Za-z0-9_.-]{0,79}', str(assignee)): raise ValueError('Invalid task title or assignee.')
        timeout = data.get('timeoutMinutes', 1440)
        if type(timeout) is not int or not 1 <= timeout <= 10080 or not isinstance(schema, list) or len(schema) > 20: raise ValueError('Invalid form or timeout.')
        names = set()
        for field in schema:
            name = field.get('name')
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_]\w*', name) or name in ('__proto__','constructor','prototype') or name in names or field.get('type') not in ('String','Number','Boolean') or not isinstance(field.get('label'), str) or len(field['label']) > 120 or type(field.get('required')) is not bool: raise ValueError('Invalid form field.')
            names.add(name)
        context, schema_text = safe(data.get('context', {})), safe(schema)
        task_id = str(uuid.uuid4())
        conn.execute('INSERT INTO studio_human_tasks VALUES (?,?,?,?,?,?,?,?,?,?,NULL)', (task_id, tenant, job_id, node['id'], title, assignee, context, schema_text, 'Pending', now() + timeout * 60000))
        audit(conn, tenant, task_id, 'robot', 'Created')
        return task_view(conn.execute('SELECT * FROM studio_human_tasks WHERE id=?', (task_id,)).fetchone())

def save_wait(host, tenant, view, checkpoint):
    if not isinstance(checkpoint, dict): raise ValueError('A durable checkpoint is required.')
    safe(checkpoint.get('values'))
    with database(host) as conn, conn:
        conn.execute('BEGIN IMMEDIATE'); job_id = view['jobId']
        job = conn.execute('SELECT * FROM studio_human_jobs WHERE id=? AND tenant=?', (job_id, tenant)).fetchone()
        current = json.loads(conn.execute('SELECT snapshot FROM studio_robot_jobs WHERE id=? AND organization_id=?', (job_id, tenant)).fetchone()[0])
        if not job: raise ValueError('Job does not support human tasks.')
        if current['status'] in TERMINAL or job['cancelled']: return current
        definition = json.loads(job['definition']); root = nodes(definition); cursor = checkpoint.get('cursor')
        if type(cursor) is not int or not 1 <= cursor <= len(root): raise ValueError('Invalid wait cursor.')
        node = root[cursor-1]
        if node['id'] != checkpoint.get('nodeId') or node['data']['activityId'] != 'wait-for-human-task' or node['data']['properties']['output'] != checkpoint.get('output') or checkpoint.get('packageId') != definition['portablePackage']['id'] or not isinstance(checkpoint.get('values'), dict) or not re.fullmatch(r'[a-f0-9-]{36}', str(checkpoint.get('id'))): raise ValueError('Checkpoint does not match the pinned workflow.')
        task = conn.execute('SELECT * FROM studio_human_tasks WHERE id=? AND job_id=?', (checkpoint.get('taskId'), job_id)).fetchone()
        if not task: raise ValueError('Wait task must belong to this job.')
        previous = conn.execute('SELECT * FROM studio_human_waits WHERE job_id=? AND cursor=?', (job_id, cursor)).fetchone()
        if previous:
            if previous['id'] != checkpoint['id'] or previous['payload'] != json.dumps(checkpoint): raise ValueError('Checkpoint conflict.')
            return current
        if conn.execute("SELECT COUNT(*) FROM studio_queue_items WHERE owner=? AND status='in_progress'", ('job:' + job_id,)).fetchone()[0]: raise ValueError('Finish all transactions before waiting for human input.')
        conn.execute('INSERT INTO studio_human_waits VALUES (?,?,?,?,?,?)', (checkpoint['id'], job_id, cursor, task['id'], json.dumps(checkpoint), 'waiting'))
        view['environment'] = current.get('environment'); view.pop('completedAt', None)
        conn.execute('UPDATE studio_robot_jobs SET snapshot=? WHERE id=?', (json.dumps(view), job_id)); conn.execute("UPDATE rpa_jobs SET status='waiting' WHERE id=?", (job_id,))
        audit(conn, tenant, task['id'], 'robot', 'Waiting', checkpoint['id'])
        return view

def finish(conn, tenant, job_id):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='studio_human_tasks'").fetchone(): return
    for row in conn.execute("SELECT id FROM studio_human_tasks WHERE job_id=? AND tenant=? AND status='Pending'", (job_id, tenant)).fetchall(): audit(conn, tenant, row[0], 'system', 'Cancelled')
    conn.execute("UPDATE studio_human_tasks SET status='Cancelled' WHERE job_id=? AND tenant=? AND status='Pending'", (job_id, tenant))
    conn.execute("UPDATE studio_human_waits SET phase='consumed' WHERE job_id=?", (job_id,))

def request_stop(host, tenant, job_id):
    with database(host) as conn, conn:
        conn.execute('BEGIN IMMEDIATE'); row = conn.execute('SELECT * FROM studio_human_jobs WHERE id=? AND tenant=?', (job_id, tenant)).fetchone()
        if not row: return None
        view = json.loads(conn.execute('SELECT snapshot FROM studio_robot_jobs WHERE id=?', (job_id,)).fetchone()[0])
        if view['status'] in TERMINAL: return view
        conn.execute('UPDATE studio_human_jobs SET cancelled=1 WHERE id=?', (job_id,)); finish(conn, tenant, job_id)
        view['status'] = 'stopping'; conn.execute('UPDATE studio_robot_jobs SET snapshot=? WHERE id=?', (json.dumps(view), job_id))
        return view

def resume_token(host, checkpoint_id):
    file = Path(host['WORKFLOWS_DB']).resolve().parent / 'studio-human.key'
    try: fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError: pass
    else:
        with os.fdopen(fd, 'wb') as f: f.write(secrets.token_bytes(32))
    key = file.read_bytes()
    if len(key) != 32: raise ValueError('Human task signing key is unavailable.')
    return hmac.new(key, checkpoint_id.encode(), hashlib.sha256).hexdigest()

def tick(host, call, save):
    with database(host) as conn, conn:
        expire(conn)
        pending = conn.execute("SELECT j.*,r.bot_id,r.snapshot,w.id checkpoint_id,w.payload,t.result FROM studio_human_jobs j JOIN studio_robot_jobs r ON r.id=j.id LEFT JOIN studio_human_waits w ON w.job_id=j.id AND w.phase IN ('waiting','resuming') LEFT JOIN studio_human_tasks t ON t.id=w.task_id WHERE (w.id IS NOT NULL AND t.status!='Pending') OR j.cancelled=1").fetchall()
    for row in pending:
        view = json.loads(row['snapshot'])
        if view['status'] in TERMINAL: continue
        try:
            if row['cancelled']:
                stopped = call(host, row['tenant'], row['bot_id'], 'POST', '/' + row['id'] + '/stop')['job']; save(host, row['tenant'], stopped); continue
            checkpoint = json.loads(row['payload']); token = resume_token(host, checkpoint['id'])
            with database(host) as conn, conn:
                conn.execute('BEGIN IMMEDIATE')
                if conn.execute('SELECT cancelled FROM studio_human_jobs WHERE id=?', (row['id'],)).fetchone()[0]: continue
                conn.execute("UPDATE studio_human_waits SET phase='resuming' WHERE id=? AND phase='waiting'", (checkpoint['id'],))
                conn.execute('UPDATE studio_job_asset_grants SET token_hash=?,expires_at=? WHERE job_id=?', (hashlib.sha256(token.encode()).hexdigest(), now()+86400000, row['id']))
            definition = json.loads(row['definition']); result = json.loads(row['result'])
            payload = {'jobId': row['id'], 'definition': definition, 'inputs': {}, 'callbackUrl': row['callback'], 'environment': view.get('environment'), 'assetContext': {'serverUrl': row['callback'].split('/api/v1/')[0], 'jobId': row['id'], 'token': token}, 'resume': {'checkpointId': checkpoint['id'], 'cursor': checkpoint['cursor'], 'output': checkpoint['output'], 'values': checkpoint['values'], 'result': result, 'packageId': checkpoint['packageId']}, 'previous': view}
            accepted = call(host, row['tenant'], row['bot_id'], 'POST', '/' + row['id'] + '/resume', payload=payload)['job']
            if accepted.get('resumeId') != checkpoint['id']: raise ValueError('Robot did not confirm the checkpoint.')
            with database(host) as conn, conn: conn.execute("UPDATE studio_human_waits SET phase='consumed' WHERE id=?", (checkpoint['id'],))
            if accepted['status'] != 'waiting': save(host, row['tenant'], accepted)
        except Exception: pass  # Same durable checkpoint is retried; Robot journals acceptance before side effects.

def start(host, call, save):
    key = str(Path(host['WORKFLOWS_DB']).resolve())
    with _worker_lock:
        if key in _workers: return
        _workers.add(key)
    def run():
        while True:
            try: tick(host, call, save)
            except Exception: pass
            time.sleep(3)
    threading.Thread(target=run, name='human-task-resumer', daemon=True).start()

def operator(conn, tenant, token):
    row = conn.execute('SELECT * FROM studio_human_operators WHERE tenant=? AND token_hash=? AND enabled=1', (tenant, hashlib.sha256(token.encode()).hexdigest())).fetchone()
    if not row: raise PermissionError('A valid personal task token is required.')
    return row

def allowed(row, identity): return row['assignee'] == 'user:' + identity['id'] or row['assignee'].startswith('role:') and row['assignee'][5:] in json.loads(identity['roles'])

def handle(handler, method, parsed, host):
    if parsed.path != BASE and not parsed.path.startswith(BASE + '/'): return False
    tenant = host['get_request_tenant_id'](handler, parsed); admin = host['_is_valid_api_key'](handler.headers.get('X-API-Key', '').strip())
    try:
        with database(host) as conn, conn:
            conn.execute('BEGIN IMMEDIATE'); expire(conn)
            personal = handler.headers.get('X-Runway-Task-Token', '')
            identity = operator(conn, tenant, personal) if personal else None
            if not admin and not identity: raise PermissionError('Authentication required.')
            if method == 'POST' and parsed.path == BASE + '/operators':
                if not admin: raise PermissionError('Administrative key required.')
                p = handler._read_json_body(); id = p.get('id'); roles = p.get('roles', [])
                if not isinstance(id, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,79}', id) or not isinstance(p.get('name'), str) or not 1 <= len(p['name']) <= 120 or not isinstance(roles, list) or len(roles) > 20 or any(not isinstance(r, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,79}', r) for r in roles) or type(p.get('enabled', True)) is not bool: raise ValueError('Invalid operator identity or roles.')
                old = conn.execute('SELECT revision FROM studio_human_operators WHERE tenant=? AND id=?', (tenant, id)).fetchone()
                if p.get('revision', 0) != (old[0] if old else 0): raise ValueError('Operator changed. Refresh before saving.')
                token = secrets.token_urlsafe(32)
                conn.execute('INSERT INTO studio_human_operators VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET name=excluded.name,roles=excluded.roles,token_hash=excluded.token_hash,enabled=excluded.enabled,revision=excluded.revision', (tenant, id, p['name'], json.dumps(roles), hashlib.sha256(token.encode()).hexdigest(), int(p.get('enabled', True)), (old[0] if old else 0)+1))
                actor = 'user:' + identity['id'] if identity else 'admin:shared-key'
                maestro_audit.record(conn, tenant, actor, 'operators', 'operator.updated' if old else 'operator.created', 'operator', id, metadata={'enabled': p.get('enabled', True), 'roleCountAfter': len(roles), 'revisionAfter': (old[0] if old else 0)+1})
                maestro_audit.record(conn, tenant, actor, 'operators', 'operator.token_rotated', 'operator', id)
                conn.commit(); handler._respond(200, {'ok': True, 'personalToken': token}); return True
            if method == 'GET' and parsed.path == BASE:
                tasks = [task_view(r) for r in conn.execute('SELECT * FROM studio_human_tasks WHERE tenant=? ORDER BY rowid DESC LIMIT 500', (tenant,)) if admin and not identity or identity and allowed(r, identity)]
                operators = [{'id': r['id'], 'name': r['name'], 'roles': json.loads(r['roles']), 'enabled': bool(r['enabled']), 'revision': r['revision']} for r in conn.execute('SELECT * FROM studio_human_operators WHERE tenant=?', (tenant,))] if admin else []
                audit_rows = [dict(r) for r in conn.execute('SELECT * FROM studio_human_audit WHERE tenant=? ORDER BY id DESC LIMIT 200', (tenant,)) if r['task_id'] in {t['id'] for t in tasks}]
                conn.commit(); handler._respond(200, {'ok': True, 'tasks': tasks, 'operators': operators, 'audit': audit_rows, 'identity': {'id': identity['id'], 'name': identity['name']} if identity else None}); return True
            if method == 'POST' and parsed.path == BASE + '/decide':
                if not identity: raise PermissionError('Use a personal task token to make a decision.')
                p = handler._read_json_body(); task = conn.execute('SELECT * FROM studio_human_tasks WHERE id=? AND tenant=?', (p.get('taskId'), tenant)).fetchone()
                if not task or not allowed(task, identity): raise PermissionError('This task is not assigned to you or your roles.')
                request = p.get('requestId'); fingerprint = hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()
                if not isinstance(request, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', request): raise ValueError('Invalid decision request ID.')
                previous = conn.execute('SELECT fingerprint FROM studio_human_decisions WHERE tenant=? AND actor=? AND request_id=?', (tenant, identity['id'], request)).fetchone()
                if previous:
                    if previous[0] != fingerprint: raise ValueError('Decision request ID conflict.')
                    conn.commit(); handler._respond(200, {'ok': True, 'task': task_view(task)}); return True
                if task['status'] != 'Pending': raise ValueError('This task has already been completed or expired.')
                decision, fields, comment = p.get('decision'), p.get('fields', {}), p.get('comment', '')
                if decision not in ('Approved','Rejected') or not isinstance(fields, dict) or not isinstance(comment, str) or len(comment) > 2000: raise ValueError('Invalid decision.')
                schema = json.loads(task['schema'])
                if any(k not in {f['name'] for f in schema} for k in fields): raise ValueError('Unknown form field.')
                for f in schema:
                    v = fields.get(f['name'])
                    if v is None or v == '':
                        if decision == 'Approved' and f['required']: raise ValueError('Required form field: ' + f['label'])
                    elif f['type'] == 'String' and not isinstance(v, str) or f['type'] == 'Number' and type(v) not in (int,float) or f['type'] == 'Boolean' and type(v) is not bool: raise ValueError('Incorrect form value type.')
                safe(fields)
                result = {'taskId': task['id'], 'decision': decision, 'fields': fields, 'comment': comment, 'actor': identity['id'], 'actorName': identity['name'], 'completedAt': now()}
                conn.execute('UPDATE studio_human_tasks SET status=?,result=? WHERE id=?', (decision, json.dumps(result), task['id'])); audit(conn, tenant, task['id'], identity['id'], decision, comment)
                conn.execute('INSERT INTO studio_human_decisions VALUES (?,?,?,?,?)', (tenant, identity['id'], request, fingerprint, task['id']))
                conn.commit(); handler._respond(200, {'ok': True, 'task': task_view(conn.execute('SELECT * FROM studio_human_tasks WHERE id=?', (task['id'],)).fetchone())}); return True
        raise ValueError('Unknown human task endpoint.')
    except PermissionError as error: handler._respond(403, {'ok': False, 'error': str(error)})
    except (ValueError, TypeError, KeyError) as error: handler._respond(400, {'ok': False, 'error': str(error) if isinstance(error, ValueError) else 'Invalid human task request.'})
    except Exception: handler._respond(503, {'ok': False, 'error': 'Human task operation could not be confirmed. Recover the same request.'})
    return True
