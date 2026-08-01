# Features to add to twitch bot

Forty two features planned for this project, in the order they get added.

Twitch only. Nothing here assumes a second streaming platform.

This is a reference document, not a commitment. Nothing is scheduled and no
version has been bumped.

Items carry a status line once work starts on them. **BUILT, AWAITING TESTING**
means the code is written and whatever could be exercised offline has been, but
it has not been used on a real stream. Each such item says exactly what was
verified and what was not.

---

## How this list is ordered

Top to bottom, as a build sequence. Dependencies always come before the things
that need them, so the list can be worked straight down without hitting a wall.

Within that constraint the cheap work comes first, so the early items land fast
and the expensive subsystems are reached only once the groundwork under them
exists.

Each item carries a rough size: **hours**, **a day**, **a few days**, or
**a week or more**.

### What already exists and can be built on

Effort estimates are against this repo at v0.5.1, not against a blank page.

| Capability | Where |
| --- | --- |
| Twitch IRC connection, read and send | `src/twitchBot.js` via tmi.js |
| Sub, resub, gift, gift bomb, cheer, raid events | `src/twitchBot.js` handlers |
| Helix client, app token and user token | `src/twitchApi.js` |
| **Title and category updating, already written** | `updateChannelInfo()` in `src/twitchApi.js` |
| OAuth implicit grant with a re-auth path | `src/twitchAuth.js`, Reconnect on Setup step 3 |
| Live WebSocket to the OBS overlay | `src/alertServer.js`, `public/overlay.html` |
| HTTP endpoints on that server | `GET /status`, `GET /test-alert` |
| Server-side TTS | `src/ttsEngine.js`, `bin/tts-helper.exe` |
| Config as user-editable JSON | `config/*.json` via `src/configStore.js` |
| Moderation: warn, delete, timeout | `src/moderation.js` |
| Desktop control panel on the ui-kit | `installer/ControlProgram.cs` |
| Live chat rendering in that panel | `@@CHAT@@` markers from `src/chatEmit.js` |
| Structured logging | `src/logger.js` |
| Self-update with a detached watcher | `scripts/update.js`, Update button |

### One live blocker

Items 9 and 10 will not work until the Twitch token is re-authed. The
`channel:manage:broadcast` scope was added to `src/twitchAuth.js` after the
current `.env` token was issued. Setup step 3 has a Reconnect button for exactly
this, but per `HANDOFF.md` that path has never been exercised.

---

# Phase 1: Quick wins

No dependencies, no new subsystems. All of these can land in a single session.

### 1. Reload Overlays
**BUILT, AWAITING TESTING** (2026-08-01)
*hours*
**Does:** Force-refreshes the OBS browser source without touching OBS. The
standard fix for an overlay that has gone stale or stopped rendering.
**How:** The cheapest real feature in the document. `alertServer.broadcast()`
already reaches every connected overlay, so this is a new payload kind plus a
`location.reload()` handler in `public/overlay.html`, and a button. Roughly ten
lines of JavaScript on each side.
**Why first:** Zero new infrastructure. The socket, the client and the connection
count all exist, and it is immediately useful.
**As built:** `GET /reload-overlays` in `src/alertServer.js` broadcasts
`{ kind: 'reload' }`; `public/overlay.html` answers it with `location.reload()`;
a Reload Overlays ghost button sits under Test Alert in the rail.
**Verified:** the endpoint and the overlay's handling of it, against a real
browser source on an isolated port. The page reloaded and the socket
reconnected, confirmed by the connection count returning to 1.
**Not verified:** the control panel's button, which needs a running bot; and
anything inside OBS itself.

### 2. Load on startup
**BUILT, AWAITING TESTING** (2026-08-01)
*hours*
**Does:** Launches with Windows.
**How:** A shortcut in the Startup folder, or an `HKCU\...\Run` entry, plus a
toggle. `scripts/setup.js` already writes a desktop shortcut, so the shortcut code
exists to copy.
**As built:** an `HKCU\...\Run` entry named `twitch-bot`, toggled by a Start
with Windows tick in the rail. The Run entry rather than a Startup shortcut,
because a `.lnk` needs COM interop the bundled `csc.exe` build does not handle
cleanly, while `Microsoft.Win32.Registry` needs no new reference. It launches
the panel only, not the bot. The tick is a new owner-drawn `KitCheck` control:
a WinForms `CheckBox` with `FlatStyle.Flat` paints its *unchecked* box as a
solid block of `ForeColor`, which reads as switched on when it is switched off.
**Verified:** both painted states; reading the entry at startup; and the
self-heal that repoints a stale entry at the current exe path.
**Not verified:** writing the entry by clicking the tick, since a synthetic
`WM_LBUTTONDOWN` does not drive a custom control the way `BM_CLICK` drives a
real Button. Also unverified: an actual Windows sign-in launching the panel.

