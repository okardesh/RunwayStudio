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
import { PICKER_NATIVE_CSHARP } from './pickerNativeScript';

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
  // Windows PowerShell 5.1 otherwise decodes UTF-8 scripts as the ANSI code page.
  fs.writeFileSync(tmpFile, '\uFEFF' + "$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\n" + script, { encoding: 'utf8' });
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
if (-not ('RunwayWindow' -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RunwayWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
"@
}
$null = [RunwayWindow]::SetProcessDpiAwarenessContext([IntPtr](-4))
$null = [RunwayWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
function Get-Pattern($element, $pattern) {
  try { return $element.GetCurrentPattern($pattern) } catch [System.InvalidOperationException] { return $null }
}

Add-Type -AssemblyName UIAutomationClient -EA SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes  -EA SilentlyContinue
$root = [System.Windows.Automation.AutomationElement]::RootElement
`;

function parseSel(selector: string): { window: string; conditions: { prop: string; val: string }[] } {
  const accessibleSeparator = selector.lastIndexOf(' > msaa:');
  if (accessibleSeparator >= 0) {
    return { window: selector.slice(0, accessibleSeparator).replace(/^window:/i, '').trim(), conditions: [{ prop: 'msaa', val: selector.slice(accessibleSeparator + ' > msaa:'.length) }] };
  }
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
    : `'${val.replace(/'/g, "''")}'`;
}

