# twitch-bot

A local Twitch live chat bot: custom commands and auto-moderation, running
on your own machine (no hosting required). This is a leaner, Twitch-only
sibling of [stream-bot](https://github.com/CruddOCE/stream-bot): same core
engine, no YouTube setup, no Google Cloud project needed.

## Status: 0.6.0, undergoing testing

**This is a personal project under active development, and parts of it have
not been tested on a real stream yet.** It works, and the offline test suite
passes, but "passes its tests" and "proven live in front of viewers" are not
the same thing. Treat it accordingly if you run it on your own channel.

**In progress since 0.6.0:** a Channel card on the dashboard for editing the
stream title and category, described under **Setting the title and category**
below. Built and reading correctly, but writing needs a token re-auth that has
not happened on this install yet.

**0.6.0 adds overlay recovery through OBS and screenshots on bug reports.**
Reload Overlays can now rescue an overlay that never loaded at all, which is
the case you actually press it in, and Report an Issue collects a screenshot
before opening the tracker. [`CHANGELOG.md`](CHANGELOG.md) has the full list,
including the diagnosis behind the overlay fix.

**0.5.16 completed Phase 1** of [`FEATURES-TO-ADD.md`](FEATURES-TO-ADD.md),
the build-ordered backlog these features come from, adding Mute Alerts, Report
an Issue, an update check on launch, and three chat display controls
(timestamps, mod-mention highlighting, font size).

Confirmed working, having previously been untested: spoken alerts inside OBS,
cooldowns and timers against live chat, the control panel's running state,
Start with Windows, and both halves of Reload Overlays, the broadcast refresh
and the OBS-side recovery of an overlay that never loaded. Report an Issue is
confirmed end to end, screenshot paste included.

These are what remain known-unverified rather than known-to-work:

- **The Mute Alerts and Check for updates on launch ticks.** Both are custom
  controls that synthetic clicks cannot drive, so each was verified by
  exercising the code behind it instead. The HTTP endpoint behind Mute Alerts
  is covered by the test suite; the ticks themselves have not been clicked.
- **Chat timestamps and mod-mention highlighting.** Both need live chat with
  a moderator present before the rendering can be seen.
- **Changing the title or category**, whether from the Channel card or with
  `!title` and `!game`. All three need a token carrying
  `channel:manage:broadcast`, and the flow that grants it has not been completed
  on this install: see **Setting the title and category** below.

A scene switch will not recover a dead overlay either, since
`restart_when_active` is not set on the browser source. Reload Overlays is the
route back.

`!title` and `!game` only work when the bot account is the broadcaster, since
Twitch only lets a channel's own token change its info.

Issues and pull requests are welcome, but please assume rough edges.

## What it does

- Connects to your Twitch channel's chat.
- Built-in commands: `!commands`, `!uptime`, `!joke` (random clean joke from
  `config/jokes.json`, no racist material, add/remove your own anytime),
  `!so` (mod-only shoutout that looks up the target on Twitch, or falls back to
  the last raider), `!pp` (random length and girth joke command).
- Custom commands you define yourself in `config/commands.json`, with no code
  editing, and changes apply live (no restart needed).
- Auto-moderation: banned words, link blocking (with an allowlist), excessive
  caps, and repeated-message spam. Each escalates from a warning to a
  timeout, configurable in `config/moderation.json` (also hot-reloads).
- Mods and the broadcaster are always exempt from auto-mod.
- Stream alerts + an OBS overlay: subs, resubs, gift subs, cheers, and raids.
  Runs on a small local web server you add to OBS as a Browser Source.
- Alerts and `!joke`/`!pp`/`!so` all show as a popup with a chime through the
  overlay, and are read aloud too. Speech is generated server-side using
  Windows' built-in voices (randomly picked each time) rather than relying on
  the browser's own text-to-speech, since OBS's Browser Source usually has no
  TTS voices available to it at all (a limitation of its embedded browser).
- A dark **control panel** (`bin/twitch-bot-control.exe`) for day-to-day use:
  Start/Stop, a live color-coded chat feed, an activity log, a live overlay
  connection readout, and one-click OBS setup and test alerts. Styled with
  the workspace design system in `../ui-kit`. See below.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer.
- A Twitch account for the bot to log in as (can be your main account or a
  separate one, though a separate one is recommended so chat clearly shows the
  bot as a bot).
- For moderation actions (timeout/delete), the bot account must be a
  moderator in your channel: type `/mod <botname>` in your own Twitch chat.

## Easiest: double-click install-twitch-bot.exe

Double-click [`install-twitch-bot.exe`](install-twitch-bot.exe). It sits at
the top level on its own, so it's the one file here meant to be run
directly. It just opens
[`bin/twitch-bot-control.exe`](bin/twitch-bot-control.exe), the control panel
below. There's no separate installer or console wizard: the control panel
itself walks you through everything the first time it's run.

## The control panel: bin/twitch-bot-control.exe

This is the whole app. First-run setup and day-to-day use both happen
here, via the Desktop shortcut or by running it directly.

**First run**, it shows a setup screen with three steps, each with its own
status and action button:
1. **Node.js**, checked automatically. If it's missing, click **Download
   Node.js**, install it, then **Recheck**.
2. **Install Dependencies**, one click, runs `npm install` and streams the
   output live.
3. **Connect your Twitch account**: enter the bot's username and your
   channel name, click **Connect**, and sign in via Twitch's own login page
   in your browser. No Twitch Developer Console and no Client ID to paste
   in, since it uses a built-in shared app.

Once all three are done, it switches automatically to the dashboard, with
nothing to restart. Re-opening the app later skips straight to the
dashboard since everything's already set up. The setup screen stays
reachable from the **Setup** item in the left rail, where the third step's
button becomes **Reconnect**: use it to re-authorise when the token needs
a scope it was not originally granted.

**Day-to-day**, the dashboard is a proper control panel, not a bare console
window. It uses the workspace design system in `../ui-kit`, so it matches
the other panels in this workspace: a persistent left rail, a top bar
carrying state and the one primary action, and the content column for what
you actually watch.

The **left rail** holds:

- **Dashboard** and **Setup** navigation.
- **OBS**: your OBS WebSocket password (Tools > WebSocket Server Settings >
  Show Connect Info), which is optional now that both OBS actions fall back to
  the password OBS itself has saved. Alongside it, **Add Browser Source**,
  which adds the overlay to your current scene automatically with audio
  already routed, **Test Alert**, which fires a real alert and spoken test
  message through the running bot's alert server so you can confirm OBS is
  connected before going live, and **Reload Overlays**, which force-refreshes
  every connected browser source. Reload is the fix for an overlay that has
  gone stale or stopped rendering, and unlike Test Alert it is safe to press
  mid-stream: viewers see nothing, the page just reconnects.

  If no overlay is connected at all, Reload Overlays goes in through OBS
  instead and refreshes the Browser Source directly. That is the case you hit
  when OBS starts before the bot: the source asks for the overlay, gets a
  connection refused, and sits on an error page. Nothing runs on an error
  page, so it cannot reconnect on its own and the button cannot talk to it,
  which is why it has to be driven from the OBS end. It needs OBS's WebSocket
  server enabled.
- **Mute Alerts**: silences alert audio while alerts keep appearing on the
  overlay, for when you're mid-sentence or in a cutscene. This is not the
  same as pausing: a muted alert still plays and still passes, it just makes
  no sound, so nothing is held back to fire later. The setting lives in the
  running bot rather than on disk and clears when the bot stops, because a
  mute that quietly survived a restart would cost a whole stream of audio
  before anyone noticed.
- A **readout** of the channel, the alert server port, and how many overlays
  are currently connected. The overlay count is polled from the running bot
  every 5 seconds, so plugging the Browser Source into OBS shows up here
  without having to fire a test alert to find out.
- **Start with Windows**: opens this panel automatically when you sign in.
  It opens the panel only, not the bot, so pressing Start Bot stays a
  deliberate choice rather than something that happens at every boot. The
  setting is a `HKCU\...\Run` registry entry rather than a Startup folder
  shortcut, so unticking the box removes it completely.
- **Check for updates on launch**: on by default. Asks GitHub whether this
  install is behind, and if it is, says so in the activity log and relabels
  the Update button to **Update available**. It only ever checks: nothing is
  downloaded or applied until you press Update, since git cannot overwrite
  the running `.exe` anyway.
- **Report an Issue**: asks for a screenshot of the problem, then opens the
  project's GitHub issue tracker with the report already started.

  Take a screenshot of the bug however you normally would, then drag the file
  onto the dialog's drop zone (or click it to browse). Pressing **Open issue
  tracker** copies that image to your clipboard and opens a new issue with the
  version, your Windows build and a short template already filled in. Paste
  the screenshot into the issue body with **Ctrl+V** and write up what
  happened.

  The paste is manual because GitHub accepts an image only by paste or drag
  into its own editor: there is no way to attach one through a link. The
  clipboard carries both the image and the file itself, so if a paste does not
  take, dragging the file into the issue works instead. A screenshot is
  optional, and skipping it still gets you the prefilled template.
- **Update**: pulls the latest version from GitHub. Since Windows won't let
  git overwrite a running `.exe`, clicking this closes the app, updates, and
  reopens it automatically (a console window shows progress in between).
- The version, pinned dim in the bottom corner.

The **top bar** holds the status dot, `RUNNING` or `STOPPED`, an uptime
badge while the bot is running, and the **Start Bot** / **Stop Bot** toggle.
Start Bot is the only accent-filled control on the screen; once the bot is
running it becomes an outlined Stop Bot, so a running panel has nothing
demanding attention.

The **content column** holds:

- **Live Chat panel**: every message shows up as it arrives, with a
  timestamp, a `[MOD]`/`[HOST]` badge where it applies, and each username
  rendered in its own consistent color. Its own small toolbar carries:
  **Timestamps**, which hides the time prefix if you'd rather have the
  width; **Highlight mentions**, which gives a raised background to any
  message that `@`s a moderator so it doesn't scroll past unnoticed (mods
  are learned from chat as they speak, so no Twitch API call is needed);
  and **A-** / **A+**, which scale the chat text between 70% and 200% for
  reading it from across the room on a second monitor. All three are
  remembered between sessions.