### 3. Report an issue
*hours*
**Does:** Opens a route to file a bug or request.
**How:** `src/openBrowser.js` already exists. Point it at the GitHub issues page.
One function call.

### 4. Mute Alerts
*hours*
**Does:** Silences alert audio while alerts keep appearing visually. For when
someone is talking, or during a cutscene.
**How:** A boolean checked in `alertServer.speak()` before synthesis, or a mute
flag on the payload that the overlay honours when it builds the AudioContext
source. `config/alerts.json` already has an `enabled` flag, so the config shape
exists.
**Why it can come this early:** Unlike Pause, mute needs no queue. A muted alert
still plays, just silently, so it is one gate on an existing path.

### 5. Chat timestamps
*hours*
**Does:** Prefixes each chat line with the time it arrived.
**How:** The panel already renders chat lines. Add the timestamp at emit time in
`chatEmit.js` (already a structured delimited format, so adding a field is safe)
or stamp it on arrival in the panel. A checkbox controls display.

### 6. Highlight mod mentions
*hours*
**Does:** Flags messages that mention a moderator so they do not scroll past
unnoticed.
**How:** `emitChatLine()` already carries `isMod` and `isBroadcaster`, so the
panel already knows who the mods are. This is a scan for `@name` against that set,
plus a background colour on the row.
**Why easy:** The hard part, knowing who is a mod, is already solved.

### 7. Chat font size
*hours*
**Does:** Scales chat text, which matters on a second monitor while gaming.
**How:** A font size on the chat control. Use the same control style here as for
the feed in item 20, so the two do not drift into different interaction models.

### 8. Automatic updates
*hours*
**Does:** Pulls new versions in the background instead of on a button press.
**How:** `scripts/update.js` and the detached-watcher trick (a running `.exe`
cannot be overwritten by git, so the watcher waits for exit) both already exist.
This adds a check on launch, a toggle, and a "restart to apply" prompt.
**Why easy:** The genuinely hard part of self-updating on Windows is already
solved and shipped.

---

# Phase 2: Channel control

The best value per line of new code in the document, because the API call is
already written.

### 9. Stream title editing
*a day*
**Does:** Change the live title from the control panel, without opening the Twitch
dashboard.
**How:** **The API call already exists.** `updateChannelInfo()` in
`src/twitchApi.js` takes `{ title }`, resolves the broadcaster ID and PATCHes
Helix. It is already wired to `!title`. This is a text field, a Submit button and
a call into existing code.
**Blocked on:** the `channel:manage:broadcast` re-auth. It also only works when
the bot account IS the broadcaster, which is true here (both are `cruddoce`).

**Do the scope work once.** Items 11 to 14 each need a different new scope, and
this item already forces a re-auth. Add every scope the roadmap needs to
`src/twitchAuth.js` in this one pass so there is a single re-auth rather than
five: `moderator:read:followers`, `channel:read:subscriptions`,
`moderator:read:chatters`, `channel:read:ads`, `channel:manage:ads`,
`channel:read:redemptions`, `bits:read`.

### 10. Stream category editing
*a day*
**Does:** Change the game or category.
**How:** Same function, `{ gameName }`. It already does the `helix/games?name=`
lookup to convert a name to a `game_id`, including the error path for an unknown
category. Share one Submit button with item 9 so a title and category change go
up together.

---

# Phase 3: Channel stats

Four readouts for the panel's left rail, beside the uptime badge. Build them as
one shared polling layer with backoff and a sane failure display, not four
independent timers.

### 11. Viewer count
*a few days*
**Does:** Live concurrent viewers.
**How:** Helix `Get Streams`. Public data, no new scope needed, so this is the one
to build first and it carries the cost of the shared polling layer.

### 12. Follower count
*hours*
**Does:** Total channel followers.
**How:** Helix `Get Channel Followers`, scope `moderator:read:followers`. Slots
into the polling layer from item 11.

### 13. Subscriber count
*hours*
**Does:** Total active subscribers.
**How:** Helix `Get Broadcaster Subscriptions`, scope
`channel:read:subscriptions`.

