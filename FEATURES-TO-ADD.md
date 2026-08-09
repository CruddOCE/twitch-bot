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

### The one live blocker, cleared for real on 2026-08-09

**Cleared, and this time with evidence.** The user pressed Reconnect on Setup
step 3 and the token was re-validated against
`https://id.twitch.tv/oauth2/validate`. It now carries all ten scopes, including
`channel:manage:broadcast`, and expires in 58 days. A real title and category
change was then written and read back, from both the command line and the panel's
own Update Channel button.

`channel:manage:ads` is correctly **absent**, confirmed by the same validation.

**The history here is worth keeping, because this section twice claimed to be
cleared when it was not.** The original token held only `chat:read`, `chat:edit`
and `moderator:manage:banned_users`, the scope list from before
`channel:manage:broadcast` existed, so `!title` and `!game` had never worked on
this install despite `HANDOFF.md` recording them as confirmed on 2026-08-03. The
lesson: a scope question is settled by validating the token, not by reading these
notes.

**The re-auth also did the Phase 3 groundwork.** `scripts/connectAccount.js`
reads `SCOPES` when it runs and merges into `.env` rather than overwriting, so
that single sign-in granted the six read scopes items 11 to 14 need. Phase 3
needs no further authorisation work.

---

# Phase 1: Quick wins

No dependencies, no new subsystems. All of these can land in a single session.

**All eight are built as of 2026-08-03.** Items 1, 2 and 3 are tested and DONE.
Items 4 to 8 were built in one pass and carry their own verification notes; what
is left unconfirmed in each case is either a custom tick that synthetic clicks
cannot drive, or chat rendering that needs live chat to see.

Items 1 and 3 were both extended in 0.6.0, item 1 with OBS-side recovery for an
overlay that never loaded and item 3 with screenshot collection on a bug report.
Both of those paths were used for real on 2026-08-09 and behaved correctly, so
both items are back to a clean DONE.

One thing worth knowing before adding another rail control: the rail is a fixed
stack that cannot reflow, and it now sets the window's minimum height. Adding to
it without raising `Height`/`MinimumSize` in `MainForm` silently eats the
readout rows from the top, which is exactly what happened during this pass.

### 1. Reload Overlays
**DONE** (built 2026-08-01, tested 2026-08-03; recovery path added 2026-08-04,
shipped in 0.6.0, tested 2026-08-09)
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
reconnected, confirmed by the connection count returning to 1. The control
panel's button and the behaviour inside OBS were both confirmed on
2026-08-03.

**As built in 0.6.0, the case the original build could not handle.** Read the
2026-08-03 verification as *confirmed against an overlay that was already
connected*. It could not recover a disconnected one at all, which is the case
the button gets pressed in. When OBS starts before the bot, the Browser Source
gets a connection refused and renders an error page; nothing of ours runs on an
error page, so the overlay's own reconnect loop is not alive in there, and
broadcasting over the WebSocket reaches nobody because it was never connected.
`OnReloadOverlaysClick` now runs `scripts/refreshObsSource.js` when the
connected count is 0, going in through obs-websocket and pressing OBS's own
`refreshnocache` properties button. Sources are matched on URL rather than
name, so renamed sources and per-scene copies are all caught, with a fallback
that re-sets the URL via `about:blank` if that property name is ever missing.
The handshake was lifted into `src/obsWebSocket.js` so `addObsSource.js` shares
it.

**Verified:** by reproducing the fault rather than trusting the happy path. A
temporary browser source was pointed at port 8091 with nothing listening,
producing the identical error page; an alert server was then started on 8091
and confirmed to still report `connectedOverlays:0`; running
`refreshObsSource.js` took it to 1. The temporary source was removed and the
scene returned to its original 8 browser sources. `addObsSource.js` was re-run
under a throwaway `OBS_SOURCE_NAME` to prove the module extraction did not
break it.
**Confirmed 2026-08-09:** the recovery path was used for real, not staged, and
behaved as intended. Both halves of this item are now proven: the broadcast
refresh against a connected overlay, and the OBS-side refresh against one that
never loaded.
**Still open:** `restart_when_active` is not set on the source, so a scene
switch will not recover it either. Deliberately out of scope for that pass, and
still worth doing, since it would make the recovery automatic rather than a
button someone has to remember to press.

### 2. Load on startup
**DONE** (built 2026-08-01, tested 2026-08-03)
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
self-heal that repoints a stale entry at the current exe path. Clicking the
tick and an actual Windows sign-in launching the panel were both confirmed
by hand on 2026-08-03, closing out the two paths that automation could not
reach (a synthetic `WM_LBUTTONDOWN` does not drive a custom control the way
`BM_CLICK` drives a real Button).

