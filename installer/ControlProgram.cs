using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Http;
using System.Text;
using Microsoft.Win32;
using System.Text.RegularExpressions;
using System.Windows.Forms;

// Self-contained control panel: on first run, walks you through getting
// Node.js, installing dependencies, and signing in with Twitch, all from
// this window -- no separate installer/wizard console needed. Once set
// up, it's the day-to-day dashboard: start/stop the bot, watch live chat
// with per-user coloring, see an activity log, connect OBS, and self-
// update. Closing the window stops the bot if it's running, so there's
// no separate "turn it off" step to remember after a stream.
//
// The visual language is the workspace ui-kit (../ui-kit), ported by
// hand: WinForms cannot consume a stylesheet, so Theme below mirrors
// tokens.css and the component classes here mirror components.css. When
// a token changes in the kit, change it here too or the panel drifts
// away from the other tools on the desktop.
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

// Mirror of ui-kit/tokens.css. Names match the CSS custom properties so
// the two can be diffed by eye.
static class Theme
{
    // Surfaces: five steps, deepest to most raised.
    public static readonly Color Surface0 = FromHex("0e1015");      // rail, top bar
    public static readonly Color Surface1 = FromHex("14161c");      // content column
    public static readonly Color Surface2 = FromHex("1c1f28");      // panel, card
    public static readonly Color Surface3 = FromHex("242833");      // raised: active nav, hover
    public static readonly Color SurfaceInset = FromHex("0a0c11");  // inputs

    public static readonly Color Border = FromHex("2c303c");
    public static readonly Color BorderStrong = FromHex("3a3f4e");

    public static readonly Color Text = FromHex("e8e9ee");
    public static readonly Color TextMuted = FromHex("9198a8");
    public static readonly Color TextDim = FromHex("646b7c");
    public static readonly Color TextOnAccent = FromHex("0a1424");

    // One accent, spent only on active state and the primary action.
    public static readonly Color Accent = FromHex("6ea8fe");
    public static readonly Color AccentHover = FromHex("8ab9ff");
    public static readonly Color AccentPress = FromHex("5b93e6");

    public static readonly Color Ok = FromHex("4ecb71");
    public static readonly Color Warn = FromHex("ffb454");
    public static readonly Color Danger = FromHex("f2555a");

    // Radii. The kit defaults to Epic's softness rather than the square
    // corners of the other two references, because these are desktop
    // panels rather than in-game HUDs.
    public const int RadiusMd = 6;
    public const int RadiusLg = 10;

    public static Font H1 = new Font("Segoe UI", 16F, FontStyle.Bold);
    public static Font H2 = new Font("Segoe UI", 11F, FontStyle.Bold);
    public static Font Body = new Font("Segoe UI", 10F);
    public static Font BodyBold = new Font("Segoe UI", 10F, FontStyle.Bold);
    public static Font Small = new Font("Segoe UI", 9F);
    public static Font SmallBold = new Font("Segoe UI", 9F, FontStyle.Bold);
    public static Font Micro = new Font("Segoe UI", 8.25F, FontStyle.Bold);
    public static Font Mono = new Font("Consolas", 9F);

    public static Color FromHex(string hex)
    {
        return Color.FromArgb(
            Convert.ToInt32(hex.Substring(0, 2), 16),
            Convert.ToInt32(hex.Substring(2, 2), 16),
            Convert.ToInt32(hex.Substring(4, 2), 16));
    }

    public static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        if (radius <= 0)
        {
            path.AddRectangle(r);
            return path;
        }
        int d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

enum BtnKind { Primary, Ghost, Danger }

// Mirror of the kit's .btn variants. One loud (Primary) button per view;
// everything else is Ghost or Danger, both of which are outline-only.
//
// Variant is a settable property rather than baked in at construction,
// because which control is the primary action genuinely moves: Start
// becomes Stop, and a setup step stops being the next thing to do once
// it is complete. Restyling in place keeps that from needing two buttons
// fighting over one slot.
class KitButton : Button
{
    private BtnKind kind;
    private readonly Color parentBack;
    private bool hovering;

    public KitButton(string text, BtnKind kind, Color parentBack)
    {
        this.kind = kind;
        this.parentBack = parentBack;

        Text = text;
        FlatStyle = FlatStyle.Flat;
        Font = Theme.SmallBold;
        Cursor = Cursors.Hand;
        UseVisualStyleBackColor = false;
        FlatAppearance.BorderSize = 1;

        MouseEnter += (s, e) => { hovering = true; Apply(); };
        MouseLeave += (s, e) => { hovering = false; Apply(); };
        EnabledChanged += (s, e) => Apply();

        Apply();
    }

    public BtnKind Kind
    {
        get { return kind; }
        set { kind = value; Apply(); }
    }

    private void Apply()
    {
        if (!Enabled)
        {
            BackColor = kind == BtnKind.Primary ? Theme.Surface3 : parentBack;
            ForeColor = Theme.TextDim;
            FlatAppearance.BorderColor = Theme.Border;
            return;
        }

        if (kind == BtnKind.Primary)
        {
            BackColor = hovering ? Theme.AccentHover : Theme.Accent;
            ForeColor = Theme.TextOnAccent;
            FlatAppearance.BorderColor = hovering ? Theme.AccentHover : Theme.Accent;
            FlatAppearance.MouseOverBackColor = Theme.AccentHover;
        }
        else if (kind == BtnKind.Danger)
        {
            BackColor = parentBack;
            ForeColor = Theme.Danger;
            FlatAppearance.BorderColor = hovering ? Theme.Danger : Theme.Border;
            FlatAppearance.MouseOverBackColor = parentBack;
        }
        else
        {
            BackColor = parentBack;
            ForeColor = hovering ? Theme.Text : Theme.TextMuted;
            FlatAppearance.BorderColor = hovering ? Theme.BorderStrong : Theme.Border;
            FlatAppearance.MouseOverBackColor = parentBack;
        }
    }
}

// A small filled circle used for status indicators (RUNNING/STOPPED, step
// completion) -- drawn via GDI+ rather than a Unicode glyph, since an
// earlier version of this app hit font-rendering issues (tofu boxes) with
// Unicode bullet characters on some systems.
class Dot : Panel
{
    public Color DotColor = Theme.TextDim;
    public Dot() { Size = new Size(10, 10); BackColor = Color.Transparent; }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var brush = new SolidBrush(DotColor))
        {
            e.Graphics.FillEllipse(brush, 0, 0, Width - 1, Height - 1);
        }
    }
}

// The kit's .checkbox-row input: an empty bordered square when off, an
// accent fill with a dark tick when on. Owner-drawn because a WinForms
// CheckBox with FlatStyle.Flat paints its unchecked box as a solid block
// of ForeColor, which reads as switched on when it is switched off.
class KitCheck : Control
{
    private bool checkedState;
    private bool hovering;

    public event EventHandler CheckedChanged;

    public KitCheck()
    {
        Size = new Size(15, 15);
        BackColor = Theme.Surface0;
        Cursor = Cursors.Hand;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }

    public bool Checked
    {
        get { return checkedState; }
        set
        {
            if (checkedState == value) return;
            checkedState = value;
            Invalidate();
            if (CheckedChanged != null) CheckedChanged(this, EventArgs.Empty);
        }
    }

    // Lets the initial state be restored from the registry without the
    // restore itself counting as a change the handler has to act on.
    public void SetCheckedSilently(bool value)
    {
        checkedState = value;
        Invalidate();
    }

    public void Toggle() { Checked = !Checked; }

    protected override void OnMouseEnter(EventArgs e) { hovering = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovering = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnClick(EventArgs e) { Toggle(); base.OnClick(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var back = new SolidBrush(BackColor)) e.Graphics.FillRectangle(back, ClientRectangle);

        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, 3))
        {
            if (checkedState)
            {
                using (var fill = new SolidBrush(Theme.Accent)) e.Graphics.FillPath(fill, path);
            }
            using (var pen = new Pen(checkedState ? Theme.Accent : (hovering ? Theme.BorderStrong : Theme.Border)))
            {
                e.Graphics.DrawPath(pen, path);
            }
        }

        if (!checkedState) return;
        using (var tick = new Pen(Theme.TextOnAccent, 2))
        {
            e.Graphics.DrawLines(tick, new[]
            {
                new Point(3, 7), new Point(6, 10), new Point(11, 4),
            });
        }
    }
}

// Rounded square carrying a letter or number: the rail's brand mark and
// the setup steps' numbering.
class Badge : Panel
{
    public string Label = "";
    public Font BadgeFont = Theme.SmallBold;
    public Color Fore = Theme.TextOnAccent;
    public Color Fill = Theme.Accent;

    public Badge(int size)
    {
        Size = new Size(size, size);
        BackColor = Color.Transparent;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, Theme.RadiusMd))
        using (var brush = new SolidBrush(Fill))
        {
            e.Graphics.FillPath(brush, path);
        }
        TextRenderer.DrawText(e.Graphics, Label, BadgeFont, ClientRectangle, Fore,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }
}

// The kit's .badge: a fully rounded pill of quiet metadata. Used for
// uptime beside the running status.
class Pill : Panel
{
    public string Label = "";
    public Pill() { Height = 18; BackColor = Color.Transparent; }

    public void SetText(string text, Graphics g)
    {
        Label = text;
        Width = TextRenderer.MeasureText(text, Theme.Micro).Width + 16;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, Height / 2))
        using (var brush = new SolidBrush(Theme.Surface3))
        {
            e.Graphics.FillPath(brush, path);
        }
        TextRenderer.DrawText(e.Graphics, Label, Theme.Micro, ClientRectangle, Theme.TextMuted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }
}

// The kit's .panel: a raised surface with a hairline border and soft
// corners. Painted rather than composed, because WinForms has no border
// radius. Children must be inset by Padding or they will square off the
// corners they sit on.
class Card : Panel
{
    private readonly Color surround;

    public Card(Color surround)
    {
        this.surround = surround;
        BackColor = surround;
        Padding = new Padding(14);
        DoubleBuffered = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, Theme.RadiusLg))
        {
            using (var brush = new SolidBrush(Theme.Surface2)) e.Graphics.FillPath(brush, path);
            using (var pen = new Pen(Theme.Border)) e.Graphics.DrawPath(pen, path);
        }
    }
}

// The kit's .nav-item: active state is a raised fill rather than an
// accent fill, so it never competes with the one primary action.
class NavItem : Button
{
    private bool active;

