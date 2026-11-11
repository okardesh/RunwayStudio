const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync,spawn}=require('node:child_process');
const dest=fs.mkdtempSync(path.join(os.tmpdir(),'runway-connection-tests-'));
execFileSync(process.execPath,[path.join(__dirname,'prepare.cjs'),dest],{stdio:'inherit'});
execFileSync(process.execPath,[path.join(dest,'node-run.cjs')],{stdio:'inherit'});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[dest],{env,stdio:'inherit'});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{
 const file=path.join(dest,'electron-summary.json');const summary=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 if(summary)console.log(JSON.stringify(summary,null,2));console.log('Results: '+dest);
 process.exitCode=code||!summary||summary.failed?1:0;
});
