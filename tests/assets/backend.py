import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server'))
import maestro_assets as assets

out = Path(tempfile.mkdtemp(prefix='maestro-assets-'))
host = {'WORKFLOWS_DB': str(out / 'test.sqlite'), '_is_valid_api_key': lambda key: key == 'test-key', 'get_request_tenant_id': lambda handler, parsed: handler.headers.get('X-Tenant-Id', 'default')}


def call(path='', data=None, tenant='default', key='test-key'):
    responses = []
    h = SimpleNamespace(headers={'X-API-Key': key, 'X-Tenant-Id': tenant}, _read_json_body=lambda: data, _respond=lambda status, body: responses.append((status, body)))
    assert assets.handle(h, 'GET' if data is None else 'POST', urlparse(assets.BASE + path), host)
    return responses[0]


def save(profile, name, kind, value, revision=0):
    return call('/values', {'profileId': profile, 'name': name, 'type': kind, 'value': value, 'revision': revision})


assert call(key='bad')[0] == 401
assert call()[1]['profiles'][0]['id'] == 'default'
assert call('/profiles', {'name': 'Generated profile', 'enabled': True})[0] == 200
for profile in ['development', 'production']:
    assert call('/profiles', {'id': profile, 'name': profile.title(), 'enabled': True})[0] == 200
assert save('development', 'ERP_URL', 'String', 'https://dev.example')[0] == 200
assert save('production', 'ERP_URL', 'String', 'https://prod.example')[0] == 200
credential = {'username': 'fixture-user-private', 'password': 'fixture-password-private'}
assert save('development', 'ERP_Login', 'Credential', credential)[0] == 200
assert save('development', 'API_SECRET', 'Secret', 'fixture-secret-private')[0] == 200
assert save('development', 'Retries', 'Int32', 3)[0] == 200
assert save('development', 'Settings', 'Object', {'items': [True, 3]})[0] == 200
assert save('development', 'Bad', 'Int32', True)[0] == 400
assert save('development', 'Bad', 'Int32', 2147483648)[0] == 400
assert save('development', '{{dynamic}}', 'String', 'no')[0] == 400
assert save('development', 'Bad', 'Credential', {'username': 'u'})[0] == 400
catalog = call()[1]
for secret in [*credential.values(), 'fixture-secret-private']:
    assert secret not in json.dumps(catalog)
    assert secret.encode() not in Path(host['WORKFLOWS_DB']).read_bytes()
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    assert all(secret not in str(conn.execute('SELECT * FROM studio_asset_audit').fetchall()) for secret in credential.values())
print('PASS Authentication, typed values, encrypted SQLite storage, protected metadata and value-free audit')
assert assets.resolve(host, 'default', 'development', 'ERP_URL', 'String')['value'] == 'https://dev.example'
assert assets.resolve(host, 'default', 'production', 'ERP_URL', 'String')['value'] == 'https://prod.example'
assert assets.resolve(host, 'default', 'development', 'ERP_Login', 'Credential')['value'] == credential
assert call('/resolve', {'profileId': 'development', 'name': 'ERP_Login', 'type': 'Credential'}, tenant='other')[0] == 400
assert call('/resolve', {'profileId': 'production', 'name': 'ERP_Login', 'type': 'Credential'})[0] == 400
assert call('/resolve', {'profileId': 'development', 'name': 'ERP_Login', 'type': 'String'})[0] == 400
assert save('development', 'ERP_URL', 'String', 'https://new.example', 1)[0] == 200
assert save('development', 'ERP_URL', 'String', 'https://stale.example', 1)[0] == 409
assert assets.resolve(host, 'default', 'development', 'ERP_URL', 'String')['value'] == 'https://new.example'
assert call('/profiles', {'id': 'production', 'name': 'Production', 'enabled': False})[0] == 200
assert call('/resolve', {'profileId': 'production', 'name': 'ERP_URL', 'type': 'String'})[0] == 400
assert call('/profiles', {'id': 'default', 'name': 'Default', 'enabled': False})[0] == 400
print('PASS Environment isolation, missing/type mismatch, no fallback, disabled profiles and optimistic concurrency')
definition = {'portablePackage': {'workflows': [{'definition': {'nodes': [{'data': {'activityId': 'get-credential', 'properties': {'assetName': 'ERP_Login'}}}, {'data': {'activityId': 'get-asset', 'properties': {'assetName': 'ERP_URL', 'assetType': 'String'}}}]}}]}}
with assets.database(host, 'default') as conn:
    with conn:
        conn.execute('CREATE TABLE studio_robot_jobs(id TEXT,organization_id TEXT,snapshot TEXT)')
        conn.execute('INSERT INTO studio_robot_jobs VALUES (?,?,?)', ('job', 'default', json.dumps({'status': 'running'})))
        selected, refs, token = assets.prepare_grant(host, 'default', 'development', definition, 'job', conn)
        assets.save_grant(conn, 'default', selected['id'], refs, token, 'job')
assert token.encode() not in Path(host['WORKFLOWS_DB']).read_bytes()
assert assets.resolve_job(host, 'job', token, 'ERP_Login', 'Credential')['value'] == credential
for args in [('job', 'wrong', 'ERP_Login', 'Credential'), ('job', token, 'API_SECRET', 'Secret'), ('other-job', token, 'ERP_URL', 'String')]:
    try:
        assets.resolve_job(host, *args)
        raise AssertionError('Unexpected grant access')
    except assets.AssetError:
        pass
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    conn.execute('UPDATE studio_robot_jobs SET snapshot=?', (json.dumps({'status': 'stopped'}),))
try:
    assets.resolve_job(host, 'job', token, 'ERP_Login', 'Credential')
    raise AssertionError('Terminal job accessed credentials')
except assets.AssetError:
    pass
print('PASS Hashed per-job capability, package allowlist, unknown jobs and terminal grant revocation')
key_file = out / 'studio-assets.key'
backup = key_file.read_bytes()
key_file.unlink()
try:
    assets.resolve(host, 'default', 'development', 'ERP_Login', 'Credential')
    raise AssertionError('Missing key accepted')
except assets.AssetError:
    pass
assert not key_file.exists(), 'A missing key must never be silently replaced'
key_file.write_bytes(backup)
assert assets.resolve(host, 'default', 'development', 'ERP_Login', 'Credential')['value'] == credential
assert call('/values', {'profileId': 'development', 'name': 'ERP_Login', 'revision': 1, 'delete': True})[0] == 200
print('PASS Missing encryption key fails closed, backup restores values and revision-checked delete')
print('Backend assets scenarios passed: ' + str(out))