### 3. Report an issue
**DONE** (built 2026-08-03; extended with screenshots 2026-08-04, shipped in
0.6.0, tested 2026-08-09)
*hours*
**Does:** Opens a route to file a bug or request.
**How:** `src/openBrowser.js` already exists. Point it at the GitHub issues page.
One function call.
**As built:** a Report an Issue ghost button in the rail's bottom group, above
Update. It logs a line naming the version before opening
`github.com/CruddOCE/twitch-bot/issues/new`, since a report without a version
number is most of a wasted round trip.
**As built in 0.6.0, screenshots.** A blank issue form asks the reporter to
describe a visual bug in prose. The button now opens an `IssueDialog` first,
which takes the screenshot they already have, puts it on the clipboard, and
opens the issue with a template, the version and the Windows build prefilled.
One Ctrl+V is the floor and everything up to it is automated: **GitHub accepts
an image only by paste or drag into its own editor**, with no URL parameter and
no attachment endpoint. Committing the image needs write access a reporter will
not have, and an external image host means shipping a user's screenshot off
their machine. Do not spend time looking for a way around this; it was looked
for. `PutImageOnClipboard` sets a `DataObject` carrying **both** a `Bitmap` and
a `FileDropList`, because a paste into a browser editor arrives as either
depending on the browser, and carrying both is what makes it work first try.
Size and extension are rejected in the dialog rather than left to GitHub, since
a failed upload after the browser is already open reads as the tracker being
broken. The dialog is a modal and **not** rail controls, because the rail is a
fixed stack at the window's minimum height and anything added there clips the
readout rows off the top.
**Verified:** the button renders and is reachable; the dialog renders in the kit
style; and the full path ran end to end on a real screenshot, logging the
clipboard copy and opening the tracker. `FileDrop`, `FileNameW`, `FileName`,
`System.Drawing.Bitmap` and `Bitmap` were all confirmed present on the
clipboard afterwards.
**Confirmed 2026-08-09:** the paste lands in GitHub's editor. This was the one
step that could not be proven without a signed-in browser and a real issue
draft, and it works, so carrying both a `Bitmap` and a `FileDropList` on the
clipboard did its job. The whole item is now end to end.

### 4. Mute Alerts
**BUILT, AWAITING TESTING** (2026-08-03)
*hours*
**Does:** Silences alert audio while alerts keep appearing visually. For when
someone is talking, or during a cutscene.
**How:** A boolean checked in `alertServer.speak()` before synthesis, or a mute
flag on the payload that the overlay honours when it builds the AudioContext
source. `config/alerts.json` already has an `enabled` flag, so the config shape
exists.
**Why it can come this early:** Unlike Pause, mute needs no queue. A muted alert
still plays, just silently, so it is one gate on an existing path.
**As built:** `GET /mute-alerts?muted=0|1` in `src/alertServer.js` holds an
in-memory flag. `speak()` returns before synthesis when muted, and `alert()`
carries `muted` on the payload so `public/overlay.html` skips `playChime()`
while still showing the box. The state rides on the existing `/status` poll, so
the rail's Mute Alerts tick follows the bot rather than guessing. Deliberately
not persisted: the flag dies with the bot process, and the tick clears itself in
`SetStopped()` rather than claiming a mute nothing is enforcing.
**Verified:** end to end against a real browser source on port 8091. With mute
on, the alert box reached full opacity while a patched `createOscillator`
counted zero chimes and the log recorded `Speech suppressed because alert audio
is muted`. With mute off, the same test alert produced exactly one chime. Four
HTTP-level checks are in `npm test`, including that a bare `/mute-alerts` with
no query mutes rather than silently doing nothing.
**Not verified:** the tick itself, which is a custom control that synthetic
clicks cannot drive. The endpoint behind it is fully covered.

### 5. Chat timestamps
**BUILT, AWAITING TESTING** (2026-08-03)
*hours*
**Does:** Prefixes each chat line with the time it arrived.
**How:** The panel already renders chat lines. Add the timestamp at emit time in
`chatEmit.js` (already a structured delimited format, so adding a field is safe)
or stamp it on arrival in the panel. A checkbox controls display.
**Smaller than it looked:** the timestamp was already being rendered
unconditionally in `AppendChat`, so the only missing part was the control over
it. Stamped on arrival in the panel rather than at emit time, so toggling it
costs nothing on the bot side.
**As built:** a Timestamps tick in a new toolbar inside the LIVE CHAT card,
gating the existing `HH:mm:ss` prefix. Saved to `HKCU\Software\twitch-bot`.
**Not verified:** the rendering change, which needs live chat.

