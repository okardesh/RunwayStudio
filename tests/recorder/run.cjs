// Runs in a separate Electron app/profile. Never activates or mocks a Studio license.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { recorderScript, stopRecorderScript } = require('./recorder-script.cjs');
app.setPath('userData', path.join(__dirname, 'profile-' + process.pid));
app.commandLine.appendSwitch('force-renderer-accessibility');
const results = [];
fs.writeFileSync(path.join(__dirname, 'results.json'), '[]');
fs.writeFileSync(path.join(__dirname, 'fatal.txt'), '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
const fixture = `<!doctype html><html><body>
<button data-testid='save'>Save</button><button aria-label='Say "hello"'>Hello</button>
<input name='customer["name"]'><button id='123:a.b'>Special ID</button>
<button id='duplicate'>First</button><button id='duplicate'>Second</button>
<section><div><div><div><div><div><button>Deep 1</button></div></div></div></div></div></section>
<section><div><div><div><div><div><button>Deep 2</button></div></div></div></div></div></section>
<svg><g><circle cx='20' cy='20' r='10'/></g></svg>
<a href='/next'>Next page</a>
<script>window.clicks=0;document.addEventListener('click',()=>window.clicks++);window.messages=[];const log=console.log;console.log=(m)=>{messages.push(m);log(m)};</script>
</body></html>`;
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack || String(error) }); }
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
}
const evaluate = script => Promise.race([
  win.webContents.executeJavaScript(script),
  new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Evaluation timed out: ' + script.slice(0, 200))), 6000); timer.unref(); }),
]);
const guest = script => evaluate(`document.querySelector('webview').executeJavaScript(${JSON.stringify(script)})`);
async function until(script) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await evaluate(script)) return; await sleep(30); }
  throw new Error('Timed out: ' + script);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function load(url) {
  await evaluate(`{ const el=document.querySelector('.rec-nav__url'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,${JSON.stringify(url)});el.dispatchEvent(new Event('input',{bubbles:true})); }`);
  await sleep(50);
  await click('.rec-nav__load');
  await until(`!document.querySelector('.rec-loading-bar')`);
  if (url.startsWith('http://127.0.0.1:') && !url.includes(':1/')) {
    await until(`document.querySelector('webview').executeJavaScript('location.href').then(value=>value===${JSON.stringify(url)}).catch(()=>false)`);
  }
}
async function pick(target) {
  await click('.rec-nav__record');
  await until(`document.querySelector('.rec-nav__record').classList.contains('active')`);
  await guest(`document.querySelector(${JSON.stringify(target)}).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
  await until(`!!document.querySelector('.rec-result__selector')`);
  return evaluate(`document.querySelector('.rec-result__selector').textContent`);
}
app.whenReady().then(async () => {
  server = http.createServer((_req,res)=>{ res.setHeader('Content-Type','text/html'); res.end(fixture); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  win = new BrowserWindow({ width: 1200, height: 900, title: 'Runway Recorder Tests', webPreferences: { webviewTag: true, contextIsolation: true } });
  await win.loadFile(path.join(__dirname, 'index.html'));
  await evaluate('mountRecorder()');
  await until(`!!document.querySelector('webview')`);
  await check('Load HTTP fixture in real Electron webview', async()=>{ await load(url); assert.equal(await guest('location.href'),url); });
  const targets = [
    ['data-testid attribute','[data-testid="save"]'], ['quoted aria-label','[aria-label]'],
    ['quoted name','input'], ['escaped numeric/punctuation ID','button[id="123:a.b"]'],
    ['duplicate ID disambiguation','button[id="duplicate"]:nth-of-type(5)'],
    ['deep path uniqueness','section:nth-of-type(2) button'], ['SVG element','circle'],
  ];
  for (const [name,target] of targets) await check(name,async()=>{
    const selector=await pick(target);
    assert.ok(await guest(`(()=>{const matches=document.querySelectorAll(${JSON.stringify(selector)});return matches.length===1 && matches[0]===document.querySelector(${JSON.stringify(target)})})()`),selector);
  });
  await check('Pick completion removes listeners and permits normal clicks',async()=>{
    await pick('[data-testid="save"]');
    const before=await guest('clicks');
    await guest('document.querySelector("button").click()');
    assert.equal(await guest('clicks'),before+1);
    assert.equal(await guest('!!window.__runwayRecorderStop'),false);
  });
  await check('Stop Picking cleans up and permits restarting',async()=>{
    await click('.rec-nav__record'); await sleep(70);
    assert.ok(await guest('!!window.__runwayRecorderStop'));
    await click('.rec-nav__record'); await sleep(70);
    assert.equal(await guest('!!window.__runwayRecorderStop'),false);
    assert.equal(await evaluate(`document.querySelector('.rec-nav__record').classList.contains('active')`),false);
    await pick('input');
  });
  await check('Escape cancels without retaining stale selection',async()=>{
    await click('.rec-nav__record'); await sleep(70);
    await guest(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    await until(`!document.querySelector('.rec-nav__record').classList.contains('active')`);
    assert.equal(await evaluate(`!!document.querySelector('.rec-result')`),false);
    assert.equal(await guest('!!window.__runwayRecorderStop'),false);
  });
  await check('Use selector returns the actual captured selector',async()=>{
    const selector=await pick('input'); await click('.rec-result__use');
    assert.equal(await evaluate('selections.at(-1)'),selector);
  });
  await check('Reload invalidates captured selector',async()=>{
    await click('.rec-nav__btn:nth-child(3)');
    await until(`!document.querySelector('.rec-loading-bar') && !document.querySelector('.rec-result')`);
    await pick('input');
  });
  await check('Invalid schemes show a recoverable error',async()=>{
    await load('javascript:alert(1)');
    assert.match(await evaluate(`document.querySelector('[role="alert"]').textContent`),/HTTP/);
    await load(url);
  });
  await check('Failed navigation shows an error and recovers',async()=>{
    for (let attempt = 0; attempt < 5; attempt++) {
      await load('http://127.0.0.1:1/');
      await until(`!!document.querySelector('[role="alert"]')`);
      await load(url); await pick('input');
    }
  });
  await check('Page console cannot overwrite an inactive capture',async()=>{
    const before=await evaluate(`document.querySelector('.rec-result__selector').textContent`);
    await guest(`console.log('__REC__:'+JSON.stringify({selector:'fake',tag:'x',text:'x'}))`); await sleep(50);
    assert.equal(await evaluate(`document.querySelector('.rec-result__selector').textContent`),before);
  });
  await check('Repeated start and stop has one capture and no residual overlay',async()=>{
    for(let i=0;i<20;i++) { await guest(recorderScript('stress')); await guest(recorderScript('stress')); await guest(stopRecorderScript); }
    assert.equal(await guest('!!window.__runwayRecorderStop'),false);
    assert.equal(await guest(`document.querySelectorAll('div[style*="2147483647"]').length`),0);
    await pick('input');
  });
  await check('Closing and reopening recorder works in StrictMode',async()=>{
    await evaluate('unmountRecorder()'); await until(`!document.querySelector('webview')`);
    await evaluate('mountRecorder()'); await until(`!!document.querySelector('webview')`);
    await load(url); await pick('input');
  });
  await evaluate(`unmountRecorder(); window.desktopCalls=[];window.desktopCancels=[];window.electronAPI={pickDesktopElement:(title,id)=>{desktopCalls.push({title,id});return new Promise(resolve=>window.resolveDesktop=resolve)},cancelDesktopPick:id=>desktopCancels.push(id)}; void 0;`);
  await sleep(50);
  await check('Desktop StrictMode starts exactly one picker',async()=>{
    await evaluate('mountDesktop()'); await until('desktopCalls.length>0'); await sleep(100);
    assert.equal(await evaluate('desktopCalls.length'),1);
  });
  await check('Parent rerender does not restart desktop picker',async()=>{
    await evaluate('mountDesktop()'); await sleep(100); assert.equal(await evaluate('desktopCalls.length'),1);
  });
  await check('Desktop capture, repick, cancellation and unmount',async()=>{
    await evaluate(`resolveDesktop({selector:'window:Recorder Fixture > name:Save',name:'Save',controlType:'Button'})`);
    await until(`!!document.querySelector('.rec-result__selector')`);
    await click('.rec-result__use'); assert.match(await evaluate('selections.at(-1)'),/name:Save/);
    await click('.rec-result__repick'); await until('desktopCalls.length===2');
    await evaluate('unmountRecorder()'); await until('desktopCancels.length===1');
    assert.equal(await evaluate('desktopCancels[0]'),await evaluate('desktopCalls[1].id'));
    await evaluate('resolveDesktop({cancelled:true})');
  });
  const {pickDesktopElement} = require('./desktop-picker.cjs');
  await check('Native picker reports a missing scoped window promptly',async()=>{
    await assert.rejects(pickDesktopElement('Runway Missing Fixture 8ba91'),/no longer available/);
  });
  await check('Native picker can be aborted without leaving its process running',async()=>{
    const controller = new AbortController();
    const pending=pickDesktopElement('',controller.signal);
    setTimeout(()=>controller.abort(),700);
    assert.deepEqual(await pending,{cancelled:true});
  });
  // Optional interactive smoke test, driven against a harmless fixture window.
  if (fs.existsSync(path.join(__dirname, 'native-smoke.flag'))) {
    const fixtureTitle = 'Recorder Fixture ' + process.pid;
    const readyPath = path.join(__dirname, 'native-ready-' + process.pid);
    const fixtureProcess = require('node:child_process').spawn(path.join(__dirname, 'native-fixture.exe'), [fixtureTitle, readyPath]);
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(readyPath)) { if (Date.now() > deadline) throw new Error('Native fixture did not open'); await sleep(50); }
    const nativeAbort = new AbortController();
    fixtureProcess.once('exit',()=>nativeAbort.abort());
    win.hide();
    fs.writeFileSync(path.join(__dirname,'stage.txt'),'native-pick');
    await check('Native desktop picker captures a real Windows element',async()=>{
      const picked = await pickDesktopElement(fixtureTitle,nativeAbort.signal);
      fs.writeFileSync(path.join(__dirname,'native-capture.json'),JSON.stringify(picked,null,2));
      assert.equal(picked.cancelled,false);
      assert.match(picked.name,/İstanbul/);
      assert.match(picked.selector,/window:Recorder Fixture/);
    });
    fs.writeFileSync(path.join(__dirname,'stage.txt'),'native-escape');
    await check('Native desktop picker Escape cancels',async()=>{ assert.deepEqual(await pickDesktopElement(fixtureTitle,nativeAbort.signal),{cancelled:true}); });
    fixtureProcess.kill();
  }
  fs.writeFileSync(path.join(__dirname, 'summary.txt'), `${results.filter(r=>r.passed).length}/${results.length} passed`);
  win.destroy(); server.close(); app.quit();
}).catch(error=>{ fs.writeFileSync(path.join(__dirname,'fatal.txt'),error.stack||String(error)); app.exit(1); });
