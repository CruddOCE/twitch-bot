; Inno Setup script for the twitch-bot installer pack.
;
; Not built by hand: scripts/build-installer.js stages a clean payload
; (app files, production node_modules, a bundled node.exe) into a temp
; folder and passes it in as PayloadDir, so nothing from a working copy,
; no .env, no logs, no versions archive, can end up in a public installer.
;
; Requires Inno Setup 6.3 or newer for ArchitecturesInstallIn64BitMode's
; x64compatible value.
;
; Build:  npm run build-installer

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PayloadDir
  #error PayloadDir must be defined by the build script
#endif

#define AppName "twitch-bot"
#define AppPublisher "CruddOCE"
#define AppUrl "https://github.com/CruddOCE/twitch-bot"
#define ControlExe "bin\twitch-bot-control.exe"

[Setup]
; This GUID is the app's identity. Changing it turns an upgrade into a
; second parallel install with its own Add/Remove Programs entry, so it
; must stay fixed for the life of the project.
AppId={{A7F3C1E2-5B94-4D6A-9E31-2C8F0B7D4A15}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
VersionInfoVersion={#AppVersion}.0
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
; Program Files, so setup needs elevation. The app itself runs unelevated
; and keeps everything it writes under %APPDATA%\twitch-bot.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#PayloadDir}\..\out
OutputBaseFilename={#AppName}-setup-{#AppVersion}
SetupIconFile={#SourcePath}\..\native\icon.ico
UninstallDisplayIcon={app}\{#ControlExe}
UninstallDisplayName={#AppName} {#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Uses the Restart Manager to spot the control panel or a running bot
; holding files in the install folder. Without this an upgrade fails
; halfway through with a locked-file error, which is exactly what happens
; when the panel updates itself.
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ControlExe}"; WorkingDir: "{app}"; Comment: "Start and stop the bot, watch chat, set up OBS"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ControlExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; skipifsilent matters: a silent run is the self-update path, and there the
; control panel is relaunched by the updater's own command chain. Without
; this flag that update would leave two panels open.
Filename: "{app}\{#ControlExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Installed files go on their own. This clears what the app generated
; inside the program folder afterwards, so no empty shell is left behind.
Type: filesandordirs; Name: "{app}"

[Code]
function DataDir(): String;
begin
  Result := ExpandConstant('{userappdata}\{#AppName}');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Dir: String;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;

  Dir := DataDir();
  if not DirExists(Dir) then
    Exit;

  { Defaults to keeping the data, and never asks during a silent uninstall.
    The folder holds the Twitch login and every custom command the user has
    written, so throwing it away has to be a deliberate answer to a
    question, not the path of least resistance. }
  if UninstallSilent then
    Exit;

  if MsgBox('Also delete your settings, custom commands and Twitch login?'#13#10#13#10
            + Dir + #13#10#13#10
            + 'Choose No if you plan to reinstall.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DelTree(Dir, True, True, True);
end;