- **Activity Log panel**: connection status, commands run, moderation
  actions taken, and any errors. Lines that read as a failure are coloured
  red and lines that read as a milestone green, with everything else muted.

Closing the window stops the bot if it's running, so there's no separate
"turn it off" step to remember after a stream.

Both `.exe`s (source in [`installer/`](installer)) and the TTS helper
(source in [`native/`](native)) are compiled with the C# compiler that
ships with Windows, so nothing is downloaded to build them.

## Manual / command-line setup

If you'd rather not use the `.exe`s above:

1. Clone this repo and open a terminal in it.
2. Run the guided setup wizard:
   ```
   npm run setup
   ```
   It installs dependencies, then just has you sign in with the bot
   account via Twitch's own login page. There's no Twitch app to register
   yourself and no Client ID to paste in. Everything is written to `.env` for
   you. (Advanced: if you'd rather use your own Twitch app instead of the
   built-in shared one, the wizard will ask and walk you through that too.)
3. Start the bot:
   ```
   npm start
   ```

Twitch's chat connection always requires a logged-in bot account, since
there's no anonymous/read-only mode like some platforms' API-key options,
but signing in is the only step; you're not creating or configuring anything
on Twitch's developer console unless you specifically want your own app.

## Commands

| Command | Who | What it does |
|---|---|---|
| `!uptime` | anyone | How long the bot has been running |
| `!commands` | anyone | Lists every available command |
| `!joke` | anyone | Random joke, also fires an OBS alert (popup + chime + spoken voice) |
| `!pp` | anyone | Silly random length and girth joke, also fires an OBS alert |
| `!so [username]` | mods/broadcaster | Shoutout to an explicit target, or falls back to the last raider; also fires an OBS alert. Raids get this automatically too (see below) |
| `!lurk` | anyone | Announces you're lurking |
| `!unlurk` | anyone | Announces you're back |
| `!title <text>` | mods/broadcaster | Changes the stream title |
| `!game <name>` | mods/broadcaster | Changes the stream category |