### 6. Highlight mod mentions
**BUILT, AWAITING TESTING** (2026-08-03)
*hours*
**Does:** Flags messages that mention a moderator so they do not scroll past
unnoticed.
**How:** `emitChatLine()` already carries `isMod` and `isBroadcaster`, so the
panel already knows who the mods are. This is a scan for `@name` against that set,
plus a background colour on the row.
**Why easy:** The hard part, knowing who is a mod, is already solved.
**As built:** `MentionsKnownMod()` matches `@name` against a case-insensitive
set that fills itself in as mods speak, so no Twitch API call is needed. A hit
paints the whole row `Surface3` via `SelectionBackColor`, set once for the row
rather than per run so the highlight reads as one band instead of striping
around the gaps. Deliberately `@name` only: bare names come up often enough in
normal conversation that matching them would highlight most of chat, which
highlights nothing.
**Not verified:** the rendering, which needs live chat with a mod present.

### 7. Chat font size
**BUILT, AWAITING TESTING** (2026-08-03)
*hours*
**Does:** Scales chat text, which matters on a second monitor while gaming.
**How:** A font size on the chat control. Use the same control style here as for
the feed in item 20, so the two do not drift into different interaction models.
**As built:** `A-` and `A+` buttons in the chat card toolbar stepping
`RichTextBox.ZoomFactor` by 0.1, clamped 0.7 to 2.0 and saved as a percentage.
ZoomFactor rather than restyling each run, because it scales text already in the
buffer without disturbing the per-user colours and per-run fonts `AppendColored`
has baked in. **This sets the pattern item 20 should copy.**
**Verified:** driven end to end with `BM_CLICK`. Three presses of `A+` wrote
`ChatZoomPercent=130`, one press of `A-` wrote `120`, and a relaunch came back
up visibly larger, confirming the restore path.
**Watch for:** at 28px wide the buttons silently clipped to a bare `A`, losing
the `-` and `+` entirely. They are 40px for that reason.

### 8. Automatic updates
**BUILT, AWAITING TESTING** (2026-08-03)
*hours*
**Does:** Pulls new versions in the background instead of on a button press.
**How:** `scripts/update.js` and the detached-watcher trick (a running `.exe`
cannot be overwritten by git, so the watcher waits for exit) both already exist.
This adds a check on launch, a toggle, and a "restart to apply" prompt.
**Why easy:** The genuinely hard part of self-updating on Windows is already
solved and shipped.
**Scope, deliberately narrowed:** it checks and tells you, it does not pull.
Windows will not let git overwrite a running `.exe`, and the control panel is
that `.exe`, so a background pull would fail precisely when the panel is open,
which is always. Applying stays the Update button, which closes the app first.
**As built:** `scripts/checkUpdate.js` fetches and prints
`UPDATE_AVAILABLE=<n>`, run at launch when the Check for updates on launch tick
is on (default on). A non-zero count logs a line and relabels Update to
**Update available**. Relabelled rather than promoted to the accent style, since
Start Bot is meant to be the only accent-filled control on screen.
**Verified:** `UPDATE_AVAILABLE=0` against this repo, and the correct count
against a scratch clone reset back a known number of commits. The panel run
against a clone one commit behind showed **Update available** in the rail. A
test asserts the script never references a mutating git verb.
**Not verified:** the tick itself (custom control, as with item 4).

---

# Phase 2: Channel control

The best value per line of new code in the document, because the API call is
already written.

**Both items are built and tested as of 2026-08-09.** Reads and writes are
confirmed against the live channel, from the command line and from the panel's
own button, with the title and category restored to their original values
afterwards.

### 9. Stream title editing
**DONE** (built and tested 2026-08-09)
*a day*
**Does:** Change the live title from the control panel, without opening the Twitch
dashboard.
**How:** **The API call already exists.** `updateChannelInfo()` in
`src/twitchApi.js` takes `{ title }`, resolves the broadcaster ID and PATCHes
Helix. It is already wired to `!title`. This is a text field, a Submit button and
a call into existing code.
**Blocked on:** the `channel:manage:broadcast` re-auth. It also only works when
the bot account IS the broadcaster, which is true here (both are `cruddoce`).

