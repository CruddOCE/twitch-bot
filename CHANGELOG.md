# Changelog

## 0.7.0 (2026-08-09)

A packaging release. Installing the bot used to mean downloading the repo,
installing Node.js, and letting the control panel run `npm install` before
anything worked. It is now a single setup exe that needs nothing already on
the machine.

Nothing about how the bot behaves on stream changed in this version.

### Added

- **A real Windows installer**, `twitch-bot-setup-<version>.exe`. Installs to
  `C:\Program Files\twitch-bot`, adds Start Menu and optional Desktop
  shortcuts, and registers in Settings > Apps with a working uninstaller.
  Reinstalling upgrades in place rather than leaving two entries behind.
- **A bundled Node.js runtime.** The pack carries its own `node.exe` and all
  production dependencies, so there is nothing to install first, nothing to
  compile, and no internet needed during setup. The bot always runs on the
  Node version it shipped with rather than whatever happens to be on PATH.
- **`npm run build-installer`**, which builds the pack. It stages a clean
  copy in a temp folder from an explicit allowlist, so a real `.env`, the log
  file or the `versions/` archive cannot end up in a public installer, and it
  refuses to build if a `.env` or `.git` reaches the payload.
- **Update by installer.** On an installed copy, the Update button now asks
  the GitHub Releases API for the newest version, downloads its installer and
  runs it. A git checkout still pulls, exactly as before.
- Tests covering the split: where each writable path resolves, that config
  seeding never overwrites a user's own file, that the TTS mount still serves
  audio, release version comparison, and that the version in `package.json`
  matches the one the panel displays.

### Changed

- **First-run setup is one step instead of three** on an installed copy.
  Node.js and Install Dependencies are both already satisfied by the pack, so
  only Connect your Twitch account is left. A git checkout still shows all
  three, because a checkout genuinely needs them.
- **Your settings moved to `%APPDATA%\twitch-bot`** for installed copies:
  `.env`, `config\*.json`, `logs\bot.log` and generated TTS audio. Program
  Files is not writable by the account running the app, so leaving them in
  the program folder would have failed on the first save. An existing `.env`
  is migrated across automatically on first run. A git checkout is unchanged
  and keeps all of them in the project folder.
- **Shipped config files are now templates.** They seed your config the first
  time the bot runs and are never written over afterwards, so an update
  cannot reset custom commands.
- The uninstaller asks once whether to delete your settings and Twitch login,
  and defaults to keeping them.

### Removed

- `install-twitch-bot.exe` from the project root, along with its source. It
  existed only to give a fresh download one obvious thing to double-click,
  which is what the installer and its Start Menu shortcut now do properly.

### Known limitation

- The installer is not code-signed, so Windows SmartScreen shows "Windows
  protected your PC" on first run and users have to click More info, then Run
  anyway. Fixing this needs a paid code-signing certificate.

## 0.6.0 (2026-08-09)

Two features, both of them fixes for things that wasted real stream time: an
overlay that could not recover itself when OBS started first, and a bug report
that arrived with no picture of the bug.

Neither feature had been used on a live stream when this version shipped. Both
were confirmed working on 2026-08-09, shortly after. See **Still needs testing**
at the bottom for what is still outstanding, all of it carried over from
0.5.16.

### Added

- **Overlay recovery through OBS.** Reload Overlays used to answer "no OBS
  overlay is connected" and stop there, which is precisely the case you press
  it in. It now goes in through OBS's own WebSocket and refreshes the Browser
  Source directly, so an overlay that never loaded can be recovered without
  deleting and re-adding the source.

  This is the fix for having to re-add the overlay every session. When OBS
  starts before the bot, the Browser Source asks for the overlay, gets a
  connection refused and renders an error page. The overlay's own reconnect
  loop is script inside the page, and an error page runs no script, so nothing
  is left alive in there to reconnect. Broadcasting over the WebSocket cannot
  reach it either, because it was never connected. Driving OBS from the outside
  is the only route back.
- **`npm run obs-refresh`**, the same recovery as a standalone script. It finds
  every browser source pointing at the overlay and presses OBS's own "Refresh
  cache of current page". Sources are matched on their URL rather than their
  name, so a renamed source and a copy in each scene are all caught.
- **Screenshots on bug reports.** Report an Issue now asks for a screenshot
  first, copies it to your clipboard, and opens the tracker with the version,
  your Windows build and a short template already filled in. Paste it into the
  issue body with Ctrl+V.

  The paste is manual and cannot be automated away: GitHub accepts an image
  only by paste or drag into its own editor, with no link or parameter that
  attaches one. The clipboard carries both the image and the file, so if a
  paste does not take, dragging the file in works instead. A screenshot is
  optional, and skipping it still gets you the prefilled template.
- **Girth on `!pp`**, alongside the existing length.

### Fixed

- An empty OBS password box beat a correct password in `.env`. The panel passed
  the empty value to the OBS scripts regardless, and dotenv will not overwrite
  a variable that is already defined, so the file was never consulted and
  authentication failed. The box is now omitted when empty.
- The saved OBS WebSocket password was stale, almost certainly since the OBS
  reinstall in July, which regenerates it. Both OBS scripts now fall back to
  reading it from OBS's own `plugin_config/obs-websocket/config.json`, so it
  cannot silently rot again.
