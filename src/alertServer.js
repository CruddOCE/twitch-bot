const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const paths = require('./paths');
const logger = require('./logger');
const configStore = require('./configStore');
const ttsEngine = require('./ttsEngine');
const channelStats = require('./channelStats');

let wss = null;
let server = null;
let listeningPort = null;

// Silences alert audio while alerts keep appearing on screen, for when
// you're mid-sentence or in a cutscene. Deliberately in-memory and not
// persisted to config: this is a "for the next few minutes" control, and
// a mute that quietly survived a restart would cost a whole stream's
// worth of audio before anyone noticed it was still on.
let alertsMuted = false;

function start() {
  const port = Number(process.env.ALERT_SERVER_PORT) || 8090;
  listeningPort = port;

  const app = express();
  app.use(express.static(path.join(paths.installRoot, 'public')));
  // Generated TTS is written to the user's data dir, not into the shipped
  // public/ folder, so it needs its own mount to keep answering the
  // /tts/<id>.wav URLs ttsEngine hands to the overlay. Without this every
  // alert renders silently with a 404 on its audio.
  app.use('/tts', express.static(paths.ttsDir));

  // Lets you trigger a real alert + TTS on demand, so you can confirm the
  // OBS Browser Source is actually connected and its audio is routed
  // correctly before going live -- without waiting for a real sub/cheer/raid.
  app.get('/test-alert', (req, res) => {
    const connected = getConnectedCount();
    alert('test', 'Test alert! If you can see this and hear a sound, OBS is connected correctly.');
    speak('This is a test alert from twitch-bot. If you can hear this, your OBS audio is set up correctly.');
    logger.action('test-alert', `Triggered manually (${connected} overlay(s) connected)`);
    res.json({ ok: true, connectedOverlays: connected });
  });

  // Read-only counterpart to /test-alert, polled by the control panel so
  // its "Overlays" readout reflects reality continuously. Kept separate
  // because /test-alert has side effects (it fires an alert and speaks),
  // so it can't be used to answer "is anything connected right now?".
  // The channel stats ride along here for the same reason mute does: the
  // panel is already polling this every 5 seconds, so four more numbers in
  // the response cost nothing, where a second endpoint would cost a second
  // poll. They come out of channelStats' cache, never a live Helix call --
  // see the header of that module for why that distinction matters.
  app.get('/status', (req, res) => {
    res.json({
      ok: true,
      connectedOverlays: getConnectedCount(),
      port: listeningPort,
      muted: alertsMuted,
      stats: channelStats.getSnapshot(),
    });
  });

  // Mute rides on /status above rather than getting its own poll, so the
  // control panel's tick follows the bot's actual state without a second
  // request. Any value other than an explicit "0"/"false" mutes, so a bare
  // /mute-alerts does the safe thing.
  app.get('/mute-alerts', (req, res) => {
    const raw = String(req.query.muted === undefined ? '1' : req.query.muted).toLowerCase();
    alertsMuted = !(raw === '0' || raw === 'false');
    logger.action('mute-alerts', alertsMuted
      ? 'Alert audio muted -- alerts will still appear on screen'
      : 'Alert audio unmuted');
    res.json({ ok: true, muted: alertsMuted });
  });

  // The standard fix for a browser source that has gone stale or stopped
  // rendering, without going near OBS itself. Reloading from here also
  // beats OBS's own Refresh button when several scenes each carry a copy
  // of the overlay, since every connected client gets it at once.
  app.get('/reload-overlays', (req, res) => {
    const connected = getConnectedCount();
    broadcast({ kind: 'reload' });
    logger.action('reload-overlays', `Reload sent to ${connected} overlay(s)`);
    res.json({ ok: true, connectedOverlays: connected });
  });

  server = http.createServer(app);
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('[alerts] Overlay connected');
    logger.action('overlay-connect', 'Overlay browser source connected');

    // A browser source that disappears without a clean close (OBS scene
    // switch, network blip, computer sleep) leaves a "zombie" entry here
    // forever otherwise -- ws has no built-in dead-peer detection, so
    // getConnectedCount() would keep reporting a connection that's
    // actually gone, and broadcasts would silently go nowhere.
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      logger.info('overlay-connect', 'Overlay browser source disconnected');
    });
  });

  // Every 20s, ping each client and terminate anyone who didn't pong back
  // since the last round -- this is what actually catches zombie
  // connections (see comment above). unref() so this timer alone can't
  // keep the process alive.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        logger.info('overlay-connect', 'Overlay connection timed out (no response to ping) -- removing it');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 20000);
  heartbeat.unref();

  // Tied to the server's lifetime rather than started from index.js, so
  // /status can never serve a snapshot from a module nobody started. It
  // returns immediately when there are no credentials yet.
  channelStats.start();

  // Loopback only -- these routes (mute, test-alert, reload-overlays) have no
  // auth, and everything that talks to this server (OBS, the control panel)
  // already does so via localhost, so there's no reason for it to be reachable
  // from the rest of the network.
  server.listen(port, '127.0.0.1', () => {
    console.log(`[alerts] Overlay running at http://localhost:${port}/overlay.html (add this as an OBS Browser Source)`);
    logger.action('alert-server', `Listening at http://localhost:${port}/overlay.html`);
  });

  server.on('error', (err) => {
    console.error('[alerts] Server error:', err.message);
    logger.action('alert-server', `Failed to start on port ${port}: ${err.message}`, false);
  });

  return server;
}

