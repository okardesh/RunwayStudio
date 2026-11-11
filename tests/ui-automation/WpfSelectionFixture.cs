using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using System.Windows.Threading;
using System.Web.Script.Serialization;
class WpfSelectionFixture {
  [STAThread] static void Main(string[] args) {
    var app=new Application();
    var panel=new StackPanel { Margin=new Thickness(30) };
    var combo=new ComboBox { Width=320, Height=35, HorizontalAlignment=HorizontalAlignment.Left };
    AutomationProperties.SetName(combo,"City");
    foreach(var text in new[]{"Ankara","İstanbul","İzmir","'İstanbul', +{}","Duplicate","Duplicate"})combo.Items.Add(new ComboBoxItem { Content=text });
    combo.SelectedIndex=0;
    int selections=0;
    combo.SelectionChanged+=(s,e)=>selections++;
    panel.Children.Add(new TextBlock { Text="Runway WPF selection fixture", Margin=new Thickness(0,0,0,20) });panel.Children.Add(combo);
    var window=new Window { Title=args[0], Width=650, Height=350, WindowStartupLocation=WindowStartupLocation.CenterScreen, Content=panel };
    var timer=new DispatcherTimer { Interval=TimeSpan.FromMilliseconds(50) };
    timer.Tick+=(s,e)=>{try { File.WriteAllText(args[1],new JavaScriptSerializer().Serialize(new { city=((ComboBoxItem)combo.SelectedItem).Content,selections })); }catch(IOException){} };
    window.Loaded+=(s,e)=>timer.Start();
    app.Run(window);
  }
}
