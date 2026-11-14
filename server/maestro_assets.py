"""Central assets, encrypted credentials and environment profiles for Maestro."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

BASE = '/api/v1/studio-assets'
TYPES = {'String', 'Boolean', 'Int32', 'Double', 'Object', 'Secret', 'Credential'}
NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_.-]{0,127}')


class AssetError(ValueError):
    pass


@contextmanager
def database(host, tenant):
    conn = sqlite3.connect(host['WORKFLOWS_DB'], timeout=15)
    try:
        with conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_asset_profiles(tenant TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(tenant,id))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_assets(tenant TEXT NOT NULL,profile_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,value TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(tenant,profile_id,name))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_asset_audit(tenant TEXT NOT NULL,profile_id TEXT NOT NULL,name TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL)''')
            conn.execute('''CREATE TABLE IF NOT EXISTS studio_job_asset_grants(job_id TEXT PRIMARY KEY,tenant TEXT NOT NULL,profile_id TEXT NOT NULL,token_hash TEXT NOT NULL,refs TEXT NOT NULL,expires_at INTEGER NOT NULL)''')
            conn.execute("INSERT OR IGNORE INTO studio_asset_profiles VALUES (?,'default','Default',1)", (tenant,))
        yield conn
    finally:
        conn.close()


def cipher(host):
    from cryptography.fernet import Fernet
    file = Path(host['WORKFLOWS_DB']).resolve().parent / 'studio-assets.key'
    if not file.exists():
        with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
            if conn.execute("SELECT COUNT(*) FROM studio_assets WHERE type IN ('Secret','Credential')").fetchone()[0]:
                raise AssetError('The asset encryption key is missing. Restore its matching backup before saving or resolving protected values.')
    try:
        fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(Fernet.generate_key())
    return Fernet(file.read_bytes())


def profile(conn, tenant, profile_id):
    row = conn.execute('SELECT id,name,enabled FROM studio_asset_profiles WHERE tenant=? AND id=?', (tenant, profile_id)).fetchone()
    if not row or not row[2]:
        raise AssetError('The selected environment is missing or disabled. No fallback environment was used.')
    return {'id': row[0], 'name': row[1], 'enabled': bool(row[2])}


def validate_value(kind, value):
    if kind not in TYPES:
        raise AssetError('Unsupported asset type.')
    valid = True
    if kind in ('String', 'Secret'):
        valid = isinstance(value, str) and (kind != 'Secret' or bool(value))
    elif kind == 'Credential':
        valid = isinstance(value, dict) and set(value) == {'username', 'password'} and all(isinstance(value[k], str) and value[k] for k in value)
    elif kind == 'Boolean':
        valid = isinstance(value, bool)
    elif kind == 'Int32':
        valid = isinstance(value, int) and not isinstance(value, bool) and -2147483648 <= value <= 2147483647
    elif kind == 'Double':
        valid = isinstance(value, (int, float)) and not isinstance(value, bool)
    try:
        text = json.dumps(value, allow_nan=False, separators=(',', ':'))
    except (ValueError, TypeError):
        raise AssetError('Enter a valid JSON value.')
    if not valid or len(text) > 100000:
        raise AssetError('Value does not match the asset type or exceeds 100 KB.')
    return text


def metadata(row):
    result = {'profileId': row[0], 'name': row[1], 'type': row[2], 'revision': row[4], 'updatedAt': row[5]}
    if row[2] not in ('Secret', 'Credential'):
        result['value'] = json.loads(row[3])
    return result


def resolve(host, tenant, profile_id, name, kind):
    if not isinstance(name, str) or not NAME.fullmatch(name) or kind not in TYPES:
        raise AssetError('Invalid asset reference.')
    with database(host, tenant) as conn:
        profile(conn, tenant, profile_id)
        row = conn.execute('SELECT type,value,revision FROM studio_assets WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, name)).fetchone()
    if not row:
        raise AssetError('Asset is missing from the selected environment.')
    if row[0] != kind:
        raise AssetError('Asset type does not match the activity.')
    try:
        value = json.loads(cipher(host).decrypt(row[1].encode()).decode() if kind in ('Secret', 'Credential') else row[1])
    except Exception:
        raise AssetError('Protected asset could not be decrypted. Restore its matching key backup.')
    return {'type': kind, 'value': value, 'revision': row[2]}


def requirements(definition):
    refs = []
    for workflow in definition.get('portablePackage', {}).get('workflows', []):
        for node in workflow.get('definition', {}).get('nodes', []):
            data = node.get('data', {})
            if data.get('activityId') not in ('get-asset', 'get-credential'):
                continue
            p = data.get('properties', {})
            name, kind = p.get('assetName'), 'Credential' if data['activityId'] == 'get-credential' else p.get('assetType', 'String')
            if not isinstance(name, str) or not NAME.fullmatch(name) or kind not in TYPES or data['activityId'] == 'get-asset' and kind == 'Credential':
                raise AssetError('Package contains an invalid asset reference.')
            ref = {'name': name, 'type': kind}
            if ref not in refs:
                refs.append(ref)
    return refs


def prepare_grant(host, tenant, profile_id, definition, job_id, conn):
    refs = requirements(definition)
    selected = profile(conn, tenant, profile_id)
    for ref in refs:
        row = conn.execute('SELECT type FROM studio_assets WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, ref['name'])).fetchone()
        if not row or row[0] != ref['type']:
            raise AssetError('A required asset is missing or has a different type in the selected environment.')
    token = secrets.token_urlsafe(32)
    return selected, refs, token


def save_grant(conn, tenant, profile_id, refs, token, job_id):
    conn.execute('INSERT INTO studio_job_asset_grants VALUES (?,?,?,?,?,?)', (job_id, tenant, profile_id, hashlib.sha256(token.encode()).hexdigest(), json.dumps(refs), int(time.time() * 1000) + 86400000))


def authorize_job(host, job_id, token):
    # The unguessable per-job capability is separate from Maestro's shared administrative API key.
    with database(host, 'default') as conn:
        row = conn.execute('SELECT tenant,profile_id,token_hash,refs,expires_at FROM studio_job_asset_grants WHERE job_id=?', (job_id,)).fetchone()
        if not row or not token or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), row[2]) or row[4] < int(time.time() * 1000):
            raise AssetError('Invalid or expired job asset grant.')
        state = conn.execute('SELECT snapshot FROM studio_robot_jobs WHERE id=? AND organization_id=?', (job_id, row[0])).fetchone()
        if not state or json.loads(state[0])['status'] in ('success', 'failed', 'stopped'):
            raise AssetError('This job cannot access that asset.')
    return {'tenant': row[0], 'profileId': row[1], 'refs': json.loads(row[3])}


def resolve_job(host, job_id, token, name, kind):
    grant = authorize_job(host, job_id, token)
    if {'name': name, 'type': kind} not in grant['refs']:
        raise AssetError('This job cannot access that asset.')
    return resolve(host, grant['tenant'], grant['profileId'], name, kind)


def handle(handler, method, parsed, host):
    if parsed.path != BASE and not parsed.path.startswith(BASE + '/'):
        return False
    if not host['_is_valid_api_key'](handler.headers.get('X-API-Key', '').strip()):
        handler._respond(401, {'ok': False, 'error': 'Invalid or missing X-API-Key.'})
        return True
    tenant = host['get_request_tenant_id'](handler, parsed)
    try:
        if method == 'GET' and parsed.path == BASE:
            with database(host, tenant) as conn:
                profiles = [{'id': r[0], 'name': r[1], 'enabled': bool(r[2])} for r in conn.execute('SELECT id,name,enabled FROM studio_asset_profiles WHERE tenant=? ORDER BY name', (tenant,))]
                assets = [metadata(r) for r in conn.execute('SELECT profile_id,name,type,value,revision,updated_at FROM studio_assets WHERE tenant=? ORDER BY name', (tenant,))]
            handler._respond(200, {'ok': True, 'profiles': profiles, 'assets': assets})
            return True
        if method == 'POST' and parsed.path == BASE + '/resolve':
            p = handler._read_json_body() or {}
            handler._respond(200, {'ok': True, 'asset': resolve(host, tenant, p.get('profileId', 'default'), p.get('name'), p.get('type'))})
            return True
        if method != 'POST':
            handler._respond(404, {'ok': False, 'error': 'Asset endpoint not found.'})
            return True
        p = handler._read_json_body() or {}
        with database(host, tenant) as conn:
            with conn:
                conn.execute('BEGIN IMMEDIATE')
                if parsed.path == BASE + '/profiles':
                    name, enabled = str(p.get('name', '')).strip(), p.get('enabled', True)
                    if not name or len(name) > 80 or not isinstance(enabled, bool):
                        raise AssetError('Enter an environment name and enabled state.')
                    profile_id = str(p.get('id') or ('env_' + secrets.token_hex(12)))
                    if not NAME.fullmatch(profile_id) or profile_id == 'default' and not enabled:
                        raise AssetError('Invalid environment profile.')
                    duplicate = conn.execute('SELECT id FROM studio_asset_profiles WHERE tenant=? AND lower(name)=lower(?) AND id<>?', (tenant, name, profile_id)).fetchone()
                    if duplicate:
                        raise AssetError('An environment with this name already exists.')
                    conn.execute('INSERT INTO studio_asset_profiles VALUES (?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled', (tenant, profile_id, name, int(enabled)))
                    action, item = 'profile-update', profile_id
                elif parsed.path == BASE + '/values':
                    profile_id, name = p.get('profileId', 'default'), p.get('name')
                    profile(conn, tenant, profile_id)
                    if not isinstance(name, str) or not NAME.fullmatch(name):
                        raise AssetError('Enter a valid asset name.')
                    existing = conn.execute('SELECT revision FROM studio_assets WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, name)).fetchone()
                    if p.get('revision', 0) != (existing[0] if existing else 0):
                        handler._respond(409, {'ok': False, 'error': 'Asset changed. Refresh before saving.'})
                        return True
                    if p.get('delete') is True:
                        conn.execute('DELETE FROM studio_assets WHERE tenant=? AND profile_id=? AND name=?', (tenant, profile_id, name))
                        action = 'asset-delete'
                    else:
                        kind = p.get('type')
                        value = validate_value(kind, p.get('value'))
                        if kind in ('Secret', 'Credential'):
                            value = cipher(host).encrypt(value.encode()).decode()
                        conn.execute('INSERT INTO studio_assets VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant,profile_id,name) DO UPDATE SET type=excluded.type,value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at', (tenant, profile_id, name, kind, value, (existing[0] if existing else 0) + 1, int(time.time() * 1000)))
                        action = 'asset-save'
                    item = name
                else:
                    raise AssetError('Asset endpoint not found.')
                conn.execute('INSERT INTO studio_asset_audit VALUES (?,?,?,?,?)', (tenant, profile_id, item, action, int(time.time() * 1000)))
        handler._respond(200, {'ok': True})
    except AssetError as error:
        handler._respond(400, {'ok': False, 'error': str(error)})
    except Exception:
        handler._respond(500, {'ok': False, 'error': 'Asset request could not be completed. No protected value was returned.'})
    return True
