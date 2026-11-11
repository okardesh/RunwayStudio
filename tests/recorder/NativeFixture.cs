using System;
using System.IO;
using System.Windows.Forms;
using System.Drawing;

class NativeFixture {
  [STAThread]
  static void Main(string[] args) {
    Application.EnableVisualStyles();
    var form = new Form { Text = args[0], Width = 640, Height = 400, StartPosition = FormStartPosition.CenterScreen };
    var button = new Button { Name = "saveButton", Text = "Kaydet \u0130stanbul", AccessibleName = "Kaydet \u0130stanbul", Location = new Point(50, 70), Size = new Size(250, 60), Font = new Font("Segoe UI", 16) };
    form.Controls.Add(button);
    form.Shown += delegate { File.WriteAllText(args[1], "ready"); };
    Application.Run(form);
  }
}
