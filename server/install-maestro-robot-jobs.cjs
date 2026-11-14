// Apply only to an explicitly supplied Maestro checkout. No workflow or user data files are read/written.
const fs = require('node:fs'), path = require('node:path');
const directory = process.argv[2];
const updating = process.argv.includes('--update');
if (!directory) throw Error('Usage: node server/install-maestro-robot-jobs.cjs <Maestro source directory>');
const file = path.resolve(directory, 'script_server.py'), target = path.resolve(directory, 'maestro_robot_jobs.py');
let source = fs.readFileSync(file, 'utf8');
// Maestro's RPA UI runs on a separate local port and authenticates asset requests by key.
source = source.replace('Content-Type, Authorization, X-Tenant-Id', 'Content-Type, Authorization, X-API-Key, X-Tenant-Id');
const moduleText = fs.readFileSync(path.join(__dirname, 'maestro_robot_jobs.py'), 'utf8');
const assetsTarget = path.resolve(directory, 'maestro_assets.py');
const assetsText = fs.readFileSync(path.join(__dirname, 'maestro_assets.py'), 'utf8');
if (!updating && fs.existsSync(assetsTarget) && fs.readFileSync(assetsTarget, 'utf8') !== assetsText) throw Error('An existing maestro_assets.py differs. Review it before installing, then use --update.');
if (!updating && fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== moduleText) throw Error('An existing maestro_robot_jobs.py differs. Review it before installing, then use --update.');
const pagePath = path.resolve(directory, 'src/components/RpaProcessesPage.jsx');
const uiPath = path.resolve(directory, 'src/components/MaestroAssets.jsx');
const uiText = fs.readFileSync(path.join(__dirname, 'maestro_ui/MaestroAssets.jsx'), 'utf8');
if (!updating && fs.existsSync(uiPath) && fs.readFileSync(uiPath, 'utf8') !== uiText) throw Error('An existing MaestroAssets.jsx differs. Review it before updating.');
let page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : null;
if (page && !page.includes('import MaestroAssets')) {
  const imports = 'import RobotsPage from "./RobotsPage";';
  const tab = "{ id: 'robots', label: 'Robots' },";
  const render = "activeTab === 'robots' ? <RobotsPage /> : (";
  if (!page.includes(imports) || !page.includes(tab) || !page.includes(render)) throw Error('Unrecognized Maestro RPA page. No files were changed.');
  page = page.replace(imports, imports + '\nimport MaestroAssets from "./MaestroAssets";').replace(tab, tab + "\n            { id: 'assets', label: 'Assets & Credentials' },").replace(render, "activeTab === 'robots' ? <RobotsPage /> : activeTab === 'assets' ? <MaestroAssets apiBase={API_BASE} /> : (");
}
if (!source.includes('import maestro_robot_jobs')) {
  for (const method of ['GET', 'POST']) {
    const expression = new RegExp(`(^[ \\t]+)if context_repository\\.handle\\(self, '${method}', parsed\\):`, 'm');
    if (!expression.test(source)) throw Error('Unrecognized Maestro handler layout. No files were changed.');
    source = source.replace(expression, (_full, indent) => `${indent}if maestro_robot_jobs.handle(self, '${method}', parsed, globals()):\n${indent}    return\n${indent}if context_repository.handle(self, '${method}', parsed):`);
  }
  // Insert after an ordinary import, preserving future-import placement.
  if (!/^import department_store\r?$/m.test(source)) throw Error('Unrecognized Maestro imports. No files were changed.');
  source = source.replace(/^import department_store\r?$/m, 'import department_store\nimport maestro_robot_jobs');
}
fs.writeFileSync(assetsTarget, assetsText); fs.writeFileSync(target, moduleText); fs.writeFileSync(file, source);
if (page) { fs.writeFileSync(uiPath, uiText); fs.writeFileSync(pagePath, page); }
console.log('Installed Robot Jobs routes in ' + file + '. Restart/rebuild Maestro to activate them.');
