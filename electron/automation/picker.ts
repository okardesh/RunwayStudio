/**
 * Point-and-click desktop element picker.
 *
 * Runs a PowerShell/UIAutomation script that tracks the cursor, draws a
 * hollow highlight frame around whatever element is underneath it, and
 * captures that element's identifying properties on left-click (Escape
 * cancels). Output is a single JSON line on stdout.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PickedElement {
  cancelled: boolean;
  windowTitle?: string;
  name?: string;
  automationId?: string;
  className?: string;
  controlType?: string;
  selector?: string;
}

function buildPickerScript(windowTitle: string): string {
  const escaped = windowTitle.replace(/'/g, "''");
  const scoped = windowTitle.trim().length > 0;
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PickerNative {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  public const int VK_LBUTTON = 0x01;
  public const int VK_ESCAPE = 0x1B;
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x20;
  public const int WS_EX_LAYERED = 0x80;
  public const int WS_EX_NOACTIVATE = 0x08000000;
}
"@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$targetWindow = '${escaped}'
$scoped = ${scoped ? '$true' : '$false'}

if ($scoped) {
  $wndCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $targetWindow)
  $targetWnd = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $wndCond)
  if ($targetWnd -ne $null) {
    try {
      $wp = $targetWnd.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
      if ($wp -and $wp.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
        $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
      }
    } catch {}
    try { $targetWnd.SetFocus() } catch {}
  }
}

$highlight = New-Object System.Windows.Forms.Form
$highlight.FormBorderStyle = 'None'
$highlight.ShowInTaskbar = $false
$highlight.TopMost = $true
$highlight.StartPosition = 'Manual'
$highlight.BackColor = [System.Drawing.Color]::FromArgb(255, 90, 0)
$highlight.Bounds = New-Object System.Drawing.Rectangle(0, 0, 1, 1)
$highlight.Show()

$ex = [PickerNative]::GetWindowLong($highlight.Handle, [PickerNative]::GWL_EXSTYLE)
[PickerNative]::SetWindowLong($highlight.Handle, [PickerNative]::GWL_EXSTYLE, $ex -bor [PickerNative]::WS_EX_TRANSPARENT -bor [PickerNative]::WS_EX_LAYERED -bor [PickerNative]::WS_EX_NOACTIVATE) | Out-Null

function Set-HighlightRect($rect) {
  $b = 3
  $w = [Math]::Max(1, [int]$rect.Width)
  $h = [Math]::Max(1, [int]$rect.Height)
  $outer = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $inner = New-Object System.Drawing.Rectangle($b, $b, [Math]::Max(0, $w - 2*$b), [Math]::Max(0, $h - 2*$b))
  $region = New-Object System.Drawing.Region($outer)
  $region.Exclude($inner)
  $highlight.Bounds = New-Object System.Drawing.Rectangle([int]$rect.X, [int]$rect.Y, $w, $h)
  $highlight.Region = $region
}

function Get-WindowAncestorTitle($el) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $cur = $el
  $last = $el
  while ($cur -ne $null) {
    try {
      if ($cur.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { return $cur.Current.Name }
    } catch {}
    $last = $cur
    try { $cur = $walker.GetParent($cur) } catch { $cur = $null }
  }
  try { return $last.Current.Name } catch { return '' }
}

$result = $null
$lastEl = $null
$wasDown = $false
$wasEsc = $false
$deadline = (Get-Date).AddSeconds(120)

while ($true) {
  Start-Sleep -Milliseconds 25
  [System.Windows.Forms.Application]::DoEvents()

  if ((Get-Date) -gt $deadline) { break }

  $esc = ([PickerNative]::GetAsyncKeyState([PickerNative]::VK_ESCAPE) -band 0x8000) -ne 0
  if ($esc -and -not $wasEsc) { break }
  $wasEsc = $esc

  $pt = [System.Windows.Forms.Cursor]::Position
  $auPt = New-Object System.Windows.Point($pt.X, $pt.Y)
  try { $el = [System.Windows.Automation.AutomationElement]::FromPoint($auPt) } catch { $el = $null }

  $inScope = $false
  if ($el -ne $null) {
    $hoverWindow = Get-WindowAncestorTitle $el
    if ((-not $scoped) -or ($hoverWindow -eq $targetWindow)) {
      $inScope = $true
      $lastEl = $el
      try { Set-HighlightRect $el.Current.BoundingRectangle } catch {}
    }
  }
  if (-not $inScope) {
    # Outside the indicated app's window - hide the highlight, don't let it land on other apps
    $highlight.Bounds = New-Object System.Drawing.Rectangle(-10, -10, 1, 1)
  }

  $down = ([PickerNative]::GetAsyncKeyState([PickerNative]::VK_LBUTTON) -band 0x8000) -ne 0
  if ($down -and -not $wasDown -and $inScope -and $lastEl -ne $null) {
    $c = $lastEl.Current
    $ctName = $c.ControlType.ProgrammaticName -replace '^ControlType\\.',''
    $result = @{
      name = $c.Name
      automationId = $c.AutomationId
      className = $c.ClassName
      controlType = $ctName
      windowTitle = (Get-WindowAncestorTitle $lastEl)
    }
    break
  }
  $wasDown = $down
}

$highlight.Close()

if ($result -eq $null) {
  Write-Output '{"cancelled":true}'
} else {
  Write-Output ($result | ConvertTo-Json -Compress)
}
`;
}

function buildSelector(r: { windowTitle?: string; automationId?: string; name?: string; controlType?: string; className?: string }): string {
  const window = r.windowTitle ?? '';
  if (r.automationId) return `window:${window} > automationId:${r.automationId}`;
  if (r.name && r.controlType) return `window:${window} > controlType:${r.controlType},name:${r.name}`;
  if (r.name) return `window:${window} > name:${r.name}`;
  if (r.className) return `window:${window} > className:${r.className}`;
  return `window:${window}`;
}

export async function pickDesktopElement(windowTitle = ''): Promise<PickedElement> {
  const tmpFile = path.join(os.tmpdir(), `rpa-picker-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`);
  fs.writeFileSync(tmpFile, buildPickerScript(windowTitle), { encoding: 'utf8' });

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpFile], {
        windowsHide: true,
      });
      let out = '';
      let err = '';
      const killTimer = setTimeout(() => child.kill(), 125_000);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', (e) => { clearTimeout(killTimer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code !== 0 && !out.trim()) reject(new Error(err || `picker exited with code ${code}`));
        else resolve(out);
      });
    });

    const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '{"cancelled":true}';
    const parsed = JSON.parse(line);
    if (parsed.cancelled) return { cancelled: true };

    const picked: PickedElement = {
      cancelled: false,
      windowTitle: parsed.windowTitle || '',
      name: parsed.name || '',
      automationId: parsed.automationId || '',
      className: parsed.className || '',
      controlType: parsed.controlType || '',
    };
    picked.selector = buildSelector(picked);
    return picked;
  } finally {
    fs.unlink(tmpFile, () => {});
  }
}
