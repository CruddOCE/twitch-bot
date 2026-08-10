# Features to add to twitch bot

Fifty one features planned for this project, in the order they get added.

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

**BUILT 2026-08-09, all four.** They share one module, `src/channelStats.js`.

**Where they went, since the instruction above could not be followed
literally:** "the left rail, beside the uptime badge" names two different
places, because `uptimePill` is added to the top bar, not the rail. They went in
the rail, as four rows under a `STATS` label in the existing readout block,
which is the right home semantically: it *is* the state readout, and splitting
state between the rail and the top bar would be incoherent. Top bar pills were
measured and rejected: the bar spans the window width minus the 232px rail, so
at the 760px minimum there are about 184px left after Start Bot, the status dot,
label and uptime pill, and four pills need roughly 280. It would have looked
right at the default width and broken when the window was dragged narrow.

**The architecture, which is the part worth keeping:** polling lives in node and
is served on the alert server's existing `GET /status`, not in the panel. The
panel already polls that endpoint every 5 seconds for the overlay count and the
mute state, so four more numbers in the response cost no new machinery on the
C# side. **The two cadences are deliberately decoupled by a cache**: the panel
reads every 5 seconds, Twitch is asked once a minute. Wiring Helix directly into
the `/status` handler would have turned one open control panel into roughly 17
requests a minute per endpoint, which is the mistake this design exists to
avoid. Failures double the wait up to a ten minute cap and snap back on the
first success, so a revoked token costs a request every ten minutes rather than
one a minute for as long as the bot is up.

**Accepted trade-off:** the numbers only exist while the bot is running, since
the alert server is the bot. The panel blanks them on stop rather than leaving
the last known values sitting there looking current.

### 11. Viewer count
**BUILT, AWAITING LIVE TESTING** (2026-08-09)
*a few days*
**Does:** Live concurrent viewers.
**How:** Helix `Get Streams`. Public data, no new scope needed, so this is the one
to build first and it carries the cost of the shared polling layer.
**As built:** `fetchStream()` in `src/channelStats.js`. **Offline is not zero.**
Helix returns an empty array for a channel that is not live, so there is no
`viewer_count` to read at all, and rendering that as `0` would be a lie that
looks like a measurement. The row reads `offline` instead.
**Verified:** the call works and correctly reported the channel as offline. The
viewer number itself is the one thing here that **cannot be checked without
going live**, since it requires an actual audience.

### 12. Follower count
**BUILT AND VERIFIED** (2026-08-09)
*hours*
**Does:** Total channel followers.
**How:** Helix `Get Channel Followers`, scope `moderator:read:followers`. Slots
into the polling layer from item 11.
**As built:** `first=1` on the request, reading `total` off the response
envelope rather than paging through the names to count them.
**Verified:** returned 312 against the live channel.

### 13. Subscriber count
**BUILT AND VERIFIED** (2026-08-09)
*hours*
**Does:** Total active subscribers.
**How:** Helix `Get Broadcaster Subscriptions`, scope
`channel:read:subscriptions`.
**Verified:** returned 2 against the live channel.

### 14. Chatter count
**BUILT AND VERIFIED** (2026-08-09)
*hours*
**Does:** People present in chat, as distinct from viewers. The two numbers
diverge constantly, which is why both are worth showing.
**How:** Helix `Get Chatters`, scope `moderator:read:chatters`.
**The endpoint is `/helix/chat/chatters`, not `/helix/chatters`.** The wrong
path returns a 404, which reads exactly like a missing scope and will send you
back to re-auth a token that was fine. This cost a detour on the first run.
**Answered while building:** chatters **does** work while the channel is
offline, returning 3 with nothing live. It had been an open question, since
item 11's endpoint goes quiet offline and it was reasonable to expect this one
to as well.

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

# Phase 8: Panel management

Editing the bot's own content from the panel, instead of opening a JSON file in
a text editor while the stream is running. The shape of this phase comes from
the StreamElements dashboard's panel picker.

**These are numbered last but they are not costed last.** Items 43 to 46 are
Phase 1 cheap and depend on nothing in Phases 4 to 7, so they can be pulled
forward ahead of the activity feed whenever they are wanted. They sit at the
bottom only because renumbering would break the thirty-odd cross-references
between items 16 and 42.

