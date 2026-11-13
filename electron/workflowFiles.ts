import fs from 'node:fs/promises';
import path from 'node:path';

/** Read-only resolver shared by Invoke execution, its argument editor and Analyzer. */
export async function readInvokedWorkflow(requested: string, callerPath: string | null) {
  if (typeof requested !== 'string' || !requested.trim() || requested.length > 32768 || !requested.toLowerCase().endsWith('.rpa.json')) throw Error('Select a Studio .rpa.json workflow file.');
  if (!path.isAbsolute(requested) && (!callerPath || !path.isAbsolute(callerPath))) throw Error('Save the calling workflow or choose an absolute workflow path.');
  const resolved = await fs.realpath(path.isAbsolute(requested) ? requested : path.resolve(path.dirname(callerPath!), requested));
  const info = await fs.stat(resolved);
  if (!info.isFile() || info.size > 5_000_000) throw Error('Workflow must be a file of at most 5 MB.');
  return { path: resolved, content: await fs.readFile(resolved, 'utf8') };
}
