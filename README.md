# twitch-bot

A local Twitch live chat bot: custom commands and auto-moderation, running
on your own machine (no hosting required). This is a leaner, Twitch-only
sibling of [stream-bot](https://github.com/CruddOCE/stream-bot) — same core
engine, no YouTube setup, no Google Cloud project needed.

## What it does

- Connects to your Twitch channel's chat.
- Built-in commands: `!commands`, `!uptime`, `!joke` (random clean joke from
  `config/jokes.json`, no racist material — add/remove your own anytime),
  `!so` (mod-only shoutout — looks up the target on Twitch, or falls back to
  the last raider), `!pp` (random 1-100 inch joke command).
- Custom commands you define yourself in `config/commands.json` — no code
  editing, and changes apply live (no restart needed).
- Auto-moderation: banned words, link blocking (with an allowlist), excessive
  caps, and repeated-message spam — each escalates from a warning to a
  timeout, configurable in `config/moderation.json` (also hot-reloads).
- Mods and the broadcaster are always exempt from auto-mod.
- Stream alerts + an OBS overlay: subs, resubs, gift subs, cheers, and raids.
  Runs on a small local web server you add to OBS as a Browser Source.
- Alerts and `!joke` also show as a popup with a chime through the overlay.
  There's a best-effort attempt to read `!joke` aloud via the browser's
  built-in text-to-speech, but OBS's Browser Source usually doesn't have any
  TTS voices available (a limitation of its embedded browser) — treat the
  chime + visual popup as the real notification, and the voice as a bonus if
  your setup happens to support it.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer.
- A Twitch account for the bot to log in as (can be your main account or a
  separate one — a separate one is recommended so chat clearly shows the bot
  as a bot).
- For moderation actions (timeout/delete), the bot account must be a
  moderator in your channel: type `/mod <botname>` in your own Twitch chat.

## Setup

1. Clone this repo and open a terminal in it.
2. Run the guided setup wizard:
   ```
   npm run setup
   ```
   It installs dependencies, opens the exact Twitch developer console page
   you need, and walks you through registering a free Twitch app and
   logging in as your bot account. Everything is written to `.env` for you.
3. Start the bot:
   ```
   npm start
   ```

On Windows, double-clicking [`install-and-start.bat`](install-and-start.bat)
does all of the above for you (installs dependencies, runs the wizard if
`.env` doesn't exist yet, then starts the bot) — no terminal typing required.
Re-running it later is safe: if `.env` already exists it'll ask whether you
want to redo the wizard, then start the bot either way.

Only need to read chat, not have the bot post/moderate? You still need a
Twitch app (Client ID) for `npm run setup`/`npm run twitch-auth` to work,
since Twitch's chat connection always requires a logged-in bot account —
there's no anonymous/read-only mode like YouTube's API-key option.

## Commands

| Command | Who | What it does |
|---|---|---|
| `!uptime` | anyone | How long the bot has been running |
| `!commands` | anyone | Lists every available command |
| `!joke` | anyone | Random joke, also read aloud via the overlay |
| `!pp` | anyone | Silly random-length joke |
| `!so [username]` | mods/broadcaster | Shoutout — explicit target, or falls back to the last raider |

Add your own in `config/commands.json`:
```json
{
  "hello": "Hey there, welcome to the stream!",
  "discord": "Join the Discord: https://discord.gg/your-invite"
}
```

## Moderation

Configured in `config/moderation.json`:

- `bannedWords` — case-insensitive substring match.
- `linkFilter` — blocks links not in the `allowlist`.
- `capsFilter` — flags messages over `maxCapsRatio` (and at least
  `minLength` characters).
- `spamFilter` — flags the same message repeated `repeatedMessageThreshold`
  times within `windowSeconds`.

Each rule's `action` is `warn`, `delete`, or `timeout`. With
`warnBeforeTimeout: true`, a user gets `maxWarnings` warnings before
escalating to a timeout (`escalatedTimeoutSeconds`). All of this hot-reloads
— edit the file while the bot is running and it takes effect immediately.

## Alerts + OBS overlay

1. Set `alerts.enabled: true` in `config/alerts.json` (on by default) and
   customize the message templates if you like.
2. Add `http://localhost:8090/overlay.html` as a Browser Source in OBS
   (adjust the port if you changed `ALERT_SERVER_PORT` in `.env`), or run:
   ```
   npm run obs-source
   ```
   which connects to OBS directly (requires OBS's WebSocket server enabled:
   Tools > WebSocket Server Settings) and adds it to your current scene with
   "Control audio via OBS" already turned on.
3. To confirm everything's wired up before going live, visit
   `http://localhost:8090/test-alert` while the bot is running — it fires a
   test alert + chime at any connected overlay.

## Updating

```
npm run update
```
Pulls the latest version from GitHub, preserving your local `config/*.json`
customizations (stashes them, pulls, reapplies — on a genuine conflict,
nothing is lost, you just resolve it manually via `git status`).

## Uninstalling

```
npm run uninstall
```
Removes `node_modules` and, if you choose, your `.env` credentials. Never
touches your source code, config, or git history.

## Project layout

- `index.js` — entry point.
- `src/twitchBot.js` — Twitch IRC connection (via `tmi.js`), chat/mod
  event handling.
- `src/commands.js` — built-in + custom command handling.
- `src/moderation.js` — auto-mod rule evaluation.
- `src/configStore.js` — loads and hot-reloads `config/*.json`.
- `src/alertServer.js` + `public/overlay.html` — the local alert/overlay
  server and the OBS Browser Source page it serves.
- `src/twitchAuth.js` / `src/twitchApi.js` — OAuth login flow and the Helix
  API client used by `!so`.
- `scripts/` — setup wizard, token refresh, update, uninstall, and the OBS
  WebSocket integration.
- `test/run.js` — offline test suite (`npm test`), no live credentials
  needed.

## Status

Core (chat connection, commands, auto-mod, alerts) is built and covered by
an offline test suite, and has been live-tested against the real overlay
server. Try it on a low-stakes stream first and watch the console output
before trusting it on a real one.
