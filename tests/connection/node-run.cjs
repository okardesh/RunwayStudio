const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {postLicenseRequest,normalizeRunwayServerUrl}=require('./transport.cjs');
const connection=require('./connection.cjs');
const results=[],requests=[],sockets=new Set();let mode='ok',server,url;
const test=async(name,fn)=>{try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e.stack||e)});}fs.writeFileSync(path.join(__dirname,'node-results.json'),JSON.stringify(results,null,2));};
const body=(more={})=>({ok:true,authenticated:true,canUseDevelopers:true,apiKey:'fixture-api-key',...more});
const request=action=>({serverUrl:url,action,deviceName:'runway-fixture',organizationId:'default'});
const storage=new Map(),keys=new Map();
global.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
global.window={electronAPI:{requestRunwayLicense:r=>postLicenseRequest(r,{timeoutMs:120}),getRunwayApiKey:async u=>keys.get(u)??null,storeRunwayApiKey:async(u,k)=>{keys.set(u,k);return true;}}};
function reset(){storage.clear();keys.clear();requests.length=0;mode='ok';}
(async()=>{
 server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({method:req.method,path:req.url,headers:req.headers,body:raw?JSON.parse(raw):null});
  if(mode==='hang')return;
  res.setHeader('Content-Type','application/json');
  if(mode==='slow-body'){res.writeHead(200);res.write('{');return;}
  if(mode==='redirect'){res.writeHead(307,{Location:url+'/elsewhere'});res.end();return;}
  if(mode==='malformed'){res.end('<html>Login page</html>');return;}
  if(mode==='denied'){res.statusCode=403;res.end(JSON.stringify({ok:false,message:'Developer license denied'}));return;}
  if(mode==='inactive'&&req.url.endsWith('/heartbeat')){res.statusCode=409;res.end(JSON.stringify({ok:false,message:'Registration not active'}));return;}
  res.end(JSON.stringify(mode==='no-access'?body({canUseDevelopers:false}):mode==='no-key'?{ok:true,authenticated:true,canUseDevelopers:true}:body()));
 });server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;
 await test('Bare server address and trailing slash normalize consistently',()=>{assert.equal(normalizeRunwayServerUrl(' 172.20.10.12:5050/ '),'http://172.20.10.12:5050');assert.equal(normalizeRunwayServerUrl(url+'/proxy/'),url+'/proxy');});
 await test('Non-HTTP addresses, credentials and query parameters are rejected',()=>{for(const value of ['file:///tmp/test','https://user:secret@example.com','https://example.com/?token=test','javascript:alert(1)',''])assert.throws(()=>normalizeRunwayServerUrl(value));});
 await test('Register uses the exact endpoint, tenant header and consumption contract',async()=>{reset();const r=await postLicenseRequest(request('register'));assert.equal(r.status,200);const q=requests[0];assert.equal(q.path,'/api/license/register');assert.equal(q.headers['x-tenant-id'],'default');assert.deepEqual(q.body,{organizationId:'default',clientType:'Developer Studio',deviceName:'runway-fixture',consume:true});});
 await test('Heartbeat and release never send consume=true',async()=>{reset();for(const action of ['heartbeat','release'])assert.equal((await postLicenseRequest(request(action))).status,200);for(const q of requests)assert.equal('consume'in q.body,false);});
 await test('A reverse-proxy base path is retained',async()=>{reset();await postLicenseRequest({...request('register'),serverUrl:url+'/proxy/'});assert.equal(requests[0].path,'/proxy/api/license/register');});
 await test('Invalid actions and empty device identities do not make requests',async()=>{reset();for(const r of [{...request('delete')},{...request('register'),deviceName:''}])assert.equal((await postLicenseRequest(r)).error.code,'INVALID_REQUEST');assert.equal(requests.length,0);});
 await test('Response timeout is bounded and names the unreachable server',async()=>{reset();mode='hang';const started=Date.now(),r=await postLicenseRequest(request('register'),{timeoutMs:100});assert.equal(r.error.code,'TIMEOUT');assert.ok(r.error.message.includes(url));assert.ok(Date.now()-started<2000);});
 await test('A stalled response body also times out',async()=>{reset();mode='slow-body';assert.equal((await postLicenseRequest(request('register'),{timeoutMs:100})).error.code,'TIMEOUT');});
 await test('POST redirects are not followed or replayed',async()=>{reset();mode='redirect';const r=await postLicenseRequest(request('register'));assert.ok(r.error);assert.equal(requests.length,1);});
 await test('Connection-refused and DNS failures get actionable messages',async()=>{for(const [code,match] of [['ECONNREFUSED',/refused/],['ENOTFOUND',/resolved/]]){const r=await postLicenseRequest(request('register'),{fetch:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code}});}});assert.equal(r.error.code,code);assert.match(r.error.message,match);}});
 await test('Renderer uses the desktop bridge and stores the issued API key',async()=>{reset();const c=await connection.connectToRunwayServer(url);assert.equal(c.serverUrl,url);assert.equal(keys.get(url),'fixture-api-key');assert.equal(requests.length,1);});
 await test('Repeated connection uses heartbeat and cached credentials',async()=>{requests.length=0;mode='no-key';const c=await connection.connectToRunwayServer(url);assert.equal(c.accessToken,'fixture-api-key');assert.equal(requests[0].path,'/api/license/heartbeat');assert.equal(requests.length,1);});
 await test('Concurrent startup calls share a single registration',async()=>{reset();const first=connection.connectToRunwayServer(url),second=connection.connectToRunwayServer(url);assert.strictEqual(first,second);await Promise.all([first,second]);assert.equal(requests.length,1);});
 await test('Inactive registration recovers once, then remains registered',async()=>{reset();await connection.connectToRunwayServer(url);requests.length=0;mode='inactive';await connection.connectToRunwayServer(url);assert.deepEqual(requests.map(r=>r.path),['/api/license/heartbeat','/api/license/register']);requests.length=0;mode='ok';await connection.connectToRunwayServer(url);assert.equal(requests[0].path,'/api/license/heartbeat');});
 await test('License denial preserves the server message',async()=>{reset();mode='denied';await assert.rejects(connection.connectToRunwayServer(url),/Developer license denied/);assert.equal(requests.length,1);});
 await test('A successful HTTP response still requires Developer Studio access',async()=>{reset();mode='no-access';await assert.rejects(connection.connectToRunwayServer(url),/did not grant Developer Studio/);});
 await test('Malformed success is reported without retrying registration',async()=>{reset();mode='malformed';await assert.rejects(connection.connectToRunwayServer(url),/invalid license response/);assert.equal(requests.length,1);});
 await test('Missing credentials do not unlock Studio',async()=>{reset();mode='no-key';await assert.rejects(connection.connectToRunwayServer(url),/did not issue an API key/);});
 await test('Timeout clears the in-flight attempt so retry can connect',async()=>{reset();mode='hang';await assert.rejects(connection.connectToRunwayServer(url),/did not respond/);mode='ok';assert.equal((await connection.connectToRunwayServer(url)).serverUrl,url);});
 await test('Live heartbeat and release use the same transport',async()=>{reset();const c=await connection.connectToRunwayServer(url);requests.length=0;await connection.heartbeatRunwayLicense(c);await connection.releaseRunwayLicense(c);assert.deepEqual(requests.map(r=>r.path),['/api/license/heartbeat','/api/license/release']);});
 const summary={scenarios:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};fs.writeFileSync(path.join(__dirname,'node-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));for(const r of results.filter(r=>!r.passed))console.error(r.error);process.exitCode=summary.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const socket of sockets)socket.destroy();server?.close();});
