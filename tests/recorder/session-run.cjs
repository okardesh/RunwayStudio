const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { runBrowserActivity } = require('./browser-engine.cjs');
app.setPath('userData', path.join(__dirname, 'session-profile-' + process.pid));
const results = [];
let win, server;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch(error) { results.push({ name, passed: false, error: String(error.stack || error) }); } fs.writeFileSync(path.join(__dirname, 'session-results.json'), JSON.stringify(results, null, 2)); }
const evaluate = script => win.webContents.executeJavaScript(script);
const guest = script => evaluate(`document.querySelector('webview').executeJavaScript(${JSON.stringify(script)})`);
async function until(script) { const deadline = Date.now()+15000; while(Date.now()<deadline) { if(await evaluate(script)) return; await sleep(40); } throw Error('Timed out: '+script); }
const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent===${JSON.stringify(text)}).click()`);
const setInput = (label, value) => evaluate(`{const el=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
ipcMain.handle('execute', async (_event,id,props) => {
  try { return id==='log-message' ? {success:true, log:String(props.message)} : await runBrowserActivity(id,props); }
  catch(error) { return {success:false,log:String(error)}; }
});
app.whenReady().then(async()=>{
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url === '/frame' ? '<!doctype html><p>Background frame</p>' : req.url.startsWith('/search') ? '<!doctype html><span id="rate">50,22 Türk Lirası</span>' : '<!doctype html><form action="/search"><input id="random-'+Math.random().toString(36).slice(2)+'" name="q"><button>Search</button></form>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  win=new BrowserWindow({width:1200,height:950,webPreferences:{webviewTag:true,contextIsolation:true,preload:path.join(__dirname,'session-preload.cjs')}});
  await win.loadFile(path.join(__dirname,'index.html'));await evaluate('mountSession()');await until(`!!document.querySelector('webview')`);
  await check('Recording starts before navigation and survives a new document',async()=>{
    await click('Start Recording');await setInput('Page URL',url);await sleep(50);await click('Go');
    await until(`document.querySelector('webview').executeJavaScript('!!window.__runwaySessionStop').catch(()=>false)`);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Stop Recording')`));
  });
  await check('Background iframe loading does not stop recording or disable extraction',async()=>{
    await guest(`{const frame=document.createElement('iframe');frame.src='/frame';document.body.appendChild(frame);void 0;}`);
    await sleep(500);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Get Text → Variable').disabled`),false);
    assert.equal(await guest('!!window.__runwaySessionStop'),true);
  });
  await check('Typing is flushed before Enter and recording continues after form navigation',async()=>{
    await guest(`{const input=document.querySelector('input');input.value='1 usd kac tl';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('form').requestSubmit();}`);
    await until(`document.querySelector('webview').executeJavaScript('!!document.querySelector("#rate") && !!window.__runwaySessionStop').catch(()=>false)`);
    assert.match(await evaluate(`document.querySelector('.session-steps').textContent`),/type-into: 1 usd kac tl/);
  });
  await check('Extract text creates a named variable and Finish preserves the whole recording',async()=>{
    await click('Get Text → Variable');await guest(`document.querySelector('#rate').click()`);await until(`document.querySelector('.session-steps').textContent.includes('get-text: usdTry')`);
    await click('Finish & Save Recording');await until('!!window.recordedWorkflow');await until(`!!document.querySelector('[data-testid="saved"]')`);
    const recorded=await evaluate('recordedSteps');assert.deepEqual(recorded.map(step=>step.activityId),['navigate-to','type-into','send-hotkey','get-text']);
    assert.equal(recorded[1].properties.selector,'input[name=q]');
    assert.equal(recorded[3].preview,'50,22 Türk Lirası');
    const workflow=await evaluate('recordedWorkflow');assert.equal(workflow.variables[0].name,'usdTry');assert.equal(workflow.nodes.at(-1).data.activityId,'log-message');
    fs.writeFileSync(path.join(__dirname,'session-workflow.json'),JSON.stringify(workflow,null,2));
    await evaluate(`recordedWorkflow=${JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname,'session-workflow.json'),'utf8')))}`);
  });
  await check('Saved recording replays in real Chrome and logs the runtime extracted variable',async()=>{
    assert.equal(await evaluate('replayRecording()'),'completed');
    const logs=await evaluate('replayLogs');assert.ok(logs.some(log=>log.text.includes('usdTry = 50,22 Türk Lirası')),JSON.stringify(logs));
    fs.writeFileSync(path.join(__dirname,'session-replay-log.json'),JSON.stringify(logs,null,2));
    await runBrowserActivity('close-browser',{});
  });
  await check('Pending text is retained when Stop is clicked without waiting for debounce',async()=>{
    await evaluate('unmountRecorder();mountSession()');await until(`!!document.querySelector('webview')`);await click('Start Recording');await setInput('Page URL',url);await sleep(50);await click('Go');await until(`document.querySelector('webview').executeJavaScript('!!window.__runwaySessionStop').catch(()=>false)`);
    await guest(`{const input=document.querySelector('input');input.value='last edit';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click('Stop Recording');await until(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Start Recording')`);
    assert.match(await evaluate(`document.querySelector('.session-steps').textContent`),/last edit/);
  });
  fs.writeFileSync(path.join(__dirname,'session-summary.txt'),`${results.filter(result=>result.passed).length}/${results.length} passed`);
  win.destroy();server.close();app.exit(results.some(result=>!result.passed)?1:0);
}).catch(error=>{fs.writeFileSync(path.join(__dirname,'session-fatal.txt'),String(error.stack||error));app.exit(1);});
