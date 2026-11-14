import sys, json, sqlite3, tempfile, uuid, concurrent.futures
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server'))
import maestro_queues as q
import maestro_assets as a
root = Path(tempfile.mkdtemp(prefix='maestro-queues-'))
host = {'WORKFLOWS_DB': str(root / 'db.sqlite'), '_is_valid_api_key': lambda key: key == 'key', 'get_request_tenant_id': lambda h, p: h.headers.get('X-Tenant-Id', 'default')}
def api(path='', data=None, key='key', tenant='default'):
    response = []
    h = SimpleNamespace(headers={'X-API-Key': key, 'X-Tenant-Id': tenant, 'X-Runway-Queue-Session': 'fixture'}, _read_json_body=lambda: data, _respond=lambda status, body: response.append((status, body)))
    assert q.handle(h, 'GET' if data is None else 'POST', urlparse(q.BASE + path), host)
    return response[0]
def op(operation, owner='owner', request=None, tenant='default', profile='default', **kwargs):
    return q.operate(host, tenant, profile, owner, {'operation': operation, 'requestId': request or 'r_' + uuid.uuid4().hex, 'queueName': 'Invoices', **kwargs})
def config(**kwargs):
    assert api('/configure', {'name': 'Invoices', 'maxRetries': 2, 'retryDelaySeconds': 0, 'leaseSeconds': 30, **kwargs})[0] == 200
assert api(key='bad')[0] == 401
config()
assert api('/configure', {'name': 'Invoices', 'revision': 0})[0] == 400
assert api('/configure', {'name': 'Bad', 'leaseSeconds': 1})[0] == 400
empty = op('claim', request='empty'); assert empty['item'] is None
first = op('add', request='add_once', reference='INV-1', content={'amount': 42})
assert op('add', request='add_once', reference='INV-1', content={'amount': 42})['item']['id'] == first['item']['id']
assert op('add', reference='INV-1', content={'amount': 42})['duplicate'] is True
try:
    op('add', reference='INV-1', content={'amount': 43}); raise AssertionError('Conflicting reference accepted')
except q.QueueError: pass
assert op('claim', request='empty')['item'] is None
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    claimed = list(pool.map(lambda i: op('claim', owner='worker_' + str(i), request='claim_' + str(i)), range(8)))
winners = [r for r in claimed if r['item']]; assert len(winners) == 1
winner = winners[0]; owner = 'worker_' + str(claimed.index(winner)); token = winner['leaseToken']; item = winner['item']
assert op('claim', owner=owner, request='claim_' + str(claimed.index(winner)))['leaseToken'] == token
assert token.encode() not in Path(host['WORKFLOWS_DB']).read_bytes()
assert 'leaseToken' not in json.dumps(api('?queueName=Invoices')[1])
print('PASS Atomic concurrent claims, reference deduplication, empty replay, mutation recovery and private lease receipts')
try:
    op('complete', owner='intruder', itemId=item['id'], leaseToken=token, status='Successful'); raise AssertionError('Wrong owner accepted')
except q.QueueError: pass
op('renew', owner=owner, itemId=item['id'], leaseToken=token)
failed = op('complete', owner=owner, itemId=item['id'], leaseToken=token, status='Failed', errorType='Application', reason='Temporary outage')
assert failed['item']['status'] == 'retry' and failed['item']['retryCount'] == 1
second = op('claim', owner='second'); assert second['item']['attempt'] == 2
try:
    op('complete', owner=owner, itemId=item['id'], leaseToken=token, status='Successful'); raise AssertionError('Old fencing token accepted')
except q.QueueError: pass
business = op('complete', owner='second', itemId=item['id'], leaseToken=second['leaseToken'], status='Failed', errorType='Business', reason='Invalid invoice')
assert business['item']['status'] == 'failed'; assert op('claim')['item'] is None
print('PASS Lease renewal, stale/wrong owner rejection, Application retry and final Business failure')
op('add', reference='INV-2', content={}); lease = op('claim', owner='crashed')
with sqlite3.connect(host['WORKFLOWS_DB']) as conn: conn.execute('UPDATE studio_queue_items SET lease_until=0 WHERE id=?', (lease['item']['id'],))
recovered = op('claim', owner='recovered'); assert recovered['item']['attempt'] == 2 and recovered['item']['retryCount'] == 1
done = op('complete', owner='recovered', request='done', itemId=recovered['item']['id'], leaseToken=recovered['leaseToken'], status='Successful')
assert op('complete', owner='recovered', request='done', itemId=recovered['item']['id'], leaseToken=recovered['leaseToken'], status='Successful')['item']['status'] == 'successful'
op('add', reference='INV-3', content={}); held = op('claim', owner='stopped'); assert op('releaseAll', owner='stopped')['released'][0]['status'] == 'retry'
assert api('/configure', {'name': 'Invoices', 'leaseSeconds': 30}, tenant='other')[0] == 200
assert op('claim', tenant='other')['item'] is None
for expected in ['retry', 'failed']:
    current = op('claim', owner='retrying')
    assert op('complete', owner='retrying', itemId=current['item']['id'], leaseToken=current['leaseToken'], status='Failed', errorType='Application', reason='Temporary')['item']['status'] == expected
config(revision=1, retryDelaySeconds=30)
op('add', reference='INV-4', content={}); current = op('claim', owner='delayed')
assert op('complete', owner='delayed', itemId=current['item']['id'], leaseToken=current['leaseToken'], status='Failed', errorType='Application', reason='Later')['item']['readyAt'] > q.now()
assert op('claim')['item'] is None
with a.database(host, 'default') as conn:
    with conn: conn.execute("INSERT INTO studio_asset_profiles VALUES ('default','test','Test',1)")
config(profileId='test'); assert op('claim', profile='test')['item'] is None
with a.database(host, 'default') as conn:
    with conn:
        conn.execute('CREATE TABLE studio_robot_jobs(id TEXT,organization_id TEXT,snapshot TEXT)')
        conn.execute('INSERT INTO studio_robot_jobs VALUES (?,?,?)', ('x', 'default', '{"status":"running"}'))
try:
    q.operate(host, 'default', 'default', 'job:x', {'operation': 'claim', 'requestId': 'denied', 'queueName': 'Invoices'}, allowed=[]); raise AssertionError('Grant bypass')
except q.QueueError: pass
with a.database(host, 'default') as conn:
    with conn: conn.execute('UPDATE studio_robot_jobs SET snapshot=? WHERE id=?', ('{"status":"stopped"}', 'x'))
try:
    q.operate(host, 'default', 'default', 'job:x', {'operation': 'claim', 'requestId': 'late', 'queueName': 'Invoices'}, allowed=[{'name': 'Invoices', 'operations': ['claim']}]); raise AssertionError('Terminal job claimed after cleanup')
except q.QueueError: pass
print('PASS Crash recovery, replayed completion, controlled cleanup, environment separation and package grants')
print('Queue backend scenarios passed: ' + str(root))
