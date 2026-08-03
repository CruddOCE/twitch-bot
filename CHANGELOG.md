# Changelog

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
