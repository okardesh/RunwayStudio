import { runBrowserActivity } from './browser.js';
import { runDesktopActivity } from './desktop.js';
import { execFile } from 'node:child_process';
import { dialog, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import Tesseract from 'tesseract.js';

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

async function openPdf(filePath: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  return pdfjs.getDocument({ data: bytes }).promise;
}

async function extractPdfText(filePath: string) {
  const document = await openPdf(filePath);
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str ?? '').join(' ').trim());
  }
  return pages.filter(Boolean).join('\n\n');
}

async function recognizePdfText(filePath: string, language: string) {
  const document = await openPdf(filePath);
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas: null, canvasContext: canvas.getContext('2d') as any, viewport }).promise;
    const result = await Tesseract.recognize(canvas.toBuffer('image/png'), language);
    pages.push(result.data.text.trim());
  }
  return pages.filter(Boolean).join('\n\n');
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function splitArguments(value: string) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((argument) => argument.replace(/^"|"$/g, '')) ?? [];
}

function normalizeScriptLanguage(requestedLanguage: string, scriptPath: string) {
  if (requestedLanguage !== 'Auto Detect') return requestedLanguage;
  switch (path.extname(scriptPath).toLowerCase()) {
    case '.ps1': return 'PowerShell';
    case '.py': return 'Python';
    case '.cs':
    case '.csx': return 'C#';
    default: throw new Error('Cannot detect script language. Select a language explicitly.');
  }
}

async function executeFile(command: string, argumentsList: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, argumentsList, { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim()));
        return;
      }
      resolve({ stdout: String(stdout).trim(), stderr: String(stderr).trim() });
    });
  });
}

async function executeScript(scriptPath: string, language: string, argumentText: string) {
  if (!fs.existsSync(scriptPath)) throw new Error(`Script file not found: ${scriptPath}`);
  const args = splitArguments(argumentText);
  if (language === 'PowerShell') return executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]);
  if (language === 'Python') {
    try {
      return await executeFile('py.exe', ['-3', scriptPath, ...args]);
    } catch (error) {
      if (!/ENOENT|not found/i.test(String(error))) throw error;
      return executeFile('python.exe', [scriptPath, ...args]);
    }
  }
  if (language === 'C#') return executeFile('dotnet-script', [scriptPath, ...args]);
  throw new Error(`Unsupported script language: ${language}`);
}

function graphUrl(graphPath: string) {
  return `https://graph.microsoft.com/v1.0${graphPath.startsWith('/') ? graphPath : `/${graphPath}`}`;
}