    public NavItem(string text)
    {
        Text = "   " + text;
        TextAlign = ContentAlignment.MiddleLeft;
        FlatStyle = FlatStyle.Flat;
        Font = Theme.Body;
        Cursor = Cursors.Hand;
        Height = 38;
        BackColor = Theme.Surface0;
        ForeColor = Theme.TextMuted;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;

        MouseEnter += (s, e) => { if (!active && Enabled) { BackColor = Theme.Surface2; ForeColor = Theme.Text; } };
        MouseLeave += (s, e) => { if (!active && Enabled) { BackColor = Theme.Surface0; ForeColor = Theme.TextMuted; } };
        EnabledChanged += (s, e) => { if (!active) ForeColor = Enabled ? Theme.TextMuted : Theme.TextDim; };
    }

    public bool Active
    {
        get { return active; }
        set
        {
            active = value;
            BackColor = value ? Theme.Surface3 : Theme.Surface0;
            ForeColor = value ? Theme.Text : (Enabled ? Theme.TextMuted : Theme.TextDim);
            Invalidate();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var brush = new SolidBrush(Theme.Surface0)) e.Graphics.FillRectangle(brush, ClientRectangle);
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, Theme.RadiusLg))
        using (var brush = new SolidBrush(BackColor))
        {
            e.Graphics.FillPath(brush, path);
        }
        TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, ForeColor,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
    }
}

// The drop target for a bug reporter's screenshot. Painted with a dashed
// border so it reads as "put something here" rather than as another button,
// and clickable as well as droppable, because plenty of people will never
// think to drag a file.
class DropZone : Panel
{
    private bool hovering;
    private string filePath = "";

    public DropZone()
    {
        BackColor = Theme.Surface2;
        Cursor = Cursors.Hand;
        AllowDrop = true;
        DoubleBuffered = true;

        MouseEnter += (s, e) => { hovering = true; Invalidate(); };
        MouseLeave += (s, e) => { hovering = false; Invalidate(); };
        DragLeave += (s, e) => { hovering = false; Invalidate(); };
    }

    public string FilePath
    {
        get { return filePath; }
        set { filePath = value == null ? "" : value; Invalidate(); }
    }

    protected override void OnDragEnter(DragEventArgs e)
    {
        if (e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            e.Effect = DragDropEffects.Copy;
            hovering = true;
            Invalidate();
        }
        base.OnDragEnter(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var brush = new SolidBrush(Theme.Surface2)) e.Graphics.FillRectangle(brush, ClientRectangle);

        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(rect, Theme.RadiusMd))
        {
            using (var brush = new SolidBrush(hovering ? Theme.Surface3 : Theme.SurfaceInset))
            {
                e.Graphics.FillPath(brush, path);
            }
            using (var pen = new Pen(hovering ? Theme.Accent : Theme.Border))
            {
                pen.DashStyle = DashStyle.Dash;
                e.Graphics.DrawPath(pen, path);
            }
        }

        bool empty = filePath.Length == 0;
        string label = empty ? "Drag your screenshot here, or click to browse" : Path.GetFileName(filePath);
        TextRenderer.DrawText(e.Graphics, label, empty ? Theme.Small : Theme.SmallBold, ClientRectangle,
            empty ? Theme.TextMuted : Theme.Text,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    }
}

// Asks for the reporter's screenshot before handing them to GitHub.
//
// It exists because GitHub takes an image only by paste or drag into its own
// editor: there is no URL parameter and no API endpoint for an attachment.
// So the most that can be automated is collecting the file, putting it on the
// clipboard and opening a prefilled form, which leaves the reporter one
// Ctrl+V rather than a blank page and no instructions.
//
// A dialog rather than controls in the rail: the rail is a fixed stack
// already sitting at the window's minimum height, and anything added to it
// clips the readout rows off the top.
class IssueDialog : Form
{
    private const int MaxBytes = 10 * 1024 * 1024;   // GitHub's per-image limit
    private static readonly string[] AllowedExtensions = { ".png", ".jpg", ".jpeg", ".gif" };

    private readonly DropZone dropZone;
    private readonly Label statusLabel;

    public string ScreenshotPath { get; private set; }

    public IssueDialog()
    {
        ScreenshotPath = "";

        Text = "Report an Issue";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;
        BackColor = Theme.Surface1;
        Font = Theme.Body;
        ClientSize = new Size(480, 283);

        var card = new Card(Theme.Surface1);
        card.Location = new Point(16, 16);
        card.Size = new Size(448, 205);

        var heading = new Label
        {
            Text = "Attach a screenshot",
            Font = Theme.H2,
            ForeColor = Theme.Text,
            BackColor = Theme.Surface2,
            Location = new Point(14, 12),
            Size = new Size(420, 22),
        };

        var blurb = new Label
        {
            Text = "Take a screenshot of the problem, then drop it in below. It gets copied to your clipboard so you can paste it straight into the issue with Ctrl+V. Optional, but it makes a bug far easier to fix.",
            Font = Theme.Small,
            ForeColor = Theme.TextMuted,
            BackColor = Theme.Surface2,
            Location = new Point(14, 38),
            Size = new Size(420, 48),
        };

        dropZone = new DropZone
        {
            Location = new Point(14, 92),
            Size = new Size(420, 60),
        };
        dropZone.Click += (s, e) => Browse();
        dropZone.DragDrop += OnZoneDragDrop;

        var browseButton = new KitButton("Choose file...", BtnKind.Ghost, Theme.Surface2)
        {
            Location = new Point(14, 162),
            Size = new Size(120, 30),
        };
        browseButton.Click += (s, e) => Browse();

        statusLabel = new Label
        {
            Text = "",
            Font = Theme.Small,
            ForeColor = Theme.Warn,
            BackColor = Theme.Surface2,
            Location = new Point(144, 162),
            Size = new Size(290, 30),
        };

        card.Controls.Add(heading);
        card.Controls.Add(blurb);
        card.Controls.Add(dropZone);
        card.Controls.Add(browseButton);
        card.Controls.Add(statusLabel);

        var cancelButton = new KitButton("Cancel", BtnKind.Ghost, Theme.Surface1)
        {
            Location = new Point(16, 235),
            Size = new Size(120, 32),
            DialogResult = DialogResult.Cancel,
        };

        var openButton = new KitButton("Open issue tracker", BtnKind.Primary, Theme.Surface1)
        {
            Location = new Point(284, 235),
            Size = new Size(180, 32),
            DialogResult = DialogResult.OK,
        };

        Controls.Add(card);
        Controls.Add(cancelButton);
        Controls.Add(openButton);

        AcceptButton = openButton;
        CancelButton = cancelButton;
    }

    private void OnZoneDragDrop(object sender, DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(DataFormats.FileDrop)) return;
        var files = (string[])e.Data.GetData(DataFormats.FileDrop);
        if (files != null && files.Length > 0) Accept(files[0]);
    }

    private void Browse()
    {
        using (var picker = new OpenFileDialog())
        {
            picker.Title = "Choose a screenshot";
            picker.Filter = "Images (*.png;*.jpg;*.jpeg;*.gif)|*.png;*.jpg;*.jpeg;*.gif|All files (*.*)|*.*";
            if (picker.ShowDialog(this) == DialogResult.OK) Accept(picker.FileName);
        }
    }

    // Rejecting here rather than letting GitHub reject it: an upload that
    // fails after the browser is already open reads as the tracker being
    // broken, and the reporter has no idea which of the two things went wrong.
    private void Accept(string path)
    {
        if (!File.Exists(path))
        {
            Reject("That file no longer exists.");
            return;
        }

        string extension = Path.GetExtension(path).ToLowerInvariant();
        if (Array.IndexOf(AllowedExtensions, extension) < 0)
        {
            Reject("GitHub takes PNG, JPG or GIF images.");
            return;
        }

        var info = new FileInfo(path);
        if (info.Length > MaxBytes)
        {
            Reject("That image is over GitHub's 10MB limit (" + (info.Length / (1024 * 1024)) + "MB).");
            return;
        }

        ScreenshotPath = path;
        dropZone.FilePath = path;
        statusLabel.ForeColor = Theme.Ok;
        statusLabel.Text = "Ready to paste into the issue.";
    }

    private void Reject(string message)
    {
        ScreenshotPath = "";
        dropZone.FilePath = "";
        statusLabel.ForeColor = Theme.Warn;
        statusLabel.Text = message;
    }
}

class MainForm : Form
{
    private const string AppVersion = "0.7.0";
    private const int RailWidth = 232;
    private const int TopBarHeight = 64;

    private readonly string rootDir;
    private Process botProcess;
    private bool nodeAvailable;
    // True when this copy came from the installer rather than a git
    // checkout: the runtime and node_modules are both bundled, so the
    // first two setup steps have nothing left to ask the user for.
    private bool isPackagedInstall;
    private string bundledNodePath;
    private bool hasEnteredDashboard;
    private bool isReady;