### What makes this phase cheap

Three things are already true in the repo, and all of them work in this phase's
favour.

**Config is already live-reloaded.** `src/configStore.js` runs `fs.watch` on
every file in `config/` with a 150ms debounce and a listener fan-out. A panel
that writes `commands.json` takes effect immediately, with no restart and no new
plumbing on the bot side. This single fact is what turns "build a command
editor" from a subsystem into a form.

**Commands are read per message, not cached.** `handle()` in `src/commands.js`
calls `configStore.get('commands')` on every message, so an edit made mid-stream
applies to the very next line of chat.

**The data shapes are trivial.** Custom commands are a flat
`{ name: response }` map, jokes are a flat array of strings. The editor is a
two-column grid and a list box, not a schema.

### The one hazard, worth reading before writing any of it

**The panel must write these files in place, and must not save via rename.** An
atomic write (write a temp file, rename it over the target) is the usual correct
answer and is the wrong answer here. `fs.watch` is bound to the file it was
handed, and renaming over that file on Windows drops the watch. Hot reload then
dies silently and stays dead until the bot is restarted, which is precisely the
failure that makes an editor feel broken. `src/configStore.js` already carries a
comment about a watched file briefly vanishing during an editor's rename-save,
so the problem is known; it has just never had a writer on the other end of it
before.

Write the whole file with a single `File.WriteAllText`, and expect the reload
listener to fire once per save.

### 43. Command editor
**BUILT AND VERIFIED** (2026-08-10)
*a few days*
**Does:** Add, edit, rename and delete custom commands from the panel, with each
command's cooldown edited alongside it.
**How:** A grid over `config/commands.json`, which is a flat
`{ name: response }` map, with a third column reading and writing `perCommand`
in `config/cooldowns.json`. The built-in commands (`!uptime`, `!commands`,
`!joke`, `!pp`, `!so`, `!lurk`, `!unlurk`, `!title`, `!game`) are listed
read-only in the same grid, because a list showing only half the commands that
exist is worse than no list at all.
**Watch for:** the command name is the map key, so renaming is a delete plus an
insert, and doing that naively drops any cooldown keyed to the old name. Reject
a custom command that shadows a builtin at edit time as well: `handle()` checks
`BUILTINS` first, so a custom `joke` is accepted by the file and then silently
never fires.
**Why first in the phase:** it is the item this phase exists for, and items 44
to 46 are largely the same editor pointed at other files.

**As built.** A **Commands** item in the rail's nav opening a third view, beside
Dashboard and Setup, holding one list of every command the bot answers to and a
row of Add, Edit, Rename, Delete and Refresh beneath it. Built-ins are listed
dimmed with their replies locked and **their cooldowns still editable**, since
`checkCooldown()` applies `perCommand` to them exactly as it does to custom
commands, and `!so` ships with 10 seconds on it.

**The node scripts own the JSON, and the panel never parses or writes it.**
`scripts/readCommands.js` prints one `@@CMD@@|` line per command with the
free-text fields base64-encoded, the same shape and the same reason as
`src/chatEmit.js`: a reply can contain the delimiter.
`scripts/setCommand.js` takes `COMMAND_ACTION` of `save`, `rename`, `delete` or
`cooldown` and does the writing. The panel is compiled against five framework
assemblies and none of them is a JSON library, so the alternative was adding a
reference and changing the documented `csc` line, or hand-rolling a parser and
owning every escaping bug in it. It is also the only shape that can be tested,
which is the same reasoning that put items 9 and 10 in scripts: this feature is
almost entirely text fields, and text fields cannot be driven by any automation
tried on this project.

**All validation is in the script, so all of it is covered by `npm test`.**
Names are lowercased and must match `^[a-z0-9][a-z0-9_-]*$`, because `handle()`
lowercases and splits on whitespace before looking a command up, so a capital or
a space produces a command that can never fire. A capital is corrected rather
than refused, and the correction is stated rather than silent. A name that
shadows a builtin is refused outright, closing the trap this document warned
about. Replies are single-line and capped at Twitch's own 500. Renaming carries
the cooldown across and rebuilds the map in order, so it does not look like a
reordering of the whole file in a diff.

