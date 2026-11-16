// The brain: drives Claude Code in headless mode inside the active project folder,
// and turns its event stream into things the desk can show and say.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SYSTEM = `You are Kacy, the user's voice-driven personal assistant, running on their own computer inside a 3D "desk" app. Think Jarvis: you do whatever is asked, end to end, without asking the user to do steps you can do yourself.

YOU ARE A GENERAL ASSISTANT, NOT ONLY A CODER
- Anything goes: create or edit a file anywhere on the computer, write notes or documents, research a topic on the internet, compare options, explain something, run a script, organise a folder, open apps and websites, operate the screen, or build software.
- Requests arrive by voice, so they are often short, loosely worded or slightly mis-transcribed. Work out what the user most likely means and do it. Only ask a question when a wrong guess would waste real work.
- Research: use WebSearch and WebFetch, read several sources, then give the answer. For anything longer than two sentences, call desk_note with the full write-up (and source links) so it shows on the desk, and save it as a markdown file when the user wants to keep it.
- Files: when no location is given, save in the current folder. Paths like Desktop, Documents and Downloads are in the user's home folder.
- Your spoken replies are read aloud. Keep them to one or two short sentences, plain words, no markdown, no code. Detail goes in desk_note or in files.

NO PROJECT IS NEEDED
- You start at "home base", which is just a scratch folder. Most requests have nothing to do with it: weather, a question, opening an app, research, a quick file. Just do them. Never tell the user to create, pick or open a folder or project first, and never mention home base.
- Weather, news, prices, scores, "what is", "who is": search the web and answer in a sentence or two. If the place matters and you do not know it, ask which city.
- "Open System Settings", "open Chrome", "open YouTube": use open_app or open_url straight away.
- Music: if the user just says "play some music", ask "What's your mood?" and stop there; their next words are the answer. Then find a fitting YouTube video or mix with WebSearch and open its watch link with open_url so it starts playing. If you only have a search page, use screen_look and click the first result. If they already named a song, artist or mood, skip the question.
- When you need an answer from the user, end your spoken reply with a question mark; the microphone reopens for their reply without the wake word.
- Pictures: you can make diagrams, logos, icons and illustrations as SVG or HTML, and charts or simple images with Python. Save the file, then open it so the user sees it. You cannot generate photographic AI images; say so in one sentence and offer the drawn version.
- Only when the user asks to open, start or create a project do you call desk_open_project (create=true for a new one, with parent set if they named a folder). Then build inside it.

THE DESK (only for build work)
- The desk shows each component of a software project as a physical part, wired to the parts it talks to. When the task is building or changing software, keep it true:
  desk_add_part when a component appears (status planned), desk_set_status building while you write it, ready when it works, error when broken, desk_connect for each data or control flow. List each part's files.
- The user learns from the desk. On every desk_connect fill "where" (file:line of the call) and "how" (the call itself), so clicking a part shows exactly which line of code talks to which part or model. When asked to explain a part, call desk_note with a short walkthrough: what it does, then each neighbour and the lines that reach it.
- Types: llm, agent, encoder, retriever, database, api, tool, ui, data, trainer, sensor, actuator, service, generic.
- Skip the desk tools entirely for requests that are not about building software (a note, a question, research, an errand).
- For build work, commit meaningful steps with git so the commit rail stays alive.

OPERATING THE MAC ("click on Wi-Fi", "go to Bluetooth", "press the blue button", "next, open that")
- These are follow-ups to whatever app is in front. Act on them directly; never answer that you cannot see the screen.
- First choice: ui_click with the visible name (ui_click label "Wi-Fi" app "System Settings"). It needs no screenshot. If it reports not found, call ui_list to read what is on screen and pick the closest name. If you do not know which app is in front, call front_app.
- System Settings panes can also be opened directly with open_url, e.g. x-apple.systempreferences:com.apple.wifi-settings-extension (Wi-Fi), com.apple.BluetoothSettings (Bluetooth), com.apple.Sound-Settings.extension (Sound), com.apple.Displays-Settings.extension (Displays), com.apple.preference.security (Privacy & Security).
- Second choice, for things with no name (an image, a spot on a canvas): screen_look, then mouse_click on what you saw, then screen_look again to confirm.
- If a tool answers PERMISSION NEEDED, tell the user exactly which switch to turn on, in one sentence, and stop; do not keep retrying.
- Email and messages: prepare the draft (a mailto: link through open_url is the fastest way) and stop before sending. Read back the recipient and ask the user to confirm, because voice often mishears names and addresses.
- While doing long work, speak only at the start and the end. The user follows the steps on screen, and every sentence you speak closes their microphone while it plays.

