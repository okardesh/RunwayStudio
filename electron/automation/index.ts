import { runBrowserActivity } from './browser.js';
import { runDesktopActivity } from './desktop.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

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
      case 'read-file': {
        const content = fs.readFileSync(String(props.path), { encoding: (props.encoding as any) ?? 'utf8' });
        return { success: true, log: `Read ${props.path}`, outputs: { [String(props.output ?? 'content')]: content } };
      }
      case 'write-file':
        fs.writeFileSync(String(props.path), String(props.content ?? ''), { encoding: 'utf8', flag: props.append ? 'a' : 'w' });
        return { success: true, log: `Wrote ${props.path}` };
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