- A wrong OBS password used to look identical to OBS not running. It is not an
  error, it is close code 4009 with no reply, so the connection just went quiet
  and timed out. It is now reported as a wrong password.

### Changed

- The OBS password field is optional, now that both OBS actions fall back to
  the password OBS itself has saved.
- The obs-websocket handshake moved into `src/obsWebSocket.js`, shared by
  `scripts/addObsSource.js` and the new `scripts/refreshObsSource.js` instead
  of living inside the former.

### Still needs testing

Everything carried over from 0.5.16 is still outstanding:

- The Mute Alerts and Check for updates on launch ticks. Both are custom
  controls that synthetic clicks cannot drive, so they were verified by driving
  the code behind them instead.
- Chat timestamps and mod-mention highlighting, which need live chat with a
  moderator present to see.

New in this release, both since confirmed:

- ~~**The cold start that motivated the whole feature.** Recovery was proved by
  reproducing the fault deliberately: a browser source was pointed at a port
  with nothing listening, which produced the identical error page, and the
  refresh took the connected count from 0 to 1. What has not happened yet is
  an ordinary session where OBS opens first and the button is pressed for
  real.~~
- ~~**Whether the screenshot actually pastes into GitHub's editor.** The dialog
  runs end to end and the clipboard is confirmed to carry both the image and
  the file path afterwards, but proving the paste needs a signed-in browser
  and a real issue draft.~~

**Confirmed after release, 2026-08-09.** Both of the above were used for real
and behaved as intended: the overlay recovered on an actual cold start, and the
screenshot pasted into GitHub's editor. They are struck through rather than
deleted, because these notes are the record of what was proven at the time the
version shipped, and at that point neither was.

### Known gap

A scene switch still will not recover a dead overlay, because
`restart_when_active` is not set on the browser source. Reload Overlays is the
route back for now.

## 0.5.16 (2026-08-03)

Completes Phase 1 of `FEATURES-TO-ADD.md`. Six new controls, five of them in
the control panel and one in the alert server.

Some of this is not yet exercised against live chat or live OBS. See
**Still needs testing** at the bottom.

### Added

- **Mute Alerts.** Silences alert audio while alerts keep appearing on the
  overlay, for when you are mid-sentence or in a cutscene. This is not a
  pause: a muted alert still plays and still passes, it just makes no sound,
  so nothing is held back to fire later. New `GET /mute-alerts?muted=0|1` on
  the alert server, with the state also reported by `GET /status` so the
  panel's tick follows the bot rather than guessing. The flag lives in the
  running bot and clears when it stops, deliberately: a mute that quietly
  survived a restart would cost a whole stream of audio before anyone
  noticed it was still on.
- **Report an Issue.** Opens the GitHub issue tracker, after logging a line
  naming the version, since a report without a version number is most of a
  wasted round trip.
- **Check for updates on launch.** On by default. Asks GitHub whether this
  install is behind and, if it is, says so in the activity log and relabels
  the Update button to "Update available". It only ever checks. Nothing is
  downloaded or applied until you press Update, because git cannot overwrite
  the running `.exe` anyway. New read-only `scripts/checkUpdate.js` does the
  work and can be run by hand.
- **Chat timestamps toggle.** The time prefix was always drawn; now it can be
  turned off when you would rather have the width.
- **Highlight mod mentions.** A message that `@`s a moderator gets a raised
  background so it does not scroll past unnoticed. Moderators are learned
  from chat as they speak, so no Twitch API call is involved. Matches `@name`
  only: bare names come up often enough in normal conversation that matching
  them would highlight most of chat, which highlights nothing.
- **Chat font size.** `A-` and `A+` scale the chat text between 70% and 200%,
  for reading it from across the room on a second monitor.
- A toolbar inside the Live Chat card holding the three chat display
  controls, which are remembered between sessions in
  `HKCU\Software\twitch-bot`.

### Fixed

- The left rail overflowed once the new controls were added, silently eating
  the Channel and Alert port readout rows from the top and cutting the Mute
  Alerts row in half. The rail is a fixed stack that cannot reflow, so it now
  sets the window's minimum height.
- The `A-` and `A+` buttons rendered as a bare `A`, the trailing symbol being
  clipped at their original width.

### Changed

- Default window height is 640 (was 600) and the minimum is 760x630 (was
  760x460), both driven by what the rail has to fit.
- `GET /status` gained a `muted` field.
- Alert payloads gained a `muted` field, which the overlay honours by
  skipping the chime while still showing the alert box.
- Panel display preferences are stored in the registry under
  `HKCU\Software\twitch-bot`, kept separate from `config/*.json`, which
  remains the bot's own configuration and is stashed and reapplied by the
  updater.

### Still needs testing

- The Mute Alerts and Check for updates on launch ticks. Both are custom
  controls that synthetic clicks cannot drive, so they were verified by
  driving the code behind them instead. The HTTP endpoint behind Mute Alerts
  is fully covered by `npm test`.
- Chat timestamps and mod-mention highlighting, which need live chat with a
  moderator present to see.
- The Report an Issue click, left alone rather than firing a browser window
  into a working session. It calls the same helper the setup screen's
  Node.js download link already uses.

## 0.5.15 and earlier

Not retrospectively written up. See the commit history and the annotated
tags `v0.5.1` and `v0.5.15`.
