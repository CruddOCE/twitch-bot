using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Windows.Forms;

// Self-contained control panel: on first run, walks you through getting
// Node.js, installing dependencies, and signing in with Twitch, all from
// this window -- no separate installer/wizard console needed. Once set
// up, it's the day-to-day dashboard: start/stop the bot, watch live chat
// with per-user coloring, see an activity log, connect OBS, and self-
// update. Closing the window stops the bot if it's running, so there's
// no separate "turn it off" step to remember after a stream.
class ControlApp
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}

// Centralized dark palette so every control matches.
static class Theme
{
    public static readonly Color Background = Color.FromArgb(24, 24, 27);
    public static readonly Color Panel = Color.FromArgb(32, 32, 36);
    public static readonly Color Header = Color.FromArgb(18, 18, 20);
    public static readonly Color Border = Color.FromArgb(50, 50, 55);
    public static readonly Color Text = Color.FromArgb(230, 230, 235);
    public static readonly Color MutedText = Color.FromArgb(150, 150, 160);
    public static readonly Color Accent = Color.FromArgb(145, 70, 255);
    public static readonly Color AccentDark = Color.FromArgb(105, 50, 190);
    public static readonly Color Running = Color.FromArgb(87, 242, 135);
    public static readonly Color Stopped = Color.FromArgb(255, 92, 92);
    public static readonly Color Pending = Color.FromArgb(255, 190, 90);
    public static readonly Color Secondary = Color.FromArgb(55, 55, 62);

    public static Font Title = new Font("Segoe UI", 14, FontStyle.Bold);
    public static Font Subtitle = new Font("Segoe UI", 9.5F);
    public static Font Body = new Font("Segoe UI", 9.5F);
    public static Font BodyBold = new Font("Segoe UI", 9.5F, FontStyle.Bold);
    public static Font Small = new Font("Segoe UI", 8.5F);
    public static Font SmallBold = new Font("Segoe UI", 8.5F, FontStyle.Bold);
    public static Font Mono = new Font("Consolas", 9F);

    public static Color Lighten(Color c, int amount)
    {
        return Color.FromArgb(c.A, Math.Min(255, c.R + amount), Math.Min(255, c.G + amount), Math.Min(255, c.B + amount));
    }

    public static Button MakeButton(string text, Color back, Color fore)
    {
        var b = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            BackColor = back,
            ForeColor = fore,
            Font = BodyBold,
            Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderSize = 0;
        Color hover = Lighten(back, 18);
        b.MouseEnter += (s, e) => { if (b.Enabled) b.BackColor = hover; };
        b.MouseLeave += (s, e) => b.BackColor = back;
        b.EnabledChanged += (s, e) => b.BackColor = b.Enabled ? back : Secondary;
        return b;
    }

    public static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        int d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

// A small filled circle used for status indicators (RUNNING/STOPPED, step
// completion) -- drawn via GDI+ rather than a Unicode glyph, since an
// earlier version of this app hit font-rendering issues (tofu boxes) with
// Unicode bullet characters on some systems.
class Dot : Panel
{
    public Color DotColor = Theme.MutedText;
    public Dot() { Size = new Size(10, 10); }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var brush = new SolidBrush(DotColor))
        {
            e.Graphics.FillEllipse(brush, 0, 0, Width - 1, Height - 1);
        }
    }
}

// Small rounded badge with a letter/number, used for the header logo mark
// and the setup steps' numbering.
class Badge : Panel
{
    public string Label = "";
    public Font BadgeFont = new Font("Segoe UI", 11, FontStyle.Bold);
    public Color Fore = Color.White;
    private readonly bool gradient;

    public Badge(int size, bool gradient = true)
    {
        Size = new Size(size, size);
        this.gradient = gradient;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, Math.Max(4, Width / 4)))
        {
            if (gradient)
            {
                using (var brush = new LinearGradientBrush(rect, Theme.Accent, Theme.AccentDark, 45f))
                {
                    e.Graphics.FillPath(brush, path);
                }
            }
            else
            {
                using (var brush = new SolidBrush(Theme.Secondary))
                {
                    e.Graphics.FillPath(brush, path);
                }
            }
        }
        TextRenderer.DrawText(e.Graphics, Label, BadgeFont, ClientRectangle, Fore, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }
}

class MainForm : Form
{
    private const string AppVersion = "0.5.0";

    private readonly string rootDir;
    private Process botProcess;
    private bool nodeAvailable;
    private bool hasEnteredDashboard;

