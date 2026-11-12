const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-log-message-'));
for (const [source, dest] of [['src/engine/executor.ts', 'executor.cjs'], ['src/shared/logMessageExpression.ts', 'expressions.cjs'], ['electron/automation/index.ts', 'engine.cjs']]) {
  esbuild.buildSync({ entryPoints: [path.join(root, source)], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: path.join(out, dest) });
}
const enginePath = path.join(out, 'engine.cjs');
fs.writeFileSync(enginePath, fs.readFileSync(enginePath, 'utf8').replaceAll('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><meta charset="utf-8"><div id="value">Merhaba İstanbul 42</div><div id="braces">{{other}}</div>');
fs.writeFileSync(path.join(out, 'main.cjs'), `
const {app}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_PATH=${JSON.stringify(path.join(root, 'node_modules'))};require('node:module').Module._initPaths();
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
global.crypto ||= require('node:crypto').webcrypto;
const memory=new Map();global.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const {executeActivity}=require('./engine.cjs');const messages=[],calls=[];
global.window={electronAPI:{executeActivity:async(id,props)=>{calls.push({id,props});const result=await executeActivity(id,props);if(id==='log-message')messages.push(result.log);return result;}}};
const {executeWorkflow}=require('./executor.cjs');const {resolveLogMessage}=require('./expressions.cjs');
const node=(id,activityId,properties,data={})=>({id,position:{x:0,y:0},data:{activityId,label:id,properties,...data}});
app.whenReady().then(async()=>{
const values={textResult:'Extracted value',zero:0,flag:false,empty:null,other:'NEVER_REEVALUATE'};
const cases=[['textResult','Extracted value'],[' textResult ','Extracted value'],['{{textResult}}','Extracted value'],['Value: {{textResult}}','Value: Extracted value'],['"textResult"','textResult'],["'textResult'",'textResult'],['unknown','unknown'],['textResult.ToUpper()','EXTRACTED VALUE'],['zero','0'],['flag','false'],['empty',''],['{{missing}}','{{missing}}'],['toString','toString']];
for(const [input,expected]of cases)assert.equal(resolveLogMessage(input,values),expected,input);
const url=require('node:url').pathToFileURL(path.join(__dirname,'fixture.html')).href;
const messagesToTest=['textResult','{{textResult}}','Sonuç: {{textResult}}','"textResult"','textResult.ToUpper()'];
const nodes=[node('browser','use-app-browser',{url,headless:true},{isContainer:true,childIds:['read']}),node('read','get-text',{selector:'#value',output:'textResult'},{parentId:'browser'}),...messagesToTest.map((message,i)=>node('log-'+i,'log-message',{message})),node('read-braces','get-text',{selector:'#braces',output:'textResult'}),node('log-braces','log-message',{message:'textResult'}),node('log-template-braces','log-message',{message:'{{textResult}}'}),node('close','close-browser',{})];
const variables=[{id:'v',name:'textResult',type:'String',defaultValue:'',scope:'Main'},{id:'o',name:'other',type:'String',defaultValue:'NEVER_REEVALUATE',scope:'Main'}];
const result=await executeWorkflow(nodes,[],variables,()=>{},()=>{},()=>{},{projectName:'Get Text to Log Message regression'});
assert.equal(result,'completed');
assert.deepEqual(messages,['[Info] Merhaba İstanbul 42','[Info] Merhaba İstanbul 42','[Info] Sonuç: Merhaba İstanbul 42','[Info] textResult','[Info] MERHABA İSTANBUL 42','[Info] {{other}}','[Info] {{other}}']);
assert.ok(calls.filter(c=>c.id==='get-text').every(c=>c.props.output==='textResult'),'Output targets must remain variable names');
const summary={passed:true,expressionCases:cases.length,realBrowserGetTextToLogMessage:true,verifiedMessages:messages,outputTargetsPreserved:true};fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));app.exit(0);
}).catch(async error=>{try{await executeActivity('close-browser',{})}catch{}console.error(error);app.exit(1)});
`);
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [out], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) console.error(result.error);
console.log('Artifacts: ' + out);
process.exitCode = result.status === 0 ? 0 : 1;
