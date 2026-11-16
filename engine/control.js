// Eyes and hands on the computer. macOS driver uses only tools that ship with the OS
// (screencapture, sips, osascript). Other platforms report "not implemented yet".
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkShell, checkKeys, checkLabel, REFUSAL } = require('./guard');

// macOS refuses these actions until the user grants a permission; say which one, in words Kacy can pass on.
function explain(msg) {
  if (/not allowed to send keystrokes|not allowed assistive access|\(1002\)|\(-1719\)|\(-25211\)/i.test(msg)) return 'PERMISSION NEEDED: macOS is blocking keyboard and mouse control. Tell the user to open System Settings > Privacy & Security > Accessibility, switch on Terminal, then restart Kacy. ' + msg;
  if (/could not create image from display/i.test(msg)) return 'PERMISSION NEEDED: macOS is blocking screen capture. Tell the user to open System Settings > Privacy & Security > Screen & System Audio Recording, switch on Terminal, then restart Kacy.';
  return msg;
}
const run = (cmd, args, opts = {}) => new Promise((res, rej) =>
  execFile(cmd, args, { timeout: 20000, maxBuffer: 64 * 1024 * 1024, ...opts }, (e, out, err) => (e ? rej(new Error(explain((err || e.message).trim()))) : res(out))));

// Long-running mouse helper (pointer.py). Falls back to one-off scripts when python3 is missing.
const helper = { proc: null, ok: false, tried: false, note: null };
function pointerStart() {
  if (helper.tried || process.platform !== 'darwin') return helper.ok;
  helper.tried = true;
  try {
    const p = spawn('/usr/bin/python3', [path.join(__dirname, 'pointer.py')], { stdio: ['pipe', 'pipe', 'ignore'] });
    helper.proc = p;
    p.stdout.on('data', (d) => { if (/^ok /.test(String(d))) helper.ok = true; helper.note && helper.note('mouse helper: ' + String(d).trim().slice(0, 200)); });
    p.on('error', () => { helper.ok = false; helper.proc = null; });
    p.on('close', (code) => { helper.ok = false; helper.proc = null; helper.note && helper.note('mouse helper stopped, code ' + code); });
    p.stdin.on('error', () => {});
  } catch { helper.ok = false; }
  return helper.ok;
}
// Send one command to the mouse helper. Returns false when the helper is not running.
function pointer(line) {
  pointerStart();
  if (!helper.proc || !helper.ok) return false;
  if (!/^(m|d|u|r) [0-9.]+ [0-9.]+$|^c [0-9.]+ [0-9.]+ [12]$|^k [12] (left|right)$|^s -?[0-9.]+$|^C [0-9.]+ [0-9.]+ [12] (left|right)$/.test(line)) return false;
  try { helper.proc.stdin.write(line + '\n'); return true; } catch { return false; }
}
const mac = process.platform === 'darwin';
const needMac = () => { if (!mac) throw new Error(`System control driver for ${process.platform} is not implemented yet (macOS only for now).`); };
const jxa = (script, args = []) => run('osascript', ['-l', 'JavaScript', '-e', script, ...args]);

const KEYCODES = { return: 36, enter: 36, tab: 48, space: 49, escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126,
  pagedown: 121, pageup: 116, home: 115, end: 119, backspace: 51, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111 };
