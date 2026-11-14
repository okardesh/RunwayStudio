import sys, json, sqlite3, tempfile, uuid, concurrent.futures, importlib
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server'))
import maestro_human_tasks as h
import maestro_queues as q
import maestro_robot_jobs as jobs
root = Path(tempfile.mkdtemp(prefix='maestro-human-'))
host = {'WORKFLOWS_DB': str(root/'db.sqlite'), '_is_valid_api_key': lambda key: key == 'admin', 'get_request_tenant_id': lambda handler, parsed: handler.headers.get('X-Tenant-Id', 'default')}
with q.database(host, 'default'): pass
with jobs._db(host) as conn: conn.execute('CREATE TABLE rpa_jobs(id TEXT,status TEXT)')
with h.database(host) as conn: conn.execute('CREATE TABLE IF NOT EXISTS stub(a TEXT)')
def api(path='', data=None, token='', admin=True, tenant='default'):
    result=[]; handler=SimpleNamespace(headers={'X-API-Key': 'admin' if admin else '', 'X-Runway-Task-Token':token, 'X-Tenant-Id':tenant}, _read_json_body=lambda:data, _respond=lambda status,body:result.append((status,body)))
    assert h.handle(handler,'GET' if data is None else 'POST',urlparse(h.BASE+path),host)
    return result[0]
def operator(id, roles):
    status, value=api('/operators',{'id':id,'name':id.title(),'roles':roles}); assert status==200,value;return value['personalToken']
token=operator('onur',['finance']); other=operator('other',['other'])
assert api(admin=False)[0]==403
def make(assignee='role:finance', fields=None):
    job_id=str(uuid.uuid4()); definition={'portablePackage':{'id':'sha256:fixture','entryWorkflowId':'wf-0','workflows':[{'id':'wf-0','definition':{'nodes':[{'id':'create','data':{'activityId':'create-human-task','properties':{'assignee':assignee}}},{'id':'wait','data':{'activityId':'wait-for-human-task','properties':{'output':'approval'}}},{'id':'after','data':{'activityId':'log-message','properties':{}}}]}}]}}
    with jobs._db(host) as conn:
        conn.execute('INSERT INTO studio_robot_jobs VALUES(?,?,?,?,?,?,?,?,?)',(job_id,'default',job_id,'f','robot','wf','1','sha256:fixture',json.dumps({'jobId':job_id,'status':'running','startedAt':1,'logs':[]})))
        conn.execute('INSERT INTO rpa_jobs VALUES(?,?)',(job_id,'running')); h.register(conn,'default',job_id,definition,'http://maestro/api/v1/robot-jobs/'+job_id+'/complete')
    payload={'nodeId':'create','title':'Invoice approval','assignee':assignee,'context':{'amount':42},'formSchema':fields or [],'timeoutMinutes':1}
    task=h.create(host,'default',job_id,payload)
    assert h.create(host,'default',job_id,payload)['id']==task['id']
    checkpoint={'id':str(uuid.uuid4()),'packageId':'sha256:fixture','nodeId':'wait','cursor':2,'taskId':task['id'],'output':'approval','values':{'approvalTask':{'id':task['id']},'amount':42}}
    view={'jobId':job_id,'status':'waiting','startedAt':1,'logs':[],'waitingTask':{'id':task['id'],'checkpointId':checkpoint['id']}}
    assert h.save_wait(host,'default',view,checkpoint)['status']=='waiting'
    return job_id,task,checkpoint,view
job,task,cp,view=make(fields=[{'name':'costCenter','label':'Cost center','type':'String','required':True}])
assert len(api(token=other,admin=False)[1]['tasks'])==0
assert api('/decide',{'taskId':task['id'],'requestId':'admin_only','decision':'Approved'})[0]==403
assert api('/decide',{'taskId':task['id'],'requestId':'wrong_role','decision':'Approved'},token=other)[0]==403
assert api('/decide',{'taskId':task['id'],'requestId':'missing','decision':'Approved','fields':{}},token=token)[0]==400
def decide(i):return api('/decide',{'taskId':task['id'],'requestId':'decision_'+str(i),'decision':'Approved','fields':{'costCenter':'FIN'},'comment':'Reviewed'},token=token)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(decide,range(8)))
assert sum(r[0]==200 for r in results)==1,results
winner=next(i for i,r in enumerate(results) if r[0]==200);assert decide(winner)[0]==200
assert api('/decide',{'taskId':task['id'],'requestId':'decision_'+str(winner),'decision':'Rejected','fields':{}},token=token)[0]==400
print('PASS Personal identities/roles, required typed forms, atomic competing decisions, idempotency and audit identity')
accepted={}; attempts=[]
def call(host,tenant,bot,method,suffix,payload=None):
    key=payload['resume']['checkpointId']; attempts.append(key)
    if key not in accepted:
        accepted[key]={'jobId':payload['jobId'],'status':'success','resumeId':key,'startedAt':1,'logs':[]}
        raise OSError('Acknowledgement lost after acceptance')
    return {'job':accepted[key]}
def save(host,tenant,v):
    with jobs._db(host) as conn:conn.execute('UPDATE studio_robot_jobs SET snapshot=? WHERE id=?',(json.dumps(v),v['jobId']))
    return v
h.tick(host,call,save);h=importlib.reload(h);h.tick(host,call,save)
assert len(accepted)==1 and attempts==[cp['id'],cp['id']]
with sqlite3.connect(host['WORKFLOWS_DB']) as conn:
    assert conn.execute('SELECT phase FROM studio_human_waits WHERE id=?',(cp['id'],)).fetchone()[0]=='consumed'
    assert token not in '\n'.join(str(row) for row in conn.execute('SELECT * FROM studio_human_operators'))
print('PASS Durable checkpoint after adapter restart, pinned package/cursor and retrying the identical resume after lost acknowledgement')
job2,task2,cp2,view2=make('user:onur');assert api('/decide',{'taskId':task2['id'],'requestId':'reject','decision':'Rejected','fields':{}},token=token)[0]==200
job3,task3,cp3,view3=make();original=h.now;h.now=lambda:original()+61000
assert next(t for t in api(token=token)[1]['tasks'] if t['id']==task3['id'])['status']=='TimedOut'
h.now=original
assert api('/decide',{'taskId':task3['id'],'requestId':'late','decision':'Approved'},token=token)[0]==400
assert h.request_stop(host,'default',job2)['status']=='stopping'
with h.database(host) as conn: assert conn.execute('SELECT cancelled FROM studio_human_jobs WHERE id=?',(job2,)).fetchone()[0]==1
for data in [{'password':'private'}, {'nested':{'apiKey':'private'}}]:
    try:h.safe(data);raise AssertionError('Protected checkpoint accepted')
    except ValueError:pass
bad={**cp3,'id':str(uuid.uuid4()),'cursor':1}
try:h.save_wait(host,'default',view3,bad);raise AssertionError('Invalid cursor accepted')
except ValueError:pass
assert api(token=token,tenant='other',admin=False)[0]==403
print('PASS Reject, durable timeout, cancellation, tenant isolation and protected-state/invalid-cursor rejection')
print('Human task backend checks passed: '+str(root))
