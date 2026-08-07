/**
 * Playwright-based browser automation — uses the user's installed Chrome/Edge.
 * No browser download needed; we discover the executable at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';

// Lazily imported so the main process doesn't fail if playwright-core is missing
let pw: typeof import('playwright-core') | null = null;
async function getPw() {
  if (!pw) pw = await import('playwright-core');
  return pw;
}

let browser: import('playwright-core').Browser | null = null;
let page:    import('playwright-core').Page | null = null;

function findBrowser(preferred = 'Chrome'): string {
  const locs: Record<string, string[]> = {
    Chrome: [
      path.join(process.env.PROGRAMFILES        ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA         ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
    Edge: [
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(process.env.PROGRAMFILES         ?? '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ],
    Firefox: [
      path.join(process.env.PROGRAMFILES         ?? '', 'Mozilla Firefox\\firefox.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Mozilla Firefox\\firefox.exe'),
    ],
  };
  const candidates = [...(locs[preferred] ?? []), ...Object.values(locs).flat()];
  const found = candidates.find(p => p && fs.existsSync(p));
  if (!found) throw new Error(`No browser found. Install Chrome, Edge, or Firefox.`);
  return found;
}

type Result = { success: true; log: string; outputs?: Record<string, unknown> }
            | { success: false; log: string };

function p(props: Record<string, unknown>, key: string, fallback: unknown = '') {
  return props[key] ?? fallback;
}

export async function runBrowserActivity(
  id: string,
  props: Record<string, unknown>
): Promise<Result> {
  const { chromium, firefox } = await getPw();

  switch (id) {
    case 'use-app-browser':
    case 'open-browser': {
      const url      = String(p(props, 'url', 'about:blank'));
      const pref     = String(p(props, 'browser', 'Chrome'));
      const headless = Boolean(p(props, 'headless', false));
      const timeout  = Number(p(props, 'timeout', 30000));
      const exePath  = findBrowser(pref);
      if (browser) await browser.close().catch(() => {});
      const launcher = pref === 'Firefox' ? firefox : chromium;
      browser = await launcher.launch({ executablePath: exePath, headless, args: ['--start-maximized'] });
      const ctx = await browser.newContext({ viewport: null });
      page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return { success: true, log: `Opened ${pref} → ${url}` };
    }

    case 'close-browser':
      await browser?.close(); browser = null; page = null;
      return { success: true, log: 'Browser closed' };

    case 'navigate-to': {
      if (!page) throw new Error('No browser open — use Open Browser first');
      await page.goto(String(p(props, 'url')), { waitUntil: (p(props, 'waitUntil') as any) || 'load' });
      return { success: true, log: `Navigated → ${p(props, 'url')}` };
    }
    case 'navigate-back':
      if (!page) throw new Error('No browser open'); await page.goBack();
      return { success: true, log: 'Back' };
    case 'navigate-forward':
      if (!page) throw new Error('No browser open'); await page.goForward();
      return { success: true, log: 'Forward' };
    case 'refresh-page':
      if (!page) throw new Error('No browser open'); await page.reload();
      return { success: true, log: 'Reloaded' };

    case 'open-new-tab': {
      if (!page) throw new Error('No browser open');
      page = await page.context().newPage();
      if (p(props, 'url')) await page.goto(String(p(props, 'url')));
      return { success: true, log: `New tab${p(props, 'url') ? ` → ${p(props, 'url')}` : ''}` };
    }
    case 'close-tab': {
      if (!page) throw new Error('No browser open');
      await page.close();
      const pages = page.context().pages();
      page = pages[pages.length - 1] ?? null;
      return { success: true, log: 'Tab closed' };
    }
    case 'switch-tab': {
      if (!page) throw new Error('No browser open');
      const all = page.context().pages();
      const by  = String(p(props, 'switchBy', 'Index'));
      const val = String(p(props, 'value', '0'));
      if (by === 'Index') page = all[Number(val)] ?? page;
      else if (by === 'Title') for (const pg of all) { if ((await pg.title()).includes(val)) { page = pg; break; } }
      else for (const pg of all) { if (pg.url().includes(val)) { page = pg; break; } }
      await page.bringToFront();
      return { success: true, log: `Switched to tab` };
    }

    case 'click': {
      if (!page) throw new Error('No browser open');
      const sel = String(p(props, 'selector')); const ct = String(p(props, 'clickType', 'Left'));
      const btn = ct === 'Right' ? 'right' : ct === 'Middle' ? 'middle' : 'left';
      await page.click(sel, { button: btn, clickCount: ct === 'Double' ? 2 : 1, timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: `Click → ${sel}` };
    }
    case 'double-click':
      if (!page) throw new Error('No browser open');
      await page.dblclick(String(p(props, 'selector')), { timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: `Double-click → ${p(props, 'selector')}` };
    case 'right-click':
      if (!page) throw new Error('No browser open');
      await page.click(String(p(props, 'selector')), { button: 'right', timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: `Right-click → ${p(props, 'selector')}` };
    case 'hover':
      if (!page) throw new Error('No browser open');
      await page.hover(String(p(props, 'selector')));
      return { success: true, log: `Hover → ${p(props, 'selector')}` };

    case 'type-into': {
      if (!page) throw new Error('No browser open');
      const sel = String(p(props, 'selector')); const text = String(p(props, 'text', ''));
      if (p(props, 'clearBefore') !== false) await page.fill(sel, text);
      else await page.type(sel, text, { delay: Number(p(props, 'delay', 50)) });
      return { success: true, log: `Typed "${text.slice(0, 40)}" → ${sel}` };
    }
    case 'clear-text':
      if (!page) throw new Error('No browser open');
      await page.fill(String(p(props, 'selector')), '');
      return { success: true, log: `Cleared → ${p(props, 'selector')}` };

    case 'send-hotkey': {
      if (!page) throw new Error('No browser open');
      const key = String(p(props, 'key', 'Enter')).replace('Ctrl+', 'Control+');
      const sel = String(p(props, 'selector', ''));
      if (sel) await page.locator(sel).press(key);
      else await page.keyboard.press(key);
      return { success: true, log: `Hotkey: ${p(props, 'key')}` };
    }
    case 'select-option': {
      if (!page) throw new Error('No browser open');
      const sel = String(p(props, 'selector')); const val = String(p(props, 'value')); const by = String(p(props, 'selectBy', 'Text'));
      if (by === 'Value') await page.selectOption(sel, { value: val });
      else if (by === 'Index') await page.selectOption(sel, { index: Number(val) });
      else await page.selectOption(sel, { label: val });
      return { success: true, log: `Selected "${val}" in ${sel}` };
    }
    case 'check-checkbox': {
      if (!page) throw new Error('No browser open');
      const sel = String(p(props, 'selector')); const checked = p(props, 'checked') !== false;
      if (checked) await page.check(sel); else await page.uncheck(sel);
      return { success: true, log: `${checked ? 'Checked' : 'Unchecked'} ${sel}` };
    }
    case 'drag-drop':
      if (!page) throw new Error('No browser open');
      await page.dragAndDrop(String(p(props, 'source')), String(p(props, 'target')));
      return { success: true, log: `Dragged ${p(props, 'source')} → ${p(props, 'target')}` };
    case 'scroll-to':
      if (!page) throw new Error('No browser open');
      await page.locator(String(p(props, 'selector'))).scrollIntoViewIfNeeded();
      return { success: true, log: `Scrolled to ${p(props, 'selector')}` };
    case 'scroll-page': {
      if (!page) throw new Error('No browser open');
      const dir = String(p(props, 'direction', 'Down')); const amt = Number(p(props, 'amount', 500));
      if (dir === 'Top') await page.evaluate('window.scrollTo(0,0)');
      else if (dir === 'Bottom') await page.evaluate('window.scrollTo(0,document.body.scrollHeight)');
      else if (dir === 'Down') await page.evaluate(`window.scrollBy(0,${amt})`);
      else await page.evaluate(`window.scrollBy(0,-${amt})`);
      return { success: true, log: `Scrolled ${dir}` };
    }
    case 'upload-file':
      if (!page) throw new Error('No browser open');
      await page.setInputFiles(String(p(props, 'selector')), String(p(props, 'filePath')));
      return { success: true, log: `Uploaded ${p(props, 'filePath')}` };
    case 'focus-element':
      if (!page) throw new Error('No browser open');
      await page.focus(String(p(props, 'selector')));
      return { success: true, log: `Focused ${p(props, 'selector')}` };
    case 'switch-frame':
      return { success: true, log: `(frame context set to ${p(props, 'selector')})` };
    case 'switch-default-content':
      return { success: true, log: 'Switched to default content' };
    case 'maximize-window': {
      if (!page) throw new Error('No browser open');
      const mode = String(p(props, 'mode', 'Maximize'));
      if (mode === 'Custom') await page.setViewportSize({ width: Number(p(props, 'width', 1280)), height: Number(p(props, 'height', 800)) });
      else await page.evaluate('window.moveTo(0,0);window.resizeTo(screen.width,screen.height)');
      return { success: true, log: `Window ${mode}` };
    }
    case 'execute-javascript': {
      if (!page) throw new Error('No browser open');
      const result = await page.evaluate(String(p(props, 'script', 'return undefined')));
      const out = JSON.stringify(result ?? '').slice(0, 80);
      return { success: true, log: `JS → ${out}`, outputs: { [String(p(props, 'output', 'jsResult'))]: result } };
    }
    case 'take-screenshot': {
      if (!page) throw new Error('No browser open');
      const savePath = String(p(props, 'savePath')); const sel = String(p(props, 'selector', ''));
      if (sel) await (await page.$(sel))?.screenshot({ path: savePath });
      else await page.screenshot({ path: savePath });
      return { success: true, log: `Screenshot → ${savePath}` };
    }
    case 'accept-alert':
      if (!page) throw new Error('No browser open');
      page.once('dialog', d => d.accept(String(p(props, 'promptText', ''))));
      return { success: true, log: 'Alert handler set (accept)' };
    case 'dismiss-alert':
      if (!page) throw new Error('No browser open');
      page.once('dialog', d => d.dismiss());
      return { success: true, log: 'Alert handler set (dismiss)' };

    // ── Data extraction ──
    case 'get-text': {
      if (!page) throw new Error('No browser open');
      const raw = (await page.textContent(String(p(props, 'selector')))) ?? '';
      const val = p(props, 'trim') !== false ? raw.trim() : raw;
      return { success: true, log: `Got text: "${String(val).slice(0, 60)}"`, outputs: { [String(p(props, 'output', 'text'))]: val } };
    }
    case 'get-attribute': {
      if (!page) throw new Error('No browser open');
      const val = await page.getAttribute(String(p(props, 'selector')), String(p(props, 'attribute', 'href')));
      return { success: true, log: `Attribute: "${val}"`, outputs: { [String(p(props, 'output', 'attrValue'))]: val ?? '' } };
    }
    case 'get-value': {
      if (!page) throw new Error('No browser open');
      const val = await page.inputValue(String(p(props, 'selector')));
      return { success: true, log: `Value: "${val}"`, outputs: { [String(p(props, 'output', 'value'))]: val } };
    }
    case 'get-inner-html': {
      if (!page) throw new Error('No browser open');
      const html = await page.innerHTML(String(p(props, 'selector')));
      return { success: true, log: `HTML (${html.length} chars)`, outputs: { [String(p(props, 'output', 'html'))]: html } };
    }
    case 'get-element-count': {
      if (!page) throw new Error('No browser open');
      const n = await page.locator(String(p(props, 'selector'))).count();
      return { success: true, log: `Count: ${n}`, outputs: { [String(p(props, 'output', 'count'))]: n } };
    }
    case 'get-page-title': {
      if (!page) throw new Error('No browser open');
      const title = await page.title();
      return { success: true, log: `Title: "${title}"`, outputs: { [String(p(props, 'output', 'title'))]: title } };
    }
    case 'get-page-url': {
      if (!page) throw new Error('No browser open');
      const url = page.url();
      return { success: true, log: `URL: ${url}`, outputs: { [String(p(props, 'output', 'url'))]: url } };
    }
    case 'get-all-text': {
      if (!page) throw new Error('No browser open');
      const texts = await page.locator(String(p(props, 'selector'))).allTextContents();
      const sep   = String(p(props, 'separator', ''));
      const val   = sep ? texts.join(sep) : texts;
      return { success: true, log: `Got ${texts.length} items`, outputs: { [String(p(props, 'output', 'texts'))]: val } };
    }
    case 'extract-table': {
      if (!page) throw new Error('No browser open');
      const data = await page.evaluate((sel: string) => {
        const t = document.querySelector(sel);
        if (!t) return [];
        return [...t.querySelectorAll('tr')].map(r => [...r.querySelectorAll('th,td')].map(c => c.textContent?.trim() ?? ''));
      }, String(p(props, 'selector', 'table')));
      return { success: true, log: `Table: ${data.length} rows`, outputs: { [String(p(props, 'output', 'table'))]: data } };
    }
    case 'find-elements': {
      if (!page) throw new Error('No browser open');
      const n = await page.locator(String(p(props, 'selector'))).count();
      return { success: true, log: `Found ${n} elements`, outputs: { [String(p(props, 'output', 'elements'))]: n } };
    }

    // ── Wait & verify ──
    case 'wait-element':
      if (!page) throw new Error('No browser open');
      await page.waitForSelector(String(p(props, 'selector')), { state: (p(props, 'state') as any) || 'visible', timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: `Element ready: ${p(props, 'selector')}` };
    case 'wait-element-vanish':
      if (!page) throw new Error('No browser open');
      await page.waitForSelector(String(p(props, 'selector')), { state: 'hidden', timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: `Element gone: ${p(props, 'selector')}` };
    case 'wait-page-load':
      if (!page) throw new Error('No browser open');
      await page.waitForLoadState('load', { timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: 'Page loaded' };
    case 'wait-text':
      if (!page) throw new Error('No browser open');
      await page.locator(String(p(props, 'selector'))).filter({ hasText: String(p(props, 'text')) }).waitFor({ timeout: Number(p(props, 'timeout', 30000)) });
      return { success: true, log: `Text found: "${p(props, 'text')}"` };
    case 'element-exists': {
      if (!page) throw new Error('No browser open');
      const exists = (await page.$(String(p(props, 'selector')))) !== null;
      return { success: true, log: `Exists: ${exists}`, outputs: { [String(p(props, 'output', 'exists'))]: exists } };
    }
    case 'assert-text': {
      if (!page) throw new Error('No browser open');
      const actual   = ((await page.textContent(String(p(props, 'selector')))) ?? '').trim();
      const expected = String(p(props, 'expected'));
      const mt       = String(p(props, 'matchType', 'Contains'));
      const pass     = mt === 'Equals' ? actual === expected : mt === 'StartsWith' ? actual.startsWith(expected) : mt === 'Regex' ? new RegExp(expected).test(actual) : actual.includes(expected);
      if (!pass) throw new Error(`Assert failed. Expected: "${expected}", Got: "${actual.slice(0,80)}"`);
      return { success: true, log: `Assert ✓ "${actual.slice(0, 60)}"` };
    }
    case 'assert-title': {
      if (!page) throw new Error('No browser open');
      const actual = await page.title(); const expected = String(p(props, 'expected'));
      const pass = String(p(props, 'matchType', 'Contains')) === 'Equals' ? actual === expected : actual.includes(expected);
      if (!pass) throw new Error(`Title assert failed: "${actual}" vs "${expected}"`);
      return { success: true, log: `Title ✓ "${actual}"` };
    }
    case 'assert-url': {
      if (!page) throw new Error('No browser open');
      const actual = page.url(); const expected = String(p(props, 'expected'));
      const pass = String(p(props, 'matchType', 'Contains')) === 'Equals' ? actual === expected : actual.includes(expected);
      if (!pass) throw new Error(`URL assert failed: "${actual}" vs "${expected}"`);
      return { success: true, log: `URL ✓` };
    }

    default:
      return { success: false, log: `Unknown browser activity: ${id}` };
  }
}
