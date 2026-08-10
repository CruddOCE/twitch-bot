// Forces OBS to reload the overlay Browser Source, from outside the page.
//
// This exists because the overlay's own reconnect loop cannot save a source
// that never loaded. If OBS starts before the bot, the source requests
// http://localhost:<port>/overlay.html, gets a connection refused, and OBS
// renders an error page. No script runs on an error page, so there is nothing
// left in there to reconnect, and the alert server's /reload-overlays (which
// broadcasts over the WebSocket to pages that are already connected) reaches
// nobody. Driving OBS itself is the only route back.
//
// Usage: node scripts/refreshObsSource.js
// Matches on the URL rather than the source name, so renamed sources and
// copies sitting in several scenes all get refreshed.

require('dotenv').config({ path: require('../src/paths').envPath });
const { connectAuthenticated, sendRequest } = require('../src/obsWebSocket');
const logger = require('../src/logger');

const OBS_URL = process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455';
const ALERT_PORT = String(process.env.ALERT_SERVER_PORT || 8090);

function isOverlayUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return isLocal && parsed.port === ALERT_PORT && parsed.pathname === '/overlay.html';
  } catch (e) {
    // Local file browser sources have no url at all, and a malformed one is
    // not ours either way.
    return false;
  }
}

// "refreshnocache" is the properties button OBS shows as "Refresh cache of
// current page". Pressing it is exactly the manual fix, so it is the first
// choice. The fallback re-sets the URL via about:blank, because setting a
// setting to the value it already holds is a no-op and would not reload
// anything.
async function refreshInput(ws, inputName) {
  try {
    await sendRequest(ws, 'PressInputPropertiesButton', { inputName, propertyName: 'refreshnocache' });
    return 'refreshed';
  } catch (err) {
    const settings = await sendRequest(ws, 'GetInputSettings', { inputName });
    const url = settings.inputSettings.url;
    await sendRequest(ws, 'SetInputSettings', { inputName, inputSettings: { url: 'about:blank' } });
    await sendRequest(ws, 'SetInputSettings', { inputName, inputSettings: { url } });
    return 'reloaded via URL reset';
  }
}

async function main() {
  console.log(`Connecting to OBS at ${OBS_URL}...`);
  let ws;
  try {
    ws = await connectAuthenticated();
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error('Make sure OBS is running and WebSocket Server is enabled: Tools > WebSocket Server Settings.');
    logger.action('obs-refresh', err.message, false);
    process.exitCode = 1;
    return;
  }

  console.log('Connected to OBS.');

  try {
    const inputs = await sendRequest(ws, 'GetInputList', {});
    const browserSources = inputs.inputs.filter((i) => i.inputKind === 'browser_source');

    const matches = [];
    for (const source of browserSources) {
      const settings = await sendRequest(ws, 'GetInputSettings', { inputName: source.inputName });
      if (isOverlayUrl(settings.inputSettings.url)) matches.push(source.inputName);
    }

    if (matches.length === 0) {
      console.error(`FAILED: No Browser Source in OBS points at http://localhost:${ALERT_PORT}/overlay.html.`);
      console.error('Use "Add Browser Source" to create one.');
      logger.action('obs-refresh', 'No overlay Browser Source found in OBS', false);
      process.exitCode = 1;
      return;
    }

    for (const inputName of matches) {
      const how = await refreshInput(ws, inputName);
      console.log(`SUCCESS: "${inputName}" ${how}.`);
    }

    console.log('The overlay should reconnect within a second or two.');
    logger.action('obs-refresh', `Refreshed ${matches.length} overlay Browser Source(s): ${matches.join(', ')}`);
  } catch (err) {
    console.error('FAILED:', err.message);
    logger.action('obs-refresh', err.message, false);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
}

main();
