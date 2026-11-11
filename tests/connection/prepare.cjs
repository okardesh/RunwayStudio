const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const dest=path.resolve(process.argv[2]);fs.mkdirSync(dest,{recursive:true});
for(const [entry,out] of [['src/shared/runwayLicenseTransport.ts','transport.cjs'],['src/engine/runwayConnection.ts','connection.cjs'],['electron/runwayLicenseIpc.ts','license-ipc.cjs'],['electron/preload.ts','preload.cjs']])esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:path.join(dest,out)});
esbuild.buildSync({entryPoints:[path.join(__dirname,'renderer.tsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',outfile:path.join(dest,'renderer.js')});
for(const file of ['node-run.cjs','electron-run.cjs'])fs.copyFileSync(path.join(__dirname,file),path.join(dest,file));
fs.writeFileSync(path.join(dest,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'runway-connection-tests',main:'electron-run.cjs'}));
console.log(dest);