`!title`/`!game` call Twitch's API directly, which only allows a channel's
own token to change its info. They only work when `TWITCH_BOT_USERNAME` is
the broadcaster's own account, and the token needs the
`channel:manage:broadcast` scope. See **Setting the title and category** below
if either command reports a permissions error.

## Setting the title and category

The **Channel** card at the top of the dashboard changes the stream title and
category without opening Twitch's dashboard. The two fields arrive filled in
with what is currently live, so you are editing what is there rather than
typing it from memory, and **Update Channel** sends both as a single request.
Leaving a field alone leaves that value alone; there is no way to clear either
one, which matches Twitch, where a channel always has both.

**Refresh** re-reads the live values. Worth pressing if you have changed the
title in Twitch's own dashboard or with `!title` since the panel opened, since
the fields would otherwise still hold the old text and Update would put it back.

The category takes a name and has to match a real Twitch category, so a typo
comes back as "could not find a game/category named ...". There is no
autocomplete yet.

Both fields, and `!title`/`!game`, need a token carrying
`channel:manage:broadcast`. Without it Twitch answers with a 401 naming the
missing scope and nothing changes. If you set the bot up before that scope
existed, press **Reconnect** on Setup step 3, which signs in again and merges
the new token into your `.env` without disturbing anything else in it. One
Reconnect also picks up the read scopes the upcoming channel-stats readouts
need, so this is a single sign-in rather than one per feature.