async function graphRequest(accessToken: string, graphPath: string, method = 'GET', body?: unknown) {
  if (!accessToken) throw new Error('A Microsoft 365 access token is required');
  const response = await fetch(graphUrl(graphPath), {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${await response.text()}`);
  return response;
}

async function connectMicrosoft365(tenantId: string, clientId: string, scopes: string) {
  if (!clientId) throw new Error('Application (Client) ID is required for Microsoft 365 sign-in');
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(tenantId || 'organizations')}/oauth2/v2.0`;
  const deviceResponse = await fetch(`${authority}/devicecode`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: scopes }),
  });
  if (!deviceResponse.ok) throw new Error(`Could not start Microsoft sign-in: ${await deviceResponse.text()}`);
  const device = await deviceResponse.json() as { device_code: string; user_code: string; verification_uri: string; message: string; expires_in: number; interval?: number };
  const choice = await dialog.showMessageBox({ type: 'info', title: 'Microsoft 365 sign-in', message: 'Sign in to Microsoft 365', detail: device.message, buttons: ['Open sign-in page', 'Cancel'], defaultId: 0, cancelId: 1 });
  if (choice.response === 1) throw new Error('Microsoft 365 sign-in was cancelled');
  await shell.openExternal(device.verification_uri);

  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(2, device.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await wait(interval);
    const tokenResponse = await fetch(`${authority}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: device.device_code }),
    });
    const token = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };
    if (token.access_token) return token.access_token;
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(token.error_description ?? token.error ?? 'Microsoft 365 sign-in failed');
  }
  throw new Error('Microsoft 365 sign-in timed out');
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
      case 'run-script-file': {
        const scriptPath = String(props.path ?? '');
        const language = normalizeScriptLanguage(String(props.language ?? 'Auto Detect'), scriptPath);
        const result = await executeScript(scriptPath, language, String(props.arguments ?? ''));
        const output = result.stdout || result.stderr;
        return { success: true, log: output ? `${language} script completed: ${output}` : `${language} script completed`, outputs: { [String(props.output ?? 'scriptOutput')]: output } };
      }
      case 'run-script-code': {
        const language = String(props.language ?? 'PowerShell');
        const extension = language === 'PowerShell' ? '.ps1' : language === 'Python' ? '.py' : '.csx';
        const scriptPath = path.join(os.tmpdir(), `runway-script-${Date.now()}-${Math.floor(Math.random() * 1e6)}${extension}`);
        fs.writeFileSync(scriptPath, String(props.code ?? ''), 'utf8');
        try {
          const result = await executeScript(scriptPath, language, String(props.arguments ?? ''));
          const output = result.stdout || result.stderr;
          return { success: true, log: output ? `${language} script completed: ${output}` : `${language} script completed`, outputs: { [String(props.output ?? 'scriptOutput')]: output } };
        } finally {
          fs.rmSync(scriptPath, { force: true });
        }
      }
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
      case 'read-pdf': {
        const text = await extractPdfText(String(props.path ?? ''));
        return { success: true, log: `Extracted ${text.length} characters from PDF`, outputs: { [String(props.output ?? 'pdfText')]: text } };
      }
      case 'ocr-image': {
        const result = await Tesseract.recognize(String(props.path ?? ''), String(props.language ?? 'eng'));
        const text = result.data.text.trim();
        return { success: true, log: `Recognized ${text.length} characters from image`, outputs: { [String(props.output ?? 'ocrText')]: text } };
      }
      case 'ocr-pdf': {
        const text = await recognizePdfText(String(props.path ?? ''), String(props.language ?? 'eng'));
        return { success: true, log: `Recognized ${text.length} characters from scanned PDF`, outputs: { [String(props.output ?? 'ocrText')]: text } };
      }
      case 'connect-m365': {
        const accessToken = await connectMicrosoft365(String(props.tenantId ?? 'organizations'), String(props.clientId ?? ''), String(props.scopes ?? 'User.Read'));
        return { success: true, log: 'Connected to Microsoft 365', outputs: { [String(props.output ?? 'm365Token')]: accessToken } };
      }
      case 'outlook-send-email': {
        const recipients = String(props.to ?? '').split(/[;,]/).map((address) => address.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } }));
        if (!recipients.length) throw new Error('At least one recipient is required');
        await graphRequest(String(props.accessToken ?? ''), '/me/sendMail', 'POST', { message: { subject: String(props.subject ?? ''), body: { contentType: String(props.bodyType ?? 'HTML'), content: String(props.body ?? '') }, toRecipients: recipients }, saveToSentItems: true });
        return { success: true, log: `Sent Outlook email to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}` };
      }
      case 'outlook-get-emails': {
        const folder = String(props.folder ?? 'Inbox');
        const folderPath = folder.toLowerCase() === 'inbox' ? 'inbox' : encodeURIComponent(folder);
        const limit = Math.max(1, Math.min(100, Number(props.limit ?? 25)));
        const response = await graphRequest(String(props.accessToken ?? ''), `/me/mailFolders/${folderPath}/messages?$top=${limit}&$select=id,subject,bodyPreview,receivedDateTime,from,isRead`);
        const payload = await response.json() as { value?: unknown[] };
        const emails = payload.value ?? [];
        return { success: true, log: `Read ${emails.length} Outlook email${emails.length === 1 ? '' : 's'}`, outputs: { [String(props.output ?? 'emails')]: emails } };
      }
      case 'onedrive-upload-file': {
        const localPath = String(props.localPath ?? '');
        const remotePath = String(props.remotePath ?? '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
        const response = await fetch(graphUrl(`/me/drive/root:/${remotePath}:/content`), { method: 'PUT', headers: { Authorization: `Bearer ${String(props.accessToken ?? '')}`, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(localPath) });
        if (!response.ok) throw new Error(`OneDrive upload ${response.status}: ${await response.text()}`);
        return { success: true, log: `Uploaded ${path.basename(localPath)} to OneDrive` };
      }
      case 'onedrive-download-file': {
        const remotePath = String(props.remotePath ?? '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
        const response = await graphRequest(String(props.accessToken ?? ''), `/me/drive/root:/${remotePath}:/content`);
        fs.writeFileSync(String(props.localPath ?? ''), Buffer.from(await response.arrayBuffer()));
        return { success: true, log: `Downloaded OneDrive file to ${props.localPath}` };
      }
      case 'm365-graph-request': {
        const body = String(props.body ?? '').trim();
        const response = await graphRequest(String(props.accessToken ?? ''), String(props.path ?? '/me'), String(props.method ?? 'GET'), body ? JSON.parse(body) : undefined);
        const contentType = response.headers.get('content-type') ?? '';
        const value = contentType.includes('application/json') ? await response.json() : await response.text();
        return { success: true, log: `Microsoft Graph ${props.method ?? 'GET'} ${props.path}`, outputs: { [String(props.output ?? 'graphResult')]: value } };
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