const MODS = { cmd: 'command down', command: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', opt: 'option down', shift: 'shift down' };

let scale = 1; // screen points per screenshot pixel, set by the last screenshot

async function screenshot() {
  needMac();
  const file = path.join(os.tmpdir(), `kacy-screen-${Date.now()}.jpg`);
  await run('screencapture', ['-x', '-t', 'jpg', file]);
  await run('sips', ['-Z', '1440', file]).catch(() => {});
  let imgW = 1440, pts = 1440;
  try { imgW = Number((await run('sips', ['-g', 'pixelWidth', file])).match(/pixelWidth:\s*(\d+)/)[1]); } catch {}
  try { pts = Number((await jxa("ObjC.import('CoreGraphics'); String($.CGDisplayPixelsWide($.CGMainDisplayID()))")).trim()) || imgW; } catch {}
  scale = pts / imgW;
  const data = fs.readFileSync(file).toString('base64');
  return { file, data, mimeType: 'image/jpeg', width: imgW, note: `Screenshot is ${imgW}px wide. Give mouse_click coordinates in screenshot pixels.` };
}

async function click({ x, y, button = 'left', double = false }) {
  needMac();
  const px = Math.round(Number(x) * scale), py = Math.round(Number(y) * scale);
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('click needs numeric x and y');
  if (pointer(`C ${Math.max(0, px)} ${Math.max(0, py)} ${double ? 2 : 1} ${button === 'right' ? 'right' : 'left'}`)) return `clicked ${button}${double ? ' x2' : ''} at ${x},${y}`;
  const script = `
ObjC.import('CoreGraphics');
function run(argv){
  var x=Number(argv[0]), y=Number(argv[1]), right=argv[2]==='right', n=Number(argv[3]);
  var down=right?$.kCGEventRightMouseDown:$.kCGEventLeftMouseDown, up=right?$.kCGEventRightMouseUp:$.kCGEventLeftMouseUp;
  var btn=right?$.kCGMouseButtonRight:$.kCGMouseButtonLeft, pt={x:x,y:y};
  $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent($(), $.kCGEventMouseMoved, pt, btn)); delay(0.08);
  for(var i=1;i<=n;i++){
    var d=$.CGEventCreateMouseEvent($(), down, pt, btn); $.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, i); $.CGEventPost($.kCGHIDEventTap, d);
    var u=$.CGEventCreateMouseEvent($(), up, pt, btn); $.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, i); $.CGEventPost($.kCGHIDEventTap, u); delay(0.06);
  }
  return 'ok';
}`;
  await jxa(script, [String(px), String(py), button, double ? '2' : '1']);
  return `clicked ${button}${double ? ' x2' : ''} at ${x},${y}`;
}

async function type({ text }) {
  const w = checkShell(text);
  if (w) throw new Error(REFUSAL(w));
  needMac();
  await run('osascript', ['-e', 'on run argv', '-e', 'tell application "System Events" to keystroke (item 1 of argv)', '-e', 'end run', '--', String(text)]);
  return `typed ${String(text).length} characters`;
}

async function key({ combo }) {
  const w = checkKeys(combo);
  if (w) throw new Error(REFUSAL(`press ${w}`));
  needMac();
  const parts = String(combo).toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const k = parts.pop();
  const mods = parts.map((m) => MODS[m]).filter(Boolean);
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  let stroke;
  if (k in KEYCODES) stroke = `key code ${KEYCODES[k]}${using}`;
  else if (k.length === 1) stroke = `keystroke ${JSON.stringify(k)}${using}`;
  else throw new Error(`unknown key "${k}"`);
  await run('osascript', ['-e', `tell application "System Events" to ${stroke}`]);
  return `pressed ${combo}`;
}

async function openApp({ name }) { needMac(); await run('open', ['-a', String(name)]); return `opened ${name}`; }
async function openUrl({ url }) {
  if (!/^(https?:\/\/|mailto:|x-apple\.systempreferences:)/i.test(String(url))) throw new Error('only http(s), mailto: and x-apple.systempreferences: links can be opened');
  if (mac) await run('open', [url]);
  else if (process.platform === 'win32') await run('cmd', ['/c', 'start', '', url]);
  else await run('xdg-open', [url]);
  return `opened ${url}`;
}
// --- Accessibility: act on what is on screen by its name, with no screenshot and no coordinates ---
const UI_SCRIPT = `
on run argv
  set appName to item 1 of argv
  set mode to item 2 of argv
  set target to item 3 of argv
  set found to {}
  tell application "System Events"
    if appName is "" then set appName to name of first application process whose frontmost is true
    tell application process appName
      set frontmost to true
      set els to entire contents of window 1
      repeat with e in els
        try
          set n to ""
          try
            set n to (name of e) as text
          end try
          if n is "" or n is "missing value" then
            try
              set n to (description of e) as text
            end try
          end if
          if n is "" or n is "missing value" then
            try
              set n to (value of e) as text
            end try
          end if
          if n is not "" and n is not "missing value" then
            if mode is "list" then
              set r to (role description of e) as text
              if (count of found) < 120 then set end of found to (r & ": " & n)
            else if n contains target then
              try
                perform action "AXPress" of e
              on error
                click e
              end try
              return "clicked: " & n & " (in " & appName & ")"
            end if
          end if
        end try
      end repeat
    end tell
  end tell
  if mode is "list" then
    set AppleScript's text item delimiters to linefeed
    return "App: " & appName & linefeed & (found as text)
  end if
  return "NOT_FOUND in " & appName
end run`;
async function uiClick({ app = '', label }) {
  if (!label) throw new Error('ui_click needs a label');
  const banned = checkLabel(label, app); if (banned) throw new Error(REFUSAL(banned));
  needMac();
  const out = (await run('osascript', ['-e', UI_SCRIPT, '--', String(app), 'click', String(label)], { timeout: 25000 })).trim();
  if (/^NOT_FOUND/.test(out)) throw new Error(`Nothing named "${label}" was found ${out.slice(10)}. Call ui_list to see what is on screen, or use screen_look and mouse_click.`);
  return out;
}
async function uiList({ app = '' }) { needMac(); return (await run('osascript', ['-e', UI_SCRIPT, '--', String(app), 'list', ''], { timeout: 25000 })).trim().slice(0, 6000); }
async function frontApp() {
  needMac();
  return (await run('osascript', ['-e', 'tell application "System Events" to return name of first application process whose frontmost is true'])).trim();
}
module.exports = { onHelperNote: (fn) => { helper.note = fn; }, screenshot, click, type, key, openApp, openUrl, pointer, pointerStart, uiClick, uiList, frontApp };