**The scope work is done.** `SCOPES` in `src/twitchAuth.js` now carries the six
read scopes items 11 to 14 need (`moderator:read:followers`,
`channel:read:subscriptions`, `moderator:read:chatters`, `channel:read:ads`,
`channel:read:redemptions`, `bits:read`) alongside the four it already had, so
one Reconnect grants everything Phases 2 and 3 want rather than one sign-in per
item. A test pins the list, because a scope going missing surfaces later as a
401 a long way from the cause.

**`channel:manage:ads` was deliberately left out**, against this document's
original advice. It authorises starting an ad break: irreversible,
viewer-facing, and with revenue consequences. Nothing here runs ads, and item 35
is in Phase 6. It gets added when that item is built, so the token cannot run
ads months before the feature exists. That costs one extra re-auth then, which
is the cheaper side of the trade.

**As built.** A `CHANNEL` card at the top of the dashboard content column,
holding a Title field (capped at Twitch's own 140 characters), a Category field,
one **Update Channel** button submitting both as a single Helix request, and a
**Refresh** button. In the content column and not the rail, because the rail is a
fixed stack already setting the window's minimum height and text fields need
more width than its 232px.

The button runs `scripts/setChannelInfo.js` through the existing
`RunNodeScriptOneShot`, passing the values as environment variables the way the
OBS password is passed. A script rather than an endpoint on the alert server,
deliberately: the token lives in `.env` rather than in the bot process, so an
endpoint would mean the bot had to be running before a title could be fixed, and
fixing the title is something you do *before* pressing Start Bot. It is also the
only shape that can be tested, since GUI text fields could not be driven by any
automation tried on this project, and running the script directly with the same
variables the button passes is the documented way around that.

**The fields prefill from the live channel**, via a new
`getChannelSettings()` in `src/twitchApi.js` and `scripts/readChannelInfo.js`,
which prints `CHANNEL_TITLE=` and `CHANNEL_CATEGORY=` lines for the panel to
parse. Empty boxes would be a trap: pressing Update with a blank title reads as
"clear the title", with no way to distinguish unchanged from erase. The read is
a separate function from `getChannelInfo()`, which serves `!so`, returns a
different shape with no title in it, and gives up silently without a client
secret. Refresh exists because Twitch's own dashboard can change these behind
the panel's back, and a stale field would quietly put the old value back.

**Verified:** the read path against the live API, printing the real current title
and category, which also proves the app-token-or-user-token fallback works with
no client secret configured. The fields arrive prefilled in the real window,
screenshotted. Three offline tests: the scope list, the empty-submission guard,
and the missing-credentials guard.

**The write path is verified against the live channel**, after the Reconnect
that finally granted `channel:manage:broadcast`:
- Title and category both written and confirmed by reading them back, then
  restored to their original values and confirmed byte-identical with a
  case-sensitive comparison.
- The category was changed to something genuinely different (`Star Citizen`, from
  `Escape from Tarkov`) rather than resubmitted unchanged, so the
  `helix/games?name=` lookup and `game_id` resolution were exercised for real
  rather than as a no-op.
- The error path was exercised with a nonsense category name: it fails with
  `Could not find a game/category named "..."`, exits non-zero, and writes
  nothing, because the lookup runs before the PATCH.
- **Driven from the panel's own button**, not just the command line, by finding
  the Update Channel control with `EnumChildWindows` and sending `BM_CLICK`. The
  activity log showed the script running and `CHANNEL_UPDATE_OK=1` at exit code
  0. Worth noting the buttons respond to synthetic clicks where the custom
  `KitCheck` ticks do not, since `KitButton` really is a `Button`.

**Still not verified:** `!title` and `!game` from chat. They call the same
`updateChannelInfo()` with the same token, so the API half is proven by
construction, but nobody has typed the commands in chat since the scope was
granted. Sending a message as the broadcaster is not something to automate.

### 10. Stream category editing
**DONE** (built and tested 2026-08-09)
*a day*
**Does:** Change the game or category.
**How:** Same function, `{ gameName }`. It already does the `helix/games?name=`
lookup to convert a name to a `game_id`, including the error path for an unknown
category. Share one Submit button with item 9 so a title and category change go
up together.
**As built:** the Category field on the same card, sharing item 9's Update
Channel button, so both go up as one request. Built and verified alongside item
9; see its entry for the detail, including the real category change and the
unknown-category error path.
**Rough edge worth naming:** the field takes a category *name* and there is no
picker or autocomplete. A typo is rejected with a clear "could not find a
game/category named X" rather than corrected. A searchable dropdown means a
Helix category search plus new UI, which is more than this item asked for, but it
is the obvious next improvement here.

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
