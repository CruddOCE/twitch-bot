// Small in-memory runtime state shared across modules. Cleared on restart.

let lastRaider = null;

function setLastRaider(username) {
  lastRaider = username;
}

function getLastRaider() {
  return lastRaider;
}

module.exports = { setLastRaider, getLastRaider };
