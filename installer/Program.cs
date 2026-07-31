using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

// Tiny launcher: double-clicking this .exe just opens twitch-bot-control.exe
// in this program's own folder. The control panel is fully self-contained
// now -- it walks you through checking for Node.js, installing
// dependencies, and connecting your Twitch account all from its own UI,
// so there's no separate batch-file wizard to run first.
class Launcher
{
    [STAThread]
    static int Main()
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string controlExe = Path.Combine(exeDir, "twitch-bot-control.exe");

        if (!File.Exists(controlExe))
        {
            MessageBox.Show(
                "twitch-bot-control.exe was not found next to this program.\nExpected it at: " + controlExe,
                "twitch-bot",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = controlExe,
            WorkingDirectory = exeDir,
            UseShellExecute = true,
        });
        return 0;
    }
}
