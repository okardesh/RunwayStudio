import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commandExtension = process.platform === 'win32' ? '.cmd' : '';

function run(command, args) {
  execFileSync(command, args, { cwd: root, shell: process.platform === 'win32', stdio: 'inherit' });
}

run(npm, ['run', 'build']);
run(npm, ['--prefix', 'Robot', 'run', 'build']);
run(path.join(root, 'node_modules', '.bin', `electron-builder${commandExtension}`), ['--win', 'dir', '--arm64']);
run(path.join(root, 'Robot', 'node_modules', '.bin', `electron-builder${commandExtension}`), ['--win', 'dir', '--arm64']);

const localAppData = process.env.LOCALAPPDATA;
const candidates = localAppData
  ? [
      path.join(localAppData, 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1', 'makensis.exe'),
      path.join(localAppData, 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1', 'Bin', 'makensis.exe'),
    ]
  : [];
const makensis = candidates.find(existsSync);

if (!makensis) throw new Error('NSIS compiler was not found. Run an electron-builder NSIS package once to download it.');

run(makensis, [path.join(root, 'build', 'unified-installer.nsi')]);