**Two things worth not rediscovering.**

The write must stay a plain `writeFileSync` over the existing file. An atomic
write (temp file, rename over the target) is the usual correct answer and is
wrong here: `fs.watch` is bound to the file it was handed, and renaming over it
on Windows drops the watch, so live reload would die silently and stay dead
until the bot restarted. A test asserts the script contains no `fs.rename`,
`renameSync` or `copyFileSync`.

The writer also **preserves each file's existing line endings**. It first wrote
LF, and since git here has `core.autocrlf` on and checks these files out as
CRLF, every edit from the panel left a config file showing as modified with a
completely empty diff. That is the kind of noise that trains someone to stop
reading `git status`. A test covers both directions.

**The ListView is owner-drawn**, and has to be: a Framework `ListView` draws its
column headers through comctl32, which ignores `BackColor` entirely. Without
`OwnerDraw` the header is a light grey strip across the top of a dark card, and
the region *past the last column* is a second one, which is why `Reply` is
sized to absorb the exact remaining client width rather than a fixed margin.
Measured against `ClientSize` and re-fitted after the rows load, because a
vertical scrollbar takes its width out of the client area and `SizeChanged` does
not fire when one appears. This is the first `ListView` in the app and sets the
pattern items 44 and 45 should copy.

**The rail height trap bit again and was handled:** `Height` 740 to 780 and
`MinimumSize` 730 to 770, since a `NavItem` is 38px plus a 2px margin and the
rail is a fixed stack that cannot reflow. `ShowView(bool)` became
`ShowView(View)` over a three-value enum, three call sites.

**Verified:**
- `npm test`, with seven new checks: the in-place write guard, every rejection
  path leaving both files byte-identical, the add/rename/delete round trip
  including cooldown movement and key order, builtin cooldown editing, line
  ending preservation in both directions, the base64 round trip of
  `readCommands.js`, and hot reload.
- **Hot reload proven, not argued.** The test registers a `configStore`
  listener, runs `setCommand.js`, waits for the reload to fire, and then asserts
  `handle()` answers the new command. `[config] Reloaded commands.json` appears
  in the run.
- **Driven end to end through the real panel**, not just the scripts. A
  throwaway command was added by script, the list was reloaded from the nav
  item, the row was selected, Delete was pressed, the confirmation was accepted,
  and `config/commands.json` came back byte-identical to its committed state.
  Worth recording: a `SysListView32` **does** respond to a synthetic
  `WM_LBUTTONDOWN`/`WM_LBUTTONUP` pair, unlike the owner-drawn `KitCheck`, so
  list selection is automatable even though the text fields are not.
- The dashboard was re-screenshotted after the height change to confirm the rail
  readout is not being eaten from the top.

**Not verified:** typing into the dialog's own text fields, which is the
documented automation limit on this project. The dialogs were opened and
screenshotted, and the values they collect are passed straight to the script,
which is covered.

### 44. Joke list editor
*hours*
**Does:** Add, edit, remove and reorder the lines `!joke` picks from.
**How:** `config/jokes.json` is a flat array of strings, currently 41 of them.
A list box plus Add, Edit and Remove, saving the array back. Nearly free once
item 43 has built the load, validate and save path.
**Worth building while in there:** a Test button that runs the selected line
through `alertServer.alert('joke', ...)`, so a new joke can be seen in the
overlay before it is seen by chat.

### 45. Timer editor
*hours*
**Does:** Edits the recurring chat messages and how often they fire.
**How:** `config/timers.json` holds `enabled`, `intervalMinutes` and a
`messages` array, so this is a tick, a number field, and item 44's list editor.
`src/timers.js` already reacts to a config change, so nothing new is needed on
the bot side.
**Watch for:** an interval of zero, and an empty message list while `enabled` is
true. Both are reachable from a form and neither means anything.

### 46. Bot module toggles
*hours*
**Does:** Turns whole subsystems on and off from one card: moderation, timers,
alerts, cooldowns.
**How:** The cheapest item in the phase, because every flag already exists.
`moderation.json`, `timers.json`, `alerts.json` and `cooldowns.json` each carry
an `enabled` boolean the code already honours. Four ticks writing four booleans.
**Why it earns its place anyway:** those flags are currently only reachable by
opening four separate files by hand, which means in practice they never get
touched.

