using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
class MousePanel : Panel { public MousePanel(){SetStyle(ControlStyles.StandardClick | ControlStyles.StandardDoubleClick,true);} }
class NativeFixture {
  [STAThread] static void Main(string[] args) {
    Application.EnableVisualStyles();
    var form = new Form { Text=args[0], Width=850, Height=650, StartPosition=FormStartPosition.CenterScreen };
    int clicks=0, doubles=0, rights=0, hovers=0, enters=0,buttonHovers=0,buttonRights=0,selections=0;
    var keys=new List<int>();
    var button=new Button { Text="Approve", AccessibleName="Approve", Location=new Point(30,30), Size=new Size(200,55) };
    var panel=new MousePanel { AccessibleName="Mouse target", Location=new Point(270,30), Size=new Size(200,55), BackColor=Color.LightBlue };
    var input=new TextBox { AccessibleName="Search address", Location=new Point(30,120), Width=350 };
    var check=new CheckBox { Text="Enabled option", AccessibleName="Enabled option", Location=new Point(30,170), Width=250 };
    var combo=new ComboBox { AccessibleName="City", Location=new Point(30,220), Width=250, DropDownStyle=ComboBoxStyle.DropDownList };
    combo.Items.AddRange(new object[]{"Ankara","İstanbul","İzmir","'İstanbul', +{}","Duplicate","Duplicate"});combo.SelectedIndex=0;
    combo.SelectedIndexChanged+=(s,e)=>selections++;
    var label=new Label { Text="İstanbul visible text", AccessibleName="Fixture label", Location=new Point(30,280), Width=350 };
    var readonlyBox=new TextBox { AccessibleName="Read only", Text="fixed", ReadOnly=true, Location=new Point(30,330), Width=250 };
    button.Click+=(s,e)=>clicks++;
    panel.MouseDoubleClick+=(s,e)=>doubles++;
    panel.MouseDown+=(s,e)=>{if(e.Button==MouseButtons.Right)rights++;};
    panel.MouseEnter+=(s,e)=>hovers++;
    input.KeyDown+=(s,e)=>{keys.Add((int)e.KeyCode);if(e.KeyCode==Keys.Enter)enters++;};
    button.MouseEnter+=(s,e)=>buttonHovers++;
    button.MouseDown+=(s,e)=>{if(e.Button==MouseButtons.Right)buttonRights++;};
    form.Controls.AddRange(new Control[]{button,panel,input,check,combo,label,readonlyBox});
    var timer=new Timer { Interval=50 };
    timer.Tick+=(s,e)=>{try{ File.WriteAllText(args[1], new JavaScriptSerializer().Serialize(new { clicks,doubles,rights,hovers,enters,buttonHovers,buttonRights,selections,keys,text=input.Text,check=check.Checked,city=combo.SelectedItem,windowState=form.WindowState.ToString(),width=form.Width,height=form.Height,cursorX=Cursor.Position.X,cursorY=Cursor.Position.Y,targetX=panel.PointToScreen(Point.Empty).X,targetY=panel.PointToScreen(Point.Empty).Y,targetWidth=panel.Width,targetHeight=panel.Height })); }catch(IOException){} };
    form.Shown+=(s,e)=>timer.Start();
    Application.Run(form);
  }
}
