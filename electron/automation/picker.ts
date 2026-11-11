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
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PickerNative {
  private delegate IntPtr MouseProc(int code, IntPtr message, IntPtr data);
  private static MouseProc callback = OnMouse;
  private static MouseProc keyCallback = OnKey;
  private static IntPtr hook = IntPtr.Zero;
  private static IntPtr keyHook = IntPtr.Zero;
  public static bool Clicked;
  public static bool Cancelled;
  public static int ClickX, ClickY;
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] private struct MouseData { public Point pt; public uint mouseData, flags, time; public UIntPtr extra; }
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int id, MouseProc proc, IntPtr module, uint threadId);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr handle);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr handle, int code, IntPtr message, IntPtr data);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] private static extern IntPtr GetModuleHandle(string name);
  private static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
    if (code >= 0 && message == (IntPtr)0x0201) {
      var mouse = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
      ClickX = mouse.pt.X; ClickY = mouse.pt.Y; Clicked = true;
    }
    return CallNextHookEx(hook, code, message, data);
  }
  private static IntPtr OnKey(int code, IntPtr message, IntPtr data) {
    if (code >= 0 && (message == (IntPtr)0x0100 || message == (IntPtr)0x0104) && Marshal.ReadInt32(data) == 27) Cancelled = true;
    return CallNextHookEx(keyHook, code, message, data);
  }
  public static void StartMouseHook() {
    hook = SetWindowsHookEx(14, callback, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    keyHook = SetWindowsHookEx(13, keyCallback, GetModuleHandle(null), 0);
    if (keyHook == IntPtr.Zero) { StopMouseHook(); throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  }
  public static void StopMouseHook() {
    if (hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
    if (keyHook != IntPtr.Zero) { UnhookWindowsHookEx(keyHook); keyHook = IntPtr.Zero; }
  }
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
  if ($targetWnd -eq $null) { throw "The selected application window is no longer available." }
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
  $previousRegion = $highlight.Region
  $highlight.Region = $region
  if ($previousRegion -ne $null) { $previousRegion.Dispose() }
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
$wasEsc = $false
$deadline = (Get-Date).AddSeconds(120)

[PickerNative]::StartMouseHook()
try {
while ($true) {
  Start-Sleep -Milliseconds 25
  [System.Windows.Forms.Application]::DoEvents()

  if ([PickerNative]::Cancelled) { break }
  if ((Get-Date) -gt $deadline) { break }

  $esc = ([PickerNative]::GetAsyncKeyState([PickerNative]::VK_ESCAPE) -band 0x8000) -ne 0
  if ($esc -and -not $wasEsc) { break }
  $wasEsc = $esc

  $pt = [System.Windows.Forms.Cursor]::Position
  $clicked = [PickerNative]::Clicked
  if ($clicked) {
    $pt = New-Object System.Drawing.Point([PickerNative]::ClickX, [PickerNative]::ClickY)
    [PickerNative]::Clicked = $false
  }
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

  if ($clicked -and $inScope -and $lastEl -ne $null) {
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
}
} finally {
  [PickerNative]::StopMouseHook()
  $highlight.Close()
  $highlight.Dispose()
}

if ($result -eq $null) {
  Write-Output '{"cancelled":true}'
} else {
  Write-Output ($result | ConvertTo-Json -Compress)
}
`;
}

function buildSelector(r: { windowTitle?: string; automationId?: string; name?: string; controlType?: string; className?: string }): string {
  const window = r.windowTitle ?? '';
  if (r.controlType === 'Window') return `window:${window}`;
  if (r.automationId) return `window:${window} > automationId:${r.automationId}`;
  if (r.name && r.controlType) return `window:${window} > controlType:${r.controlType},name:${r.name}`;
  if (r.name) return `window:${window} > name:${r.name}`;
  if (r.className) return `window:${window} > className:${r.className}`;
  return `window:${window}`;
}

export async function pickDesktopElement(windowTitle = '', signal?: AbortSignal): Promise<PickedElement> {
  if (signal?.aborted) return { cancelled: true };
  const tmpFile = path.join(os.tmpdir(), `rpa-picker-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`);
  fs.writeFileSync(tmpFile, buildPickerScript(windowTitle), { encoding: 'utf8' });

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmpFile], {
        windowsHide: true,
        signal,
      });
      let out = '';
      let err = '';
      const killTimer = setTimeout(() => { child.kill(); reject(new Error('Element picking timed out. Try again.')); }, 125_000);
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
  } catch (error) {
    if (signal?.aborted) return { cancelled: true };
    throw error;
  } finally {
    fs.unlink(tmpFile, () => {});
  }
}