### 14. Chatter count
*hours*
**Does:** People present in chat, as distinct from viewers. The two numbers
diverge constantly, which is why both are worth showing.
**How:** Helix `Get Chatters`, scope `moderator:read:chatters`.

---

# Phase 4: Activity feed

The largest single improvement available, and the thing most of the rest of the
roadmap sits on. Item 15 is the foundation; everything after it in this phase is
comparatively cheap once it exists.

### 15. Activity feed with stored history
*a week or more*
**Does:** A single reverse-chronological stream of every monetisation and growth
event, persisting across restarts and paging back months.
**How:** Events currently become an alert and a log line and are then gone. This
needs a datastore, a write on every event handler in `twitchBot.js`, a read API on
the alert server, and a virtualised list in the panel. SQLite is the obvious
choice. Newline-delimited JSON keeps the dependency count at zero, which matches
this project's habits, but will not page well at volume.
**Why not harder:** No new Twitch transport is needed for the events already
received. It is a data layer plus a list view, both well understood.
**Unlocks:** items 16 to 29.

### 16. Replay Activity
*hours*
**Does:** Re-fires a past event's alert through the overlay. The fix for an alert
missed during a scene switch or eaten while muted.
**How:** Nearly free once item 15 exists, because the firing path is already
built. Read the stored event, rebuild the payload with `fireAlert`'s template
logic from `twitchBot.js`, hand it to `alertServer.alert()`.
**Why this early in the phase:** highest value per unit of work in the whole
document once the store is there.

### 17. Hide activity from feed
*hours*
**Does:** Removes a single event from the feed, for a troll donation message or
similar.
**How:** A soft-delete flag in the store. Soft delete rather than hard, so a
misclick is recoverable. Style the control destructively.

### 18. Show read markers
*hours*
**Does:** Tracks which events have already been seen.
**How:** A per-event read flag in the store, set on scroll or on click.

### 19. Per-event-type colour coding
*a day*
**Does:** Gives each event type its own colour so the feed is scannable without
reading badges.
**How:** A colour map in `config/alerts.json`, consumed by both the overlay CSS
and the panel. `configStore` already handles user-edited JSON defensively. The
picker UI is the fiddliest part and `ColorDialog` handles it.

### 20. Feed font size
*hours*
**Does:** Scales feed text.
**How:** Same mechanism and same control style as item 7.

### 21. Shorten long messages
*a day*
**Does:** Truncates long donation or chat messages to keep row heights uniform.
**How:** Truncate at render with an ellipsis and an expand affordance.

### 22. Clickable links
*a day*
**Does:** Turns URLs in messages into working links.
**How:** URL regex plus `openBrowser.js`.
**Ship this off by default.** One click from a chat message straight into the
default browser is a phishing vector, and the person clicking is mid-stream and
not reading carefully.

### 23. Control labels
*hours*
**Does:** Shows text labels on row controls instead of icon-only, for
discoverability.
**How:** Cheap once the row controls from items 16 and 17 exist.

### 24. Per-event-type filtering
*a few days*
**Does:** Controls exactly which event types appear in the feed. Twitch has nine
worth surfacing: Follow, Subscription, Cheer, Gifted subs, Raid, Sponsorship,
Channel points, Redemption and Charity.
**How:** The filtering itself is easy, a predicate over the feed. The constraint
is supply: **five of those nine arrive today.** Follow, Channel points, Redemption
and Charity do not come over IRC at all and need item 34. Build the filter over
what exists now and let it grow when EventSub lands.

### 25. Minimum value thresholds
*a few days*
**Does:** Suppresses low-value events so the feed only surfaces things worth
reacting to. Applies to Subscription, Cheer and Gifted subs.
**How:** A numeric field per type, compared against the amount already carried on
the tmi.js userstate (`bits`, `msg-param-cumulative-months`, the gift count). The
data is in hand; it is the per-type inline UI that costs.

### 26. Source filtering
*hours*
**Does:** Turns a whole event source on or off in the feed.
**How:** A master toggle per source, sitting above the per-type toggles from item
24. Until item 37 lands there is only one source, so this stays a single toggle
and barely earns its UI. Build the mechanism now alongside the other filters, and
it is ready when a second source appears.

### 27. Feed avatars
*a day*
**Does:** Shows profile pictures on feed rows.
**How:** Helix `users` returns `profile_image_url`, and `getChannelInfo()` already
calls that endpoint. Needs a small disk cache so the same image is not refetched
on every render, which is what makes this a day rather than an hour.

