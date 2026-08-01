# twitch-bot

A local Twitch live chat bot: custom commands and auto-moderation, running
on your own machine (no hosting required). This is a leaner, Twitch-only
sibling of [stream-bot](https://github.com/CruddOCE/stream-bot): same core
engine, no YouTube setup, no Google Cloud project needed.

## What it does

- Connects to your Twitch channel's chat.
- Built-in commands: `!commands`, `!uptime`, `!joke` (random clean joke from
  `config/jokes.json`, no racist material, add/remove your own anytime),
  `!so` (mod-only shoutout that looks up the target on Twitch, or falls back to
  the last raider), `!pp` (random 1-100 inch joke command).
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
- A dark **control panel** (`twitch-bot-control.exe`) for day-to-day use:
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

Double-click [`install-twitch-bot.exe`](install-twitch-bot.exe). It just
opens [`twitch-bot-control.exe`](twitch-bot-control.exe), the control panel
below. There's no separate installer or console wizard: the control panel
itself walks you through everything the first time it's run.

## The control panel: twitch-bot-control.exe

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
  Show Connect Info), plus **Add Browser Source**, which adds the overlay to
  your current scene automatically with audio already routed, and **Test
  Alert**, which fires a real alert and spoken test message through the
  running bot's alert server so you can confirm OBS is connected before
  going live.
- A **readout** of the channel, the alert server port, and how many overlays
  are currently connected. The overlay count is polled from the running bot
  every 5 seconds, so plugging the Browser Source into OBS shows up here
  without having to fire a test alert to find out.
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
  rendered in its own consistent color.
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
| `!pp` | anyone | Silly random-length joke, also fires an OBS alert |
| `!so [username]` | mods/broadcaster | Shoutout to an explicit target, or falls back to the last raider; also fires an OBS alert. Raids get this automatically too (see below) |
| `!lurk` | anyone | Announces you're lurking |
| `!unlurk` | anyone | Announces you're back |
| `!title <text>` | mods/broadcaster | Changes the stream title |
| `!game <name>` | mods/broadcaster | Changes the stream category |

`!title`/`!game` call Twitch's API directly, which only allows a channel's
own token to change its info. They only work when `TWITCH_BOT_USERNAME` is
the broadcaster's own account, and the token needs the
`channel:manage:broadcast` scope. If you set this bot up before that scope
was added, re-run `npm run twitch-auth` (or the setup wizard) to get a
token that includes it.

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

## Updating

Click **Update** in the control panel, or run:
```
npm run update
```
Pulls the latest version from GitHub, preserving your local `config/*.json`
customizations (it stashes them, pulls, then reapplies; on a genuine conflict,
nothing is lost, you just resolve it manually via `git status`).

## Uninstalling

Double-click [`uninstall-twitch-bot.exe`](uninstall-twitch-bot.exe), or run:
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
  used by alerts and `!joke`/`!pp`/`!so`. Shells out to `tts-helper.exe`
  rather than PowerShell (~3x faster per call, see `native/`).
- `src/twitchAuth.js` / `src/twitchApi.js`: OAuth login flow and the Helix
  API client used by `!so`/`!title`/`!game`.
- `scripts/`: setup wizard, token refresh, update, uninstall, the OBS
  WebSocket integration, and `connectAccount.js` (the non-interactive
  sign-in step the control panel's setup screen runs).
- `installer/`: C# source for the three compiled GUI `.exe`s (control
  panel, installer, uninstaller).
- `native/`: C# source for `tts-helper.exe` (the compiled speech
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
