"""Exercise real writers and migration with isolated databases, including rollback and redaction."""
import json, runpy, sqlite3, sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'server'))
import maestro_audit as audit
import maestro_assets as assets
fixture = runpy.run_path(str(root / 'tests/human-tasks/backend.py'))
host, token, task = fixture['host'], fixture['token'], fixture['task']
def call(query='', key='admin', token='', tenant='default', method='GET'):
    result = []
    h = SimpleNamespace(headers={'X-API-Key':key,'X-Runway-Task-Token':token,'X-Tenant-Id':tenant,'X-User':'spoofed'}, _respond=lambda s,b:result.append((s,b)))
    assert audit.handle(h, method, urlparse(audit.BASE + query), host)
    return result[0]
def save(name='AuditCredential', revision=0, personal=token):
    result = []
    h = SimpleNamespace(headers={'X-API-Key':'admin','X-Runway-Task-Token':personal}, _read_json_body=lambda:{'profileId':'default','name':name,'type':'Credential','value':{'username':'private-username-907','password':'private-password-907'},'revision':revision}, _respond=lambda s,b:result.append((s,b)))
    assets.handle(h,'POST',urlparse(assets.BASE+'/values'),host)
    return result[0]
assert save()[0] == 200
assert save(personal='invalid')[0] == 403
assert call(key='',token=token)[0] == 403
assert call(token='invalid')[0] == 403
assert call(method='POST')[0] == 405
status, data = call(token=token)
assert status == 200 and data['identity'] == 'user:onur'
assert any(e['source']=='assets' and e['actor']=='user:onur' for e in data['events'])
assert any(e['action']=='human.approved' and e['actor']=='user:onur' for e in data['events'])
text = json.dumps(data)
for secret in [token, 'private-password-907','private-username-907','Reviewed','FIN','spoofed']:
    assert secret not in text, secret
assert call('?actor=user:onur&action=human.approved&source=human')[1]['events']
assert all(e['actor']=='user:onur' and e['action']=='human.approved' for e in call('?actor=user:onur&action=human.approved')[1]['events'])
assert call('?from=0&to=1')[1]['events'] == []
for query in ['?from=12&to=1','?from=NaN','?limit=0','?limit=101','?cursor=bad']:
    assert call(query)[0] == 400, query
assert call(tenant='other')[1]['events'] == []
assert call('?actor=spoofed')[1]['events'] == []
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    # Historical comments and unrelated payloads must never enter central audit.
    conn.execute('INSERT INTO studio_asset_audit VALUES (?,?,?,?,?)', ('default','default','OldAsset','asset-save',1))
    conn.execute('INSERT INTO studio_human_audit(tenant,task_id,actor,action,at,detail) VALUES (?,?,?,?,?,?)', ('default',task['id'],'onur','Approved',2,'historical-private-comment'))
first = call()[1]
second = call()[1]
assert [e['id'] for e in first['events']] == [e['id'] for e in second['events']]
assert any(e['actor']=='unknown:legacy' for e in first['events'])
assert 'historical-private-comment' not in json.dumps(first)
page = call('?limit=2')[1]; ids = [e['id'] for e in page['events']]
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    audit.record(conn,'default','system:test','assets','asset.saved','asset','NEW',metadata={'password':'never-write','nested':{'token':token},'revisionAfter':2})
while page['nextCursor']:
    page = call('?limit=2&snapshot='+str(page['snapshot'])+'&cursor='+page['nextCursor'])[1]
    ids += [e['id'] for e in page['events']]
assert len(ids)==len(set(ids))==len(first['events'])
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    for sql in ['DELETE FROM studio_audit_events','UPDATE studio_audit_events SET actor=\'user:spoof\'']:
        try: conn.execute(sql); raise AssertionError('Mutable audit')
        except sqlite3.IntegrityError: conn.rollback()
    assert 'never-write' not in str(conn.execute('SELECT * FROM studio_audit_events').fetchall())
before = len(call()[1]['events'])
original = audit.record
def failure(*args, **kwargs): raise RuntimeError('Simulated audit disk failure')
audit.record = failure
assert save('RolledBack')[0] == 500
audit.record = original
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    assert conn.execute("SELECT COUNT(*) FROM studio_assets WHERE name='RolledBack'").fetchone()[0] == 0
assert len(call()[1]['events']) == before
assert save(revision=1,personal='')[0] == 200
assert any(e['actor']=='admin:shared-key' and e['targetId']=='AuditCredential' for e in call()[1]['events'])
print('PASS Central merge, verified actors, tenant/date/operation filters, snapshot pagination, idempotent migration, append-only, secret exclusion and atomic rollback')
