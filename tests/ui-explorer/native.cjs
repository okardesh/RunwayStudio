const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),e=require('./engine.cjs');
app.setPath('userData',path.join(__dirname,'native-profile'));
app.whenReady().then(async()=>{
 let win;
 try {
  const title='Runway Explorer Fixture '+process.pid;
  win=new BrowserWindow({width:800,height:600,title});win.setMenu(null);
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<title>${title}</title><style>body{font:24px sans-serif;padding:40px}button,input,div{display:block;margin:14px 0;padding:10px}</style><button id="contact" aria-label="Esra 1 unread message" onclick="window.clicks=(window.clicks||0)+1;this.setAttribute('aria-label','Esra');document.getElementById('result').textContent='Esra'">Open contact</button><div id="result">Waiting</div><label>Password<input type="password" aria-label="Password" value="PROTECTED-FIXTURE-VALUE"></label>`));
  win.show();win.focus();await new Promise(resolve=>setTimeout(resolve,500));
  console.log('Fixture window: '+win.getTitle()+' visible='+win.isVisible());
  const selector=(name,type='Button',mode)=>'window:'+title+' > msaa:'+Buffer.from(JSON.stringify({name,controlType:type,...(mode?{nameMatch:mode}:{})})).toString('base64');
  const cases=[];
  for(const count of [1,2,12,0]) {
   await win.webContents.executeJavaScript('document.getElementById("contact").setAttribute("aria-label",'+JSON.stringify(count?'Esra '+count+' unread '+(count===1?'message':'messages'):'Esra')+');document.getElementById("result").textContent="Waiting"');
   const click=await e.runDesktopActivity('click',{selector:selector('Esra 1 unread message')});assert.equal(click.success,true,click.log);
   const read=await e.runDesktopActivity('get-text',{selector:selector('Esra','Text'),output:'textResult'});assert.equal(read.success,true,read.log);assert.equal(read.outputs.textResult,'Esra');
   cases.push({count,text:read.outputs.textResult});console.log('PASS Native Click → Get Text with unread count '+count);
  }
  const tree=await e.inspectUi(title,'msaa');
  assert.ok(tree.nodes.some(n=>n.name==='Esra'&&n.controlType==='Button'));assert.ok(tree.nodes.some(n=>n.parentId!==null));assert.ok(!JSON.stringify(tree).includes('PROTECTED-FIXTURE-VALUE'));assert.ok(tree.nodes.some(n=>n.protected));assert.ok(tree.nodes.filter(n=>n.protected).every(n=>!n.selector));
  await e.validateUiSelector(selector('Esra'),true);
  await win.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<button aria-label="Esra 9 unread messages">Duplicate</button>')`);
  const before=await win.webContents.executeJavaScript('window.clicks');
  const ambiguous=await e.runDesktopActivity('click',{selector:selector('Esra')});assert.equal(ambiguous.success,false);assert.match(ambiguous.log,/ambiguous/i);assert.equal(await win.webContents.executeJavaScript('window.clicks'),before);
  assert.ok((await e.validateUiSelector(selector('Esra','Button','Exact'))).ok);
  const wrong=await e.runDesktopActivity('get-text',{selector:selector('Esra','Hyperlink')});assert.equal(wrong.success,false);
  const unrelated=await e.runDesktopActivity('get-text',{selector:selector('Esra 12 meetings')});assert.equal(unrelated.success,false);
  const uia=await e.inspectUi(title,'uia');assert.ok(uia.nodes.length);assert.ok(!JSON.stringify(uia).includes('PROTECTED-FIXTURE-VALUE'));
  fs.writeFileSync(path.join(__dirname,'native-result.json'),JSON.stringify({cases,msaaNodes:tree.nodes.length,uiaNodes:uia.nodes.length,ambiguityBlocked:true,unrelatedNameBlocked:true,protectedValuesExcluded:true},null,2));
  console.log('PASS Native hierarchy/attributes, highlighting, protected fields, wrong role/name rejection and ambiguity without clicking');
 }finally{if(win)win.destroy();app.quit()}
}).catch(error=>{fs.writeFileSync(path.join(__dirname,'native-error.txt'),String(error.stack||error));console.error(error);app.exit(1)});