function buildFinder(selector: string): string {
  const { window, conditions } = parseSel(selector);
  if (!window) throw new Error('Selector must start with window:Title');

  if (conditions.length === 1 && conditions[0].prop === 'msaa') {
    const target = JSON.parse(Buffer.from(conditions[0].val, 'base64').toString('utf8')) as { name: string; controlType: string };
    if (typeof target.name !== 'string' || !target.name || typeof target.controlType !== 'string') throw new Error('Invalid accessible selector');
    const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'";
    return UIA_INIT + `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies @('System.dll', 'System.Core.dll', (Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'Accessibility.dll')) -TypeDefinition @"
${PICKER_NATIVE_CSHARP}
"@
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, ${literal(window)})
$wnd = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
if ($wnd -eq $null) { throw 'Target application window was not found.' }
$el = [PickerNative]::FindControl([IntPtr]$wnd.Current.NativeWindowHandle, ${literal(target.name)}, ${literal(target.controlType)})
`;
  }

  let script = UIA_INIT;
  script += `
$wndCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${window.replace(/'/g, "''")}')
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

function hotkeySequence(key: string): string {
  const parts = key.split('+').map(part => part.trim());
  const terminal = parts.pop() ?? '';
  const modifiers: Record<string,string> = { ctrl: '^', control: '^', alt: '%', shift: '+' };
  const prefix = parts.map(part => {
    const modifier = modifiers[part.toLowerCase()];
    if (!modifier) throw new Error(`Unknown hotkey modifier: ${part}`);
    return modifier;
  }).join('');
  const named: Record<string,string> = { enter:'ENTER',tab:'TAB',escape:'ESC',delete:'DEL',backspace:'BS',pagedown:'PGDN',pageup:'PGUP',end:'END',home:'HOME',left:'LEFT',right:'RIGHT',up:'UP',down:'DOWN',insert:'INSERT',space:'SPACE' };
  const name = named[terminal.toLowerCase()];
  if (name) return prefix + (name === 'SPACE' ? ' ' : `{${name}}`);
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(terminal)) return prefix + `{${terminal.toUpperCase()}}`;
  if (/^[a-z0-9]$/i.test(terminal)) return prefix + terminal.toLowerCase();
  throw new Error(`Unsupported hotkey: ${key}`);
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
$null = [RunwayWindow]::ShowWindow([IntPtr]$wnd.Current.NativeWindowHandle, 9)
$null = [RunwayWindow]::SetForegroundWindow([IntPtr]$wnd.Current.NativeWindowHandle)
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
          const script = buildFinder(sel) + `
$null = [RunwayWindow]::SetForegroundWindow([IntPtr]$wnd.Current.NativeWindowHandle)
` + (canInvoke ? `
$pat = Get-Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)
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
          if (kind === 'Hover') await new Promise(resolve => setTimeout(resolve, Number(props.duration ?? 0)));
        } else {
          // Raw screen coordinates, e.g. selector = "400,300"
          const [x, y] = sel.split(',').map(Number);
          if (!isNaN(x) && !isNaN(y)) {
            await ps(`${WIN32_MOUSE}
[Win32Mouse]::SetCursorPos(${x}, ${y})
${mouseDownUp}`);
          } else throw new Error('Invalid click selector: ' + sel);
        }
        const label = id === 'right-click' ? 'Right-click' : id === 'double-click' ? 'Double-click' : id === 'hover' ? 'Hover' : 'Click';
        return { success: true, log: `${label} → ${sel}` };
      }

      // ── Keyboard ──
      case 'clear-text':
      case 'type-into': {
        const text = id === 'clear-text' ? '' : String(props.text ?? '');
        if (sel.startsWith('window:')) {
          const script = buildFinder(sel) + `
$el.SetFocus()
$pat = Get-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
if ($pat) {
  $value = '${text.replace(/'/g, "''")}'
  ${props.clearBefore === false && id !== 'clear-text' ? '$value = $pat.Current.Value + $value' : ''}
  $pat.SetValue($value)
}
else {
  Add-Type -AssemblyName System.Windows.Forms
  ${props.clearBefore !== false || id === 'clear-text' ? "[System.Windows.Forms.SendKeys]::SendWait('^a{BACKSPACE}')" : ''}
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
        const psKey = hotkeySequence(key);
        await ps((sel.startsWith('window:') ? buildFinder(sel) + '$null = [RunwayWindow]::SetForegroundWindow([IntPtr]$wnd.Current.NativeWindowHandle)\n$el.SetFocus()\nif (-not $el.Current.HasKeyboardFocus) { throw "Target did not receive keyboard focus" }\n' : '') + `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psKey}')`);
        return { success: true, log: `Hotkey: ${key}` };
      }

      // ── Text reading ──
      case 'get-value':
      case 'get-text': {
        let value = '';
        if (sel.startsWith('window:')) {
          const script = buildFinder(sel) + `
$pat = Get-Pattern $el ([System.Windows.Automation.TextPattern]::Pattern)
if ($pat) { $pat.DocumentRange.GetText(-1) }
else {
  $vp = Get-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp) { $vp.Current.Value } else { $el.Current.Name }
}`;
          value = await ps(script);
        }
        const outVar = String(props.output ?? 'text');
        return { success: true, log: `Got text: "${value.slice(0, 60)}"`, outputs: { [outVar]: value } };
      }

      case 'select-option': {
        const value = String(props.value ?? '');
        const by = String(props.selectBy ?? 'Text');
        const literal = (text: string) => "'" + text.replace(/'/g, "''") + "'";
        await ps(buildFinder(sel) + `
if ($el -is [System.Windows.Automation.AutomationElement]) {
  $expand = Get-Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if ($expand) { $expand.Expand() }
  try {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
    $items = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $selected = $null
    if (${literal(by)} -eq 'Index') {
      $index = 0
      if (-not [int]::TryParse(${literal(value)}, [ref]$index) -or $index -lt 0 -or $index -ge $items.Count) { throw 'Combo box index out of range' }
      $selected = $items[$index]
    } elseif (${literal(by)} -eq 'Text') {
      foreach ($item in $items) { if ($item.Current.Name -ceq ${literal(value)}) { if ($selected) { throw 'Combo box option text is ambiguous' }; $selected = $item } }
    } else { throw 'Native combo boxes support Text or Index selection, not HTML option values' }
    if (-not $selected) { throw 'Combo box option not found' }
    $pattern = Get-Pattern $selected ([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if (-not $pattern) { throw 'Option does not support selection' }
    $pattern.Select()
    if (-not $pattern.Current.IsSelected) { throw 'Combo box selection did not take effect' }
  } finally { if ($expand) { $expand.Collapse() } }
} else { $el.SelectOption(${literal(value)}, ${literal(by)}) }
`);
        return { success: true, log: `Selected "${value}" in ${sel}` };
      }
      case 'check-checkbox': {
        await ps(buildFinder(sel) + `
$pat = Get-Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)
if (!$pat) { throw 'Target does not support checkbox toggling' }
if ([int]$pat.Current.ToggleState -ne ${props.checked === false ? 0 : 1}) { $pat.Toggle() }
`);
        return { success: true, log: 'Checkbox updated' };
      }
      case 'element-exists':
      case 'wait-element':
      case 'wait-element-vanish':
      case 'wait-text':
      case 'assert-text': {
        const timeout = Number(props.timeout ?? 30000);
        const deadline = Date.now() + timeout;
        const inspect = async () => {
          const text = await ps(buildFinder(sel) + `
$vp = Get-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
$value = if ($vp) { $vp.Current.Value } else { $el.Current.Name }
@{text=$value;enabled=$el.Current.IsEnabled;visible=(-not $el.Current.IsOffscreen)} | ConvertTo-Json -Compress
`);
          return JSON.parse(text) as { text: string; enabled: boolean; visible: boolean };
        };
        do {
          let found: Awaited<ReturnType<typeof inspect>> | null;
          try { found = await inspect(); } catch (error) {
            if (!/not found/i.test(String(error))) throw error;
            found = null;
          }
          if (id === 'element-exists') return { success: true, log: 'Exists: ' + !!found, outputs: { [String(props.output ?? 'exists')]: !!found } };
          let ready = false;
          if (id === 'wait-element-vanish') ready = !found || !found.visible;
          else if (found) {
            if (id === 'wait-text') ready = found.text.includes(String(props.text ?? ''));
            else if (id === 'assert-text') {
              const expected = String(props.expected ?? ''), actual = found.text.trim();
              ready = props.matchType === 'Equals' ? actual === expected : props.matchType === 'StartsWith' ? actual.startsWith(expected) : props.matchType === 'Regex' ? new RegExp(expected).test(actual) : actual.includes(expected);
              if (!ready) throw new Error('Text assertion failed: ' + actual);
            } else ready = props.state === 'present' || (props.state === 'enabled' ? found.enabled : props.state === 'clickable' ? found.enabled && found.visible : found.visible);
          }
          if (ready) return { success: true, log: 'Verified ' + sel };
          if (id === 'assert-text') throw new Error('Text assertion target not found');
          if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + sel);
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (true);
      }

      // ── Window management ──
      case 'maximize-window': {
        const windowSelector = sel || 'window:' + String(props.windowTitle ?? '');
        const mode = String(props.mode ?? 'Maximize');
        if (!['Minimize','Maximize','Restore'].includes(mode)) throw new Error('Desktop window mode is not supported: ' + mode);
        await ps(buildFinder(windowSelector) + `
$null = [RunwayWindow]::ShowWindow([IntPtr]$wnd.Current.NativeWindowHandle, ${mode === 'Minimize' ? 6 : mode === 'Restore' ? 9 : 3})
`);
        return { success: true, log: 'Window ' + mode };
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