    // Header
    private Button toggleButton;
    private Dot statusDot;
    private Label statusLabel;

    // Dashboard
    private Panel dashboardPanel;
    private Button obsButton;
    private Button testAlertButton;
    private Button updateButton;
    private TextBox obsPasswordBox;
    private RichTextBox chatBox;
    private RichTextBox logBox;
    private bool chatIsEmpty = true;

    // Setup
    private Panel setupPanel;
    private RichTextBox setupLogBox;
    private Dot nodeDot;
    private Label nodeStatusLabel;
    private Button nodeDownloadButton;
    private Button nodeRecheckButton;
    private Dot depsDot;
    private Label depsStatusLabel;
    private Button installDepsButton;
    private Dot accountDot;
    private Label accountStatusLabel;
    private TextBox usernameBox;
    private TextBox channelBox;
    private Button connectButton;

    private readonly Dictionary<string, Color> userColors = new Dictionary<string, Color>();

    private static readonly Color[] UserPalette = new[]
    {
        Color.FromArgb(255, 129, 122), Color.FromArgb(122, 190, 255), Color.FromArgb(255, 200, 110),
        Color.FromArgb(150, 235, 160), Color.FromArgb(255, 150, 225), Color.FromArgb(140, 225, 225),
        Color.FromArgb(205, 175, 255), Color.FromArgb(255, 225, 130), Color.FromArgb(180, 255, 180),
        Color.FromArgb(255, 175, 210),
    };

    public MainForm()
    {
        rootDir = AppDomain.CurrentDomain.BaseDirectory;

        Text = "twitch-bot";
        Width = 940;
        Height = 600;
        MinimumSize = new Size(760, 460);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.Background;
        Font = Theme.Body;
        Icon = CreateAppIcon();
        FormClosing += OnFormClosing;

        dashboardPanel = BuildDashboardPanel();
        setupPanel = BuildSetupPanel();

        Controls.Add(dashboardPanel);
        Controls.Add(setupPanel);
        Controls.Add(BuildHeader());

        nodeAvailable = CheckNodeAvailable();
        RefreshSetupState();
    }

    private static Icon CreateAppIcon()
    {
        using (var bmp = new Bitmap(32, 32))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(1, 1, 29, 29);
            using (var path = Theme.RoundedRect(rect, 7))
            using (var brush = new LinearGradientBrush(new Rectangle(0, 0, 32, 32), Theme.Accent, Theme.AccentDark, 45f))
            {
                g.FillPath(brush, path);
            }
            using (var font = new Font("Segoe UI", 15, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "T", font, new Rectangle(0, 0, 32, 32), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }

    // ---------- Header ----------

    private Panel BuildHeader()
    {
        var header = new Panel { Dock = DockStyle.Top, Height = 68, BackColor = Theme.Header };

        var logo = new Badge(36) { Label = "T", Location = new Point(16, 16), BadgeFont = new Font("Segoe UI", 15, FontStyle.Bold) };

        var title = new Label
        {
            Text = "twitch-bot",
            Font = Theme.Title,
            ForeColor = Theme.Text,
            AutoSize = true,
            Location = new Point(62, 12),
        };

        var version = new Label
        {
            Text = "v" + AppVersion,
            Font = Theme.Small,
            ForeColor = Theme.MutedText,
            AutoSize = true,
            Location = new Point(63, 38),
        };

        statusDot = new Dot { DotColor = Theme.Stopped, Anchor = AnchorStyles.Top | AnchorStyles.Right };
        statusLabel = new Label
        {
            Text = "STOPPED",
            Font = Theme.BodyBold,
            ForeColor = Theme.Stopped,
            AutoSize = true,
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
        };

        toggleButton = Theme.MakeButton("Start Bot", Theme.Accent, Color.White);
        toggleButton.Size = new Size(120, 34);
        toggleButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        toggleButton.Click += OnToggleClick;

        header.Controls.Add(logo);
        header.Controls.Add(title);
        header.Controls.Add(version);
        header.Controls.Add(statusDot);
        header.Controls.Add(statusLabel);
        header.Controls.Add(toggleButton);

        Action positionRightSide = () =>
        {
            toggleButton.Location = new Point(header.ClientSize.Width - toggleButton.Width - 16, 17);
            statusLabel.Location = new Point(toggleButton.Left - statusLabel.Width - 22, 26);
            statusDot.Location = new Point(statusLabel.Left - 18, 30);
        };
        header.Resize += (s, e) => positionRightSide();
        positionRightSide();

        return header;
    }

    // ---------- Dashboard ----------

    private Panel BuildDashboardPanel()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false };
        panel.Controls.Add(BuildBottomBar());
        panel.Controls.Add(BuildMainSplit());
        return panel;
    }

