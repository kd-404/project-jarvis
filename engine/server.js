// Kacy engine: local HTTP server (127.0.0.1 only) that serves the desk and connects
// the brain (Claude Code), the project graph, the scheduler and the computer controls.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Graph } = require('./graph');
const { Brain } = require('./brain');
const { Scheduler } = require('./scheduler');
const control = require('./control');
const { Quick } = require('./quick');
const { route } = require('./router');

function start({ port = Number(process.env.KACY_PORT) || 7718, projectsRoot, quiet = false } = {}) {
  const ROOT = path.resolve(__dirname, '..');
  const HOME = path.join(os.homedir(), '.kacy');
  fs.mkdirSync(HOME, { recursive: true });
  const cfgFile = path.join(HOME, 'config.json');
  let cfg = { projectsRoot: projectsRoot || path.dirname(ROOT), project: null, control: 'hands' };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch {}
  if (projectsRoot) cfg.projectsRoot = projectsRoot;
  const saveCfg = () => fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(HOME, 0o700); } catch {}
  const handoffFile = path.join(HOME, 'handoffs.json');
  let handoffs = []; try { handoffs = JSON.parse(fs.readFileSync(handoffFile, 'utf8')); } catch {}

  const token = crypto.randomBytes(16).toString('hex');
  const BOOT = Date.now().toString(36); // changes on every engine start, so an open desk reloads itself after an update
  const clients = new Set();
  const history = [], seen = { system: 0, project: 0 }; // what was said, so each lane can be told what the other did
  const send = (type, data) => { const msg = `data: ${JSON.stringify({ type, data, t: Date.now() })}\n\n`; for (const c of clients) c.write(msg); };
  // diagnostics log, kept next to the app so problems can be read back later
  const logFile = path.join(ROOT, 'kacy.log');
  const log = (text) => { try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 300000) fs.writeFileSync(logFile, ''); fs.appendFileSync(logFile, `${new Date().toISOString()} ${String(text).slice(0, 2000)}\n`); } catch {} };
  // Kacy's voice: on macOS the engine speaks with the built-in "say" command, so sound never depends on the browser.
  const speech = { queue: [], proc: null };
  function speakNext() {
    if (speech.proc || !speech.queue.length) return;
    const text = speech.queue.shift();
    send('speaking', { on: true });
    speech.proc = execFile('say', ['-r', String(cfg.voiceRate || 185), ...(cfg.voice ? ['-v', cfg.voice] : []), text], (e) => {
      speech.proc = null; if (e && !e.killed) log('say failed: ' + e.message);
      if (speech.queue.length) speakNext(); else send('speaking', { on: false, question: /\?\s*$/.test(text) });
    });
  }
  function speak(text) {
    if (process.platform !== 'darwin') return false;
    const clean = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>|]/g, '').replace(/https?:\/\/\S+/g, 'a link').replace(/\s+/g, ' ').trim().slice(0, 420);
    if (clean) { speech.last = clean; speech.lastAt = Date.now(); speech.queue.push(clean); speakNext(); }
    return true;
  }
  // True when a voice transcript is just Kacy's own speech picked up by the microphone.
  function isEcho(text) {
    if (!speech.last || Date.now() - speech.lastAt > 25000) return false;
    const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const said = new Set(words(speech.last)), heard = words(text);
    return heard.length > 0 && heard.filter((w) => said.has(w)).length / heard.length >= 0.6;
  }
  function hush() { speech.queue = []; if (speech.proc) { try { speech.proc.kill(); } catch {} } send('speaking', { on: false }); }
  const emit = (type, data) => {
    send(type, data);
    if (type === 'say') { speak(data.text); log('kacy: ' + data.text); history.push({ lane: data.lane || 'quick', who: 'Kacy', text: String(data.text) }); }
    if (type === 'heard') { log(`${data.source}: ${data.text}`); history.push({ lane: data.lane || 'quick', who: 'User', text: String(data.text) }); }
    if (history.length > 60) { const cut = history.length - 40; history.splice(0, cut); seen.system = Math.max(0, seen.system - cut); seen.project = Math.max(0, seen.project - cut); }
    if (type === 'log') log('brain error: ' + data.text);
    if (type === 'activity') log('  · ' + data.text);
  };

  const graph = new Graph();
  let commits = [], dirty = 0, watcher = null;

  const git = (args) => new Promise((res) => execFile('git', args, { cwd: cfg.project, timeout: 8000 }, (e, out) => res(e ? '' : out)));
  async function pollGit() {
    if (!cfg.project) return;
    const log = await git(['log', '-n', '25', '--pretty=format:%h\x1f%s\x1f%cr\x1f%an']);
    const next = log.split('\n').filter(Boolean).map((l) => { const [hash, subject, when, author] = l.split('\x1f'); return { hash, subject, when, author }; });
    const st = (await git(['status', '--porcelain'])).split('\n').filter(Boolean).length;
    if (JSON.stringify(next) !== JSON.stringify(commits) || st !== dirty) { commits = next; dirty = st; emit('git', { commits, dirty }); }
  }
  setInterval(pollGit, 4000).unref();

  function openProject(dir) {
    dir = path.resolve(dir);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('not a folder: ' + dir);
    cfg.project = dir; saveCfg();
    graph.load(dir); commits = []; dirty = 0;
    try { watcher?.close(); } catch {}
    try {
      watcher = fs.watch(dir, { recursive: true }, (_e, file) => {
        if (!file || /(^|[\\/])(\.git|node_modules|\.kacy|__pycache__|\.venv|venv|dist|build)([\\/]|$)/.test(file)) return;
        const part = graph.partForFile(file);
        emit('touch', { file: file.replace(/\\/g, '/'), part: part && part.id });
      });
      watcher.on('error', () => {});
    } catch {}
    emit('project', snapshot()); pollGit();
    setTimeout(() => brains.system.warm(workspace()), 300).unref?.();
  }
  // General requests (notes, research, errands) need no project: they run in a default workspace folder.
  function workspace() { const d = path.join(os.homedir(), '.kacy', 'home-base'); fs.mkdirSync(d, { recursive: true }); return d; }
  function hangar() {
    try {
      return fs.readdirSync(cfg.projectsRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, path: path.join(cfg.projectsRoot, d.name), hasDesk: fs.existsSync(path.join(cfg.projectsRoot, d.name, '.kacy', 'graph.json')) }));
    } catch { return []; }
  }
  const snapshot = () => ({ atHome: cfg.project === workspace(), project: cfg.project, projectsRoot: cfg.projectsRoot, graph: graph.data, commits, dirty, schedule: scheduler.list(), handoffs,
    control: cfg.control, airMouse: process.platform === 'darwin', build: String(fs.statSync(path.join(ROOT, 'ui', 'index.html')).mtimeMs) + ':' + BOOT, engineVoice: process.platform === 'darwin', models: cfg.models, lanes: { system: { busy: brains.system.busy, model: brains.system.model || 'default' }, project: { busy: brains.project.busy, model: brains.project.model || 'default' } }, brain: { online: brain.online, busy: brains.system.busy || brains.project.busy }, platform: process.platform, hangar: hangar() });

  cfg.models = { system: 'haiku', project: '', mode: 'auto', ...(cfg.models || {}) };
  // Two lanes run side by side: computer control on a small model, research and builds on the strong one.
  const brains = {
    system: new Brain({ engineDir: __dirname, port, token, emit, model: cfg.models.system, lane: 'system' }),
    project: new Brain({ engineDir: __dirname, port, token, emit, model: cfg.models.project, lane: 'project', idleMs: 4 * 60 * 1000 }),
  };
  const brain = brains.system;
  function ask(text, source = 'you') {
    const atHome = cfg.project === workspace();
    const r = route(text, { atHome, mode: cfg.models.mode }), b = brains[r.lane];
    const others = history.slice(seen[r.lane]).filter((h) => h.lane !== r.lane).slice(-6);
    seen[r.lane] = history.length;
    const notes = [`You are the ${r.lane} lane.`];
    if (!atHome) notes.push(`Project on the desk: ${cfg.project}.`);
    if (others.length) notes.push('Recently, outside this lane: ' + others.map((h) => `${h.who}: "${h.text.slice(0, 160)}"`).join(' / ') + '. Those are already handled; do not repeat them.');
    log(`  route → ${r.lane} lane (${b.model || 'default model'}): ${r.why}`);
    b.ask(text, { cwd: r.lane === 'system' ? workspace() : cfg.project || workspace(), source, context: '[' + notes.join(' ') + ']' });
    return r;
  }
  const quick = new Quick({ say: (text) => emit('say', { text }), activity: (text) => emit('activity', { text, kind: 'tool', lane: 'system' }), deps: { click: (n, btn) => control.pointer(`k ${n} ${btn}`) } });
  const scheduler = new Scheduler({ emit, run: (job) => { emit('say', { text: 'Starting your scheduled task now.' }); if (job.project && fs.existsSync(job.project) && job.project !== cfg.project) { try { openProject(job.project); } catch {} } ask(job.instruction, 'schedule'); } });

  const NEEDS_HANDS = ['mouse_click', 'ui_click', 'keyboard_type', 'keyboard_key', 'open_app'];
  async function tool(name, a = {}) {
    if (NEEDS_HANDS.includes(name) && cfg.control !== 'hands') throw new Error('Computer control is switched to "eyes only" on the desk. Tell the user to switch it to "hands" if they want you to act.');
    switch (name) {
      case 'desk_add_part': { const p = graph.addPart(a); emit('graph', graph.data); return `part "${p.id}" is on the desk (${p.type}, ${p.status})`; }
      case 'desk_connect': { const l = graph.connect(a); emit('graph', graph.data); return `wired ${l.from} -> ${l.to}`; }
      case 'desk_set_status': { const p = graph.setStatus(a); emit('graph', graph.data); return `${p.id} is now ${p.status}`; }
      case 'desk_open_project': {
        let dir = null; const want = String(a.path || a.name || '').trim();
        if (!want) throw new Error('give a project name or a folder path');
        if (want.startsWith('~')) dir = path.join(os.homedir(), want.slice(1));
        else if (path.isAbsolute(want)) dir = want;
        else {
          const key = want.toLowerCase().replace(/[^a-z0-9]/g, '');
          const hit = hangar().find((h) => h.name.toLowerCase().replace(/[^a-z0-9]/g, '') === key) || hangar().find((h) => h.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key));
          dir = hit ? hit.path : path.join(a.parent ? String(a.parent).replace(/^~/, os.homedir()) : cfg.projectsRoot, graph.slug(want));
        }
        if (!fs.existsSync(dir)) { if (!a.create) throw new Error(`no folder at ${dir}. Call again with create=true to make it.`); fs.mkdirSync(dir, { recursive: true }); }
        openProject(dir);
        return `The desk now shows the project at ${dir}. For the rest of this turn use absolute paths under that folder; desk tools now apply to it.`;
      }
      case 'set_voice': cfg.voice = String(a.voice || '').replace(/[^A-Za-z0-9 ()-]/g, '').slice(0, 40) || undefined; saveCfg(); return `voice set to ${cfg.voice || 'system default'}`;
      case 'desk_home': openProject(workspace()); return 'Back at home base. The bench is clear.';
      case 'desk_view': return graph.data;
      case 'desk_note': emit('code', { file: String(a.title || 'note'), action: 'note', code: String(a.text || '').slice(0, 12000) }); return 'shown on the desk';
      case 'screen_look': { const s = await control.screenshot(); emit('tool', { name: 'screen_look', input: 'looked at the screen' }); return { image: { data: s.data, mimeType: s.mimeType }, result: s.note }; }
      case 'mouse_click': return control.click(a);
      case 'ui_click': return control.uiClick(a);
      case 'ui_list': return control.uiList(a);
      case 'front_app': return control.frontApp();
      case 'keyboard_type': return control.type(a);
      case 'keyboard_key': return control.key(a);
      case 'open_app': return control.openApp(a);
      case 'open_url': return control.openUrl(a);
      case 'schedule_task': { const j = scheduler.add({ ...a, project: cfg.project }); return `scheduled for ${new Date(j.at).toString()} (${j.id})`; }
      case 'schedule_list': return scheduler.list();
      case 'request_user_delete': {
        const h = { id: 'h-' + Date.now().toString(36), what: String(a.what || ''), command: a.command ? String(a.command) : '', project: cfg.project, at: new Date().toISOString(), done: false };
        handoffs.push(h); fs.writeFileSync(handoffFile, JSON.stringify(handoffs, null, 2)); emit('handoffs', handoffs);
        return 'Handed to the user. It is listed on the desk under "Your hands only". Continue with the rest of the task.';
      }
      default: throw new Error('unknown tool ' + name);
    }
  }

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 2e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
  const sameOrigin = (req) => { const o = req.headers.origin; return !o || o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`; };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) return json(res, 403, { error: 'local only' });
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(path.join(ROOT, 'ui', 'index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && url.pathname === '/events') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin request refused' }); // another site must not be able to take over the desk
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        for (const old of clients) { try { old.write(`data: ${JSON.stringify({ type: 'retire', data: {} })}\n\n`); old.end(); } catch {} }
        clients.clear();
        res.write(`data: ${JSON.stringify({ type: 'hello', data: snapshot() })}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot());
      if (req.method === 'GET' && url.pathname === '/api/file') {
        if (!cfg.project) return json(res, 400, { error: 'no project open' });
        let p = path.resolve(cfg.project, url.searchParams.get('path') || '');
        if (p !== cfg.project && !p.startsWith(cfg.project + path.sep)) return json(res, 403, { error: 'outside the project' });
        if (!fs.existsSync(p)) return json(res, 404, { error: 'not found' });
        const real = fs.realpathSync(p), root = fs.realpathSync(cfg.project); // a link inside the project must not lead outside it
        if (real !== root && !real.startsWith(root + path.sep)) return json(res, 403, { error: 'outside the project' });
        p = real;
        if (fs.statSync(p).isDirectory()) return json(res, 200, { dir: fs.readdirSync(p).slice(0, 200) });
        if (fs.statSync(p).size > 5e6) return json(res, 200, { text: '(file is too large to preview)' });
        return json(res, 200, { text: fs.readFileSync(p, 'utf8').slice(0, 30000) });
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      const body = await readBody(req);
      if (url.pathname === '/api/tool') { // called by the MCP server that Claude Code launches
        if (req.headers['x-kacy-token'] !== token) return json(res, 403, { error: 'bad token' });
        try { const r = await tool(body.name, body.args); return json(res, 200, r && r.image ? r : { result: r }); }
        catch (e) { return json(res, 200, { error: e.message }); }
      }
      if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin request refused' });
      switch (url.pathname) {
        case '/api/command': {
          const text = String(body.text || '').trim();
          if (!text) return json(res, 400, { error: 'empty command' });
          if (body.voice && isEcho(text)) { log('ignored echo: ' + text); return json(res, 200, { ignored: true }); }
          if (!cfg.project) openProject(workspace());
          // instant commands first (open an app or site, play music, volume, time); everything else goes to Claude
          if (quick.parse(text)) {
            emit('heard', { text, source: 'you' });
            if (await quick.handle(text)) { send('activity', { text: 'Done', kind: 'done', lane: 'system' }); return json(res, 200, { ok: true, quick: true }); }
          }
          const r = ask(text); return json(res, 200, { ok: true, lane: r.lane });
        }
        case '/api/project': {
          let dir = body.path;
          if (body.create) { dir = path.join(cfg.projectsRoot, graph.slug(body.create)); fs.mkdirSync(dir, { recursive: true }); }
          openProject(body.home ? workspace() : dir); return json(res, 200, snapshot());
        }
        case '/api/stop': hush(); brains.system.stop(); brains.project.stop(); send('say', { text: 'Stopped.' }); return json(res, 200, { ok: true });
        case '/api/speak': return json(res, 200, { spoken: speak(body.text) });
        case '/api/hush': hush(); return json(res, 200, { ok: true });
        case '/api/models': { // the model controller on the desk
          const ok = (v) => typeof v === 'string' && /^[\w.\-\[\]]{0,60}$/.test(v);
          if (ok(body.system)) cfg.models.system = body.system;
          if (ok(body.project)) cfg.models.project = body.project;
          if (['auto', 'system', 'project'].includes(body.mode)) cfg.models.mode = body.mode;
          saveCfg(); brains.system.setModel(cfg.models.system); brains.project.setModel(cfg.models.project);
          log(`models: system=${cfg.models.system || 'default'} project=${cfg.models.project || 'default'} mode=${cfg.models.mode}`);
          send('models', { models: cfg.models }); return json(res, 200, cfg.models);
        }
        case '/api/log': log('desk: ' + String(body.text || '')); return json(res, 200, { ok: true });
        case '/api/voice': cfg.voice = String(body.voice || '').replace(/[^A-Za-z0-9 ()-]/g, '').slice(0, 40) || undefined; saveCfg(); speak('This is my voice now.'); return json(res, 200, { voice: cfg.voice || 'system default' });
        case '/api/pointer': { // air mouse: the fingertip drives the real cursor
          if (cfg.control !== 'hands') return json(res, 200, { ok: false });
          const c = String(body.c || ''), n = (v) => Math.max(0, Math.min(1, Number(v) || 0)).toFixed(4);
          const line = c === 's' ? `s ${(Number(body.dy) || 0).toFixed(1)}` : c === 'c' ? `c ${n(body.x)} ${n(body.y)} ${body.n === 2 ? 2 : 1}` : ['m', 'd', 'u', 'r'].includes(c) ? `${c} ${n(body.x)} ${n(body.y)}` : '';
          return json(res, 200, { ok: !!line && control.pointer(line) });
        }
        case '/api/gesture': { // hand gestures that act on macOS itself
          if (cfg.control !== 'hands') return json(res, 200, { error: 'eyes only' });
          const g = body.name;
          try {
            if (g === 'mission') await control.openApp({ name: 'Mission Control' });
            else if (g === 'next') await control.key({ combo: 'ctrl+right' });
            else if (g === 'prev') await control.key({ combo: 'ctrl+left' });
            else if (g === 'back') await control.key({ combo: 'escape' });
            else if (g === 'switch') await control.key({ combo: 'cmd+tab' });
            else return json(res, 400, { error: 'unknown gesture' });
          } catch (e) { log('gesture ' + g + ' failed: ' + e.message); return json(res, 200, { error: e.message }); }
          return json(res, 200, { ok: true });
        }
        case '/api/control': cfg.control = body.level === 'hands' ? 'hands' : 'eyes'; saveCfg(); emit('control', cfg.control); return json(res, 200, { control: cfg.control });
        case '/api/schedule': { const j = scheduler.add({ when: body.when, instruction: body.instruction, project: cfg.project }); return json(res, 200, j); }
        case '/api/schedule/cancel': return json(res, 200, scheduler.cancel(body.id) || {});
        case '/api/handoff/done': { const h = handoffs.find((x) => x.id === body.id); if (h) { h.done = true; fs.writeFileSync(handoffFile, JSON.stringify(handoffs, null, 2)); emit('handoffs', handoffs); } return json(res, 200, { ok: true }); }
        default: return json(res, 404, { error: 'not found' });
      }
    } catch (e) { json(res, 500, { error: e.message }); }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      try { openProject(workspace()); } catch { cfg.project = null; }
      control.onHelperNote(log); control.pointerStart();
      log(`--- engine start · ${process.platform} ${os.release()} · node ${process.version} · brain ${brain.online ? brain.bin : 'OFFLINE'}`);
      if (!quiet) console.log(`Kacy engine on http://127.0.0.1:${port}  brain: ${brain.online ? brain.bin : 'OFFLINE (Claude Code not found)'}`);
      resolve({ server, port, token, tool, brain, brains, ask, quick, scheduler, graph, openProject, snapshot, close: () => { try { watcher?.close(); } catch {} hush(); brains.system.stop(); brains.project.stop(); brains.system.retire(); brains.project.retire(); for (const c of clients) c.end(); server.close(); } });
    });
  });
}
module.exports = { start };
if (require.main === module) start().catch((e) => { console.error(e.message); process.exit(1); });