function getConnectedCount() {
  if (!wss) return 0;
  return Array.from(wss.clients).filter((c) => c.readyState === WebSocket.OPEN).length;
}

function broadcast(payload) {
  if (!wss) {
    logger.action('alert-broadcast', `${payload.kind} broadcast attempted but the alert server isn't running`, false);
    return;
  }
  const connectedClients = getConnectedCount();
  if (connectedClients === 0) {
    logger.action(
      'alert-broadcast',
      `${payload.kind} broadcast attempted but no overlay is connected -- add http://localhost:${listeningPort}/overlay.html as an OBS Browser Source (or open it in a browser to test)`,
      false
    );
    return;
  }
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

// type: 'sub' | 'resub' | 'gift' | 'giftBomb' | 'cheer' | 'raid'
function alert(type, message) {
  console.log(`[alerts] ${type}: ${message}`);
  const alerts = configStore.get('alerts');
  const displaySeconds = alerts && alerts.displaySeconds;
  // The chime is played by the overlay, so mute has to travel with the
  // payload; the box itself still shows either way.
  broadcast({ kind: 'alert', type, message, displaySeconds, muted: alertsMuted });
}

// Sent to the overlay to be read aloud. Generates real audio server-side
// (Windows SAPI via ttsEngine) and has the overlay play that file, since
// OBS's Browser Source generally exposes no voices to the browser's own
// Web Speech API -- that would produce silence there even though it works
// fine in a normal browser. Falls back to the browser's speechSynthesis
// (kind: 'tts' with `text` instead of `url`) if server-side synthesis
// fails or isn't available (e.g. non-Windows).
async function speak(text) {
  // Skipped before synthesis rather than at playback, since generating a
  // WAV nobody will hear is pure waste.
  if (alertsMuted) {
    logger.info('tts', 'Speech suppressed because alert audio is muted');
    return;
  }
  if (!wss || getConnectedCount() === 0) {
    logger.action('alert-broadcast', 'tts broadcast attempted but no overlay is connected', false);
    return;
  }
  try {
    const result = await ttsEngine.synthesize(text);
    broadcast({ kind: 'tts', url: result.url });
  } catch (err) {
    logger.action('tts', `Server-side speech synthesis failed, falling back to browser TTS: ${err.message}`, false);
    broadcast({ kind: 'tts', text });
  }
}

function isMuted() {
  return alertsMuted;
}

function setMuted(value) {
  alertsMuted = Boolean(value);
  return alertsMuted;
}

module.exports = { start, alert, speak, isMuted, setMuted };
