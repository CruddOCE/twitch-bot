// Connects to OBS's built-in WebSocket server (OBS 28+ -- enable it via
// Tools > WebSocket Server Settings in OBS) and adds the twitch-bot
// overlay as a Browser Source in the current scene, with "Control audio
// via OBS" already turned on so !joke TTS and alert chimes play through
// OBS's mixer without any manual setup.
//
// Usage: node scripts/addObsSource.js
// Reads OBS_WEBSOCKET_PASSWORD from .env (leave it blank and OBS's own
// saved password is used) and ALERT_SERVER_PORT for the overlay URL.

require('dotenv').config({ path: require('../src/paths').envPath });
const { connectAuthenticated, sendRequest } = require('../src/obsWebSocket');
const logger = require('../src/logger');

const OBS_URL = process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455';
const ALERT_PORT = process.env.ALERT_SERVER_PORT || 8090;
const OVERLAY_URL = `http://localhost:${ALERT_PORT}/overlay.html`;
const SOURCE_NAME = process.env.OBS_SOURCE_NAME || 'twitch-bot Overlay';

async function main() {
  console.log(`Connecting to OBS at ${OBS_URL}...`);
  let ws;
  try {
    ws = await connectAuthenticated();
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error('Make sure OBS is running and WebSocket Server is enabled: Tools > WebSocket Server Settings.');
    logger.action('obs-connect', err.message, false);
    process.exitCode = 1;
    return;
  }

  console.log('Connected to OBS.');
  logger.action('obs-connect', `Connected to OBS at ${OBS_URL}`);

  try {
    const sceneInfo = await sendRequest(ws, 'GetSceneList', {});
    const sceneName = sceneInfo.currentProgramSceneName;
    if (!sceneName) throw new Error('Could not determine the current OBS scene.');
    console.log(`Adding to scene: ${sceneName}`);

    await sendRequest(ws, 'CreateInput', {
      sceneName,
      inputName: SOURCE_NAME,
      inputKind: 'browser_source',
      inputSettings: {
        url: OVERLAY_URL,
        width: 1920,
        height: 1080,
        // OBS's internal name for the "Control audio via OBS" checkbox --
        // routes the overlay's TTS/chime audio through OBS's mixer.
        reroute_audio: true,
      },
      sceneItemEnabled: true,
    });

    console.log(`SUCCESS: Added "${SOURCE_NAME}" (${OVERLAY_URL}) to scene "${sceneName}", with OBS controlling its audio.`);
    logger.action('obs-source', `Added "${SOURCE_NAME}" (${OVERLAY_URL}) to scene "${sceneName}"`);
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error('If a source with that name already exists in OBS, delete it first, or set OBS_SOURCE_NAME to a different name.');
    logger.action('obs-source', err.message, false);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
}

main();