EYES, HANDS, TIME
- screen_look shows you the user's screen ("look at my screen", "what is this error").
- mouse_click, keyboard_type, keyboard_key, open_app, open_url operate the computer. Look before you click, and look again after to confirm.
- schedule_task queues work for later ("continue the training at 5 pm"). Pass an ISO 8601 local time and a complete, standalone instruction.

ABSOLUTE RULE: NEVER DELETE, FORMAT OR ERASE
You never delete, remove, format, wipe, truncate, uninstall, force-push, discard or erase anything: not files, folders, git history, database rows, disks, apps or settings. Not with a command, not with a script, not by clicking Delete, Erase, Format, Move to Trash, Empty Trash or Discard in any app, and not by any workaround.
When a task needs something removed, call request_user_delete with what should go and the exact command or steps, tell the user it is waiting for their hands, and carry on with everything else. A guard also blocks these actions; never try to get around it.

TWO LANES
Kacy runs two of you side by side. The system lane (a small fast model) operates the computer and answers quick questions. The project lane (the strong model) does research and builds software. Each request says which lane you are. Stay in your lane: in the system lane do not start writing a project, and in the project lane do not wander into unrelated computer errands. A note in square brackets at the top of a request tells you what the other lane or the user did recently.`;

// Plain-language description of what a tool call is doing, for the live activity feed.
function describe(name, i = {}) {
  const base = (f) => String(f || '').split(/[\\/]/).slice(-2).join('/');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || '').slice(0, 40); } };
  const short = (t, n = 70) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
  const k = name.replace(/^mcp__kacy__/, '');
  switch (k) {
    case 'Read': return `Reading ${base(i.file_path)}`;
    case 'Write': return `Creating ${base(i.file_path)}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Editing ${base(i.file_path || i.notebook_path)}`;
    case 'Glob': return `Looking for files: ${short(i.pattern, 40)}`;
    case 'Grep': return `Searching the code for "${short(i.pattern, 40)}"`;
    case 'Bash': return `Running: ${short(i.command)}`;
    case 'WebSearch': return `Searching the web: ${short(i.query, 60)}`;
    case 'WebFetch': return `Reading ${host(i.url)}`;
    case 'Task': case 'Agent': return `Handing off: ${short(i.description || i.prompt, 50)}`;
    case 'TodoWrite': return 'Planning the steps';
    case 'screen_look': return 'Looking at your screen';
    case 'mouse_click': return `Clicking at ${i.x}, ${i.y}`;
    case 'ui_click': return `Clicking "${i.label}"${i.app ? ' in ' + i.app : ''}`;
    case 'ui_list': return `Reading what is on screen${i.app ? ' in ' + i.app : ''}`;
    case 'front_app': return 'Checking which app is in front';
    case 'ToolSearch': return 'Getting the right tool ready';
    case 'Skill': return `Using a skill: ${i.skill || ''}`;
    case 'keyboard_type': return `Typing: ${short(i.text, 40)}`;
    case 'keyboard_key': return `Pressing ${i.combo}`;
    case 'open_app': return `Opening ${i.name}`;
    case 'open_url': return `Opening ${host(i.url)}`;
    case 'desk_add_part': return `Adding part: ${i.name}`;
    case 'desk_connect': return `Wiring ${i.from} → ${i.to}`;
    case 'desk_set_status': return `${i.id} is ${i.status}`;
    case 'desk_open_project': return `Opening project ${i.name || base(i.path)}`;
    case 'desk_note': return `Writing up: ${short(i.title, 50)}`;
    case 'schedule_task': return `Scheduling: ${short(i.instruction, 50)}`;
    case 'request_user_delete': return 'Handing a removal to you';
    default: return k.replace(/_/g, ' ');
  }
}

class Brain {
  constructor({ engineDir, port, token, emit, model, lane = 'system', idleMs = 0 }) {
    Object.assign(this, { engineDir, port, token, model, lane, idleMs });
    this.emit = (type, data) => emit(type, { ...data, lane }); // every event says which lane it came from
    this.proc = null; this.procCwd = null; this.busy = false; this.sessions = {}; this.queue = []; this.bin = this.findClaude();
    this.cfgDir = path.join(os.homedir(), '.kacy');
    fs.mkdirSync(this.cfgDir, { recursive: true });
    this.mcpFile = path.join(this.cfgDir, 'mcp.json');
    this.settingsFile = path.join(this.cfgDir, 'claude-settings.json');
    const node = process.execPath;
    try { fs.chmodSync(this.cfgDir, 0o700); } catch {}
    fs.writeFileSync(this.mcpFile, JSON.stringify({ mcpServers: { kacy: { command: node, args: [path.join(engineDir, 'mcp-server.js')], env: { KACY_PORT: String(port), KACY_TOKEN: token } } } }, null, 2), { mode: 0o600 });
    fs.writeFileSync(this.settingsFile, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `"${node}" "${path.join(engineDir, 'hook-guard.js')}"` }] }] } }, null, 2));
  }
  findClaude() {
    if (process.env.KACY_CLAUDE_BIN) return process.env.KACY_CLAUDE_BIN;
    const home = os.homedir(), exe = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(home, '.claude', 'local'), path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin')];
    for (const d of dirs) { try { const p = path.join(d, exe); fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
    return null;
  }
  get online() { return !!this.bin; }

  // One Claude Code process stays running per folder and takes each request on stdin,
  // so a command does not pay the start-up cost every time and the conversation carries on.
  ensure(cwd) {
    if (this.proc && this.procCwd === cwd) return true;
    this.retire();
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--mcp-config', this.mcpFile, '--settings', this.settingsFile,
      '--append-system-prompt', SYSTEM, '--permission-mode', 'acceptEdits',
      '--allowedTools', 'mcp__kacy,Read,Edit,Write,MultiEdit,NotebookEdit,Bash,Glob,Grep,WebSearch,WebFetch,TodoWrite,Task,Agent,ToolSearch',
      '--add-dir', os.homedir()];
    if (this.model) args.push('--model', this.model);
    if (this.sessions[cwd]) args.push('--resume', this.sessions[cwd]);
    let proc;
    try { proc = spawn(this.bin, args, { cwd, env: { ...process.env, KACY_PORT: String(this.port), KACY_TOKEN: this.token, ENABLE_TOOL_SEARCH: 'false' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { this.emit('say', { text: 'I could not start Claude Code: ' + e.message }); return false; }
    this.proc = proc; this.procCwd = cwd; this.costSoFar = 0;
    let buf = '', err = '';
    proc.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line && this.proc === proc) this.onLine(line, cwd); }
    });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    proc.stdin.on('error', () => {});
    proc.on('error', (e) => { if (this.proc !== proc) return; this.proc = null; this.procCwd = null; this.busy = false; this.emit('say', { text: 'Claude Code failed to start: ' + e.message }); this.emit('status', { state: 'idle' }); });
    proc.on('close', (code) => {
      if (this.proc !== proc) return; // an old process we already replaced
      this.proc = null; this.procCwd = null;
      const wasBusy = this.busy; this.busy = false;
      if (this.checkLogin(err)) { /* already explained */ }
      else if (wasBusy && !this.stopped && this.model && /model/i.test(err) && this.job && !this.job.retried) {
        this.emit('activity', { text: `Model "${this.model}" was not accepted, using your default instead`, kind: 'fail' });
        this.model = ''; this.job.retried = true; this.queue.unshift(this.job);
      }
      else if (wasBusy && !this.stopped && !this.needsLogin) {
        delete this.sessions[cwd]; // a stale session id is the usual cause: start clean next time
        this.emit('say', { text: 'Claude Code stopped with an error. Check the log panel.' });
        this.emit('log', { text: err.slice(-1500) || `exit code ${code}` });
      }
      this.stopped = false;
      this.emit('status', { state: 'idle' });
      this.next();
    });
    return true;
  }
  setModel(m) { if ((m || '') === (this.model || '')) return; this.model = m || ''; if (!this.busy) this.retire(); else this.restartAfter = true; }
  // the strong model's process is let go after a quiet spell, to give the memory back
  idleSoon() { clearTimeout(this.idleTimer); if (this.idleMs) { this.idleTimer = setTimeout(() => { if (!this.busy) this.retire(); }, this.idleMs); this.idleTimer.unref?.(); } }
  retire() { const p = this.proc; if (!p) return; this.proc = null; this.procCwd = null; try { p.stdin.end(); } catch {} setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, 1500).unref?.(); }
  warm(cwd) { if (this.bin && !this.busy && cwd) this.ensure(cwd); } // start Claude Code ahead of the first request

  ask(text, { cwd, source = 'you', context = '' } = {}) {
    this.emit('heard', { text, source });
    if (!this.bin) { this.emit('say', { text: 'My brain is offline. Install Claude Code and sign in, then restart me.' }); return; }
    this.queue.push({ text: context ? context + '\n\n' + text : text, cwd });
    this.next();
  }
  next() {
    if (this.busy || !this.queue.length) return;
    const job = this.queue.shift(); const { text, cwd } = job; this.job = job;
    this.needsLogin = false; clearTimeout(this.idleTimer);
    if (!this.ensure(cwd)) return;
    this.busy = true; this.startedAt = Date.now();
    this.emit('status', { state: 'thinking' });
    this.emit('activity', { text: 'Thinking…' + (this.model ? ' (' + this.model + ')' : ''), kind: 'think' });
    if (text.length > 20000) job.text = text.slice(0, 20000);
    try { this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'); }
    catch (e) { this.busy = false; this.emit('say', { text: 'I lost the connection to Claude Code. Ask me again.' }); this.retire(); this.emit('status', { state: 'idle' }); }
  }
  onLine(line, cwd) {
    let ev; try { ev = JSON.parse(line); } catch { this.checkLogin(line); return; }
    if (ev.session_id) this.sessions[cwd] = ev.session_id;
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (b.type === 'text' && b.text.trim() && !this.checkLogin(b.text)) this.emit('say', { text: b.text.trim(), partial: true });
        if (b.type === 'tool_use') this.onTool(b.name, b.input || {});
      }
    }
    if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) { // tool results coming back
      for (const b of ev.message.content) if (b.type === 'tool_result' && b.is_error) {
        const t = Array.isArray(b.content) ? b.content.map((c) => c.text || '').join(' ') : String(b.content || '');
        this.emit('activity', { text: (/no-delete/.test(t) ? 'Blocked by the no-delete rule' : 'That step failed: ' + t.replace(/\s+/g, ' ').slice(0, 90)), kind: 'fail' });
      }
    }
    if (ev.type === 'result') {
      const failed = ev.is_error || ev.subtype !== 'success';
      if (failed && !this.checkLogin(String(ev.result || '')) && ev.result) this.emit('say', { text: String(ev.result).slice(0, 200) });
      const total = Number(ev.total_cost_usd) || 0, spent = total >= (this.costSoFar || 0) ? total - (this.costSoFar || 0) : total; this.costSoFar = total;
      this.busy = false;
      this.emit('done', { ok: !failed, model: this.model || 'default', cost: spent, turns: ev.num_turns, ms: Date.now() - (this.startedAt || Date.now()),
        tokens: ev.usage ? (ev.usage.input_tokens || 0) + (ev.usage.output_tokens || 0) : undefined });
      this.emit('activity', { text: `Done in ${Math.max(1, Math.round((Date.now() - (this.startedAt || Date.now())) / 1000))}s`, kind: 'done' });
      this.emit('status', { state: 'idle' });
      if (this.restartAfter) { this.restartAfter = false; this.retire(); }
      this.idleSoon();
      this.next();
    }
  }
  // Claude Code is installed but not signed in: say exactly what to do, once per request.
  checkLogin(text) {
    if (!/(please run \/login|invalid api key|not logged in|authentication[_ ]error|oauth token (has )?expired|run `?claude`? (and|to) (log|sign) ?in)/i.test(String(text))) return false;
    if (!this.needsLogin) {
      this.needsLogin = true;
      this.emit('say', { text: 'I need a one time sign in. Open Terminal, type claude, press return, then type slash login and follow the browser page. After that, ask me again.' });
      this.emit('code', { file: 'one-time setup', action: 'do this', code: 'Open Terminal and run:\n\n    claude\n\nthen inside it type:\n\n    /login\n\nSign in with your Claude account in the browser page that opens,\nthen type /exit and ask Kacy again. You only do this once.' });
    }
    return true;
  }
  onTool(name, input) {
    this.emit('activity', { text: describe(name, input), kind: 'tool' });
    if (['Edit', 'Write', 'MultiEdit'].includes(name)) {
      const code = input.content || input.new_string || (input.edits || []).map((e) => e.new_string).join('\n...\n') || '';
      this.emit('code', { file: input.file_path, action: name === 'Write' ? 'write' : 'edit', code: code.slice(0, 6000) });
    } else if (name === 'Bash') this.emit('code', { file: 'terminal', action: 'run', code: String(input.command || '').slice(0, 2000) });
  }
  stop() {
    this.queue = [];
    if (this.proc) { this.stopped = true; const p = this.proc; try { p.kill('SIGTERM'); } catch {} }
    this.busy = false;
    this.emit('status', { state: 'idle' });
  }
}
module.exports = { Brain, SYSTEM, describe };