### 28. Gift bundle expansion
*a few days*
**Does:** Collapses a multi-gift sub into one row that expands to list the
recipients.
**How:** `submysterygift` gives the count, and the individual `subgift` events
that follow give the names. **Correlating them is the actual work.** They arrive
as separate IRC events and have to be grouped by gifter within a time window
before either can be rendered.
**Watch for:** anonymous gifters. `AnAnonymousGifter` is a real value that appears
in this channel's history and will break a naive grouping key.

### 29. Reset session
*hours*
**Does:** Clears session-scoped state such as counters and read markers.
**How:** Cheap, and only meaningful once items 15 to 28 have created session state
worth clearing. Which is why it sits at the end of the phase rather than the
start.

---

# Phase 5: Alert control

### 30. Alert queue
*a few days*
**Does:** Holds alerts in order with a known current item, instead of firing them
the instant they arrive.
**How:** `alertServer.alert()` currently formats a payload and broadcasts it
immediately, fire and forget. Rework it into an enqueue, add a drain loop that
respects `displaySeconds` from `config/alerts.json`, and have the overlay
acknowledge completion so the server knows when one has finished rather than
guessing from a timer.
**Why it costs:** It changes a core path that currently works, and the ack
protocol has to survive the overlay disconnecting mid-alert. The existing
zombie-connection heartbeat in `alertServer.js` is the right place to hook that.
**Build the queue visible.** Showing what is pending is a small addition on top of
this and turns Skip from a blind action into an informed one.
**Unlocks:** items 31 and 32.

### 31. Pause Alerts
*hours*
**Does:** Holds alerts so they can be released later, rather than muting them.
Distinct from item 4, which lets them play silently.
**How:** A flag on the drain loop from item 30. Trivial after it, impossible
before it.

### 32. Skip Alert
*a day*
**Does:** Drops the current or next queued alert.
**How:** Dequeue plus a stop-now message to the overlay.
**Watch for:** the overlay has to cleanly interrupt an in-flight animation and its
audio, and `public/overlay.html` has known OBS quirks here. It uses one shared
AudioContext created synchronously at page load, and `void box.offsetWidth` to
force reflow because `requestAnimationFrame` is unreliable in OBS's offscreen
renderer. Interrupting has to respect both.

### 33. Bindable keyboard shortcuts
*a day*
**Does:** Drives alert handling from the keyboard or a Stream Deck without the
window focused. Seven actions: Mute, Unmute, Toggle, Skip, Pause, Resume and
Reload Overlays.
**How:** Global hotkeys need `RegisterHotKey` and `WM_HOTKEY` via P/Invoke in
`ControlProgram.cs`, plus a capture field per action and persistence to config.
The panel already does P/Invoke work, so the pattern is not foreign.
**Why a day and not an hour:** capture UI, conflict detection, and the fact that a
failed `RegisterHotKey` (another app already owns the combination) has to fail
visibly rather than silently.
**Ship sensible defaults.** Bindings that start empty make the whole feature
invisible to anyone who does not go looking for it.
**Why here:** most of what it binds to does not exist until item 32.

---

# Phase 6: New integrations

Each of these adds a transport or a dependency that does not exist in the project
today.

### 34. EventSub connection
*a week or more*
**Does:** Unlocks the event types IRC cannot deliver: follows, channel point
redemptions, custom reward redemptions, charity donations and hype trains.
**How:** A whole new subsystem, not a feature. A second WebSocket with its own
session lifecycle, a `session_welcome` handshake, per-topic subscription
registration over Helix, keepalive timeouts, and a reconnect flow that Twitch
drives by sending a new URL. Each topic carries its own scope, which is why they
are added up front in item 9.
**Why it costs:** it is the only item that adds a new transport. Every piece of
failure handling has to be built from scratch, and it must not destabilise the
existing tmi.js connection. Budget real time for the reconnect path specifically,
because it only misbehaves in production.
**Worth it for follows alone.** They are the most common alert on most channels
and this bot cannot see them at all today.
**Completes:** item 24.

### 35. Ad status and run ad
*a week or more*
**Does:** Shows time until the next scheduled ad and runs an ad break on demand.
Running a mid-roll manually suppresses the pre-roll that would otherwise hit new
arrivals, so surfacing pre-roll state alongside the countdown is the point of the
feature, not decoration.
**How:** Helix `Get Ad Schedule` (`channel:read:ads`) for the countdown and
pre-roll state, and `Start Commercial` (`channel:manage:ads`) to run one.
**Why it costs:** not the API call, which is small. It is that this is a
**destructive, irreversible, viewer-facing action** with real revenue and
retention consequences, fired from a button. It needs a confirmation step, a guard
against double-firing, clear state when the channel is offline, and careful
handling of Twitch's own cooldowns. Getting it wrong costs money or annoys
viewers, so it earns the extra care.

