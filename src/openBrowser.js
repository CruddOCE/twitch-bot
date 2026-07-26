const { execFile } = require('child_process');

// execFile passes the URL as a real argument rather than interpolating it
// into a shell command string -- safe regardless of what the URL contains.
// On Windows this specifically avoids cmd.exe's `start`, which treats a
// leading quoted argument as a window title and is awkward to invoke
// safely without a shell; rundll32's URL handler opens the URL directly.
function openUrl(url) {
  if (process.platform === 'win32') {
    execFile('rundll32', ['url.dll,FileProtocolHandler', url], () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

module.exports = { openUrl };