    // Polling the alert server needs one client for the process lifetime;
    // a per-request HttpClient exhausts sockets under a repeating timer.
    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };

    // Top bar
    private KitButton toggleButton;
    private Dot statusDot;
    private Label statusLabel;
    private Pill uptimePill;
    private DateTime botStartedAt;
    private Timer uptimeTimer;
    private Timer overlayTimer;

    // Rail
    private NavItem navDashboard;
    private NavItem navSetup;
    private TextBox obsPasswordBox;
    private KitButton obsButton;
    private KitButton testAlertButton;
    private KitButton reloadOverlaysButton;
    private KitCheck muteAlertsBox;
    private KitButton reportIssueButton;
    private KitButton updateButton;
    private KitCheck startWithWindowsBox;
    private KitCheck autoUpdateBox;
    private Label channelValue;
    private Label portValue;
    private Label overlayValue;
    private Label viewersValue;
    private Label chattersValue;
    private Label followersValue;
    private Label subsValue;

    // Views
    private Panel dashboardPanel;
    private Panel setupPanel;
    private RichTextBox chatBox;
    private RichTextBox logBox;
    private bool chatIsEmpty = true;

    // Channel title and category, in the content column rather than the rail:
    // the rail is a fixed stack that already sets the window's minimum height,
    // and text fields need width the rail's 232px does not have.
    private TextBox channelTitleBox;
    private TextBox channelCategoryBox;
    private KitButton updateChannelButton;
    private KitButton channelRefreshButton;
    private Label channelHintLabel;

    // Chat display controls, kept in the chat card rather than the rail so
    // they sit next to what they affect.
    private KitCheck timestampsBox;
    private KitCheck highlightMentionsBox;
    private KitButton chatSmallerButton;
    private KitButton chatLargerButton;

    // Mods learned from chat as it arrives: every line carries isMod, so
    // the set fills itself in without asking Twitch for a mod list.
    private readonly HashSet<string> knownMods = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    // Setup
    private RichTextBox setupLogBox;
    private Dot nodeDot;
    private Label nodeStatusLabel;
    private KitButton nodeDownloadButton;
    private KitButton nodeRecheckButton;
    private Badge nodeBadge;
    private Dot depsDot;
    private Label depsStatusLabel;
    private KitButton installDepsButton;
    private Badge depsBadge;
    private Dot accountDot;
    private Label accountStatusLabel;
    private TextBox usernameBox;
    private TextBox channelBox;
    private KitButton connectButton;
    private Badge accountBadge;

    private readonly Dictionary<string, Color> userColors = new Dictionary<string, Color>();

    // Per-user chat colors are data, not design: they exist to tell
    // speakers apart at a glance, so they stay as their own palette
    // rather than being pulled from the kit's tokens.
    private static readonly Color[] UserPalette = new[]
    {
        Color.FromArgb(255, 129, 122), Color.FromArgb(122, 190, 255), Color.FromArgb(255, 200, 110),
        Color.FromArgb(150, 235, 160), Color.FromArgb(255, 150, 225), Color.FromArgb(140, 225, 225),
        Color.FromArgb(205, 175, 255), Color.FromArgb(255, 225, 130), Color.FromArgb(180, 255, 180),
        Color.FromArgb(255, 175, 210),
    };

    public MainForm()
    {
        // This exe ships in bin/ alongside the other binaries, so the project
        // root (package.json, .env, scripts/, node_modules/) is one level up.
        // Everything below resolves off rootDir, so getting this wrong breaks
        // the bot launch, the setup wizard and the update path all at once.
        rootDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));

        // Set before the panels are built: BuildSetupPanel decides how many
        // steps to show from this.
        bundledNodePath = Path.Combine(rootDir, "runtime", "node.exe");
        isPackagedInstall = File.Exists(bundledNodePath);

        Text = "twitch-bot";
        Width = 940;
        // The rail is a fixed stack of controls that cannot reflow, so the
        // window's height is set by what the rail has to fit rather than by
        // the content column. Adding a rail control means checking this
        // again: below roughly 600px of client height the rail's bottom
        // group starts eating the readout from the top.
        // Raised from 640/630 when the four Phase 3 stat rows went into the
        // rail readout: 4 rows at 20px plus the STATS label is 100px more
        // that the rail has to fit, and the readout is what gets eaten
        // first when it does not.
        Height = 740;
        MinimumSize = new Size(760, 730);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.Surface1;
        Font = Theme.Body;
        Icon = CreateAppIcon();
        FormClosing += OnFormClosing;

        dashboardPanel = BuildDashboardPanel();
        setupPanel = BuildSetupPanel();

        var viewHost = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface1 };
        viewHost.Controls.Add(dashboardPanel);
        viewHost.Controls.Add(setupPanel);

        // Dock resolution runs in reverse of add order, so the fill area
        // goes in first and each edge afterwards claims the outer strip.
        var mainArea = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface1 };
        mainArea.Controls.Add(viewHost);
        mainArea.Controls.Add(BuildTopBar());

        Controls.Add(mainArea);
        Controls.Add(BuildRail());

        uptimeTimer = new Timer { Interval = 1000 };
        uptimeTimer.Tick += (s, e) => RefreshUptime();

        // 5s is slow enough to be invisible in CPU terms and fast enough
        // that plugging the browser source into OBS shows up before you
        // go looking for why it did not.
        overlayTimer = new Timer { Interval = 5000 };
        overlayTimer.Tick += async (s, e) => await RefreshOverlayCount();

        nodeAvailable = CheckNodeAvailable();
        RefreshSetupState();

        // Restored after the chat box exists, since ZoomFactor is a
        // property of the control rather than something the toolbar holds.
        int zoomPercent;
        if (int.TryParse(GetPref(PrefChatZoom, "100"), out zoomPercent) && zoomPercent >= 70 && zoomPercent <= 200)
        {
            chatBox.ZoomFactor = zoomPercent / 100f;
        }

        if (nodeAvailable && autoUpdateBox.Checked) CheckForUpdatesInBackground();

        // Unconditional, unlike the update check: this is not a network
        // preference, it is the card being able to show what is live rather
        // than two empty boxes. It fails quietly into a hint on the card.
        ReadChannelInfoInBackground();

        // Without this the first rail button takes focus on open and
        // wears a focus ring, which reads as a second highlighted
        // control competing with the primary action.
        Shown += (s, e) =>
        {
            if (toggleButton.Enabled) ActiveControl = toggleButton;
        };
    }

    private static Icon CreateAppIcon()
    {
        using (var bmp = new Bitmap(32, 32))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(1, 1, 29, 29);
            using (var path = Theme.RoundedRect(rect, 7))
            using (var brush = new SolidBrush(Theme.Accent))
            {
                g.FillPath(brush, path);
            }
            using (var font = new Font("Segoe UI", 15, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "T", font, new Rectangle(0, 0, 32, 32), Theme.TextOnAccent,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }

    // ---------- Rail ----------

    private Panel BuildRail()
    {
        var rail = new Panel
        {
            Dock = DockStyle.Left,
            Width = RailWidth,
            BackColor = Theme.Surface0,
            Padding = new Padding(12, 12, 12, 12),
        };

        int inner = RailWidth - 24;

        var top = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            BackColor = Theme.Surface0,
        };

        var brand = new Panel { Width = inner, Height = 44, BackColor = Theme.Surface0, Margin = new Padding(0, 0, 0, 8) };
        var mark = new Badge(28) { Label = "T", Location = new Point(10, 8) };
        var brandText = new Label
        {
            Text = "TWITCH-BOT",
            Font = Theme.H2,
            ForeColor = Theme.Text,
            AutoSize = true,
            Location = new Point(48, 12),
        };
        brand.Controls.Add(mark);
        brand.Controls.Add(brandText);

        navDashboard = new NavItem("Dashboard") { Width = inner, Margin = new Padding(0, 0, 0, 2) };
        navDashboard.Click += (s, e) => { if (isReady) ShowView(false); };

        navSetup = new NavItem("Setup") { Width = inner, Margin = new Padding(0, 0, 0, 2) };

        // Re-read .env and node_modules on the way in, so the steps reflect
        // reality rather than whatever was true at startup (running
        // `npm run twitch-auth` in a terminal changes the answer underneath
        // us). RefreshSetupState picks the view itself, so the explicit
        // ShowView has to come after it, and ShowView must never call back
        // into RefreshSetupState or the two would recurse.
        navSetup.Click += (s, e) => { RefreshSetupState(); ShowView(true); };

        var obsLabel = new Label
        {
            Text = "OBS",
            Font = Theme.Micro,
            ForeColor = Theme.TextDim,
            AutoSize = true,
            Margin = new Padding(10, 16, 0, 6),
        };

        obsPasswordBox = new TextBox { PasswordChar = '*', BorderStyle = BorderStyle.None, BackColor = Theme.SurfaceInset, ForeColor = Theme.Text, Font = Theme.Small };
        var obsPassHost = BorderHost(obsPasswordBox, inner, Theme.Surface0);
        obsPassHost.Margin = new Padding(0, 0, 0, 8);

        obsButton = new KitButton("Add Browser Source", BtnKind.Ghost, Theme.Surface0);
        obsButton.Size = new Size(inner, 32);
        obsButton.Margin = new Padding(0, 0, 0, 6);
        obsButton.Click += OnObsButtonClick;

        testAlertButton = new KitButton("Test Alert", BtnKind.Ghost, Theme.Surface0);
        testAlertButton.Size = new Size(inner, 32);
        testAlertButton.Margin = new Padding(0, 0, 0, 6);
        testAlertButton.Click += OnTestAlertClick;

        reloadOverlaysButton = new KitButton("Reload Overlays", BtnKind.Ghost, Theme.Surface0);
        reloadOverlaysButton.Size = new Size(inner, 32);
        reloadOverlaysButton.Margin = new Padding(0, 0, 0, 8);
        reloadOverlaysButton.Click += OnReloadOverlaysClick;

        // Sits with the other alert controls rather than with the chat
        // display options, because it changes what viewers get, not what
        // this window shows.
        var muteRow = BuildCheckRow("Mute Alerts", out muteAlertsBox, inner);
        muteAlertsBox.CheckedChanged += OnMuteAlertsChanged;

        top.Controls.Add(brand);
        top.Controls.Add(navDashboard);
        top.Controls.Add(navSetup);
        top.Controls.Add(obsLabel);
        top.Controls.Add(obsPassHost);
        top.Controls.Add(obsButton);
        top.Controls.Add(testAlertButton);
        top.Controls.Add(reloadOverlaysButton);
        top.Controls.Add(muteRow);

        var bottom = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            BackColor = Theme.Surface0,
        };

        // Two groups in one block: the first three rows are this machine's
        // state (what the bot is pointed at, and whether OBS is attached),
        // the four below are the channel's. They are separated by the STATS
        // label rather than split into two panels, because they update on
        // the same 5s poll and read as one list.
        var readout = new Panel { Width = inner, Height = 160, BackColor = Theme.Surface0, Margin = new Padding(10, 0, 0, 6) };
        readout.Controls.Add(ReadoutRow("Channel", 0, out channelValue, inner - 10));
        readout.Controls.Add(ReadoutRow("Alert port", 20, out portValue, inner - 10));
        readout.Controls.Add(ReadoutRow("Overlays", 40, out overlayValue, inner - 10));
        readout.Controls.Add(new Label
        {
            Text = "STATS",
            Font = Theme.Micro,
            ForeColor = Theme.TextDim,
            AutoSize = true,
            Location = new Point(0, 66),
        });
        readout.Controls.Add(ReadoutRow("Viewers", 84, out viewersValue, inner - 10));
        readout.Controls.Add(ReadoutRow("Chatters", 104, out chattersValue, inner - 10));
        readout.Controls.Add(ReadoutRow("Followers", 124, out followersValue, inner - 10));
        readout.Controls.Add(ReadoutRow("Subscribers", 144, out subsValue, inner - 10));
        portValue.Font = Theme.Mono;

        reportIssueButton = new KitButton("Report an Issue", BtnKind.Ghost, Theme.Surface0);
        reportIssueButton.Size = new Size(inner, 32);
        reportIssueButton.Margin = new Padding(0, 0, 0, 6);
        reportIssueButton.Click += OnReportIssueClick;

        updateButton = new KitButton("Update", BtnKind.Ghost, Theme.Surface0);
        updateButton.Size = new Size(inner, 32);
        updateButton.Margin = new Padding(0, 0, 0, 8);
        updateButton.Click += OnUpdateButtonClick;

        var autoUpdateRow = BuildCheckRow("Check for updates on launch", out autoUpdateBox, inner);
        autoUpdateBox.SetCheckedSilently(GetPref(PrefCheckUpdates, true));
        autoUpdateBox.CheckedChanged += (s, e) => SetPref(PrefCheckUpdates, autoUpdateBox.Checked);

        var versionPin = new Label
        {
            Text = "v" + AppVersion,
            Font = Theme.Micro,
            ForeColor = Theme.TextDim,
            AutoSize = true,
            Margin = new Padding(10, 0, 0, 2),
        };

        bottom.Controls.Add(readout);
        bottom.Controls.Add(BuildStartWithWindowsRow(inner));
        bottom.Controls.Add(autoUpdateRow);
        bottom.Controls.Add(reportIssueButton);
        bottom.Controls.Add(updateButton);
        bottom.Controls.Add(versionPin);

        rail.Controls.Add(top);
        rail.Controls.Add(bottom);
        return rail;
    }

    // The kit's .readout: muted label, coloured value, everything small
    // and dense. All three reference launchers show build and connection
    // state exactly this way.
    private Panel ReadoutRow(string label, int y, out Label valueLabel, int width)
    {
        var row = new Panel { Location = new Point(0, y), Size = new Size(width, 18), BackColor = Theme.Surface0 };
        var l = new Label { Text = label, Font = Theme.Small, ForeColor = Theme.TextMuted, AutoSize = true, Location = new Point(0, 1) };
        var v = new Label
        {
            Text = "-",
            Font = Theme.SmallBold,
            ForeColor = Theme.Text,
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleRight,
            Size = new Size(width, 16),
            Location = new Point(0, 1),
        };
        // First added is front of the z-order, and the value spans the
        // full width so it can right-align. The label therefore has to go
        // in first or the value's opaque background hides it.
        row.Controls.Add(l);
        row.Controls.Add(v);
        valueLabel = v;
        return row;
    }

    // The kit's .checkbox-row: tick, gap, body text. The caption is its own
    // Label so the whole row is clickable rather than just a 15px square.
    private Panel BuildCheckRow(string caption, out KitCheck box, int width)
    {
        var row = new Panel { Width = width, Height = 22, BackColor = Theme.Surface0, Margin = new Padding(10, 0, 0, 6) };

        var check = new KitCheck { Location = new Point(0, 3) };

        var label = new Label
        {
            Text = caption,
            Font = Theme.Small,
            ForeColor = Theme.Text,
            AutoSize = true,
            Location = new Point(23, 3),
            Cursor = Cursors.Hand,
        };
        label.Click += (s, e) => check.Toggle();

        row.Controls.Add(label);
        row.Controls.Add(check);
        box = check;
        return row;
    }

    private Panel BuildStartWithWindowsRow(int width)
    {
        var row = BuildCheckRow("Start with Windows", out startWithWindowsBox, width);

        // Restore silently, so reading the registry does not immediately
        // write it back.
        startWithWindowsBox.SetCheckedSilently(SyncStartWithWindowsState());
        startWithWindowsBox.CheckedChanged += OnStartWithWindowsChanged;
        return row;
    }

    // WinForms will not colour a TextBox border, so the box goes inside a
    // 1px panel of the border token with the inset fill showing through.
    private Panel BorderHost(TextBox box, int width, Color surround)
    {
        var host = new Panel
        {
            Width = width,
            Height = 30,
            BackColor = Theme.Border,
            Padding = new Padding(1),
        };
        var innerPad = new Panel { Dock = DockStyle.Fill, BackColor = Theme.SurfaceInset, Padding = new Padding(7, 5, 7, 5) };
        box.Dock = DockStyle.Fill;
        innerPad.Controls.Add(box);
        host.Controls.Add(innerPad);
        return host;
    }

    // ---------- Top bar ----------

    private Panel BuildTopBar()
    {
        var bar = new Panel { Dock = DockStyle.Top, Height = TopBarHeight, BackColor = Theme.Surface0 };

        statusDot = new Dot { DotColor = Theme.Danger, Location = new Point(24, 28) };

        statusLabel = new Label
        {
            Text = "STOPPED",
            Font = Theme.BodyBold,
            ForeColor = Theme.Text,
            AutoSize = true,
            Location = new Point(42, 22),
        };

        uptimePill = new Pill { Location = new Point(130, 23), Visible = false };

        toggleButton = new KitButton("Start Bot", BtnKind.Primary, Theme.Surface0);
        toggleButton.Size = new Size(120, 34);
        toggleButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        toggleButton.Click += OnToggleClick;

        var rule = new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Theme.Border };

        bar.Controls.Add(statusDot);
        bar.Controls.Add(statusLabel);
        bar.Controls.Add(uptimePill);
        bar.Controls.Add(toggleButton);
        bar.Controls.Add(rule);

        bar.Resize += (s, e) => { toggleButton.Location = new Point(bar.ClientSize.Width - toggleButton.Width - 24, 15); };
        toggleButton.Location = new Point(bar.ClientSize.Width - toggleButton.Width - 24, 15);

        return bar;
    }

    // ---------- Dashboard ----------

    private Panel BuildDashboardPanel()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface1, Visible = false, Padding = new Padding(16) };

        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            BackColor = Theme.Surface1,
            SplitterWidth = 16,
        };
        split.Panel1.BackColor = Theme.Surface1;
        split.Panel2.BackColor = Theme.Surface1;

        split.Panel1.Controls.Add(BuildFeedCard("LIVE CHAT", out chatBox, true, "Chat will appear here once you're connected...", BuildChatToolbar()));
        split.Panel2.Controls.Add(BuildFeedCard("ACTIVITY LOG", out logBox, false, null, null));

        split.HandleCreated += (s, e) =>
        {
            try { split.SplitterDistance = (int)(split.Width * 0.6); }
            catch { /* width not settled yet on some resizes; harmless to skip */ }
        };

        // Fill before docked edges: dock resolution runs in reverse of add
        // order, so the split has to go in first for the channel card to claim
        // its strip above it rather than overlapping it.
        panel.Controls.Add(split);
        panel.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 16, BackColor = Theme.Surface1 });
        panel.Controls.Add(BuildChannelCard());
        return panel;
    }

    // Both field rows start here, clear of the wider of the two labels
    // ("Category"), so the inputs share a left edge instead of stepping in and
    // out with the label text.
    private const int FieldLeft = 76;

    // Title and category editing. One Submit for both, because they are one
    // Helix request and going live with a new game usually means changing both
    // at once anyway.
    private Card BuildChannelCard()
    {
        var card = new Card(Theme.Surface1) { Dock = DockStyle.Top, Height = 96, Padding = new Padding(12) };

        // Children of a Card must restate the card's fill. They inherit
        // BackColor from the control, which is set to the surrounding colour so
        // the painted rounded corners show through, and would otherwise stamp
        // that surround over the paint.
        var header = new Label
        {
            Text = "CHANNEL",
            Font = Theme.Micro,
            ForeColor = Theme.TextDim,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(12, 8),
        };

        var titleLabel = new Label
        {
            Text = "Title",
            Font = Theme.Small,
            ForeColor = Theme.TextMuted,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(12, 32),
        };

        // 140 is Twitch's own cap. Enforced here so an over-long title is
        // impossible to type rather than rejected after a round trip.
        channelTitleBox = new TextBox
        {
            Location = new Point(FieldLeft, 29),
            Font = Theme.Body,
            BackColor = Theme.Surface3,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.FixedSingle,
            MaxLength = 140,
        };

        var categoryLabel = new Label
        {
            Text = "Category",
            Font = Theme.Small,
            ForeColor = Theme.TextMuted,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(12, 62),
        };

        channelCategoryBox = new TextBox
        {
            Location = new Point(FieldLeft, 59),
            Font = Theme.Body,
            BackColor = Theme.Surface3,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.FixedSingle,
        };

        // Ghost, not Primary. Start Bot is meant to be the only accent-filled
        // control on screen.
        updateChannelButton = new KitButton("Update Channel", BtnKind.Ghost, Theme.Surface2);
        updateChannelButton.Size = new Size(130, 26);
        updateChannelButton.Font = Theme.Small;
        updateChannelButton.Click += OnUpdateChannelClick;

        // The panel is not the only thing that can change these: editing the
        // title in Twitch's own dashboard would leave the boxes showing a stale
        // value, and pressing Update would then quietly put the old one back.
        // Same width as Update Channel so the two stack as one right-hand
        // column rather than two ragged edges.
        channelRefreshButton = new KitButton("Refresh", BtnKind.Ghost, Theme.Surface2);
        channelRefreshButton.Size = new Size(130, 26);
        channelRefreshButton.Font = Theme.Small;
        channelRefreshButton.Click += OnChannelRefreshClick;

        channelHintLabel = new Label
        {
            Text = "Reading current values...",
            Font = Theme.Small,
            ForeColor = Theme.TextDim,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(148, 8),
        };

        // Laid out by hand against the card's width, the same approach the chat
        // toolbar uses. Both rows share one field left edge and one button
        // column, so the card reads as a grid rather than four loose controls.
        // The floor stops the fields collapsing behind the buttons when the
        // window is dragged to its minimum width.
        card.SizeChanged += (s, e) =>
        {
            int buttonLeft = Math.Max(FieldLeft + 140, card.ClientSize.Width - 12 - updateChannelButton.Width);
            updateChannelButton.Location = new Point(buttonLeft, 29);
            channelRefreshButton.Location = new Point(buttonLeft, 59);

            int fieldWidth = Math.Max(120, buttonLeft - 12 - FieldLeft);
            channelTitleBox.Width = fieldWidth;
            channelCategoryBox.Width = fieldWidth;
        };

        card.Controls.Add(channelHintLabel);
        card.Controls.Add(header);
        card.Controls.Add(titleLabel);
        card.Controls.Add(channelTitleBox);
        card.Controls.Add(categoryLabel);
        card.Controls.Add(channelCategoryBox);
        card.Controls.Add(updateChannelButton);
        card.Controls.Add(channelRefreshButton);
        return card;
    }

    private Card BuildFeedCard(string headerText, out RichTextBox box, bool isChat, string placeholder, Control toolbar)
    {
        var card = new Card(Theme.Surface1) { Dock = DockStyle.Fill };

        // Children of a Card must restate the card's own fill. They
        // inherit BackColor from the control, which is set to the
        // surrounding colour so the painted rounded corners can show
        // through, and would otherwise stamp that surround back on top.
        var header = new Label
        {
            Text = headerText,
            Font = Theme.Micro,
            ForeColor = Theme.TextDim,
            BackColor = Theme.Surface2,
            Dock = DockStyle.Top,
            Height = 22,
        };

        var rtb = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Surface2,
            ForeColor = isChat ? Theme.Text : Theme.TextMuted,
            Font = isChat ? Theme.Body : Theme.Mono,
        };

        if (placeholder != null)
        {
            rtb.Text = placeholder;
            rtb.ForeColor = Theme.TextDim;
        }

        // Fill goes in before the docked edges, since dock resolution runs
        // in reverse of add order and the toolbar has to claim its strip
        // above the feed rather than under the header.
        card.Controls.Add(rtb);
        if (toolbar != null) card.Controls.Add(toolbar);
        card.Controls.Add(header);
        box = rtb;
        return card;
    }

    // Chat display options live in the chat card, not the rail: they only
    // change what this window shows, and the rail is already at the height
    // where the form's minimum size starts clipping it.
    private Panel BuildChatToolbar()
    {
        var bar = new Panel { Dock = DockStyle.Top, Height = 26, BackColor = Theme.Surface2 };

        var tsRow = BuildInlineCheck("Timestamps", out timestampsBox, 0);
        timestampsBox.SetCheckedSilently(GetPref(PrefTimestamps, true));
        timestampsBox.CheckedChanged += (s, e) => SetPref(PrefTimestamps, timestampsBox.Checked);

        var mentionRow = BuildInlineCheck("Highlight mentions", out highlightMentionsBox, 108);
        highlightMentionsBox.SetCheckedSilently(GetPref(PrefHighlightMentions, true));
        highlightMentionsBox.CheckedChanged += (s, e) => SetPref(PrefHighlightMentions, highlightMentionsBox.Checked);

        // Wide enough for two glyphs plus the Button class's own internal
        // text padding: at 28px the trailing "-"/"+" was silently clipped
        // and both buttons rendered as a bare "A".
        chatSmallerButton = new KitButton("A-", BtnKind.Ghost, Theme.Surface2);
        chatSmallerButton.Size = new Size(40, 22);
        chatSmallerButton.Font = Theme.Small;
        chatSmallerButton.Click += (s, e) => StepChatZoom(-0.1f);

        chatLargerButton = new KitButton("A+", BtnKind.Ghost, Theme.Surface2);
        chatLargerButton.Size = new Size(40, 22);
        chatLargerButton.Font = Theme.Small;
        chatLargerButton.Click += (s, e) => StepChatZoom(0.1f);

        // Kept against the right edge as the splitter moves, positioned by
        // hand rather than by Anchor: the row is laid out absolutely, so
        // there is no meaningful initial offset for an anchor to preserve.
        // The floor stops them sliding underneath the checkboxes when the
        // chat pane is dragged narrow.
        bar.SizeChanged += (s, e) =>
        {
            chatSmallerButton.Location = new Point(Math.Max(244, bar.Width - 90), 2);
            chatLargerButton.Location = new Point(Math.Max(288, bar.Width - 46), 2);
        };

        bar.Controls.Add(tsRow);
        bar.Controls.Add(mentionRow);
        bar.Controls.Add(chatSmallerButton);
        bar.Controls.Add(chatLargerButton);
        return bar;
    }

    // The rail's check row is a full-width block with its own margin; this
    // is the same tick and caption packed inline for a toolbar.
    private Panel BuildInlineCheck(string caption, out KitCheck box, int x)
    {
        int textWidth = TextRenderer.MeasureText(caption, Theme.Small).Width;
        var row = new Panel
        {
            Location = new Point(x, 4),
            Size = new Size(21 + textWidth, 20),
            BackColor = Theme.Surface2,
        };

        var check = new KitCheck { Location = new Point(0, 2), BackColor = Theme.Surface2 };

        var label = new Label
        {
            Text = caption,
            Font = Theme.Small,
            ForeColor = Theme.TextMuted,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(21, 2),
            Cursor = Cursors.Hand,
        };
        label.Click += (s, e) => check.Toggle();

        row.Controls.Add(label);
        row.Controls.Add(check);
        box = check;
        return row;
    }

    // ZoomFactor rather than restyling each run: it scales text already in
    // the buffer without touching the per-user colours and per-run fonts
    // that AppendColored has already baked in.
    private void StepChatZoom(float delta)
    {
        float next = chatBox.ZoomFactor + delta;
        if (next < 0.7f) next = 0.7f;
        if (next > 2.0f) next = 2.0f;
        chatBox.ZoomFactor = next;
        SetPref(PrefChatZoom, ((int)Math.Round(next * 100)).ToString());
    }

    // ---------- Setup ----------

    private Panel BuildSetupPanel()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface1, Visible = false, Padding = new Padding(16) };

        var title = new Label
        {
            Text = "Let's get you set up",
            Font = Theme.H1,
            ForeColor = Theme.Text,
            Dock = DockStyle.Top,
            Height = 34,
        };
        var subtitle = new Label
        {
            Text = isPackagedInstall
                ? "One quick step, then you're ready to start the bot."
                : "A few quick steps, then you're ready to start the bot.",
            Font = Theme.Body,
            ForeColor = Theme.TextMuted,
            Dock = DockStyle.Top,
            Height = 30,
        };

        // The first two steps are still built on a packaged install even
        // though they are never shown: RefreshSetupState writes to their
        // badges and labels unconditionally, and the readiness check reads
        // the same state either way.
        var step1 = BuildStep("1", "Node.js", out nodeBadge, out nodeDot, out nodeStatusLabel, BuildNodeStepControls());
        var step2 = BuildStep("2", "Install dependencies", out depsBadge, out depsDot, out depsStatusLabel, BuildDepsStepControls());
        var step3 = BuildStep(isPackagedInstall ? "1" : "3", "Connect your Twitch account", out accountBadge, out accountDot, out accountStatusLabel, BuildAccountStepControls());

        var logCard = new Card(Theme.Surface1) { Dock = DockStyle.Fill };
        var logHeader = new Label
        {
            Text = "SETUP LOG",
            Font = Theme.Micro,
            ForeColor = Theme.TextDim,
            BackColor = Theme.Surface2,
            Dock = DockStyle.Top,
            Height = 22,
        };
        setupLogBox = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Surface2,
            ForeColor = Theme.TextMuted,
            Font = Theme.Mono,
        };
        logCard.Controls.Add(setupLogBox);
        logCard.Controls.Add(logHeader);

        var logSpacer = new Panel { Dock = DockStyle.Top, Height = 12, BackColor = Theme.Surface1 };

        // Dock=Top controls stack in reverse of add order, so add the
        // fill-area content first, then each step (bottom-most first),
        // then the header text last so it ends up on top.
        panel.Controls.Add(logCard);
        panel.Controls.Add(logSpacer);
        panel.Controls.Add(step3);
        if (!isPackagedInstall)
        {
            panel.Controls.Add(step2);
            panel.Controls.Add(step1);
        }
        panel.Controls.Add(subtitle);
        panel.Controls.Add(title);

        return panel;
    }

    private Panel BuildStep(string number, string title, out Badge badge, out Dot dot, out Label statusLabel, Control extraControls)
    {
        var wrap = new Panel { Dock = DockStyle.Top, Height = 66, BackColor = Theme.Surface1, Padding = new Padding(0, 0, 0, 8) };
        var card = new Card(Theme.Surface1) { Dock = DockStyle.Fill, Padding = new Padding(12) };

        var b = new Badge(30) { Label = number, Fill = Theme.Surface3, Fore = Theme.TextMuted, Location = new Point(14, 14) };

        var titleLabel = new Label
        {
            Text = title,
            Font = Theme.BodyBold,
            ForeColor = Theme.Text,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(56, 10),
        };

        var d = new Dot { Location = new Point(58, 34), Size = new Size(8, 8) };
        var status = new Label
        {
            Font = Theme.Small,
            ForeColor = Theme.TextMuted,
            BackColor = Theme.Surface2,
            AutoSize = true,
            Location = new Point(70, 28),
        };

        card.Controls.Add(b);
        card.Controls.Add(titleLabel);
        card.Controls.Add(d);
        card.Controls.Add(status);

        if (extraControls != null)
        {
            card.Controls.Add(extraControls);
            card.Resize += (s, e) =>
            {
                extraControls.Location = new Point(Math.Max(300, card.Width - extraControls.Width - 14), (card.Height - extraControls.Height) / 2);
            };
        }

        wrap.Controls.Add(card);
        badge = b;
        dot = d;
        statusLabel = status;
        return wrap;
    }

    private Control BuildNodeStepControls()
    {
        var host = new Panel { Size = new Size(266, 32), BackColor = Theme.Surface2 };
        nodeRecheckButton = new KitButton("Recheck", BtnKind.Ghost, Theme.Surface2);
        nodeRecheckButton.Size = new Size(92, 30);
        nodeRecheckButton.Location = new Point(0, 1);
        nodeRecheckButton.Click += OnRecheckNodeClick;

        nodeDownloadButton = new KitButton("Download Node.js", BtnKind.Primary, Theme.Surface2);
        nodeDownloadButton.Size = new Size(160, 30);
        nodeDownloadButton.Location = new Point(102, 1);
        nodeDownloadButton.Click += (s, e) => OpenUrl("https://nodejs.org/");

        host.Controls.Add(nodeRecheckButton);
        host.Controls.Add(nodeDownloadButton);
        return host;
    }

    private Control BuildDepsStepControls()
    {
        var host = new Panel { Size = new Size(170, 32), BackColor = Theme.Surface2 };
        installDepsButton = new KitButton("Install Dependencies", BtnKind.Primary, Theme.Surface2);
        installDepsButton.Size = new Size(170, 30);
        installDepsButton.Location = new Point(0, 1);
        installDepsButton.Click += OnInstallDepsClick;
        host.Controls.Add(installDepsButton);
        return host;
    }

    private Control BuildAccountStepControls()
    {
        var host = new Panel { Size = new Size(390, 32), BackColor = Theme.Surface2 };

        usernameBox = new TextBox { BorderStyle = BorderStyle.None, BackColor = Theme.SurfaceInset, ForeColor = Theme.Text, Font = Theme.Small };
        var userHost = BorderHost(usernameBox, 120, Theme.Surface2);
        userHost.Location = new Point(0, 1);

        channelBox = new TextBox { BorderStyle = BorderStyle.None, BackColor = Theme.SurfaceInset, ForeColor = Theme.Text, Font = Theme.Small };
        var chanHost = BorderHost(channelBox, 120, Theme.Surface2);
        chanHost.Location = new Point(128, 1);

        connectButton = new KitButton("Connect", BtnKind.Primary, Theme.Surface2);
        connectButton.Size = new Size(130, 30);
        connectButton.Location = new Point(256, 1);
        connectButton.Click += OnConnectAccountClick;

        host.Controls.Add(userHost);
        host.Controls.Add(chanHost);
        host.Controls.Add(connectButton);
        return host;
    }

    // ---------- Readiness ----------

    private void ShowView(bool setup)
    {
        setupPanel.Visible = setup;
        dashboardPanel.Visible = !setup;
        navSetup.Active = setup;
        navDashboard.Active = !setup;
        navDashboard.Enabled = isReady;

        // Gated on readiness only, never on which view is showing: the bot
        // keeps running while you are looking at Setup, so disabling this
        // here would strand a running bot with no way to stop it. The one
        // loud button rule still holds either way, because an unready panel
        // greys this out (leaving the setup step's Connect as the only
        // accent fill) and a running bot turns it into an outlined Stop.
        toggleButton.Enabled = isReady;
    }

    private void RefreshSetupState()
    {
        bool hasModules = Directory.Exists(Path.Combine(rootDir, "node_modules"));
        bool hasAccount = !string.IsNullOrEmpty(GetEnvValue("TWITCH_OAUTH_TOKEN", ""));

        UpdateStepUI(nodeBadge, nodeDot, nodeStatusLabel, nodeAvailable, nodeAvailable ? "Found" : "Not found, download it then click Recheck");
        nodeDownloadButton.Visible = !nodeAvailable;

        UpdateStepUI(depsBadge, depsDot, depsStatusLabel, hasModules, hasModules ? "Installed" : "Not installed yet");
        installDepsButton.Enabled = nodeAvailable;

        UpdateStepUI(accountBadge, accountDot, accountStatusLabel, hasAccount,
            hasAccount ? "Connected as " + GetEnvValue("TWITCH_BOT_USERNAME", "?") : "Not connected yet");

        // Exactly one setup control is the primary action at a time: the
        // first step that is not finished yet. Once everything is done
        // none of them are, which is what keeps the kit's one loud button
        // per view rule true on this screen as well as the dashboard.
        installDepsButton.Kind = (nodeAvailable && !hasModules) ? BtnKind.Primary : BtnKind.Ghost;
        installDepsButton.Text = hasModules ? "Reinstall" : "Install Dependencies";

        connectButton.Kind = (nodeAvailable && hasModules && !hasAccount) ? BtnKind.Primary : BtnKind.Ghost;
        connectButton.Text = hasAccount ? "Reconnect" : "Connect";
        if (hasAccount)
        {
            usernameBox.Text = GetEnvValue("TWITCH_BOT_USERNAME", usernameBox.Text);
            channelBox.Text = GetEnvValue("TWITCH_CHANNEL", channelBox.Text);
        }

        channelValue.Text = GetEnvValue("TWITCH_CHANNEL", "not set");
        portValue.Text = GetEnvValue("ALERT_SERVER_PORT", "8090");
        SetOverlayValue(botProcess == null ? "none" : overlayValue.Text, false);

        isReady = nodeAvailable && hasModules && hasAccount;
        ShowView(!isReady);

        if (isReady && !hasEnteredDashboard)
        {
            hasEnteredDashboard = true;
            AppendLog("twitch-bot control ready.");
        }
    }

    private void UpdateStepUI(Badge badge, Dot dot, Label label, bool done, string text)
    {
        dot.DotColor = done ? Theme.Ok : Theme.Warn;
        dot.Invalidate();
        badge.Fill = Theme.Surface3;
        badge.Fore = done ? Theme.Ok : Theme.TextMuted;
        badge.Invalidate();
        label.Text = text;
        label.ForeColor = done ? Theme.Ok : Theme.TextMuted;
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
        AppendSetupLog(nodeAvailable ? "Node.js found." : "Still not found, make sure it finished installing then try again.");
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
        // The bundled runtime wins over anything installed system-wide, so
        // the bot always runs on the version it shipped with and a user
        // with no Node.js at all is never asked to go and get one.
        if (bundledNodePath != null && File.Exists(bundledNodePath)) return bundledNodePath;

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
        statusLabel.ForeColor = Theme.Text;
        statusDot.DotColor = Theme.Ok;
        statusDot.Invalidate();

        botStartedAt = DateTime.Now;
        RefreshUptime();
        uptimePill.Visible = true;
        uptimeTimer.Start();
        overlayTimer.Start();

        // Nothing on a running panel needs doing, so the loud button goes
        // away entirely: Stop is an outlined danger control, not a fill.
        toggleButton.Text = "Stop Bot";
        toggleButton.Kind = BtnKind.Danger;
    }

    private void SetStopped()
    {
        statusLabel.Text = "STOPPED";
        statusLabel.ForeColor = Theme.Text;
        statusDot.DotColor = Theme.Danger;
        statusDot.Invalidate();

        uptimeTimer.Stop();
        overlayTimer.Stop();
        uptimePill.Visible = false;
        SetOverlayValue("none", false);

        // The stats are polled by the bot process, so a stopped bot has no
        // way to refresh them. Blank them rather than leaving last hour's
        // viewer count sitting there looking current.
        ClearStatValues();

        // The mute flag lives in the bot process, so stopping it clears
        // the mute. Follow that here rather than leaving a tick claiming
        // a mute that nothing is enforcing any more.
        muteAlertsBox.SetCheckedSilently(false);

        toggleButton.Text = "Start Bot";
        toggleButton.Kind = BtnKind.Primary;
    }

    private void RefreshUptime()
    {
        TimeSpan up = DateTime.Now - botStartedAt;
        string text;
        if (up.TotalHours >= 1) text = "up " + (int)up.TotalHours + "h " + up.Minutes + "m";
        else if (up.TotalMinutes >= 1) text = "up " + (int)up.TotalMinutes + "m";
        else text = "up " + (int)up.TotalSeconds + "s";

        using (var g = uptimePill.CreateGraphics()) uptimePill.SetText(text, g);
        uptimePill.Location = new Point(statusLabel.Right + 10, 23);
    }

    // Polls the bot's alert server so the Overlays readout reflects what
    // is actually connected, rather than only being learned when a Test
    // Alert happens to be fired.
    private async System.Threading.Tasks.Task RefreshOverlayCount()
    {
        if (botProcess == null) return;
        string port = GetEnvValue("ALERT_SERVER_PORT", "8090");
        try
        {
            string body = await Http.GetStringAsync("http://localhost:" + port + "/status");

            // Mute rides along on this poll rather than getting its own, so
            // the tick follows the bot even if something else muted it (a
            // second panel, or a hand-typed URL).
            var muted = Regex.Match(body, "\"muted\"\\s*:\\s*(true|false)");
            if (muted.Success) muteAlertsBox.SetCheckedSilently(muted.Groups[1].Value == "true");

            // The channel stats ride on this same response rather than
            // getting their own poll. They are already cached bot-side, so
            // reading them every 5s costs Twitch nothing.
            ApplyStats(body);

            var m = Regex.Match(body, "\"connectedOverlays\"\\s*:\\s*(\\d+)");
            if (!m.Success) return;
            int count = int.Parse(m.Groups[1].Value);
            SetOverlayValue(count == 0 ? "none" : count + " connected", count > 0);
        }
        catch
        {
            // The server is not up yet during the first seconds after
            // start, and a transient failure should not spam the log.
            SetOverlayValue("unknown", false);
        }
    }

    private void SetOverlayValue(string text, bool ok)
    {
        if (overlayValue == null) return;
        overlayValue.Text = text;
        overlayValue.ForeColor = ok ? Theme.Ok : Theme.TextMuted;
    }

    // Reads the stats block off the /status response. Regex rather than a
    // JSON parser to match how the rest of this poll already works, and
    // because the field names are unique across the whole document, so
    // there is nothing to disambiguate by nesting.
    private void ApplyStats(string body)
    {
        bool live = Regex.IsMatch(body, "\"live\"\\s*:\\s*true");
        string problem = StatError(ReadStatText(body, "error"));

        // Offline is not zero. Helix has no viewer count for a channel that
        // is not live, so showing 0 would invent a measurement.
        string viewers = ReadStatText(body, "viewers");
        if (viewers != null) SetStatValue(viewersValue, viewers, true);
        else if (!live) SetStatValue(viewersValue, "offline", false);
        else SetStatValue(viewersValue, problem, false);

        ApplyStat(chattersValue, body, "chatters", problem);
        ApplyStat(followersValue, body, "followers", problem);
        ApplyStat(subsValue, body, "subscribers", problem);
    }

    private void ApplyStat(Label target, string body, string field, string problem)
    {
        string value = ReadStatText(body, field);
        if (value != null) SetStatValue(target, value, true);
        else SetStatValue(target, problem, false);
    }

    // Returns the number as text, or null when the field is absent or
    // explicitly null -- which is how the bot says "no answer", as opposed
    // to an answer of zero.
    private string ReadStatText(string body, string field)
    {
        var m = Regex.Match(body, "\"" + field + "\"\\s*:\\s*(\\d+|\"[^\"]*\"|null)");
        if (!m.Success) return null;
        string raw = m.Groups[1].Value;
        if (raw == "null") return null;
        return raw.Trim('"');
    }

    // Each failure needs a different thing from the reader, so each gets
    // its own word: a scope problem is fixed by Reconnect, the rest by
    // waiting.
    private string StatError(string kind)
    {
        if (kind == "auth") return "reconnect";
        if (kind == "ratelimit") return "rate limited";
        if (kind == "unavailable") return "unavailable";
        return "-";
    }

    private void SetStatValue(Label target, string text, bool ok)
    {
        if (target == null) return;
        target.Text = text;
        target.ForeColor = ok ? Theme.Text : Theme.TextMuted;
    }

    private void ClearStatValues()
    {
        SetStatValue(viewersValue, "-", false);
        SetStatValue(chattersValue, "-", false);
        SetStatValue(followersValue, "-", false);
        SetStatValue(subsValue, "-", false);
    }

    // ---------- OBS / Test Alert / Update ----------

    private void OnObsButtonClick(object sender, EventArgs e)
    {
        RunNodeScriptOneShot("scripts/addObsSource.js", ObsScriptEnv(), obsButton);
    }

    // The box is an override, not a requirement: the scripts fall back to the
    // password OBS itself has saved. Passing it through empty would be worse
    // than not passing it, since dotenv leaves an already-defined variable
    // alone, so an empty string here beats a correct value in .env and fails
    // the handshake.
    private Dictionary<string, string> ObsScriptEnv()
    {
        var env = new Dictionary<string, string>();
        if (!string.IsNullOrEmpty(obsPasswordBox.Text))
        {
            env["OBS_WEBSOCKET_PASSWORD"] = obsPasswordBox.Text;
        }
        return env;
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
            string response = await Http.GetStringAsync("http://localhost:" + port + "/test-alert");
            if (response.Contains("\"connectedOverlays\":0"))
            {
                AppendLog("Test alert sent, but no OBS overlay is connected -- add http://localhost:" + port + "/overlay.html as an OBS Browser Source first.");
            }
            else
            {
                AppendLog("Test alert sent -- check OBS for the popup and listen for the voice/chime.");
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

    // Tells every connected browser source to reload itself, which is the
    // standard fix for an overlay that has gone stale or stopped rendering.
    // Unlike Test Alert this is safe to press on stream: nothing is shown
    // to viewers, the page just reconnects.
    //
    // When nothing is connected it goes in through OBS instead. That case is
    // not "you forgot to add the source", it is usually OBS having started
    // before the bot: the source requested the overlay, got a connection
    // refused, and is sitting on an error page. No script runs on an error
    // page, so the page cannot be told anything and cannot recover itself.
    private async void OnReloadOverlaysClick(object sender, EventArgs e)
    {
        if (botProcess == null)
        {
            AppendLog("Start the bot first, then try Reload Overlays -- the alert server only runs while the bot is running.");
            return;
        }

        reloadOverlaysButton.Enabled = false;
        string port = GetEnvValue("ALERT_SERVER_PORT", "8090");
        bool handedOffToScript = false;

        try
        {
            string response = await Http.GetStringAsync("http://localhost:" + port + "/reload-overlays");
            if (response.Contains("\"connectedOverlays\":0"))
            {
                AppendLog("No overlay connected -- asking OBS to refresh the browser source itself...");
                RunNodeScriptOneShot("scripts/refreshObsSource.js", ObsScriptEnv(), reloadOverlaysButton);
                handedOffToScript = true;
            }
            else
            {
                AppendLog("Reload sent -- the overlay should reconnect within a second or two.");
            }
        }
        catch (Exception ex)
        {
            AppendLog("Could not reach the alert server: " + ex.Message);
        }
        finally
        {
            // RunNodeScriptOneShot owns the button until the script exits.
            if (!handedOffToScript) reloadOverlaysButton.Enabled = true;
        }
    }

    // ---------- Mute Alerts ----------

    // Mute lives in the running bot, not here, so that it holds however the
    // alert was triggered. The tick is only a remote control for it, which
    // is also why it is not saved: the bot forgets on restart by design,
    // and a tick that claimed otherwise would be lying.
    private async void OnMuteAlertsChanged(object sender, EventArgs e)
    {
        bool wanted = muteAlertsBox.Checked;

        if (botProcess == null)
        {
            AppendLog("Start the bot first -- muting only applies while the alert server is running.");
            muteAlertsBox.SetCheckedSilently(false);
            return;
        }

        string port = GetEnvValue("ALERT_SERVER_PORT", "8090");
        try
        {
            await Http.GetStringAsync("http://localhost:" + port + "/mute-alerts?muted=" + (wanted ? "1" : "0"));
            AppendLog(wanted
                ? "Alert audio muted. Alerts still appear on the overlay, they just make no sound."
                : "Alert audio unmuted.");
        }
        catch (Exception ex)
        {
            AppendLog("Could not reach the alert server: " + ex.Message);
            // Show what is actually true rather than what was asked for.
            muteAlertsBox.SetCheckedSilently(!wanted);
        }
    }

    // ---------- Report an Issue ----------

    // ---------- Channel title and category ----------

    private Dictionary<string, string> ChannelScriptEnv()
    {
        var env = new Dictionary<string, string>();
        // Only non-empty values are passed. dotenv will not overwrite an
        // already-defined variable, so passing an empty string here would beat
        // anything in .env, which is the bug that made an empty OBS password
        // box defeat a correct saved one.
        if (!string.IsNullOrWhiteSpace(channelTitleBox.Text)) env["CHANNEL_TITLE"] = channelTitleBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(channelCategoryBox.Text)) env["CHANNEL_CATEGORY"] = channelCategoryBox.Text.Trim();
        return env;
    }

    private void OnUpdateChannelClick(object sender, EventArgs e)
    {
        if (!nodeAvailable)
        {
            AppendLog("Node.js is required to update the channel. See Setup.");
            return;
        }

        var env = ChannelScriptEnv();
        if (env.Count == 0)
        {
            AppendLog("Nothing to change: fill in a title or a category first.");
            return;
        }

        // Deliberately not gated on the bot running. The token lives in .env,
        // not in the bot process, and fixing a title is something you do before
        // pressing Start Bot.
        RunNodeScriptOneShot("scripts/setChannelInfo.js", env, updateChannelButton);
    }

    private void OnChannelRefreshClick(object sender, EventArgs e)
    {
        channelHintLabel.Text = "Reading current values...";
        channelHintLabel.ForeColor = Theme.TextDim;
        ReadChannelInfoInBackground();
    }

    // Prefills the two fields with what the channel currently has. Blank fields
    // would be a trap: pressing Update with an empty title box reads as "clear
    // the title", and there would be no way to tell "unchanged" from "erase".
    //
    // Captures stdout rather than going through RunNodeScriptOneShot, which
    // streams into the activity log. This runs unprompted on launch, and two
    // lines of machine-readable output in the log on every start is noise.
    private void ReadChannelInfoInBackground()
    {
        if (!nodeAvailable) return;

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ResolveNodePath(),
                Arguments = "\"" + Path.Combine(rootDir, "scripts", "readChannelInfo.js") + "\"",
                WorkingDirectory = rootDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var output = new StringBuilder();
            proc.OutputDataReceived += (s, ev) => { if (ev.Data != null) output.AppendLine(ev.Data); };
            proc.Exited += (s, ev) =>
            {
                string text = output.ToString();
                BeginInvoke(new Action(() =>
                {
                    OnChannelInfoFinished(text);
                    proc.Dispose();
                }));
            };

            proc.Start();
            proc.BeginOutputReadLine();
        }
        catch (Exception ex)
        {
            channelHintLabel.Text = "Could not read current values";
            channelHintLabel.ForeColor = Theme.Danger;
            AppendLog("Could not read the channel's current title: " + ex.Message);
        }
    }

    private void OnChannelInfoFinished(string output)
    {
        var failure = Regex.Match(output, @"CHANNEL_INFO_FAILED=(.*)$", RegexOptions.Multiline);
        if (failure.Success)
        {
            channelHintLabel.Text = "Could not read current values";
            channelHintLabel.ForeColor = Theme.Danger;
            AppendLog("Could not read the channel's current title and category: " + failure.Groups[1].Value.Trim());
            return;
        }

        // Anchored to end-of-line so a title containing "=" survives intact.
        var title = Regex.Match(output, @"CHANNEL_TITLE=(.*)$", RegexOptions.Multiline);
        var category = Regex.Match(output, @"CHANNEL_CATEGORY=(.*)$", RegexOptions.Multiline);
        if (!title.Success && !category.Success)
        {
            channelHintLabel.Text = "Could not read current values";
            channelHintLabel.ForeColor = Theme.Danger;
            return;
        }

        if (title.Success) channelTitleBox.Text = title.Groups[1].Value.TrimEnd('\r');
        if (category.Success) channelCategoryBox.Text = category.Groups[1].Value.TrimEnd('\r');
        channelHintLabel.Text = "Showing what is live now";
        channelHintLabel.ForeColor = Theme.TextDim;
    }

    private void OnReportIssueClick(object sender, EventArgs e)
    {
        using (var dialog = new IssueDialog())
        {
            if (dialog.ShowDialog(this) != DialogResult.OK) return;

            string screenshot = dialog.ScreenshotPath;
            if (!string.IsNullOrEmpty(screenshot))
            {
                if (PutImageOnClipboard(screenshot))
                {
                    AppendLog("Screenshot on the clipboard: " + Path.GetFileName(screenshot));
                    AppendLog("Press Ctrl+V in the issue body on GitHub to attach it.");
                }
                else
                {
                    AppendLog("That image could not be read, so nothing was copied. Drag it into the issue instead: " + screenshot);
                }
            }

            AppendLog("Opening the issue tracker in your browser. The version and your Windows build are filled in already.");
            OpenUrl("https://github.com/CruddOCE/twitch-bot/issues/new?body=" + Uri.EscapeDataString(BuildIssueBody(screenshot)));
        }
    }

    // Both formats go on the clipboard because a paste into a browser editor
    // can arrive as either an image or a dropped file depending on the
    // browser, and carrying both is the difference between this working first
    // try and the reporter going hunting for the file themselves.
    private bool PutImageOnClipboard(string path)
    {
        try
        {
            var data = new DataObject();
            // Copied out of the file-backed Image, which otherwise holds a
            // lock on the file for as long as it is alive.
            using (var fromFile = Image.FromFile(path))
            using (var copy = new Bitmap(fromFile))
            {
                data.SetImage(copy);
                var files = new System.Collections.Specialized.StringCollection();
                files.Add(path);
                data.SetFileDropList(files);
                Clipboard.SetDataObject(data, true);
            }
            return true;
        }
        catch (Exception ex)
        {
            AppendLog("Clipboard copy failed: " + ex.Message);
            return false;
        }
    }

    // A skeleton rather than an empty box. The three questions are the ones
    // whose absence sends every bug report into a round trip, and the version
    // and OS are filled in here because a reporter should not have to know
    // where to find them.
    private string BuildIssueBody(string screenshotPath)
    {
        var body = new StringBuilder();
        body.AppendLine("**What happened**");
        body.AppendLine();
        body.AppendLine();
        body.AppendLine("**What you expected instead**");
        body.AppendLine();
        body.AppendLine();
        body.AppendLine("**Steps to reproduce**");
        body.AppendLine("1. ");
        body.AppendLine("2. ");
        body.AppendLine();
        body.AppendLine("**Screenshot**");
        body.AppendLine(string.IsNullOrEmpty(screenshotPath)
            ? "Drag one in here if you have one."
            : "Paste it here with Ctrl+V, it is already on your clipboard.");
        body.AppendLine();
        body.AppendLine("---");
        body.AppendLine("twitch-bot v" + AppVersion + " on " + Environment.OSVersion.VersionString);
        return body.ToString();
    }

    // ---------- Update check on launch ----------

    // Checks whether GitHub is ahead and says so; it deliberately does not
    // pull. Windows will not let git overwrite a running .exe, and this
    // one is running, so a background update would fail exactly when the
    // panel is open. Applying stays the Update button, which closes the
    // app first.
    private void CheckForUpdatesInBackground()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ResolveNodePath(),
                Arguments = "\"" + Path.Combine(rootDir, "scripts", "checkUpdate.js") + "\"",
                WorkingDirectory = rootDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var output = new StringBuilder();
            proc.OutputDataReceived += (s, ev) => { if (ev.Data != null) output.AppendLine(ev.Data); };
            proc.Exited += (s, ev) =>
            {
                string text = output.ToString();
                BeginInvoke(new Action(() =>
                {
                    OnUpdateCheckFinished(text);
                    proc.Dispose();
                }));
            };

            proc.Start();
            proc.BeginOutputReadLine();
        }
        catch (Exception)
        {
            // Being unable to check is not worth a log line on every
            // launch; the Update button still works by hand.
        }
    }

    private void OnUpdateCheckFinished(string output)
    {
        var match = Regex.Match(output, @"UPDATE_AVAILABLE=(\d+)");
        if (!match.Success) return;

        int behind = int.Parse(match.Groups[1].Value);
        if (behind == 0) return;

        AppendLog("An update is available (" + behind + " new commit" + (behind == 1 ? "" : "s") +
            " on GitHub). Press Update in the left rail to apply it. The app will close, update, and reopen.");

        // Relabelled rather than promoted to Primary. Start Bot is meant to
        // be the only accent-filled control on screen, and an update is not
        // urgent enough to start competing with it for attention.
        updateButton.Text = "Update available";
    }

    // ---------- Panel preferences ----------

    // Panel-local display settings, kept in the registry rather than in
    // config/*.json. Those files are the bot's configuration and are
    // stashed and reapplied by the updater; these are preferences for this
    // window on this machine, and the Run entry already proves the
    // registry path works without a new assembly reference or a JSON
    // parser on the C# side.
    private const string PrefKeyPath = @"Software\twitch-bot";
    private const string PrefTimestamps = "ChatTimestamps";
    private const string PrefHighlightMentions = "HighlightMentions";
    private const string PrefChatZoom = "ChatZoomPercent";
    private const string PrefCheckUpdates = "CheckUpdatesOnLaunch";

    private string GetPref(string name, string defaultValue)
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(PrefKeyPath))
            {
                if (key == null) return defaultValue;
                var value = key.GetValue(name) as string;
                return value == null ? defaultValue : value;
            }
        }
        catch (Exception)
        {
            return defaultValue;
        }
    }

    private bool GetPref(string name, bool defaultValue)
    {
        return GetPref(name, defaultValue ? "1" : "0") == "1";
    }

    private void SetPref(string name, string value)
    {
        try
        {
            using (var key = Registry.CurrentUser.CreateSubKey(PrefKeyPath))
            {
                key.SetValue(name, value);
            }
        }
        catch (Exception)
        {
            // A display preference is not worth interrupting a stream over.
            // It just reverts to the default next launch.
        }
    }

    private void SetPref(string name, bool value)
    {
        SetPref(name, value ? "1" : "0");
    }

    // ---------- Start with Windows ----------

    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "twitch-bot";

    // Reads the current Run entry and reports whether it is set. Repoints a
    // stale one at the same time: the entry stores an absolute path, so a
    // moved or renamed install would otherwise keep a dead entry that only
    // announces itself at the next reboot.
    private bool SyncStartWithWindowsState()
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true))
            {
                if (key == null) return false;
                var existing = key.GetValue(RunValueName) as string;
                if (existing == null) return false;
                string wanted = StartupCommand();
                if (existing != wanted) key.SetValue(RunValueName, wanted);
                return true;
            }
        }
        catch (Exception)
        {
            // A locked-down or policy-managed Run key is not worth failing
            // startup over; the toggle just reports off until pressed.
            return false;
        }
    }

    private string StartupCommand()
    {
        return "\"" + Application.ExecutablePath + "\"";
    }

    private void OnStartWithWindowsChanged(object sender, EventArgs e)
    {
        bool wanted = startWithWindowsBox.Checked;
        try
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKeyPath))
            {
                if (wanted) key.SetValue(RunValueName, StartupCommand());
                else key.DeleteValue(RunValueName, false);
            }
            AppendLog(wanted
                ? "twitch-bot will now open when you sign in to Windows. It opens this panel only -- press Start Bot as usual."
                : "twitch-bot will no longer open when you sign in to Windows.");
        }
        catch (Exception ex)
        {
            AppendLog("Could not change the Windows startup setting: " + ex.Message);
            // Leave the tick showing what is actually true rather than what
            // was asked for. Silently, or the correction re-enters this
            // handler and undoes itself.
            startWithWindowsBox.SetCheckedSilently(!wanted);
        }
    }

    // Where the user's writable state lives. Must agree with src/paths.js:
    // Program Files is not user-writable, so an installed copy keeps its
    // .env, config, logs and TTS output under %APPDATA% instead. A
    // checkout keeps everything in the project folder as before.
    // Tested on .git and not on the bundled runtime, because src/paths.js
    // draws the line in exactly that place: a hand-unzipped release has no
    // .git either, and both sides have to agree on where the .env is or the
    // panel reads a different file from the bot it launches.
    private string ResolveDataDir()
    {
        string gitPath = Path.Combine(rootDir, ".git");
        bool isCheckout = Directory.Exists(gitPath) || File.Exists(gitPath);
        if (isCheckout) return rootDir;
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "twitch-bot");
    }

    // Minimal .env reader -- just enough to pick up config values without
    // pulling in a full parser.
    private string GetEnvValue(string key, string defaultValue)
    {
        string envPath = Path.Combine(ResolveDataDir(), ".env");
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

        AppendLog(isPackagedInstall
            ? "This app will close, download the update and reinstall itself, then reopen automatically. Windows will ask you to allow the installer."
            : "This app will close, update, then reopen automatically. A console window will show progress.");

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
    //
    // On a packaged install there is a third step in the middle. update.js
    // only downloads the new installer, because it is itself running under
    // the bundled runtime\node.exe that the installer has to overwrite.
    // Running the downloaded file from here instead means node has already
    // exited and nothing under the program folder is locked. The path is
    // fixed by src/release.js so it can be named literally here.
    private void StartUpdateWatcher()
    {
        string nodeExe = ResolveNodePath();
        string updateScript = Path.Combine(rootDir, "scripts", "update.js");
        string controlExe = Path.Combine(rootDir, "bin", "twitch-bot-control.exe");
        string downloadedInstaller = Path.Combine(Path.GetTempPath(), "twitch-bot-update", "twitch-bot-setup.exe");
        int myPid = Process.GetCurrentProcess().Id;

        // "if exist" rather than an unconditional run: a checkout's update
        // path never produces this file, and the same chain serves both.
        string installStep = "& if exist \"" + downloadedInstaller + "\" \"" + downloadedInstaller + "\" /SILENT /NORESTART ";

        string watcherCommand =
            "powershell -NoProfile -Command \"Wait-Process -Id " + myPid + " -ErrorAction SilentlyContinue\" " +
            "&& \"" + nodeExe + "\" \"" + updateScript + "\" " +
            installStep +
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

    // The bot's stdout carries no severity field, so the log is coloured
    // by keyword. Deliberately only two rules: anything that reads as a
    // failure, and anything that reads as a milestone worth spotting from
    // across the room. Everything else stays muted, because a log where
    // most lines are coloured is a log where none of them stand out.
    private Color ColorForLogLine(string line)
    {
        string l = line.ToLowerInvariant();
        if (l.Contains("fail") || l.Contains("error") || l.Contains("could not") || l.Contains("not connected"))
            return Theme.Danger;
        if (l.Contains("connected") || l.Contains("listening") || l.Contains("installed") || l.Contains("ready"))
            return Theme.Ok;
        return Theme.TextMuted;
    }

    private void AppendLog(string line)
    {
        AppendColored(logBox, line + Environment.NewLine, ColorForLogLine(line), Theme.Mono);
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

        if (isMod || isBroadcaster) knownMods.Add(username);
        bool mentionsMod = highlightMentionsBox.Checked && MentionsKnownMod(text);

        chatBox.SelectionStart = chatBox.TextLength;
        chatBox.SelectionLength = 0;

        // Set once for the whole row rather than per run, so the highlight
        // reads as one continuous band instead of striping around the gaps
        // between timestamp, badge, name and message.
        chatBox.SelectionBackColor = mentionsMod ? Theme.Surface3 : Theme.Surface2;

        if (timestampsBox.Checked) AppendColored(chatBox, DateTime.Now.ToString("HH:mm:ss "), Theme.TextDim, Theme.Small);

        if (isBroadcaster) AppendColored(chatBox, "[HOST] ", Theme.Accent, Theme.Micro);
        else if (isMod) AppendColored(chatBox, "[MOD] ", Theme.Ok, Theme.Micro);

        AppendColored(chatBox, username + ": ", ColorForUsername(username), Theme.BodyBold);
        AppendColored(chatBox, text + Environment.NewLine, Theme.Text, Theme.Body);

        // Reset, or every later line inherits the highlight.
        chatBox.SelectionBackColor = Theme.Surface2;

        chatBox.ScrollToCaret();
        TrimIfTooLong(chatBox);
    }

    // A mod is anyone who has spoken with the mod or broadcaster flag set
    // this session, so the set fills in as chat happens rather than needing
    // a Twitch API call for a list that barely changes.
    //
    // Matches "@name" only. A bare mention of a mod's name in normal
    // conversation is common enough that highlighting it would mean
    // highlighting most of chat, which highlights nothing.
    private bool MentionsKnownMod(string text)
    {
        if (knownMods.Count == 0) return false;

        foreach (Match m in Regex.Matches(text, @"@([A-Za-z0-9_]{2,25})"))
        {
            if (knownMods.Contains(m.Groups[1].Value)) return true;
        }
        return false;
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