### 36. Snooze next ad
*a few days*
**Does:** Delays a scheduled ad break, with a limited allowance that has to be
displayed accurately.
**How:** Helix `Snooze Next Ad`, same `channel:manage:ads` scope as item 35.
**Watch for:** the remaining allowance has to stay in sync or the button lies
about what it will do.

### 37. Tip and donation events
*a week or more*
**Does:** Brings real money events into the feed and the alerts: tips, merch
sales, sponsorships.
**How:** Requires a third-party service, since money does not flow through Twitch
and neither IRC nor EventSub can deliver these. StreamElements exposes a realtime
socket with a JWT. StreamLabs and Ko-fi both offer webhooks, which are a
considerably smaller integration if tips are all that is wanted.
**Why it costs:** an entirely new integration surface with its own auth lifecycle
and no relationship to anything currently in this repo.
**Completes:** item 26, which only becomes meaningful with a second source.

### 38. Media and song request queue
*a week or more*
**Does:** Viewer song or media requests, with a queue and a skip-to-next control.
**How:** There is no media subsystem here at all. This means request commands, a
queue, playback, and an overlay surface showing what is playing.
**Why it costs:** everything is new. It is a feature area, not a button.

---

# Phase 7: Deferred

Not cancelled, but the cost is high and the payoff is thin. Revisit only once
everything above is done.

### 39. Embedded stream preview
*a week or more*
**Does:** Shows the live stream inside the panel, to confirm what viewers are
seeing without alt-tabbing.
**How:** WinForms has no modern web view. The built-in `WebBrowser` control is
IE11-based and will not run the current Twitch player. WebView2 would work but
needs vendored `Microsoft.Web.WebView2` assemblies and a runtime dependency, which
fights the OS-bundled `csc.exe` build documented in `HANDOFF.md`, and it would
move the panel from a 44KB self-contained exe to something with real dependencies.
**Why deferred:** the cost is not the feature, it is changing the build and
distribution model of the entire control panel to get it.
**Cheap alternative, worth doing instead:** open Twitch's popout player in the
default browser via `openBrowser.js`. About 90 percent of the value for about 1
percent of the cost, and it compromises nothing.

### 40. Layout presets
*a week or more*
**Does:** Switches the whole panel arrangement in one click, for example a full
dashboard versus a cut-down two-panel view.
**How:** The panel is a hand-built WinForms layout with a fixed left rail and a
Dashboard page. Presets mean panels become movable, sizeable, independently
mounted components, which is a substantial refactor of `ControlProgram.cs`
(already 59KB) and its custom-painted `Card` components.
**Why deferred:** WinForms has no layout engine that makes this pleasant, and the
z-order and `BackColor` inheritance gotchas in `HANDOFF.md` bite harder the more
dynamic the control tree becomes. Two or three fixed presets is a lot of refactor
for a small amount of flexibility.

### 41. Remove panel
*a few days*
**Does:** Deletes a panel from the layout, with the survivors reflowing.
**How:** Depends entirely on item 40's refactor.
**Build the undo with it.** A one-click destructive layout change with no undo,
where the only route back is a full reset that discards everything else, is worse
than not having the feature.

### 42. Reset layout to default
*hours*
**Does:** Restores the stock arrangement.
**How:** Trivial once item 40 exists, meaningless before it. Should re-mount
panels from scratch rather than just re-arranging them, so it genuinely recovers
from a broken layout.

---

## Deliberately not on the list

Four things worth naming so they do not get raised again as gaps:

- **Standalone desktop app.** Already done. `bin/twitch-bot-control.exe` is a
  44KB native WinForms app.
- **Theme.** Already done at v0.5.1. The `Theme` class in `ControlProgram.cs`
  mirrors `../ui-kit/tokens.css`. Only a switchable light variant would be new
  work, and the ui-kit does not define one.
- **Live chat view.** Already rendering in the panel, with per-user colouring,
  driven by the `@@CHAT@@` markers from `src/chatEmit.js`.
- **Logout.** Effectively present. Clearing `TWITCH_OAUTH_TOKEN` from `.env` does
  it, and Setup step 3's Reconnect is the path back in. A labelled button would be
  cosmetic.
