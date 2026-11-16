#!/usr/bin/env node
// Launcher: starts the Kacy engine and opens the desk in its own app window.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./engine/server');

function openWindow(url) {
  const tryRun = (cmd, args) => { try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); return true; } catch { return false; } };
  // A separate Chrome profile lets these switches apply: camera and timers keep running when the desk is
  // behind other windows or on another Space (needed for hand gestures), sound may start without a click,
  // and the microphone/camera prompt is pre-accepted for this window only (it never opens any other site).
  const profile = path.join(os.homedir(), '.kacy', 'chrome-profile');
  const flags = [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1500,950', '--no-first-run', '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'];
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge'])
      if (fs.existsSync(`/Applications/${app}.app`)) return tryRun('open', ['-na', app, '--args', ...flags]);
    return tryRun('open', [url]); // Safari or whatever is default
  }
  if (process.platform === 'win32') return tryRun('cmd', ['/c', 'start', 'chrome', ...flags]) || tryRun('cmd', ['/c', 'start', '', url]);
  return tryRun('google-chrome', flags) || tryRun('xdg-open', [url]);
}

start().then(({ port }) => {
  const url = `http://127.0.0.1:${port}/`;
  if (!process.argv.includes('--no-window')) openWindow(url);
  console.log(`Desk: ${url}\nSay "Kacy" to wake her. Press Ctrl+C here to shut down.`);
}).catch((e) => {
  console.error(e.code === 'EADDRINUSE' ? 'Kacy is already running (port in use).' : e.message);
  process.exit(1);
});