### 47. Counters
*a few days*
**Does:** Named tallies chat can increment and the panel can edit, for deaths,
wipes, or whatever the run is counting.
**How:** The only item in this phase with no existing foundation. Needs a new
`config/counters.json` wired into `configStore`'s `FILES` and `DEFAULTS`, a
`!counter` command family in `src/commands.js`, and a decision about who is
allowed to increment.
**Watch for:** counters are the one config file the **bot** writes, not just the
user. Everything else in `config/` is read-only from the bot's side, so an
increment arriving while the panel has the file open is a real write conflict
rather than a theoretical one. Settle the ownership before writing the feature.
The straightforward answer is that the bot owns the value and the panel asks it
to change through the alert server, rather than both ends writing the same file.

### 48. Quick Actions
*a day*
**Does:** A configurable row of buttons for the things done most often, so they
are one click rather than a hunt through the panel.
**How:** The actions themselves already exist: Reload Overlays, Test Alert, Mute
Alerts, Update Channel, and after item 43, any custom command. This is a
configurable launcher over existing handlers, not new behaviour.
**Watch for:** the left rail is a fixed stack that already sets the window's
minimum height, and Phase 1 proved that adding to it eats the readout rows off
the top. This belongs in the content column, or it raises `Height` and
`MinimumSize` in `MainForm` deliberately.

### 49. Preflight checklist
*a day*
**Does:** A pre-stream checklist, ticked off before going live.
**How:** Entirely local. User-defined items, tick state, and a reset that clears
every tick for the next stream. No Twitch involvement at all, which makes it the
least risky item in the phase.
**The reset is the feature.** A checklist still holding last stream's ticks is a
checklist nobody trusts, so the reset has to be obvious, and it has to happen per
stream rather than per launch.

### 50. Polls
*a few days*
**Does:** Start, watch and end a Twitch poll from the panel.
**How:** Helix `Create Poll`, `Get Polls` and `End Poll`. Needs
`channel:manage:polls`, which is **not** in `SCOPES` today and should not be
added until this item is built.
**The scope precedent is item 9's.** `channel:manage:ads` was deliberately left
out of the re-auth so the token could not run ads months before the feature
existed. The same reasoning applies to a scope that can create viewer-facing
polls. It costs one extra Reconnect when this lands, which is the cheaper side
of the trade.
**Watch for:** results are live, so they need either polling on a timer or
EventSub. Item 34 would give this one for free, which is an argument for
building polls after EventSub rather than before it.

### 51. Predictions
*a few days*
**Does:** Start, lock, resolve and cancel a channel points prediction.
**How:** Helix `Create Prediction` and `End Prediction`, scope
`channel:manage:predictions`, held back until build time exactly as in item 50.
**Why it costs more than polls despite a near-identical API:** resolving a
prediction **moves channel points and cannot be undone**. Picking the wrong
outcome pays out the wrong viewers permanently. It earns the same care item 35
gets: a confirmation step, a guard against double-firing, and an unambiguous
display when no prediction is running.

### Where the rest of that dashboard's panels already live

The panel picker this phase came from lists fourteen panels. Eight of them became
items here, with item 44 added alongside because a joke list is the same editor
as a command list. Multi-Chat is deliberately not on the list, for the reason at
the bottom of this document. The remaining five are already covered, and are
recorded here so they do not come back as gaps.

| Panel | Covered by |
| --- | --- |
| Activity Feed | Item 15, and items 16 to 29 built on top of it |
| Pending Tips | Item 37, which is where money events enter the project at all |
| Stream Preview | Item 39, deferred, with the popout-player alternative worth doing instead |
| Chat | Already shipped. Live in the panel via `src/chatEmit.js` |
| Quick Settings | Items 9 and 10, the CHANNEL card's title and category fields |

---

## Deliberately not on the list

Five things worth naming so they do not get raised again as gaps:

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
- **Multi-chat.** One chat view merging Twitch with a second platform. Not
  wanted, confirmed 2026-08-10. The opening line of this document still holds:
  Twitch only, and nothing here assumes a second streaming platform.
