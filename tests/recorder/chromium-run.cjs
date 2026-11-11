// A cold Chromium accessibility tree: deliberately no force-accessibility switch.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pickDesktopElement } = require('./desktop-picker.cjs');
const { runDesktopActivity } = require('./desktop-engine.cjs');
app.setPath('userData', path.join(__dirname, 'chromium-profile-' + process.pid));
const results = []; saveResults();
function saveResults(){fs.writeFileSync(path.join(__dirname,'chromium-results.json'),JSON.stringify(results,null,2));}
const save = () => fs.writeFileSync(path.join(__dirname,'chromium-results.json'), JSON.stringify(results,null,2));
app.whenReady().then(async()=>{
  const title='Chromium Recorder Fixture '+process.pid+' > QA İstanbul';
  const win=new BrowserWindow({width:900,height:650,title,webPreferences:{contextIsolation:true}});
  win.setMenu(null);
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<title>${title}</title><style>body{font:24px sans-serif;padding:40px}button,input,a{display:block;margin:25px 0;font:24px sans-serif;padding:12px}</style><h2>Chromium recorder test</h2><button aria-label="Approve 'İstanbul', yes" onclick="window.approvals=(window.approvals||0)+1">Approve 'İstanbul', yes</button><label for="search">Search address</label><input id="search" aria-label="Search address"><a href="#target">Open details</a>`));
  const abort=new AbortController();win.on('closed',()=>abort.abort());
  for(const [name,role] of [["Approve 'İstanbul', yes",'Button'],['Search address','Edit'],['Open details','Hyperlink']]) {
    fs.writeFileSync(path.join(__dirname,'chromium-stage.json'),JSON.stringify({title,name,role}));
    try {
      const picked=await pickDesktopElement(title,abort.signal,data=>fs.writeFileSync(path.join(__dirname,'chromium-diagnostic.json'),JSON.stringify({data,ax:app.isAccessibilitySupportEnabled(),versions:process.versions},null,2)));
      fs.writeFileSync(path.join(__dirname,'chromium-capture.json'),JSON.stringify(picked,null,2));
      assert.equal(picked.cancelled,false);assert.equal(picked.name,name);
      assert.equal(picked.controlType,role);
      assert.ok(!picked.selector.includes('Chrome Legacy Window'));
      if(role==='Button') {
        const before=await win.webContents.executeJavaScript('window.approvals||0');
        const replay=await runDesktopActivity('click',{selector:picked.selector});
        assert.equal(replay.success,true,replay.log);
        assert.equal(await win.webContents.executeJavaScript('window.approvals'),before+1);
      }
      if(role==='Edit') {
        const replay=await runDesktopActivity('type-into',{selector:picked.selector,text:'İstanbul test 123'});
        assert.equal(replay.success,true,replay.log);
        assert.equal(await win.webContents.executeJavaScript('document.querySelector("input").value'),'İstanbul test 123');
        const read=await runDesktopActivity('get-text',{selector:picked.selector,output:'value'});
        assert.equal(read.success,true,read.log);assert.equal(read.outputs.value,'İstanbul test 123');
      }
      if(role==='Hyperlink') {
        const read=await runDesktopActivity('get-text',{selector:picked.selector,output:'value'});
        assert.equal(read.success,true,read.log);assert.equal(read.outputs.value,name);
      }
      results.push({name,passed:true,picked});
    } catch(error) { results.push({name,passed:false,error:String(error.stack||error)}); }
    save();
  }
  fs.writeFileSync(path.join(__dirname,'chromium-stage.json'),JSON.stringify({title,name:'Escape'}));
  try { let reason; assert.deepEqual(await pickDesktopElement(title,abort.signal,data=>{reason=data?.cancelReason;}),{cancelled:true});assert.equal(reason,'escape');results.push({name:'Escape',passed:true}); }
  catch(error){results.push({name:'Escape',passed:false,error:String(error)});}save();
  win.destroy();app.quit();
}).catch(error=>{fs.writeFileSync(path.join(__dirname,'chromium-fatal.txt'),String(error.stack||error));app.exit(1);});
