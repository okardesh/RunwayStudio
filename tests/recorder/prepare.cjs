const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const destination = path.resolve(process.argv[2] || 'work/recorder-test-app');
fs.mkdirSync(destination, { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'renderer.tsx')], bundle: true, outfile: path.join(destination, 'renderer.js'), platform: 'browser', jsx: 'automatic' });
esbuild.buildSync({ entryPoints: [path.resolve('src/components/Recorder/recorderScript.ts')], bundle: true, outfile: path.join(destination, 'recorder-script.cjs'), platform: 'node', format: 'cjs' });
esbuild.buildSync({ entryPoints: [path.resolve('electron/automation/picker.ts')], bundle: true, outfile: path.join(destination, 'desktop-picker.cjs'), platform: 'node', format: 'cjs' });
fs.writeFileSync(path.join(destination, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
fs.copyFileSync(path.join(__dirname, 'run.cjs'), path.join(destination, 'main.cjs'));
fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({ name: 'runway-recorder-tests', main: 'main.cjs' }));
const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
if (fs.existsSync(compiler)) require('node:child_process').execFileSync(compiler,
  ['/nologo', '/target:winexe', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/out:' + path.join(destination, 'native-fixture.exe'), path.join(__dirname, 'NativeFixture.cs')], { stdio: 'inherit' });
console.log(destination);

if (process.argv.includes('--session')) {
  fs.copyFileSync(path.join(__dirname, 'session-run.cjs'), path.join(destination, 'main.cjs'));
  fs.writeFileSync(path.join(destination, 'session-preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{executeActivity:(id,props)=>ipcRenderer.invoke('execute',id,props)});");
  esbuild.buildSync({ entryPoints: [path.resolve('electron/automation/browser.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['playwright-core'], outfile: path.join(destination, 'browser-engine.cjs') });
  const enginePath = path.join(destination, 'browser-engine.cjs');
  fs.writeFileSync(enginePath, fs.readFileSync(enginePath,'utf8').replace('import("playwright-core")', 'Promise.resolve(require(' + JSON.stringify(require.resolve('playwright-core')) + '))'));
}
