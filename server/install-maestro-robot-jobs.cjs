// Apply only to an explicitly supplied Maestro checkout. No workflow or user data files are read/written.
const fs = require('node:fs'), path = require('node:path');
const directory = process.argv[2];
if (!directory) throw Error('Usage: node server/install-maestro-robot-jobs.cjs <Maestro source directory>');
const file = path.resolve(directory, 'script_server.py'), target = path.resolve(directory, 'maestro_robot_jobs.py');
let source = fs.readFileSync(file, 'utf8');
const moduleText = fs.readFileSync(path.join(__dirname, 'maestro_robot_jobs.py'), 'utf8');
if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== moduleText) throw Error('An existing maestro_robot_jobs.py differs. Review it before installing.');
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
fs.writeFileSync(target, moduleText); fs.writeFileSync(file, source);
console.log('Installed Robot Jobs routes in ' + file + '. Restart/rebuild Maestro to activate them.');