    private SplitContainer BuildMainSplit()
    {
        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            BackColor = Theme.Border,
            SplitterWidth = 2,
        };

        split.Panel1.Controls.Add(BuildFeedPanel("LIVE CHAT", out chatBox, true, "Chat will appear here once you're connected..."));
        split.Panel2.Controls.Add(BuildFeedPanel("ACTIVITY LOG", out logBox, false, null));
        split.Panel1.BackColor = Theme.Background;
        split.Panel2.BackColor = Theme.Background;

        split.HandleCreated += (s, e) =>
        {
            try { split.SplitterDistance = (int)(split.Width * 0.62); }
            catch { /* width not settled yet on some resizes; harmless to skip */ }
        };

        return split;
    }

    private Panel BuildFeedPanel(string headerText, out RichTextBox box, bool isChat, string placeholder)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Padding = new Padding(10, 8, 10, 10) };

        var header = new Label
        {
            Text = headerText,
            Font = Theme.Small,
            ForeColor = Theme.MutedText,
            Dock = DockStyle.Top,
            Height = 22,
        };

        var rtb = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Panel,
            ForeColor = Theme.Text,
            Font = isChat ? Theme.Body : Theme.Mono,
        };

        if (placeholder != null)
        {
            rtb.Text = placeholder;
            rtb.ForeColor = Theme.MutedText;
        }

        panel.Controls.Add(rtb);
        panel.Controls.Add(header);
        box = rtb;
        return panel;
    }

    private Panel BuildBottomBar()
    {
        var bar = new Panel { Dock = DockStyle.Bottom, Height = 52, BackColor = Theme.Header };

        var obsLabel = new Label
        {
            Text = "OBS password:",
            ForeColor = Theme.MutedText,
            Font = Theme.Small,
            Location = new Point(16, 19),
            AutoSize = true,
        };
        obsPasswordBox = new TextBox
        {
            Location = new Point(105, 15),
            Width = 130,
            PasswordChar = '*',
            BackColor = Theme.Secondary,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.FixedSingle,
        };
        obsButton = Theme.MakeButton("Add OBS Browser Source", Theme.Secondary, Theme.Text);
        obsButton.Location = new Point(245, 11);
        obsButton.Size = new Size(190, 30);
        obsButton.Click += OnObsButtonClick;

        testAlertButton = Theme.MakeButton("Test Alert", Theme.Secondary, Theme.Text);
        testAlertButton.Location = new Point(445, 11);
        testAlertButton.Size = new Size(100, 30);
        testAlertButton.Click += OnTestAlertClick;

        updateButton = Theme.MakeButton("Update", Theme.Secondary, Theme.Text);
        updateButton.Size = new Size(90, 30);
        updateButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        updateButton.Click += OnUpdateButtonClick;

        bar.Controls.Add(obsLabel);
        bar.Controls.Add(obsPasswordBox);
        bar.Controls.Add(obsButton);
        bar.Controls.Add(testAlertButton);
        bar.Controls.Add(updateButton);

        bar.Resize += (s, e) => { updateButton.Location = new Point(bar.ClientSize.Width - updateButton.Width - 16, 11); };

        return bar;
    }

    // ---------- Setup ----------

    private Panel BuildSetupPanel()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false, Padding = new Padding(24, 20, 24, 16) };

        var title = new Label
        {
            Text = "Let's get you set up",
            Font = Theme.Title,
            ForeColor = Theme.Text,
            AutoSize = true,
            Dock = DockStyle.Top,
            Height = 32,
        };
        var subtitle = new Label
        {
            Text = "A few quick steps, then you're ready to start the bot.",
            Font = Theme.Subtitle,
            ForeColor = Theme.MutedText,
            AutoSize = true,
            Dock = DockStyle.Top,
            Height = 26,
            Margin = new Padding(0, 0, 0, 8),
        };

        var step1 = BuildStep("1", "Node.js", out nodeDot, out nodeStatusLabel, BuildNodeStepControls());
        var step2 = BuildStep("2", "Install dependencies", out depsDot, out depsStatusLabel, BuildDepsStepControls());
        var step3 = BuildStep("3", "Connect your Twitch account", out accountDot, out accountStatusLabel, BuildAccountStepControls());

        var logHeader = new Label
        {
            Text = "SETUP LOG",
            Font = Theme.Small,
            ForeColor = Theme.MutedText,
            Dock = DockStyle.Top,
            Height = 22,
            Margin = new Padding(0, 12, 0, 0),
        };
        setupLogBox = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Panel,
            ForeColor = Theme.MutedText,
            Font = Theme.Mono,
        };

        // Dock=Top controls stack in reverse of add order, so add the
        // fill-area content first, then each step (bottom-most first),
        // then the header text last so it ends up on top.
        panel.Controls.Add(setupLogBox);
        panel.Controls.Add(logHeader);
        panel.Controls.Add(step3);
        panel.Controls.Add(step2);
        panel.Controls.Add(step1);
        panel.Controls.Add(subtitle);
        panel.Controls.Add(title);

        return panel;
    }

    private Panel BuildStep(string number, string title, out Dot dot, out Label statusLabel, Control extraControls)
    {
        var row = new Panel { Dock = DockStyle.Top, Height = 64, Padding = new Padding(0, 8, 0, 8) };

        var badge = new Badge(32, gradient: false) { Label = number, Location = new Point(0, 8), BadgeFont = Theme.BodyBold };

        var titleLabel = new Label
        {
            Text = title,
            Font = Theme.BodyBold,
            ForeColor = Theme.Text,
            AutoSize = true,
            Location = new Point(44, 4),
        };

        var d = new Dot { Location = new Point(44, 30) };
        var status = new Label
        {
            Font = Theme.Small,
            ForeColor = Theme.MutedText,
            AutoSize = true,
            Location = new Point(60, 27),
        };

        row.Controls.Add(badge);
        row.Controls.Add(titleLabel);
        row.Controls.Add(d);
        row.Controls.Add(status);

        if (extraControls != null)
        {
            extraControls.Location = new Point(300, 4);
            row.Controls.Add(extraControls);
            row.Resize += (s, e) => { extraControls.Location = new Point(Math.Max(300, row.Width - extraControls.Width - 8), 4); };
        }

        dot = d;
        statusLabel = status;
        return row;
    }

    private Control BuildNodeStepControls()
    {
        var host = new Panel { Size = new Size(340, 60), BackColor = Color.Transparent };
        nodeRecheckButton = Theme.MakeButton("Recheck", Theme.Secondary, Theme.Text);
        nodeRecheckButton.Size = new Size(90, 30);
        nodeRecheckButton.Location = new Point(0, 2);
        nodeRecheckButton.Click += OnRecheckNodeClick;

        nodeDownloadButton = Theme.MakeButton("Download Node.js", Theme.Accent, Color.White);
        nodeDownloadButton.Size = new Size(160, 30);
        nodeDownloadButton.Location = new Point(100, 2);
        nodeDownloadButton.Click += (s, e) => OpenUrl("https://nodejs.org/");

        host.Controls.Add(nodeRecheckButton);
        host.Controls.Add(nodeDownloadButton);
        return host;
    }

    private Control BuildDepsStepControls()
    {
        var host = new Panel { Size = new Size(180, 60), BackColor = Color.Transparent };
        installDepsButton = Theme.MakeButton("Install Dependencies", Theme.Accent, Color.White);
        installDepsButton.Size = new Size(180, 30);
        installDepsButton.Location = new Point(0, 2);
        installDepsButton.Click += OnInstallDepsClick;
        host.Controls.Add(installDepsButton);
        return host;
    }

    private Control BuildAccountStepControls()
    {
        var host = new Panel { Size = new Size(430, 60), BackColor = Color.Transparent };

        var userLabel = new Label { Text = "Bot username", Font = Theme.Small, ForeColor = Theme.MutedText, AutoSize = true, Location = new Point(0, 0) };
        usernameBox = new TextBox { Location = new Point(0, 16), Width = 140, BackColor = Theme.Secondary, ForeColor = Theme.Text, BorderStyle = BorderStyle.FixedSingle };

        var chanLabel = new Label { Text = "Channel", Font = Theme.Small, ForeColor = Theme.MutedText, AutoSize = true, Location = new Point(150, 0) };
        channelBox = new TextBox { Location = new Point(150, 16), Width = 140, BackColor = Theme.Secondary, ForeColor = Theme.Text, BorderStyle = BorderStyle.FixedSingle };

        connectButton = Theme.MakeButton("Connect Twitch Account", Theme.Accent, Color.White);
        connectButton.Size = new Size(180, 30);
        connectButton.Location = new Point(300, 15);
        connectButton.Click += OnConnectAccountClick;

        host.Controls.Add(userLabel);
        host.Controls.Add(usernameBox);
        host.Controls.Add(chanLabel);
        host.Controls.Add(channelBox);
        host.Controls.Add(connectButton);
        return host;
    }

    // ---------- Readiness ----------

    private void RefreshSetupState()
    {
        bool hasModules = Directory.Exists(Path.Combine(rootDir, "node_modules"));
        bool hasAccount = !string.IsNullOrEmpty(GetEnvValue("TWITCH_OAUTH_TOKEN", ""));

        UpdateStepUI(nodeDot, nodeStatusLabel, nodeAvailable, nodeAvailable ? "Found" : "Not found -- download it, then click Recheck");
        nodeDownloadButton.Visible = !nodeAvailable;

        UpdateStepUI(depsDot, depsStatusLabel, hasModules, hasModules ? "Installed" : "Not installed yet");
        installDepsButton.Enabled = nodeAvailable;

        UpdateStepUI(accountDot, accountStatusLabel, hasAccount, hasAccount ? "Connected as " + GetEnvValue("TWITCH_BOT_USERNAME", "?") : "Not connected yet");
        if (hasAccount)
        {
            usernameBox.Text = GetEnvValue("TWITCH_BOT_USERNAME", usernameBox.Text);
            channelBox.Text = GetEnvValue("TWITCH_CHANNEL", channelBox.Text);
        }

        bool ready = nodeAvailable && hasModules && hasAccount;
        setupPanel.Visible = !ready;
        dashboardPanel.Visible = ready;

        if (ready && !hasEnteredDashboard)
        {
            hasEnteredDashboard = true;
            AppendLog("twitch-bot control ready.");
        }
    }

    private void UpdateStepUI(Dot dot, Label label, bool done, string text)
    {
        dot.DotColor = done ? Theme.Running : Theme.Pending;
        dot.Invalidate();
        label.Text = text;
        label.ForeColor = done ? Theme.Running : Theme.MutedText;
    }

    private bool CheckNodeAvailable()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ResolveNodePath(),
                Arguments = "--version",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using (var p = Process.Start(psi))
            {
                p.WaitForExit(5000);
                return p.ExitCode == 0;
            }
        }
        catch
        {
            return false;
        }
    }

    private void OnRecheckNodeClick(object sender, EventArgs e)
    {
        nodeRecheckButton.Enabled = false;
        AppendSetupLog("Checking for Node.js...");
        nodeAvailable = CheckNodeAvailable();
        AppendSetupLog(nodeAvailable ? "Node.js found." : "Still not found -- make sure it finished installing, then try again.");
        nodeRecheckButton.Enabled = true;
        RefreshSetupState();
    }

    private void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            AppendSetupLog("Could not open browser: " + ex.Message);
        }
    }

    private string ResolveNodePath()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pfx86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string[] candidates = { Path.Combine(pf, "nodejs", "node.exe"), Path.Combine(pfx86, "nodejs", "node.exe") };
        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        return "node.exe"; // fall back to PATH resolution
    }

    private string ResolveNpmPath()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pfx86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string[] candidates = { Path.Combine(pf, "nodejs", "npm.cmd"), Path.Combine(pfx86, "nodejs", "npm.cmd") };
        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        return "npm.cmd";
    }

    // ---------- Setup actions ----------

    private void OnInstallDepsClick(object sender, EventArgs e)
    {
        installDepsButton.Enabled = false;
        AppendSetupLog("--- Installing dependencies (npm install) ---");

        try
        {
            string npmCmd = ResolveNpmPath();
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c \"\"" + npmCmd + "\" install\"",
                WorkingDirectory = rootDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (s, ev) => { if (ev.Data != null) AppendSetupLogThreadSafe(ev.Data); };
            proc.ErrorDataReceived += (s, ev) => { if (ev.Data != null) AppendSetupLogThreadSafe(ev.Data); };
            proc.Exited += (s, ev) =>
            {
                BeginInvoke(new Action(() =>
                {
                    bool success = proc.ExitCode == 0;
                    AppendSetupLog(success ? "Dependencies installed." : "npm install failed (exit code " + proc.ExitCode + ").");
                    installDepsButton.Enabled = true;
                    proc.Dispose();
                    RefreshSetupState();
                }));
            };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            AppendSetupLog("Failed to start npm install: " + ex.Message);
            installDepsButton.Enabled = true;
        }
    }

    private void OnConnectAccountClick(object sender, EventArgs e)
    {
        string username = usernameBox.Text.Trim();
        string channel = channelBox.Text.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(channel))
        {
            AppendSetupLog("Enter a bot username and channel name first.");
            return;
        }

        connectButton.Enabled = false;
        AppendSetupLog("--- Connecting Twitch account (a browser tab will open) ---");

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ResolveNodePath(),
                Arguments = "\"" + Path.Combine(rootDir, "scripts", "connectAccount.js") + "\"",
                WorkingDirectory = rootDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.EnvironmentVariables["TWITCH_BOT_USERNAME"] = username;
            psi.EnvironmentVariables["TWITCH_CHANNEL"] = channel;

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (s, ev) => { if (ev.Data != null) AppendSetupLogThreadSafe(ev.Data); };
            proc.ErrorDataReceived += (s, ev) => { if (ev.Data != null) AppendSetupLogThreadSafe(ev.Data); };
            proc.Exited += (s, ev) =>
            {
                BeginInvoke(new Action(() =>
                {
                    connectButton.Enabled = true;
                    proc.Dispose();
                    RefreshSetupState();
                }));
            };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            AppendSetupLog("Failed to start: " + ex.Message);
            connectButton.Enabled = true;
        }
    }

    private void AppendSetupLog(string line)
    {
        setupLogBox.AppendText(line + Environment.NewLine);
        setupLogBox.SelectionStart = setupLogBox.TextLength;
        setupLogBox.ScrollToCaret();
    }

    private void AppendSetupLogThreadSafe(string line)
    {
        if (setupLogBox.InvokeRequired) setupLogBox.BeginInvoke(new Action(() => AppendSetupLog(line)));
        else AppendSetupLog(line);
    }

    // ---------- Start / stop ----------

    private void OnToggleClick(object sender, EventArgs e)
    {
        if (botProcess == null) StartBot();
        else StopBot();
    }

    private void StartBot()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ResolveNodePath(),
                Arguments = "index.js",
                WorkingDirectory = rootDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            botProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
            botProcess.OutputDataReceived += (s, ev) => { if (ev.Data != null) HandleBotOutputLine(ev.Data); };
            botProcess.ErrorDataReceived += (s, ev) => { if (ev.Data != null) AppendLogThreadSafe(ev.Data); };
            botProcess.Exited += (s, ev) =>
            {
                BeginInvoke(new Action(() =>
                {
                    AppendLog("Bot process exited.");
                    SetStopped();
                    botProcess = null;
                }));
            };

            botProcess.Start();
            botProcess.BeginOutputReadLine();
            botProcess.BeginErrorReadLine();

            SetRunning();
            AppendLog("Starting bot...");
        }
        catch (Exception ex)
        {
            AppendLog("Failed to start: " + ex.Message);
            botProcess = null;
        }
    }

    private void StopBot()
    {
        if (botProcess == null) return;
        try
        {
            // Stop the Exited handler from also firing and double-logging --
            // this is an intentional stop, so the message below is enough.
            botProcess.EnableRaisingEvents = false;
            if (!botProcess.HasExited)
            {
                botProcess.Kill();
                botProcess.WaitForExit(5000);
            }
        }
        catch (Exception ex)
        {
            AppendLog("Error stopping bot: " + ex.Message);
        }
        finally
        {
            botProcess = null;
            SetStopped();
            AppendLog("Bot stopped.");
        }
    }

    private void SetRunning()
    {
        statusLabel.Text = "RUNNING";
        statusLabel.ForeColor = Theme.Running;
        statusDot.DotColor = Theme.Running;
        statusDot.Invalidate();
        toggleButton.Text = "Stop Bot";
        toggleButton.BackColor = Theme.Stopped;
    }

    private void SetStopped()
    {
        statusLabel.Text = "STOPPED";
        statusLabel.ForeColor = Theme.Stopped;
        statusDot.DotColor = Theme.Stopped;
        statusDot.Invalidate();
        toggleButton.Text = "Start Bot";
        toggleButton.BackColor = Theme.Accent;
    }

    // ---------- OBS / Test Alert / Update ----------

    private void OnObsButtonClick(object sender, EventArgs e)
    {
        var env = new Dictionary<string, string> { { "OBS_WEBSOCKET_PASSWORD", obsPasswordBox.Text } };
        RunNodeScriptOneShot("scripts/addObsSource.js", env, obsButton);
    }

    // Fires a real alert + TTS through the running bot's alert server, so
    // you can confirm the OBS Browser Source is actually connected (and
    // hearing/showing things correctly) before you go live, instead of
    // waiting for a real sub/cheer/raid to find out.
    private async void OnTestAlertClick(object sender, EventArgs e)
    {
        if (botProcess == null)
        {
            AppendLog("Start the bot first, then try Test Alert -- the alert server only runs while the bot is running.");
            return;
        }

        testAlertButton.Enabled = false;
        string port = GetEnvValue("ALERT_SERVER_PORT", "8090");
        AppendLog("Sending test alert...");

        try
        {
            using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) })
            {
                string response = await client.GetStringAsync("http://localhost:" + port + "/test-alert");
                if (response.Contains("\"connectedOverlays\":0"))
                {
                    AppendLog("Test alert sent, but no OBS overlay is connected -- add http://localhost:" + port + "/overlay.html as an OBS Browser Source first.");
                }
                else
                {
                    AppendLog("Test alert sent -- check OBS for the popup and listen for the voice/chime.");
                }
            }
        }
        catch (Exception ex)
        {
            AppendLog("Could not reach the alert server: " + ex.Message);
        }
        finally
        {
            testAlertButton.Enabled = true;
        }
    }

    // Minimal .env reader -- just enough to pick up config values without
    // pulling in a full parser.
    private string GetEnvValue(string key, string defaultValue)
    {
        string envPath = Path.Combine(rootDir, ".env");
        if (!File.Exists(envPath)) return defaultValue;
        foreach (string line in File.ReadAllLines(envPath))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith(key + "=", StringComparison.OrdinalIgnoreCase))
            {
                string value = trimmed.Substring(key.Length + 1).Trim();
                return value.Length > 0 ? value : defaultValue;
            }
        }
        return defaultValue;
    }

    private void OnUpdateButtonClick(object sender, EventArgs e)
    {
        if (botProcess != null)
        {
            AppendLog("Stop the bot before updating.");
            return;
        }

        AppendLog("This app will close, update, then reopen automatically. A console window will show progress.");

        try
        {
            StartUpdateWatcher();
        }
        catch (Exception ex)
        {
            AppendLog("Failed to start the update: " + ex.Message);
            return;
        }

        Application.Exit();
    }

    // Windows won't let git overwrite an exe file while it's running --
    // including this one. So the update can't run in-process: this spawns
    // a detached watcher that waits for THIS process to fully exit
    // (releasing the file lock), runs the update, then relaunches the
    // control panel.
    private void StartUpdateWatcher()
    {
        string nodeExe = ResolveNodePath();
        string updateScript = Path.Combine(rootDir, "scripts", "update.js");
        string controlExe = Path.Combine(rootDir, "twitch-bot-control.exe");
        int myPid = Process.GetCurrentProcess().Id;

        string watcherCommand =
            "powershell -NoProfile -Command \"Wait-Process -Id " + myPid + " -ErrorAction SilentlyContinue\" " +
            "&& \"" + nodeExe + "\" \"" + updateScript + "\" " +
            "& \"" + controlExe + "\"";

        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c " + watcherCommand,
            WorkingDirectory = rootDir,
            UseShellExecute = true,
        };
        Process.Start(psi);
    }

    // Runs a script to completion and streams its output into the log,
    // for one-shot actions (OBS setup, updating) as opposed to the
    // long-running bot process. Disables the triggering button while it
    // runs so it can't be double-clicked mid-flight.
    private void RunNodeScriptOneShot(string relativeScriptPath, Dictionary<string, string> extraEnv, Button triggerButton)
    {
        triggerButton.Enabled = false;
        AppendLog("--- Running " + relativeScriptPath + " ---");

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ResolveNodePath(),
                Arguments = "\"" + Path.Combine(rootDir, relativeScriptPath) + "\"",
                WorkingDirectory = rootDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            if (extraEnv != null)
            {
                foreach (var kv in extraEnv) psi.EnvironmentVariables[kv.Key] = kv.Value;
            }

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (s, ev) => { if (ev.Data != null) AppendLogThreadSafe(ev.Data); };
            proc.ErrorDataReceived += (s, ev) => { if (ev.Data != null) AppendLogThreadSafe(ev.Data); };
            proc.Exited += (s, ev) =>
            {
                BeginInvoke(new Action(() =>
                {
                    AppendLog("--- " + relativeScriptPath + " finished (exit code " + proc.ExitCode + ") ---");
                    triggerButton.Enabled = true;
                    proc.Dispose();
                }));
            };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            AppendLog("Failed to run " + relativeScriptPath + ": " + ex.Message);
            triggerButton.Enabled = true;
        }
    }

    // ---------- Output routing ----------

    private const string ChatPrefix = "@@CHAT@@|";

    private void HandleBotOutputLine(string line)
    {
        if (line.StartsWith(ChatPrefix, StringComparison.Ordinal)) AppendChatThreadSafe(line);
        else AppendLogThreadSafe(line);
    }

    // ---------- Log panel ----------

    private void AppendLog(string line)
    {
        logBox.AppendText(line + Environment.NewLine);
        logBox.SelectionStart = logBox.TextLength;
        logBox.ScrollToCaret();
        TrimIfTooLong(logBox);
    }

    private void AppendLogThreadSafe(string line)
    {
        if (logBox.InvokeRequired) logBox.BeginInvoke(new Action(() => AppendLog(line)));
        else AppendLog(line);
    }

    // ---------- Chat panel ----------

    private void AppendChatThreadSafe(string rawLine)
    {
        if (chatBox.InvokeRequired) chatBox.BeginInvoke(new Action(() => AppendChat(rawLine)));
        else AppendChat(rawLine);
    }

    // Twitch-only here, so the platform field in the wire format below is
    // unused (always "twitch") -- kept as-is rather than reshaping the
    // format, since chatEmit.js's format is otherwise identical to
    // stream-bot's and there's no benefit to diverging it.
    private static readonly Color TwitchColor = Color.FromArgb(169, 112, 255);

    private void AppendChat(string rawLine)
    {
        // Format: @@CHAT@@|platform|base64(username)|isMod(0/1)|isBroadcaster(0/1)|base64(text)
        string[] parts = rawLine.Substring(ChatPrefix.Length).Split('|');
        if (parts.Length < 5) return;

        if (chatIsEmpty)
        {
            chatBox.Clear();
            chatBox.ForeColor = Theme.Text;
            chatIsEmpty = false;
        }

        string username = DecodeBase64(parts[1]);
        bool isMod = parts[2] == "1";
        bool isBroadcaster = parts[3] == "1";
        string text = DecodeBase64(parts[4]);

        chatBox.SelectionStart = chatBox.TextLength;
        chatBox.SelectionLength = 0;

        AppendColored(chatBox, DateTime.Now.ToString("HH:mm:ss "), Theme.MutedText, Theme.Small);
        AppendColored(chatBox, "[Twitch] ", TwitchColor, Theme.Small);

        if (isBroadcaster) AppendColored(chatBox, "[HOST] ", Color.Gold, Theme.Small);
        else if (isMod) AppendColored(chatBox, "[MOD] ", Theme.Running, Theme.Small);

        AppendColored(chatBox, username + ":  ", ColorForUsername(username), Theme.BodyBold);
        AppendColored(chatBox, text + Environment.NewLine, Theme.Text, Theme.Body);

        chatBox.ScrollToCaret();
        TrimIfTooLong(chatBox);
    }

    private void AppendColored(RichTextBox box, string text, Color color, Font font)
    {
        box.SelectionStart = box.TextLength;
        box.SelectionLength = 0;
        box.SelectionColor = color;
        box.SelectionFont = font;
        box.AppendText(text);
    }

    private void TrimIfTooLong(RichTextBox box)
    {
        // Keep memory/render cost bounded over a long stream, without
        // wiping formatting on the text that's kept (Lines-based trimming
        // would lose all coloring, so trim via selection-delete instead).
        const int maxChars = 60000;
        const int keepChars = 45000;
        if (box.TextLength > maxChars)
        {
            box.Select(0, box.TextLength - keepChars);
            box.SelectedText = string.Empty;
        }
    }

    private Color ColorForUsername(string username)
    {
        Color color;
        if (userColors.TryGetValue(username, out color)) return color;
        int hash = 0;
        unchecked
        {
            foreach (char c in username) hash = hash * 31 + c;
        }
        color = UserPalette[Math.Abs(hash) % UserPalette.Length];
        userColors[username] = color;
        return color;
    }

    private string DecodeBase64(string s)
    {
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(s));
        }
        catch
        {
            return s;
        }
    }

    // ---------- Shutdown ----------

    private void OnFormClosing(object sender, FormClosingEventArgs e)
    {
        if (botProcess != null && !botProcess.HasExited) StopBot();
    }
}
