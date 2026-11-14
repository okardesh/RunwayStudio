import { ps, buildFinder } from './desktop';
import { PICKER_NATIVE_CSHARP } from './pickerNativeScript';
import { accessibleSelector, type ExplorerSnapshot } from '../../src/shared/uiExplorer';

export async function inspectUi(windowTitle: string, provider: 'msaa' | 'uia' = 'msaa'): Promise<ExplorerSnapshot> {
  if (process.platform !== 'win32') throw Error('UI Explorer currently supports Windows applications.');
  if (typeof windowTitle !== 'string' || !windowTitle || windowTitle.length > 500) throw Error('Choose an application window.');
  if (!['msaa', 'uia'].includes(provider)) throw Error('Unknown accessibility provider.');
  const title = "'" + windowTitle.replace(/'/g, "''") + "'";
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -ReferencedAssemblies @('System.dll','System.Core.dll',(Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'Accessibility.dll')) -TypeDefinition @"
${PICKER_NATIVE_CSHARP}
"@
[PickerNative]::UsePhysicalCoordinates()
$root=[System.Windows.Automation.AutomationElement]::RootElement
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,${title})
$windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
if($windows.Count -ne 1){throw 'Choose a uniquely named open application window.'}
$window=$windows[0]
` + (provider === 'msaa' ? `
$nodes=@([PickerNative]::Explore([IntPtr]$window.Current.NativeWindowHandle))
@{nodes=$nodes;truncated=[PickerNative]::ExplorerTruncated}|ConvertTo-Json -Depth 8 -Compress
` : `
$nodes=New-Object System.Collections.Generic.List[object]
$clock=[Diagnostics.Stopwatch]::StartNew();$script:truncated=$false
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
function Walk($element,$parent,$depth){
 if($nodes.Count -ge 1500 -or $depth -gt 40 -or $clock.ElapsedMilliseconds -gt 3500){$script:truncated=$true;return}
 try {
  $c=$element.Current;$id=$nodes.Count;$protected=$c.IsPassword
  $name=if($protected){'[Protected]'}else{$c.Name}
  $nodes.Add(@{Id=$id;ParentId=$parent;Name=$name;ControlType=($c.ControlType.ProgrammaticName -replace '^ControlType\\.','');AutomationId=$c.AutomationId;ClassName=$c.ClassName;Protected=$protected})
  if($protected){return}
  $child=$walker.GetFirstChild($element)
  while($null -ne $child){
   if($nodes.Count -ge 1500 -or $clock.ElapsedMilliseconds -gt 3500){$script:truncated=$true;break}
   Walk $child $id ($depth+1);$child=$walker.GetNextSibling($child)
  }
 }catch [System.Windows.Automation.ElementNotAvailableException]{}
}
Walk $window -1 0
@{nodes=@($nodes.ToArray());truncated=$script:truncated}|ConvertTo-Json -Depth 8 -Compress
`);
  const result = JSON.parse((await ps(script, 15000)).split(/\r?\n/).filter(Boolean).pop()!);
  return { provider, truncated: !!result.truncated, nodes: (result.nodes ?? []).map((node: any) => {
    const name = String(node.Name ?? ''), controlType = String(node.ControlType ?? ''), automationId = String(node.AutomationId ?? ''), className = String(node.ClassName ?? '');
    // UIA AutomationId provides a stable alternative to visible text when available.
    const safeUia = (value: string) => !!value && !/[>,\r\n]/.test(value);
    let selector = '';
    if (!node.Protected) {
      if (provider === 'msaa' && name) selector = accessibleSelector(windowTitle, name, controlType);
      else if (provider === 'uia' && safeUia(automationId)) selector = `window:${windowTitle} > automationId:${automationId}`;
      else if (provider === 'uia' && safeUia(name)) selector = `window:${windowTitle} > controlType:${controlType},name:${name}`;
    }
    return { id: String(node.Id), parentId: node.ParentId < 0 ? null : String(node.ParentId), name, controlType, automationId, className, protected: !!node.Protected, selector };
  }) };
}

export async function validateUiSelector(selector: string, highlight = false) {
  if (typeof selector !== 'string' || selector.length > 12000 || !selector.startsWith('window:')) throw Error('Enter a desktop selector.');
  const script = buildFinder(selector) + `
$r=$el.Current.BoundingRectangle
if($r.Width -le 0 -or $r.Height -le 0 -or $el.Current.IsOffscreen){throw 'The target is off-screen or has no visible bounds.'}
` + (highlight ? `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -WarningAction SilentlyContinue -ReferencedAssemblies @('System.Windows.Forms.dll','System.Drawing.dll') -TypeDefinition @"
public class ExplorerOutline : System.Windows.Forms.Form {
 protected override bool ShowWithoutActivation { get { return true; } }
 protected override System.Windows.Forms.CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle|=0x08000020;return p; } }
}
"@
$forms=New-Object System.Collections.Generic.List[object]
try {
 foreach($rect in @(@([int]$r.Left,[int]$r.Top,[int]$r.Width,3),@([int]$r.Left,[int]($r.Top+$r.Height-3),[int]$r.Width,3),@([int]$r.Left,[int]$r.Top,3,[int]$r.Height),@([int]($r.Left+$r.Width-3),[int]$r.Top,3,[int]$r.Height))){
  $f=New-Object ExplorerOutline;$f.FormBorderStyle='None';$f.StartPosition='Manual';$f.ShowInTaskbar=$false;$f.TopMost=$true;$f.BackColor=[Drawing.Color]::DodgerBlue
  $f.Bounds=New-Object Drawing.Rectangle($rect[0],$rect[1],$rect[2],$rect[3]);$forms.Add($f);$f.Show()
 }
 $until=[DateTime]::UtcNow.AddMilliseconds(1200)
 while([DateTime]::UtcNow -lt $until){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 20}
}finally{foreach($f in $forms){$f.Close();$f.Dispose()}}
` : '') + `
@{ok=$true;name=$el.Current.Name;left=$r.Left;top=$r.Top;width=$r.Width;height=$r.Height}|ConvertTo-Json -Compress
`;
  return JSON.parse((await ps(script, 15000)).split(/\r?\n/).filter(Boolean).pop()!);
}