To read the live values from a terminal:

```bash
npm run channel-read
```

Reading needs no scopes at all, since channel information is public, so this
working tells you your Client ID and token are valid but says nothing about
whether you can *write*. To change them from a terminal instead of the panel,
in PowerShell:

```bash
$env:CHANNEL_TITLE = "new title"; npm run channel-set
```

`$env:CHANNEL_CATEGORY` does the category, and setting both before running it
sends one request. That path is also how to test a write without going through
the panel, which matters because the panel's text fields cannot be driven by
automation.

Add your own in `config/commands.json`:
```json
{
  "hello": "Hey there, welcome to the stream!",
  "discord": "Join the Discord: https://discord.gg/your-invite"
}
```

## Cooldowns

Configured in `config/cooldowns.json`:
```json
{
  "enabled": true,
  "defaultSeconds": 5,
  "perCommand": { "so": 10 }
}
```
Applies per user, per command (mods/broadcaster always bypass it). A
command on cooldown is silently ignored, with no reply and no alert, rather
than posting a "you're on cooldown" message, which would just be its own kind
of spam. Hot-reloads like everything else.

## Auto-messages / timers

Configured in `config/timers.json`, off by default:
```json
{
  "enabled": false,
  "intervalMinutes": 15,
  "messages": [
    "Don't forget to follow if you're enjoying the stream!",
    "Join the Discord: https://discord.gg/your-invite"
  ]
}
```
When enabled, rotates through `messages` in order, posting one to chat
every `intervalMinutes`.

## Moderation

Configured in `config/moderation.json`:

- `bannedWords`: case-insensitive substring match.
- `linkFilter`: blocks links not in the `allowlist`.
- `capsFilter`: flags messages over `maxCapsRatio` (and at least
  `minLength` characters).
- `spamFilter`: flags the same message repeated `repeatedMessageThreshold`
  times within `windowSeconds`.

Each rule's `action` is `warn`, `delete`, or `timeout`. With
`warnBeforeTimeout: true`, a user gets `maxWarnings` warnings before
escalating to a timeout (`escalatedTimeoutSeconds`). All of this hot-reloads,
so you can edit the file while the bot is running and it takes effect
immediately.

## Alerts + OBS overlay

1. Set `alerts.enabled: true` in `config/alerts.json` (on by default) and
   customize the message templates if you like. `autoShoutoutOnRaid`
   (also on by default) makes raids trigger the same shoutout message
   `!so` would, posted to chat automatically.
2. Add `http://localhost:8090/overlay.html` as a Browser Source in OBS
   (adjust the port if you changed `ALERT_SERVER_PORT` in `.env`), or run:
   ```
   npm run obs-source
   ```
   which connects to OBS directly (requires OBS's WebSocket server enabled:
   Tools > WebSocket Server Settings) and adds it to your current scene with
   "Control audio via OBS" already turned on.
3. To confirm everything's wired up before going live, visit
   `http://localhost:8090/test-alert` while the bot is running. It fires a
   test alert + chime at any connected overlay.
