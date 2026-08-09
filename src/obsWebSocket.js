// Shared obs-websocket v5 plumbing for the scripts that talk to OBS
// (adding the overlay browser source, refreshing it when it has gone stale).
// Lives here rather than inside one script because the v5 handshake is a
// two-round SHA256 challenge that is easy to get subtly wrong, and more than
// one caller now needs it.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CONNECT_TIMEOUT_MS = 8000;

function sha256Base64(input) {
  return crypto.createHash('sha256').update(input).digest('base64');
}

// obs-websocket v5 auth: base64(sha256(base64(sha256(password + salt)) + challenge))
function computeAuthString(password, salt, challenge) {
  const secret = sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

// OBS stores its own generated WebSocket password here. Reading it is the
// fallback for a stale .env: the password is regenerated on reinstall, and
// the failure it causes (socket closed, code 4009) looks nothing like a
// config problem from the outside.
function readObsConfigPassword() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const configPath = path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed.server_password || null;
  } catch (e) {
    return null;
  }
}

function connect(password) {
  const url = process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455';
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    };

    const timeout = setTimeout(() => {
      fail(new Error('Timed out connecting to OBS.'));
      ws.terminate();
    }, CONNECT_TIMEOUT_MS);

    ws.on('error', (err) => fail(new Error(`Could not connect to OBS at ${url}: ${err.message}`)));

    // A wrong password gets no reply, just a close with code 4009. Without
    // handling it here the socket simply goes quiet and the caller waits out
    // the full timeout, which reports as "OBS is down" and sends you looking
    // in the wrong place entirely.
    ws.on('close', (code) => {
      if (code === 4009) {
        const err = new Error('OBS rejected the WebSocket password.');
        err.authFailed = true;
        fail(err);
        return;
      }
      fail(new Error(`OBS closed the connection (code ${code}).`));
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }

      if (msg.op === 0) {
        // Hello -- reply with Identify, including the auth hash if OBS wants one.
        const identify = { rpcVersion: 1, eventSubscriptions: 0 };
        if (msg.d.authentication) {
          if (!password) {
            const err = new Error('OBS requires a WebSocket password but none was supplied.');
            err.authFailed = true;
            fail(err);
            ws.close();
            return;
          }
          identify.authentication = computeAuthString(password, msg.d.authentication.salt, msg.d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        // Identified -- ready to send requests.
        clearTimeout(timeout);
        settled = true;
        resolve(ws);
      }
    });
  });
}

// Tries the configured password first so an explicit override always wins,
// then falls back to the one OBS itself is using. Only the auth failure is
// retried: a refused connection means OBS is closed or its server is off,
// and a second attempt would just be a second eight second wait.
async function connectAuthenticated() {
  const envPassword = process.env.OBS_WEBSOCKET_PASSWORD || '';
  let authError = null;

  if (envPassword) {
    try {
      return await connect(envPassword);
    } catch (err) {
      if (!err.authFailed) throw err;
      authError = err;
    }
  }

  const configPassword = readObsConfigPassword();
  if (!configPassword || configPassword === envPassword) {
    throw authError || new Error(
      'OBS requires a WebSocket password. Copy it from OBS (Tools > WebSocket Server Settings > Show Connect Info) into OBS_WEBSOCKET_PASSWORD in .env.'
    );
  }

  const ws = await connect(configPassword);
  if (envPassword) {
    console.log("Note: OBS_WEBSOCKET_PASSWORD in .env is out of date, so OBS's own saved password was used instead.");
    console.log('Update .env to silence this (OBS: Tools > WebSocket Server Settings > Show Connect Info).');
  }
  return ws;
}

function sendRequest(ws, requestType, requestData) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      if (msg.op === 7 && msg.d.requestId === requestId) {
        ws.off('message', onMessage);
        if (msg.d.requestStatus.result) {
          resolve(msg.d.responseData || {});
        } else {
          reject(new Error(`${requestType} failed: ${msg.d.requestStatus.comment || `code ${msg.d.requestStatus.code}`}`));
        }
      }
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

module.exports = { connect, connectAuthenticated, sendRequest, readObsConfigPassword };
