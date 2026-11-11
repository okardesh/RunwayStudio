const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const dest=path.resolve(process.argv[2]);fs.mkdirSync(dest,{recursive:true});
for(const [entry,out] of [['electron/automation/index.ts','engine.cjs'],['src/activities/registry.ts','registry.cjs']]){
 esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:path.join(dest,out)});
 const file=path.join(dest,out);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('import("playwright-core")','Promise.resolve(require('+JSON.stringify(require.resolve('playwright-core'))+'))'));
}
fs.copyFileSync(path.join(__dirname,'browser-run.cjs'),path.join(dest,'main.cjs'));
fs.writeFileSync(path.join(dest,'node-modules-path.json'),JSON.stringify(path.resolve('node_modules')));
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'runway-ui-automation-tests',main:'main.cjs'}));
if(process.argv.includes('--native')){
 fs.copyFileSync(path.join(__dirname,'native-run.cjs'),path.join(dest,'main.cjs'));
 const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const uia=process.argv.includes('--uia-selection');
 const references=uia?['System.Xaml.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(name=>path.join(path.dirname(compiler),'WPF',name))]:['System.Windows.Forms.dll','System.Drawing.dll'];
 require('node:child_process').execFileSync(compiler,['/nologo','/target:winexe',...references.map(name=>'/reference:'+name),'/reference:System.Web.Extensions.dll','/out:'+path.join(dest,'native-fixture.exe'),path.join(__dirname,uia?'WpfSelectionFixture.cs':'NativeFixture.cs')],{stdio:'inherit'});
 if(uia)fs.writeFileSync(path.join(dest,'uia-selection.flag'),'');
}
console.log(dest);
