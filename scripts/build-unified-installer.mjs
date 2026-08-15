import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commandExtension = process.platform === 'win32' ? '.cmd' : '';
const architectures = [
  { name: 'x64', payloadDirectory: 'win-unpacked' },
  { name: 'arm64', payloadDirectory: 'win-arm64-unpacked' },
];
const requestedArchitecture = process.argv[2];
const selectedArchitectures = requestedArchitecture
  ? architectures.filter((architecture) => architecture.name === requestedArchitecture)
  : architectures;

if (!selectedArchitectures.length) throw new Error(`Unsupported Windows architecture: ${requestedArchitecture}`);

function run(command, args) {
  execFileSync(command, args, { cwd: root, shell: process.platform === 'win32', stdio: 'inherit' });
}

run(npm, ['run', 'generate:icon']);
run(npm, ['run', 'build']);
run(npm, ['--prefix', 'Robot', 'run', 'build']);

const localAppData = process.env.LOCALAPPDATA;
const candidates = localAppData
  ? [
      path.join(localAppData, 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1', 'makensis.exe'),
      path.join(localAppData, 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1', 'Bin', 'makensis.exe'),
    ]
  : [];
const makensis = candidates.find(existsSync);

if (!makensis) throw new Error('NSIS compiler was not found. Run an electron-builder NSIS package once to download it.');

for (const architecture of selectedArchitectures) {
  run(npm, ['install', '--no-save', '--force', `--cpu=${architecture.name}`, '--os=win32']);
  run(npm, ['--prefix', 'Robot', 'install', '--no-save', '--force', `--cpu=${architecture.name}`, '--os=win32']);
  run(path.join(root, 'node_modules', '.bin', `electron-builder${commandExtension}`), ['--win', 'dir', `--${architecture.name}`]);
  run(path.join(root, 'Robot', 'node_modules', '.bin', `electron-builder${commandExtension}`), ['--win', 'dir', `--${architecture.name}`]);
  run(makensis, [
    `/DARCH=${architecture.name}`,
    `/DPAYLOAD_DIR=${architecture.payloadDirectory}`,
    path.join(root, 'build', 'unified-installer.nsi'),
  ]);
}

if (selectedArchitectures.some((architecture) => architecture.name !== 'arm64')) {
  run(npm, ['install', '--no-save', '--force', '--cpu=arm64', '--os=win32']);
  run(npm, ['--prefix', 'Robot', 'install', '--no-save', '--force', '--cpu=arm64', '--os=win32']);
}