4. If an overlay goes stale or stops rendering mid-stream, visit
   `http://localhost:8090/reload-overlays` (or click **Reload Overlays** in
   the control panel). Every connected browser source reloads itself and
   reconnects, with nothing shown to viewers. This beats OBS's own Refresh
   button when several scenes each carry a copy of the overlay, since they
   all get it at once.
5. If the overlay shows as **not connected** (the readout says 0, or a test
   alert reports nothing connected), the page never loaded in the first
   place, which happens whenever OBS starts before the bot does. The URL
   broadcast in step 4 cannot help there, because there is no page to
   receive it. Click **Reload Overlays**, which detects this and refreshes
   the source from the OBS side, or run:
   ```
   npm run obs-refresh
   ```
   Either one is the scripted version of opening the source's properties in
   OBS and clicking "Refresh cache of current page". There is no need to
   delete and re-add the source. Starting the bot before OBS avoids the
   situation entirely.

## Updating

Click **Update** in the control panel, or run:
```
npm run update
```
Pulls the latest version from GitHub, preserving your local `config/*.json`
customizations (it stashes them, pulls, then reapplies; on a genuine conflict,
nothing is lost, you just resolve it manually via `git status`).

To find out whether an update exists without applying one:
```
node scripts/checkUpdate.js
```
This is what **Check for updates on launch** runs. It fetches and reports how
far behind you are, and never touches the working tree.

## Uninstalling

Double-click [`bin/uninstall-twitch-bot.exe`](bin/uninstall-twitch-bot.exe),
or run:
```
npm run uninstall
```
Removes `node_modules` and, if you choose, your `.env` credentials. Never
touches your source code, config, or git history.

## Project layout

- `index.js`: entry point.
- `src/twitchBot.js`: Twitch IRC connection (via `tmi.js`), chat/mod
  event handling.
- `src/chatEmit.js`: emits the structured `@@CHAT@@|` lines the control
  panel parses for its live chat feed.
- `src/commands.js`: built-in + custom command handling, cooldown
  tracking.
- `src/moderation.js`: auto-mod rule evaluation.
- `src/timers.js`: rotates through `config/timers.json`'s messages on an
  interval.
- `src/configStore.js`: loads and hot-reloads `config/*.json`.
- `src/alertServer.js` + `public/overlay.html`: the local alert/overlay
  server and the OBS Browser Source page it serves.
- `src/ttsEngine.js`: server-side text-to-speech (Windows SAPI voices),
  used by alerts and `!joke`/`!pp`/`!so`. Shells out to `bin/tts-helper.exe`
  rather than PowerShell (~3x faster per call, see `native/`).
- `src/twitchAuth.js` / `src/twitchApi.js`: OAuth login flow and the Helix
  API client used by `!so`/`!title`/`!game`.
- `scripts/`: setup wizard, token refresh, update, `checkUpdate.js` (the
  read-only "are we behind?" check), uninstall, the OBS WebSocket
  integration, and `connectAccount.js` (the non-interactive sign-in step
  the control panel's setup screen runs).
- `bin/`: the compiled binaries and the batch entry points, kept out of the
  project root so the root stays readable. `install-twitch-bot.exe` is the
  deliberate exception and stays at the top level, since a fresh download
  needs exactly one obvious thing to double-click. Note that the control
  panel derives the project root as its own parent directory, so it has to
  sit exactly one level down; moving `bin/` deeper breaks the bot launch,
  the setup wizard and the update path together.
- `installer/`: C# source for the three compiled GUI `.exe`s (control
  panel, installer, uninstaller), which build into `bin/`.
- `native/`: C# source for `bin/tts-helper.exe` (the compiled speech
  synthesizer `ttsEngine.js` calls out to) and the app icon. Both
  `installer/` and `native/` compile with the C# compiler that ships with
  Windows, nothing downloaded.
- `test/run.js`: offline test suite (`npm test`), no live credentials
  needed.

## Status

Core (chat connection, commands, auto-mod, alerts) is built and covered by
an offline test suite, and has been live-tested against the real overlay
server. Try it on a low-stakes stream first and watch the console output
before trusting it on a real one.
