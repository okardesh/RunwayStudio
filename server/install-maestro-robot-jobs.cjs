// Apply only to an explicitly supplied Maestro checkout. No workflow or user data files are read/written.
const fs = require('node:fs'), path = require('node:path');
const directory = process.argv[2];
const updating = process.argv.includes('--update');
if (!directory) throw Error('Usage: node server/install-maestro-robot-jobs.cjs <Maestro source directory>');
const file = path.resolve(directory, 'script_server.py'), target = path.resolve(directory, 'maestro_robot_jobs.py');
let source = fs.readFileSync(file, 'utf8');
// Maestro's RPA UI runs on a separate local port and authenticates asset requests by key.
source = source.replace('Content-Type, Authorization, X-Tenant-Id', 'Content-Type, Authorization, X-API-Key, X-Tenant-Id');
if (!source.includes('X-Runway-Queue-Session')) source = source.replace('Content-Type, Authorization, X-API-Key,', 'Content-Type, Authorization, X-API-Key, X-Runway-Queue-Session,');
if (!source.includes('X-Runway-Task-Token')) source = source.replace('Content-Type, Authorization, X-API-Key,', 'Content-Type, Authorization, X-API-Key, X-Runway-Task-Token,');
const moduleText = fs.readFileSync(path.join(__dirname, 'maestro_robot_jobs.py'), 'utf8');
const assetsTarget = path.resolve(directory, 'maestro_assets.py');
const assetsText = fs.readFileSync(path.join(__dirname, 'maestro_assets.py'), 'utf8');
const queuesTarget = path.resolve(directory, 'maestro_queues.py');
const queuesText = fs.readFileSync(path.join(__dirname, 'maestro_queues.py'), 'utf8');
const humanTarget = path.resolve(directory, 'maestro_human_tasks.py'), humanText = fs.readFileSync(path.join(__dirname, 'maestro_human_tasks.py'), 'utf8');
const humanUiPath = path.resolve(directory, 'src/components/MaestroHumanTasks.jsx'), humanUiText = fs.readFileSync(path.join(__dirname, 'maestro_ui/MaestroHumanTasks.jsx'), 'utf8');
for (const [file, text] of [[humanTarget, humanText], [humanUiPath, humanUiText]]) if (!updating && fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text) throw Error('Existing human task files differ. Review before --update.');
if (!updating && fs.existsSync(queuesTarget) && fs.readFileSync(queuesTarget, 'utf8') !== queuesText) throw Error('An existing maestro_queues.py differs. Review it before updating.');
if (!updating && fs.existsSync(assetsTarget) && fs.readFileSync(assetsTarget, 'utf8') !== assetsText) throw Error('An existing maestro_assets.py differs. Review it before installing, then use --update.');
if (!updating && fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== moduleText) throw Error('An existing maestro_robot_jobs.py differs. Review it before installing, then use --update.');
const pagePath = path.resolve(directory, 'src/components/RpaProcessesPage.jsx');
const uiPath = path.resolve(directory, 'src/components/MaestroAssets.jsx');
const uiText = fs.readFileSync(path.join(__dirname, 'maestro_ui/MaestroAssets.jsx'), 'utf8');
const queueUiPath = path.resolve(directory, 'src/components/MaestroQueues.jsx');
const queueUiText = fs.readFileSync(path.join(__dirname, 'maestro_ui/MaestroQueues.jsx'), 'utf8');
if (!updating && fs.existsSync(queueUiPath) && fs.readFileSync(queueUiPath, 'utf8') !== queueUiText) throw Error('An existing MaestroQueues.jsx differs. Review it before updating.');
if (!updating && fs.existsSync(uiPath) && fs.readFileSync(uiPath, 'utf8') !== uiText) throw Error('An existing MaestroAssets.jsx differs. Review it before updating.');
let page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : null;
if (page && !page.includes('import MaestroAssets')) {
  const imports = 'import RobotsPage from "./RobotsPage";';
  const tab = "{ id: 'robots', label: 'Robots' },";
  const render = "activeTab === 'robots' ? <RobotsPage /> : (";
  if (!page.includes(imports) || !page.includes(tab) || !page.includes(render)) throw Error('Unrecognized Maestro RPA page. No files were changed.');
  page = page.replace(imports, imports + '\nimport MaestroAssets from "./MaestroAssets";').replace(tab, tab + "\n            { id: 'assets', label: 'Assets & Credentials' },").replace(render, "activeTab === 'robots' ? <RobotsPage /> : activeTab === 'assets' ? <MaestroAssets apiBase={API_BASE} /> : (");
}
if (page && !page.includes('import MaestroQueues')) {
  const anchor = 'import MaestroAssets from "./MaestroAssets";';
  const tab = "{ id: 'assets', label: 'Assets & Credentials' },";
  const render = "activeTab === 'robots' ? <RobotsPage /> :";
  if (!page.includes(anchor) || !page.includes(tab) || !page.includes(render)) throw Error('Unrecognized Maestro RPA page. No files were changed.');
  page = page.replace(anchor, anchor + '\nimport MaestroQueues from "./MaestroQueues";').replace(tab, tab + "\n            { id: 'queues', label: 'Queues' },").replace(render, render + " activeTab === 'queues' ? <MaestroQueues apiBase={API_BASE} /> :");
}
if (page && !page.includes('import MaestroHumanTasks')) {
  const anchor = 'import MaestroQueues from "./MaestroQueues";', tab = "{ id: 'queues', label: 'Queues' },", render = "activeTab === 'queues' ? <MaestroQueues apiBase={API_BASE} /> :";
  if (!page.includes(anchor) || !page.includes(tab) || !page.includes(render)) throw Error('Unrecognized Maestro RPA page. No files changed.');
  page = page.replace(anchor, anchor + '\nimport MaestroHumanTasks from "./MaestroHumanTasks";').replace(tab, tab + "\n            { id: 'human', label: 'Human Tasks' },").replace(render, render + " activeTab === 'human' ? <MaestroHumanTasks apiBase={API_BASE} /> :");
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
fs.writeFileSync(assetsTarget, assetsText); fs.writeFileSync(queuesTarget, queuesText); fs.writeFileSync(target, moduleText); fs.writeFileSync(file, source);
fs.writeFileSync(humanTarget, humanText);
if (page) { fs.writeFileSync(uiPath, uiText); fs.writeFileSync(queueUiPath, queueUiText); fs.writeFileSync(humanUiPath, humanUiText); fs.writeFileSync(pagePath, page); }
console.log('Installed Robot Jobs routes in ' + file + '. Restart/rebuild Maestro to activate them.');
