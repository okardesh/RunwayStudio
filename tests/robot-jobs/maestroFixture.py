"""Isolated Maestro HTTP fixture using selected functions from its real source snapshot."""
import ast
import importlib.util
import json
import os
import sqlite3
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from types import SimpleNamespace

source, config_file = map(Path, sys.argv[1:3])
config = json.loads(config_file.read_text(encoding='utf-8'))
namespace = {'sqlite3': sqlite3, 'json': json, 'WORKFLOWS_DB': str(config_file.parent / 'maestro-fixture.db'), 'MCP_DEFAULT_TENANT': 'default'}
names = {'_rpa_workflow_to_dict', '_list_rpa_workflows', '_get_license_registration', '_list_license_registrations', 'create_rpa_workflows_table', 'create_rpa_jobs_table', 'create_license_client_registrations_table'}
tree = ast.parse(source.read_text(encoding='utf-8'))
selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
assert len(selected) == len(names), 'Maestro source changed: review fixture extraction'
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)
namespace['_reap_expired_license_registrations'] = lambda conn, tenant: conn.execute('UPDATE license_client_registrations SET is_active=0 WHERE organization_id=? AND lease_expires_at<?', (tenant, int(time.time() * 1000)))
namespace['_is_valid_api_key'] = lambda key: key == 'studio-fixture-key'
namespace['_get_active_api_key'] = lambda: 'robot-fixture-key'
namespace['get_request_tenant_id'] = lambda handler, parsed: handler.headers.get('X-Tenant-Id', 'default')
namespace['RUNWAY_PUBLIC_URL'] = ''
with sqlite3.connect(namespace['WORKFLOWS_DB']) as conn:
    for name in ('create_rpa_workflows_table', 'create_rpa_jobs_table', 'create_license_client_registrations_table'):
        namespace[name](conn)
    for pkg in config['packages']:
        definition = pkg['definition']
        conn.execute('INSERT OR IGNORE INTO rpa_workflows(id,organization_id,name,version,input_arguments,output_arguments,definition,published_at,published_by) VALUES(?,?,?,?,?,?,?,?,?)', (pkg['workflowId'] + '-' + pkg['version'], 'default', pkg['name'], pkg['version'], '[]', '[]', json.dumps(definition), int(time.time() * 1000), 'Fixture'))
    now = int(time.time() * 1000)
    conn.execute('''INSERT OR IGNORE INTO license_client_registrations(organization_id,client_type,device_name,consumed_count,is_active,created_at,updated_at,last_seen_at,lease_expires_at,listener_url,api_key)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)''', ('default', 'robot', 'r1', 1, 1, now, now, now, now + 3600000, config['robotUrl'], 'robot-fixture-key'))

module = Path(__file__).resolve().parents[2] / 'server' / 'maestro_robot_jobs.py'
spec = importlib.util.spec_from_file_location('fixture_jobs', module)
jobs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jobs)
assert jobs._callback_base(SimpleNamespace(headers={'Host': '10.211.55.2:5050'}), {'RUNWAY_PUBLIC_URL': 'http://127.0.0.1:5050'}) == 'http://10.211.55.2:5050'
assert jobs._callback_base(SimpleNamespace(headers={'Host': '127.0.0.1:5050'}), {'RUNWAY_PUBLIC_URL': 'https://runway.example'}) == 'https://runway.example'
flags = {'offline': False, 'drop': False}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _respond(self, status, value):
        if self.path == jobs.BASE and self.command == 'POST' and flags['drop']:
            flags['drop'] = False
            self.close_connection = True
            return
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length > 600000:
            raise ValueError('Body limit')
        return json.loads(self.rfile.read(length) or b'{}')

    def do_GET(self):
        if flags['offline']:
            self._respond(503, {'ok': False})
        else:
            jobs.handle(self, 'GET', urlparse(self.path), namespace)

    def do_POST(self):
        if self.path.startswith('/api/license/'):
            self._read_json_body()
            self._respond(200, {'ok': True, 'authenticated': True, 'canUseRobots': True, 'apiKey': 'robot-fixture-key'})
        elif self.path == '/fixture/control':
            flags.update(self._read_json_body())
            self._respond(200, {'ok': True})
        elif flags['offline']:
            self._read_json_body()
            self._respond(503, {'ok': False})
        else:
            jobs.handle(self, 'POST', urlparse(self.path), namespace)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(json.dumps({'url': 'http://127.0.0.1:' + str(server.server_port)}), flush=True)
server.serve_forever()
