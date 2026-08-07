/**
 * Windows desktop automation via PowerShell + Windows UIAutomation API.
 * Works with any Windows application: .NET, Java (with JAB), Win32, WPF, UWP.
 *
 * Desktop selector format:
 *   window:Title                          — the window itself
 *   window:Title > name:ButtonName        — element by Name property
 *   window:Title > automationId:theId     — element by AutomationId
 *   window:Title > className:TextBox      — element by ClassName
 *   window:Title > controlType:Button,name:OK  — combined condition
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Result = { success: true; log: string; outputs?: Record<string, unknown> }
            | { success: false; log: string };

// ── PowerShell runner ──────────────────────────────────────────────────────────

// Runs via a temp .ps1 file rather than -Command '<escaped>' — inline command-line
// quoting breaks as soon as a script contains a here-string (@"…"@), which several
// UIAutomation snippets below do.
// Async (execFile, not execSync) — a synchronous child-process call here blocks
// Electron's main/UI thread, freezing the whole app for the duration of every
// desktop-automation step.
function ps(script: string, timeout = 30000): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `rpa-ps-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`);
  fs.writeFileSync(tmpFile, script, { encoding: 'utf8' });
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
      { encoding: 'utf8', timeout, windowsHide: true },
      (err, stdout, stderr) => {
        fs.unlink(tmpFile, () => {});
        if (err) { reject(new Error(String(stderr || err.message).trim())); return; }
        resolve(stdout.trim());
      }
    );
  });
}

// ── UIAutomation helpers embedded as PowerShell ────────────────────────────────

const UIA_INIT = `
Add-Type -AssemblyName UIAutomationClient -EA SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes  -EA SilentlyContinue
$root = [System.Windows.Automation.AutomationElement]::RootElement
`;

function parseSel(selector: string): { window: string; conditions: { prop: string; val: string }[] } {
  const parts = selector.split('>').map(s => s.trim());
  const window = (parts[0] ?? '').replace(/^window:/i, '').trim();
  const conditions = (parts[1] ?? '').split(',').map(c => {
    const colon = c.indexOf(':');
    return colon > 0 ? { prop: c.slice(0, colon).trim(), val: c.slice(colon + 1).trim() } : null;
  }).filter(Boolean) as { prop: string; val: string }[];
  return { window, conditions };
}

const UIA_PROP: Record<string, string> = {
  name:         'AutomationElement]::NameProperty',
  automationId: 'AutomationElement]::AutomationIdProperty',
  className:    'AutomationElement]::ClassNameProperty',
  controlType:  'AutomationElement]::ControlTypeProperty',
};

// controlType compares against a ControlType object (e.g. [ControlType]::Button), not a string —
// every other property compares against a plain string value.
function valueLiteral(prop: string, val: string): string {
  return prop === 'controlType'
    ? `[System.Windows.Automation.ControlType]::${val}`
    : `'${val}'`;
}

function buildFinder(selector: string): string {
  const { window, conditions } = parseSel(selector);
  if (!window) throw new Error('Selector must start with window:Title');

  let script = UIA_INIT;
  script += `
$wndCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${window}')
$wnd = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $wndCond)
if ($wnd -eq $null) { throw "Window not found: ${window}" }
`;

  if (conditions.length === 0) {
    script += '$el = $wnd\n';
  } else if (conditions.length === 1) {
    const c = conditions[0];
    const prop = UIA_PROP[c.prop] ?? UIA_PROP.name;
    script += `$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.${prop}, ${valueLiteral(c.prop, c.val)})
$el = $wnd.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($el -eq $null) { throw "Element not found: ${c.prop}=${c.val}" }
`;
  } else {
    const conds = conditions.map((c, i) => {
      const prop = UIA_PROP[c.prop] ?? UIA_PROP.name;
      return `$c${i} = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.${prop}, ${valueLiteral(c.prop, c.val)})`;
    }).join('\n');
    const andCond = conditions.map((_, i) => `$c${i}`).join(', ');
    script += `${conds}
$andCond = New-Object System.Windows.Automation.AndCondition(${andCond})
$el = $wnd.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $andCond)
if ($el -eq $null) { throw "Element not found" }
`;
  }

  return script;
}

// ── Win32 mouse/keyboard (no extra packages needed) ───────────────────────────

const WIN32_MOUSE = `
if (-not ([System.Management.Automation.PSTypeName]'Win32Mouse').Type) {
  Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class Win32Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int b, int e);
  public const int LD=2,LU=4,RD=8,RU=16,MD=32,MU=64;
}
"@ -EA SilentlyContinue }
`;

// PowerShell lines that press+release the right mouse button(s) for a click kind.
// Assumes the cursor is already positioned (SetCursorPos) and WIN32_MOUSE is loaded.
function mouseEventCalls(kind: 'Left' | 'Right' | 'Double' | 'Middle' | 'Hover'): string {
  if (kind === 'Hover') return '';
  if (kind === 'Right') return `[Win32Mouse]::mouse_event([Win32Mouse]::RD, 0, 0, 0, 0)
[Win32Mouse]::mouse_event([Win32Mouse]::RU, 0, 0, 0, 0)`;
  if (kind === 'Middle') return `[Win32Mouse]::mouse_event([Win32Mouse]::MD, 0, 0, 0, 0)
[Win32Mouse]::mouse_event([Win32Mouse]::MU, 0, 0, 0, 0)`;
  if (kind === 'Double') return `[Win32Mouse]::mouse_event([Win32Mouse]::LD, 0, 0, 0, 0)
[Win32Mouse]::mouse_event([Win32Mouse]::LU, 0, 0, 0, 0)
Start-Sleep -Milliseconds 40
[Win32Mouse]::mouse_event([Win32Mouse]::LD, 0, 0, 0, 0)
[Win32Mouse]::mouse_event([Win32Mouse]::LU, 0, 0, 0, 0)`;
  return `[Win32Mouse]::mouse_event([Win32Mouse]::LD, 0, 0, 0, 0)
[Win32Mouse]::mouse_event([Win32Mouse]::LU, 0, 0, 0, 0)`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runDesktopActivity(id: string, props: Record<string, unknown>): Promise<Result> {
  const sel = String(props.selector ?? props.source ?? '');

  try {
    switch (id) {

      // ── Container open/close (Use Application/Browser, desktop target) ──
      case 'use-app-browser':
      case 'open-browser': {
        const winTitle = String(props.windowTitle ?? '');
        if (!winTitle) throw new Error('No window indicated — use "Indicate application to automate" first');
        // Same UIAutomation window lookup buildFinder() uses for selectors — more reliable
        // than raw Win32 FindWindow, which can miss modern (UWP-hosted) top-level windows.
        const escaped = winTitle.replace(/'/g, "''");
        const script = UIA_INIT + `
$wndCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${escaped}')
$wnd = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $wndCond)
if ($wnd -eq $null) { throw "Window not found: ${escaped}" }
$wnd.SetFocus()
`;
        await ps(script);
        return { success: true, log: `Attached to window: ${winTitle}` };
      }
      case 'close-browser':
        return { success: true, log: 'Desktop target — nothing to close' };

      // ── Mouse ──
      // Click(clickType) plus the standalone Right Click / Double Click / Hover activities
      // all boil down to: find the element (or use raw x,y), move there, press.
      case 'click':
      case 'right-click':
      case 'double-click':
      case 'hover': {
        const kind: 'Left' | 'Right' | 'Double' | 'Middle' | 'Hover' =
          id === 'right-click' ? 'Right' :
          id === 'double-click' ? 'Double' :
          id === 'hover' ? 'Hover' :
          (String(props.clickType ?? 'Left') as 'Left' | 'Right' | 'Double' | 'Middle');

        const mouseDownUp = mouseEventCalls(kind);
        // Left clicks try UIAutomation's InvokePattern first — it works even when the
        // element is occluded or off-screen. Every other kind has no InvokePattern
        // equivalent, so it always simulates a real mouse action at the element's center.
        const canInvoke = kind === 'Left';

        if (sel.startsWith('window:')) {
          const script = buildFinder(sel) + (canInvoke ? `
$pat = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
if ($pat) { $pat.Invoke() } else {
  $r = $el.Current.BoundingRectangle
  $cx = [int]($r.Left + $r.Width/2); $cy = [int]($r.Top + $r.Height/2)
  ${WIN32_MOUSE}
  [Win32Mouse]::SetCursorPos($cx, $cy)
  ${mouseDownUp}
}` : `
$r = $el.Current.BoundingRectangle
$cx = [int]($r.Left + $r.Width/2); $cy = [int]($r.Top + $r.Height/2)
${WIN32_MOUSE}
[Win32Mouse]::SetCursorPos($cx, $cy)
${mouseDownUp}`);
          await ps(script);
        } else {
          // Raw screen coordinates, e.g. selector = "400,300"
          const [x, y] = sel.split(',').map(Number);
          if (!isNaN(x) && !isNaN(y)) {
            await ps(`${WIN32_MOUSE}
[Win32Mouse]::SetCursorPos(${x}, ${y})
${mouseDownUp}`);
          }
        }
        const label = id === 'right-click' ? 'Right-click' : id === 'double-click' ? 'Double-click' : id === 'hover' ? 'Hover' : 'Click';
        return { success: true, log: `${label} → ${sel}` };
      }

      // ── Keyboard ──
      case 'type-into': {
        const text = String(props.text ?? '');
        if (sel.startsWith('window:')) {
          const script = buildFinder(sel) + `
$el.SetFocus()
$pat = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
if ($pat) { $pat.SetValue('${text.replace(/'/g, "''")}') }
else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}')}')
}`;
          await ps(script);
        } else {
          await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`);
        }
        return { success: true, log: `Typed "${text.slice(0, 40)}"` };
      }

      case 'send-hotkey': {
        const key = String(props.key ?? 'Enter');
        const psKey = key.replace('Ctrl+', '^').replace('Alt+', '%').replace('Shift+', '+').replace('Enter', '{ENTER}').replace('Tab', '{TAB}').replace('Escape', '{ESC}').replace('Delete', '{DEL}').replace('Backspace', '{BS}').replace('F5', '{F5}');
        await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psKey}')`);
        return { success: true, log: `Hotkey: ${key}` };
      }

      // ── Text reading ──
      case 'get-text': {
        let value = '';
        if (sel.startsWith('window:')) {
          const script = buildFinder(sel) + `
$pat = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
if ($pat) { $pat.DocumentRange.GetText(-1) }
else {
  $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp) { $vp.Current.Value } else { $el.Current.Name }
}`;
          value = await ps(script);
        }
        const outVar = String(props.output ?? 'text');
        return { success: true, log: `Got text: "${value.slice(0, 60)}"`, outputs: { [outVar]: value } };
      }

      // ── Window management ──
      case 'maximize-window': {
        const { window } = parseSel(sel || `window:${props.windowTitle ?? ''}`);
        await ps(`
Add-Type @"
using System.Runtime.InteropServices;
public class Win32Wnd {
  [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
  [DllImport("user32.dll")] public static extern System.IntPtr FindWindow(string c, string t);
  public const int SW_MAXIMIZE=3, SW_MINIMIZE=6, SW_RESTORE=9;
}
"@ -EA SilentlyContinue
$h = [Win32Wnd]::FindWindow($null, '${window}')
[Win32Wnd]::ShowWindow($h, [Win32Wnd]::SW_MAXIMIZE)`);
        return { success: true, log: `Maximized window: ${window}` };
      }

      case 'take-screenshot': {
        const savePath = String(props.savePath ?? '');
        await ps(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
$bmp.Save('${savePath.replace(/\\/g, '\\\\')}')
$g.Dispose(); $bmp.Dispose()`);
        return { success: true, log: `Screenshot → ${savePath}` };
      }

      default:
        return { success: false, log: `Desktop activity "${id}" not yet implemented` };
    }
  } catch (e: any) {
    return { success: false, log: `✗ ${e.message ?? e}` };
  }
}
