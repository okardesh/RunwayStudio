import { runBrowserActivity } from './browser.js';
import { runDesktopActivity } from './desktop.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Activities handled by the browser Playwright engine
const BROWSER_ACTIVITIES = new Set([
  'use-app-browser','open-browser','close-browser','navigate-to','navigate-back','navigate-forward','refresh-page',
  'open-new-tab','close-tab','switch-tab','switch-frame','switch-default-content',
  'accept-alert','dismiss-alert','maximize-window','execute-javascript',
  'click','double-click','right-click','hover','type-into','clear-text','send-hotkey',
  'select-option','check-checkbox','drag-drop','scroll-to','scroll-page','upload-file',
  'focus-element','take-screenshot',
  'get-text','get-attribute','get-value','get-inner-html','get-element-count',
  'get-page-title','get-page-url','get-all-text','extract-table','find-elements',
  'wait-element','wait-element-vanish','wait-page-load','wait-text','element-exists',
  'assert-text','assert-title','assert-url',
]);

// Activities routed to the Windows desktop / PowerShell engine
const DESKTOP_ACTIVITIES = new Set([
  'desktop-click','desktop-type','desktop-get-text','desktop-screenshot',
]);

type Result = { success: boolean; log: string; outputs?: Record<string, unknown> };

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function executeActivity(
  id: string,
  props: Record<string, unknown>
): Promise<Result> {
  try {
    // System / data activities — handled inline (no external engine needed)
    switch (id) {
      case 'write-line':
        return { success: true, log: String(props.text ?? '') };
      case 'log-message':
        return { success: true, log: `[${props.level ?? 'Info'}] ${props.message ?? ''}` };
      case 'delay':
        await new Promise(r => setTimeout(r, Number(props.duration ?? 1000)));
        return { success: true, log: `Delayed ${props.duration ?? 1000} ms` };
      case 'assign':
        return { success: true, log: `${props.to} = ${props.value}`, outputs: { [String(props.to ?? '_')]: props.value } };
      case 'throw':
        return { success: false, log: String(props.message ?? 'Workflow error') };
      case 'create-folder': {
        const folder = String(props.path ?? '');
        fs.mkdirSync(folder, { recursive: true });
        return { success: true, log: `Created folder ${folder}` };
      }
      case 'get-files': {
        const folder = String(props.folder ?? '');
        const pattern = String(props.filter ?? '*.*');
        const matcher = new RegExp(`^${pattern.replace(/[.+^${}()|[\\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
        const files = fs.readdirSync(folder, { withFileTypes: true })
          .filter((entry) => entry.isFile() && matcher.test(entry.name))
          .map((entry) => path.join(folder, entry.name));
        return { success: true, log: `Found ${files.length} file${files.length === 1 ? '' : 's'} in ${folder}`, outputs: { [String(props.output ?? 'files')]: files } };
      }
      case 'copy-file':
        fs.copyFileSync(String(props.source ?? ''), String(props.destination ?? ''), props.overwrite ? 0 : fs.constants.COPYFILE_EXCL);
        return { success: true, log: `Copied ${props.source} to ${props.destination}` };
      case 'move-file': {
        const source = String(props.source ?? '');
        const destination = String(props.destination ?? '');
        if (props.overwrite && fs.existsSync(destination)) fs.rmSync(destination);
        fs.renameSync(source, destination);
        return { success: true, log: `Moved ${source} to ${destination}` };
      }
      case 'delete-file': {
        const filePath = String(props.path ?? '');
        fs.rmSync(filePath);
        return { success: true, log: `Deleted ${filePath}` };
      }
      case 'read-file': {
        const content = fs.readFileSync(String(props.path), { encoding: (props.encoding as any) ?? 'utf8' });
        return { success: true, log: `Read ${props.path}`, outputs: { [String(props.output ?? 'content')]: content } };
      }
      case 'write-file':
        fs.writeFileSync(String(props.path), String(props.content ?? ''), { encoding: 'utf8', flag: props.append ? 'a' : 'w' });
        return { success: true, log: `Wrote ${props.path}` };
      case 'read-csv': {
        const rows = parseCsv(fs.readFileSync(String(props.path), 'utf8'));
        const hasHeaders = props.hasHeaders !== false;
        const headers = hasHeaders ? (rows.shift() ?? []) : [];
        const data = rows.map((row) => hasHeaders
          ? Object.fromEntries(row.map((value, index) => [headers[index] || `Column${index + 1}`, value]))
          : row);
        return { success: true, log: `Read ${data.length} CSV row${data.length === 1 ? '' : 's'}`, outputs: { [String(props.output ?? 'csvData')]: data } };
      }
      case 'write-csv': {
        if (!Array.isArray(props.data)) throw new Error('Table Variable must contain a list of rows');
        const rows = props.data as unknown[];
        const objectRows = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
        const headers = objectRows.length ? [...new Set(objectRows.flatMap((row) => Object.keys(row)))] : [];
        const serializedRows = rows.map((row) => {
          const values = Array.isArray(row) ? row : headers.map((header) => (row as Record<string, unknown>)[header]);
          return values.map(csvCell).join(',');
        });
        const content = [props.includeHeaders !== false && headers.length ? headers.map(csvCell).join(',') : '', ...serializedRows]
          .filter((row) => row !== '').join('\r\n');
        fs.writeFileSync(String(props.path), content, 'utf8');
        return { success: true, log: `Wrote ${rows.length} CSV row${rows.length === 1 ? '' : 's'} to ${props.path}` };
      }
      case 'http-request': {
        const res = await fetch(String(props.url ?? ''), {
          method: String(props.method ?? 'GET'),
          body: props.body ? String(props.body) : undefined,
        });
        const body = await res.text();
        return { success: true, log: `${props.method ?? 'GET'} ${props.url} → ${res.status}`, outputs: { [String(props.output ?? 'response')]: body } };
      }
      case 'json-deserialize': {
        const obj = JSON.parse(String(props.jsonString ?? '{}'));
        return { success: true, log: 'JSON deserialized', outputs: { [String(props.output ?? 'jsonObject')]: obj } };
      }
    }

    // Detect if selector (or, for the container step itself, the indicated target) is a desktop window
    const sel = String(props.selector ?? props.source ?? '');
    const isDesktop = sel.startsWith('window:') || DESKTOP_ACTIVITIES.has(id) || props.targetType === 'desktop';

    if (!isDesktop && BROWSER_ACTIVITIES.has(id)) {
      return await runBrowserActivity(id, props);
    }

    if (isDesktop || DESKTOP_ACTIVITIES.has(id)) {
      return await runDesktopActivity(id, props);
    }

    return { success: true, log: `(simulated) ${id}` };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return { success: false, log: `✗ ${msg}` };
  }
}
