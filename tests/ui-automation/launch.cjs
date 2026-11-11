const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,execFileSync}=require('node:child_process');
const uia=process.argv.includes('--uia-selection'),native=process.argv.includes('--native')||uia;
const destination=fs.mkdtempSync(path.join(os.tmpdir(),'runway-ui-tests-'));
execFileSync(process.execPath,[path.join(__dirname,'prepare.cjs'),destination,...(native?['--native']:[]),...(uia?['--uia-selection']:[])],{stdio:'inherit'});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[destination],{env,stdio:'inherit'});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{
 const kind=native?'native':'browser',file=path.join(destination,kind+'-summary.json');
 const summary=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 if(summary)console.log(JSON.stringify(summary,null,2));
 console.log('Results: '+destination);
 process.exitCode=code||!summary||summary.failed?1:0;
});
