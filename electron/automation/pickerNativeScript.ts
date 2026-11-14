// Shared native accessibility implementation for recording and replay.
export const PICKER_NATIVE_CSHARP = String.raw`using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
using System.Reflection;
using System.Text.RegularExpressions;
[StructLayout(LayoutKind.Sequential)] public struct PickerPoint { public int X; public int Y; }
public class PickerHit {
  public string Name, AutomationId, ClassName, ControlType;
  public double Left, Top, Width, Height;
  internal Accessibility.IAccessible Accessible;
  internal object Child;
  public PickerCurrent Current { get { return new PickerCurrent(this); } }
  public void SetFocus() { PickerNative.FocusAccessible(this); }
  public void SelectOption(string value, string by) { PickerNative.SelectOption(this,value,by); }
  public object GetCurrentPattern(object pattern) {
    int id=(int)pattern.GetType().GetProperty("Id").GetValue(pattern,null);
    if(id==10000 && !String.IsNullOrEmpty(Accessible.get_accDefaultAction(Child)))return this;
    if(id==10002 && ControlType=="Edit")return this;
    if(id==10015 && ControlType=="CheckBox")return this;
    return null;
  }
  public void Invoke() { Accessible.accDoDefaultAction(Child); }
  public void Toggle() { Invoke(); }
  public void SetValue(string value) { Accessible.set_accValue(Child,value); }
}
public class ExplorerHit {
  public int Id, ParentId;
  public string Name, ControlType;
  public bool Protected;
}
public class PickerCurrent {
  private PickerHit hit;
  public PickerCurrent(PickerHit value) { hit=value; }
  public string Name { get { return hit.Name; } }
  public string Value { get { try { return hit.Accessible.get_accValue(hit.Child) ?? ""; } catch(COMException) { return ""; } } }
  public bool IsEnabled { get { return (Convert.ToInt32(hit.Accessible.get_accState(hit.Child)) & 1)==0; } }
  public bool HasKeyboardFocus { get { return (Convert.ToInt32(hit.Accessible.get_accState(hit.Child)) & 4)!=0; } }
  public bool IsOffscreen { get { return (Convert.ToInt32(hit.Accessible.get_accState(hit.Child)) & 0x18000)!=0; } }
  public int ToggleState { get { return (Convert.ToInt32(hit.Accessible.get_accState(hit.Child)) & 16)!=0 ? 1 : 0; } }
  public PickerHit BoundingRectangle { get { return hit; } }
}
public class PickerNative {
  [DllImport("oleacc.dll")] private static extern int WindowFromAccessibleObject(Accessibility.IAccessible accessible,out IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,IntPtr process);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from,uint to,bool attach);
  public static void FocusAccessible(PickerHit hit) {
    IntPtr target;
    if(WindowFromAccessibleObject(hit.Accessible,out target)<0 || target==IntPtr.Zero)throw new InvalidOperationException("Target has no native focus window");
    uint current=GetCurrentThreadId(),owner=GetWindowThreadProcessId(target,IntPtr.Zero),foreground=GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero);
    bool targetAttached=false,foregroundAttached=false;
    try {
      if(current!=owner)targetAttached=AttachThreadInput(current,owner,true);
      if(foreground!=current && foreground!=owner)foregroundAttached=AttachThreadInput(current,foreground,true);
      SetForegroundWindow(GetAncestor(target,2));
      SetFocus(target);
      hit.Accessible.accSelect(1,hit.Child);
    } finally {
      if(foregroundAttached)AttachThreadInput(current,foreground,false);
      if(targetAttached)AttachThreadInput(current,owner,false);
    }
  }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr wparam,StringBuilder text);
  [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
  public static void SelectOption(PickerHit hit,string value,string by) {
    if(hit.ControlType!="ComboBox")throw new InvalidOperationException("Target is not a combo box");
    if(by!="Text" && by!="Index")throw new InvalidOperationException("Native combo boxes support Text or Index selection, not HTML option values");
    IntPtr window;
    if(WindowFromAccessibleObject(hit.Accessible,out window)<0 || window==IntPtr.Zero)throw new InvalidOperationException("Combo box has no native window");
    var className=new StringBuilder(256);GetClassName(window,className,className.Capacity);
    if(className.ToString().IndexOf("COMBOBOX",StringComparison.OrdinalIgnoreCase)<0)throw new InvalidOperationException("This accessible combo box does not expose a native selection interface");
    int count=SendMessage(window,0x146,IntPtr.Zero,IntPtr.Zero).ToInt32(),index=-1;
    if(by=="Index") { if(!Int32.TryParse(value,out index) || index<0 || index>=count)throw new InvalidOperationException("Combo box index out of range"); }
    else for(int i=0;i<count;i++) {
      int length=SendMessage(window,0x149,(IntPtr)i,IntPtr.Zero).ToInt32();
      if(length<0)throw new InvalidOperationException("Could not read combo box option");
      var text=new StringBuilder(length+1);SendMessage(window,0x148,(IntPtr)i,text);
      if(text.ToString()==value) { if(index>=0)throw new InvalidOperationException("Combo box option text is ambiguous");index=i; }
    }
    if(index<0)throw new InvalidOperationException("Combo box option not found: "+value);
    if(SendMessage(window,0x14E,(IntPtr)index,IntPtr.Zero).ToInt32()!=index)throw new InvalidOperationException("Combo box selection failed");
    // CB_SETCURSEL does not notify the application; send the same selection-change notification as user input.
    SendMessage(GetParent(window),0x111,(IntPtr)((1<<16)|(GetDlgCtrlID(window)&0xffff)),window);
    if(SendMessage(window,0x147,IntPtr.Zero,IntPtr.Zero).ToInt32()!=index)throw new InvalidOperationException("Combo box did not retain the selection");
  }
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(PickerPoint point);
  private static readonly Dictionary<object,IntPtr> rootOwners = new Dictionary<object,IntPtr>();
  private static readonly Dictionary<object,IntPtr> rootWindows = new Dictionary<object,IntPtr>();
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window,out NativeRect rect);
  [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window,ref PickerPoint point);
  // Some legacy providers return their client tree in virtualized coordinates even
  // when the UIA window bounds and mouse APIs use physical pixels. Compare the same
  // client rectangle in both spaces instead of guessing a monitor scale factor.
  private static void NormalizeBounds(Accessibility.IAccessible root,IntPtr window,List<PickerHit> hits) {
    int x,y,width,height;
    try { root.accLocation(out x,out y,out width,out height,0); }
    catch(COMException) { return; }
    NativeRect client;var origin=new PickerPoint();
    if(width<=0 || height<=0 || !GetClientRect(window,out client) || !ClientToScreen(window,ref origin))return;
    double sx=(double)(client.Right-client.Left)/width,sy=(double)(client.Bottom-client.Top)/height;
    if(Math.Abs(sx-1)<0.01 && Math.Abs(sy-1)<0.01)return;
    if(sx<0.25 || sx>8 || Math.Abs(sx-sy)>0.05)throw new InvalidOperationException("Accessible coordinate space cannot be mapped to the target window");
    foreach(var hit in hits) {
      hit.Left=origin.X+(hit.Left-x)*sx;hit.Top=origin.Y+(hit.Top-y)*sy;
      hit.Width*=sx;hit.Height*=sy;
    }
  }
  public static string Preparation = "";
  [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromPoint(PickerPoint point, [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible accessible, [MarshalAs(UnmanagedType.Struct)] out object child);
  [DllImport("oleacc.dll")] private static extern int AccessibleChildren(Accessibility.IAccessible accessible,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,ArraySubType=UnmanagedType.Struct,SizeParamIndex=2)] object[] children,out int obtained);
  private static PickerHit MsaaRead(Accessibility.IAccessible accessible,object child) {
    int role=Convert.ToInt32(accessible.get_accRole(child));
    int left,top,width,height; accessible.accLocation(out left,out top,out width,out height,child);
    string type=role==43 ? "Button" : role==42 ? "Edit" : role==30 ? "Hyperlink" : role==44 ? "CheckBox" : role==45 ? "RadioButton" : role==46 ? "ComboBox" : role==41 ? "Text" : "Pane";
    return new PickerHit { Accessible=accessible,Child=child,Name=accessible.get_accName(child) ?? "",AutomationId="",ClassName="",ControlType=type,Left=left,Top=top,Width=width,Height=height };
  }
  private static PickerHit MsaaDeep(Accessibility.IAccessible accessible,int x,int y,int depth,ref int budget,System.Diagnostics.Stopwatch clock) {
    if(depth>32 || --budget<0 || clock.ElapsedMilliseconds>400)return null;
    PickerHit best=MsaaRead(accessible,0);
    int count=Math.Min(accessible.accChildCount,200);
    if(count<=0)return best;
    object[] children=new object[count];int obtained;
    if(AccessibleChildren(accessible,0,count,children,out obtained)<0)return best;
    for(int index=0;index<obtained && budget>0 && clock.ElapsedMilliseconds<=400;index++) {
      try {
        var child=children[index] as Accessibility.IAccessible;
        var hit=child!=null ? MsaaRead(child,0) : MsaaRead(accessible,children[index]);
        if(hit.Width<=0 || hit.Height<=0 || (x>=hit.Left && y>=hit.Top && x<hit.Left+hit.Width && y<hit.Top+hit.Height)) {
          if(child!=null)hit=MsaaDeep(child,x,y,depth+1,ref budget,clock) ?? hit;
          int score=hit.ControlType=="Pane" ? 0 : hit.ControlType=="Text" ? 60 : 100;
          int bestScore=best.ControlType=="Pane" ? 0 : best.ControlType=="Text" ? 60 : 100;
          if(score>=bestScore)best=hit;
        }
      } catch(COMException) { }
    }
    return best;
  }
  public static PickerHit MsaaHitTest(int x, int y) {
    Accessibility.IAccessible accessible; object child;
    if (AccessibleObjectFromPoint(new PickerPoint { X=x, Y=y }, out accessible, out child) < 0 || accessible == null) return null;
    PickerHit hit=MsaaRead(accessible,child);
    if(hit.ControlType!="Pane")return hit;
    foreach(object root in accessibilityRoots) {
      IntPtr owner;
      if(rootOwners.TryGetValue(root,out owner) && owner!=GetAncestor(WindowFromPoint(new PickerPoint { X=x,Y=y }),2))continue;
      var acc=root as Accessibility.IAccessible;
      if(acc==null)continue;
      int budget=1500;
      var candidate=MsaaDeep(acc,x,y,0,ref budget,System.Diagnostics.Stopwatch.StartNew());
      if(candidate!=null && candidate.ControlType!="Pane")return candidate;
    }
    return hit;
  }
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern bool GetPhysicalCursorPos(out PickerPoint point);
  public static void UsePhysicalCoordinates() { try { SetThreadDpiAwarenessContext((IntPtr)(-4)); } catch (EntryPointNotFoundException) { } }
  public static PickerPoint CursorPoint() { PickerPoint point; GetPhysicalCursorPos(out point); return point; }
  public static PickerHit HitTest(int x,int y) { return MsaaHitTest(x,y); }
  private delegate bool EnumWindowProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, EnumWindowProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out object accessible);
  private static readonly HashSet<IntPtr> requested = new HashSet<IntPtr>();
  private static readonly List<object> accessibilityRoots = new List<object>();
  private static void RequestAccessibility(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero || !requested.Add(hwnd)) return;
    Preparation += " hwnd=" + hwnd;
    UIntPtr result;
    // Legacy Chromium/Electron uses MSAA; newer Chromium also exposes native UIA.
    SendMessageTimeout(hwnd, 0x003D, UIntPtr.Zero, (IntPtr)1, 0x0002, 250, out result);
    SendMessageTimeout(hwnd, 0x003D, UIntPtr.Zero, (IntPtr)(-4), 0x0002, 250, out result);
    SendMessageTimeout(hwnd, 0x003D, UIntPtr.Zero, (IntPtr)(-25), 0x0002, 250, out result);
    try {
      Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
      object accessible;
      int status = AccessibleObjectFromWindow(hwnd, unchecked((uint)-4), ref iid, out accessible);
      Preparation += " msaa=" + status;
      if (status >= 0 && accessible != null) {
        accessibilityRoots.Add(accessible);
        rootOwners[accessible]=GetAncestor(hwnd,2);
        rootWindows[accessible]=hwnd;
        IntPtr unknown = Marshal.GetIUnknownForObject(accessible);
        try {
          Guid ia2 = new Guid("E89F726E-C4F4-4c19-BB19-B647D7FA8478");
          IntPtr extended;
          if (Marshal.QueryInterface(unknown, ref ia2, out extended) >= 0 && extended != IntPtr.Zero) Marshal.Release(extended);
        } finally { Marshal.Release(unknown); }
        // Retrieving the COM pointer alone does not activate a cold Chromium tree.
        accessible.GetType().InvokeMember("accName", BindingFlags.GetProperty, null, accessible, new object[] { 0 });
        accessible.GetType().InvokeMember("accChildCount", BindingFlags.GetProperty, null, accessible, null);
      }
    } catch (Exception error) { Preparation += " error=" + error.Message; }
  }
  public static void PrepareChromium(IntPtr hwnd) {
    RequestAccessibility(hwnd);
    EnumChildWindows(hwnd, delegate(IntPtr child, IntPtr data) {
      var name = new StringBuilder(256);
      GetClassName(child, name, name.Capacity);
      if (name.ToString().StartsWith("Chrome_RenderWidgetHostHWND")) RequestAccessibility(child);
      return true;
    }, IntPtr.Zero);
  }
  public static string StableName(string name) {
    return Regex.Replace(name ?? "", @"\s+\d+\s+unread\s+messages?\s*$", "", RegexOptions.IgnoreCase).TrimEnd();
  }
  private static bool NameMatches(string actual,string expected,string mode) {
    return mode=="IgnoreUnreadCount" ? StableName(actual)==StableName(expected) : actual==expected;
  }
  private static bool lookupTruncated;
  private static void FindMatches(Accessibility.IAccessible accessible,string name,string role,string mode,List<PickerHit> matches,HashSet<string> seen,int depth,ref int budget,System.Diagnostics.Stopwatch clock) {
    if(depth>48 || --budget<0 || clock.ElapsedMilliseconds>5000) { lookupTruncated=true;return; }
    try {
      var hit=MsaaRead(accessible,0);
      if(NameMatches(hit.Name,name,mode) && hit.ControlType==role && hit.Width>0 && hit.Height>0) {
        string identity=hit.Name+"|"+hit.ControlType+"|"+hit.Left+","+hit.Top+","+hit.Width+","+hit.Height;
        if(seen.Add(identity))matches.Add(hit);
      }
      int total=accessible.accChildCount;int count=Math.Min(total,1000);if(total>count)lookupTruncated=true;if(count<=0)return;
      object[] children=new object[count];int obtained;
      if(AccessibleChildren(accessible,0,count,children,out obtained)<0)return;
      for(int i=0;i<obtained;i++) {
        if(budget<=0 || clock.ElapsedMilliseconds>5000) { lookupTruncated=true;break; }
        var child=children[i] as Accessibility.IAccessible;
        if(child!=null)FindMatches(child,name,role,mode,matches,seen,depth+1,ref budget,clock);
        else {
          var item=MsaaRead(accessible,children[i]);
          if(NameMatches(item.Name,name,mode) && item.ControlType==role && item.Width>0 && item.Height>0) {
            string identity=item.Name+"|"+item.ControlType+"|"+item.Left+","+item.Top+","+item.Width+","+item.Height;
            if(seen.Add(identity))matches.Add(item);
          }
        }
      }
    } catch(COMException) { }
  }
  public static PickerHit FindControl(IntPtr hwnd,string name,string role) {
    return FindControl(hwnd,name,role,"IgnoreUnreadCount");
  }
  public static PickerHit FindControl(IntPtr hwnd,string name,string role,string mode) {
    if(mode!="Exact" && mode!="IgnoreUnreadCount")throw new InvalidOperationException("Unknown name match mode");
    UsePhysicalCoordinates();
    PrepareChromium(hwnd);
    lookupTruncated=false;
    var matches=new List<PickerHit>();var seen=new HashSet<string>();int budget=10000;
    var clock=System.Diagnostics.Stopwatch.StartNew();
    foreach(object root in accessibilityRoots) {
      var accessible=root as Accessibility.IAccessible;
      if(accessible!=null) {
        var group=new List<PickerHit>();var groupSeen=new HashSet<string>();
        FindMatches(accessible,name,role,mode,group,groupSeen,0,ref budget,clock);
        IntPtr window;
        if(rootWindows.TryGetValue(root,out window))NormalizeBounds(accessible,window,group);
        foreach(var hit in group) {
          string identity=hit.Name+"|"+hit.ControlType+"|"+hit.Left+","+hit.Top+","+hit.Width+","+hit.Height;
          if(seen.Add(identity))matches.Add(hit);
        }
      }
    }
    if(lookupTruncated)throw new InvalidOperationException("Accessible tree scan limit reached. A unique target could not be confirmed.");
    if(matches.Count==0)throw new InvalidOperationException("Accessible control not found: "+name);
    if(matches.Count!=1)throw new InvalidOperationException("Accessible selector is ambiguous: "+name);
    return matches[0];
  }
  public static bool ExplorerTruncated;
  private static void WalkExplorer(Accessibility.IAccessible accessible,object child,int parent,int depth,List<ExplorerHit> nodes,HashSet<object> seen,System.Diagnostics.Stopwatch clock) {
    if(nodes.Count>=1500 || depth>40 || clock.ElapsedMilliseconds>3500) { ExplorerTruncated=true;return; }
    try {
      var hit=MsaaRead(accessible,child);
      bool protectedField=(Convert.ToInt32(accessible.get_accState(child)) & 0x20000000)!=0;
      int id=nodes.Count;
      nodes.Add(new ExplorerHit { Id=id,ParentId=parent,Name=protectedField ? "[Protected]" : hit.Name,ControlType=hit.ControlType,Protected=protectedField });
      if(protectedField || Convert.ToInt32(child)!=0 || !seen.Add(accessible))return;
      int count=Math.Min(accessible.accChildCount,1500);if(count<=0)return;
      object[] children=new object[count];int obtained;
      if(AccessibleChildren(accessible,0,count,children,out obtained)<0)return;
      for(int i=0;i<obtained;i++) {
        if(nodes.Count>=1500 || clock.ElapsedMilliseconds>3500) { ExplorerTruncated=true;break; }
        var nested=children[i] as Accessibility.IAccessible;
        WalkExplorer(nested ?? accessible,nested!=null ? (object)0 : children[i],id,depth+1,nodes,seen,clock);
      }
    } catch(COMException) { }
  }
  public static ExplorerHit[] Explore(IntPtr hwnd) {
    UsePhysicalCoordinates();PrepareChromium(hwnd);ExplorerTruncated=false;
    var nodes=new List<ExplorerHit>();var seen=new HashSet<object>();var clock=System.Diagnostics.Stopwatch.StartNew();
    foreach(object root in accessibilityRoots) {
      IntPtr owner;
      if(!rootOwners.TryGetValue(root,out owner) || owner!=GetAncestor(hwnd,2))continue;
      var accessible=root as Accessibility.IAccessible;
      if(accessible!=null)WalkExplorer(accessible,0,-1,0,nodes,seen,clock);
    }
    return nodes.ToArray();
  }
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
}`;
