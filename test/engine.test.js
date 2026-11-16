// End-to-end engine test with a fake "claude" binary: no network, no real Claude Code needed.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { spawn } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kacy-test-'));
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const proj = path.join(tmp, 'projects', 'bike'); fs.mkdirSync(proj, { recursive: true });
// fake claude: prints a stream-json transcript and records its argv
const fake = path.join(tmp, 'claude'); const argvFile = path.join(tmp, 'argv.json');
const inFile = path.join(tmp, 'stdin.log');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs=require('fs'); fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2))); fs.appendFileSync(${JSON.stringify(path.join(tmp, 'spawns.log'))}, 'x');
const o=(x)=>console.log(JSON.stringify(x)); let buf='';
process.stdin.on('data',(d)=>{ buf+=d; let i; while((i=buf.indexOf('\\n'))>=0){ const m=JSON.parse(buf.slice(0,i)); buf=buf.slice(i+1);
  const txt=m.message.content[0].text; fs.appendFileSync(${JSON.stringify(inFile)}, txt+'\\n');
  o({type:'system',subtype:'init',session_id:'sess-1'});
  o({type:'assistant',message:{content:[{type:'tool_use',id:'t0',name:'WebSearch',input:{query:'bike engines'}}]}});
  o({type:'assistant',message:{content:[{type:'tool_use',id:'t1',name:'Write',input:{file_path:'engine.py',content:'print(1)'}}]}});
  o({type:'assistant',message:{content:[{type:'text',text:'Engine part is in.'}]}});
  setTimeout(()=>o({type:'result',subtype:'success',total_cost_usd:0.01,num_turns:2,usage:{input_tokens:10,output_tokens:5}}), /slowbuild/.test(txt.split("\\n").pop())?1800:0); } });
`); fs.chmodSync(fake, 0o755);
process.env.KACY_CLAUDE_BIN = fake;
const lastIn = () => fs.readFileSync(inFile, 'utf8').trim().split('\n').pop();
const { start } = require('../engine/server');
const post = (port, p, body, headers = {}) => new Promise((res, rej) => { const b = JSON.stringify(body); const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), ...headers } }, (x) => { let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => res({ code: x.statusCode, body: JSON.parse(d) })); }); r.on('error', rej); r.end(b); });
(async () => {
  const k = await start({ port: 7791, projectsRoot: path.join(tmp, 'projects'), quiet: true });
  const events = []; const sse = http.get('http://127.0.0.1:7791/events', (r) => { let sb = ''; r.on('data', (d) => { sb += d; let i; while ((i = sb.indexOf('\n\n')) >= 0) { const m = sb.slice(0, i); sb = sb.slice(i + 2); if (m.startsWith('data: ')) events.push(JSON.parse(m.slice(6))); } }); });
  // project + hangar
  // starts as an assistant with no project; a command works straight away
  assert.equal(k.snapshot().atHome, true);
  let r = await post(7791, '/api/command', { text: 'whats the weather' }); assert.equal(r.code, 200); await new Promise((r) => setTimeout(r, 600));
  assert.equal(lastIn(), 'whats the weather');
  r = await post(7791, '/api/project', { path: proj }); assert.equal(r.body.project, proj); assert.equal(r.body.hangar[0].name, 'bike'); assert.equal(r.body.atHome, false);
  // tools need the token
  r = await post(7791, '/api/tool', { name: 'desk_view' }); assert.equal(r.code, 403);
  // cross-origin pages cannot command Kacy
  r = await post(7791, '/api/command', { text: 'hi' }, { origin: 'https://evil.example' }); assert.equal(r.code, 403);
  // real MCP server process, speaking JSON-RPC over stdio, forwarding to the engine
  const mcp = spawn(process.execPath, [path.join(__dirname, '..', 'engine', 'mcp-server.js')], { env: { ...process.env, KACY_PORT: '7791', KACY_TOKEN: k.token } });
  const replies = {}; let buf = ''; mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies[m.id]?.(m); } });
  let n = 0; const rpc = (method, params) => new Promise((res) => { const id = ++n; replies[id] = res; mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args }); return { text: m.result.content.map((c) => c.text).join(''), err: !!m.result.isError }; };
  assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'kacy');
  assert.ok((await rpc('tools/list', {})).result.tools.length >= 12);
  assert.ok(!(await call('desk_add_part', { name: 'Engine', type: 'llm', files: ['engine.py'] })).err);
  assert.ok(!(await call('desk_add_part', { name: 'Front Tyre', type: 'tool' })).err);
  assert.ok(!(await call('desk_connect', { from: 'Engine', to: 'Front Tyre', label: 'torque' })).err);
  assert.ok((await call('desk_connect', { from: 'Engine', to: 'ghost' })).err);
  assert.ok(!(await call('desk_set_status', { id: 'engine', status: 'building' })).err);
  const g = JSON.parse(fs.readFileSync(path.join(proj, '.kacy', 'graph.json'), 'utf8'));
  assert.equal(g.parts.length, 2); assert.equal(g.links[0].label, 'torque'); assert.equal(g.parts[0].status, 'building');
  // no-delete guard on the keyboard, and the hand-off list
  let c = await call('keyboard_type', { text: 'rm -rf ~/projects' }); assert.ok(c.err && /no-delete/.test(c.text), c.text);
  c = await call('keyboard_key', { combo: 'cmd+backspace' }); assert.ok(c.err && /no-delete/.test(c.text), c.text);
  c = await call('request_user_delete', { what: 'old checkpoints', command: 'rm -r ckpt/' }); assert.ok(!c.err);
  assert.equal(k.snapshot().handoffs[0].command, 'rm -r ckpt/');
  // eyes-only mode refuses the hands
  await post(7791, '/api/control', { level: 'eyes' }); c = await call('open_app', { name: 'Terminal' }); assert.ok(c.err && /eyes only/.test(c.text));
  await post(7791, '/api/control', { level: 'hands' });
  // scheduler: reject the past, fire when due
  assert.ok((await call('schedule_task', { when: '2020-01-01T00:00:00Z', instruction: 'x' })).err);
  assert.ok(!(await call('schedule_task', { when: new Date(Date.now() + 3600e3).toISOString(), instruction: 'continue the training of this llm' })).err);
  k.scheduler.tick(Date.now() + 2 * 3600e3); // pretend two hours passed
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(k.scheduler.list()[0].status, 'ran');
  let argv = JSON.parse(fs.readFileSync(argvFile, 'utf8')); assert.equal(lastIn(), 'continue the training of this llm');
  // a spoken command goes to the brain; the stream becomes desk events; the session resumes next time
  await post(7791, '/api/command', { text: 'add an engine' }); await new Promise((r) => setTimeout(r, 700));
  argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
  assert.equal(lastIn(), 'add an engine');
  assert.deepEqual(argv.slice(0, 6), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  // one Claude Code process is reused for a folder: three requests in "bike" so far must not mean three start-ups
  const spawnsBefore = fs.readFileSync(path.join(tmp, 'spawns.log'), 'utf8').length;
  await post(7791, '/api/command', { text: 'second request' }); await new Promise((r) => setTimeout(r, 400));
  assert.equal(lastIn(), 'second request'); assert.equal(fs.readFileSync(path.join(tmp, 'spawns.log'), 'utf8').length, spawnsBefore, 'process was not reused');
  // the live activity feed says what is happening in plain words
  const acts = events.filter((e) => e.type === 'activity').map((e) => e.data.text);
  for (const want of ['Thinking…', 'Searching the web: bike engines', 'Creating engine.py']) assert.ok(acts.includes(want), 'missing activity: ' + want + ' in ' + acts.join(' | '));
  assert.ok(acts.some((a) => /^Done in \d+s$/.test(a)));
  // air mouse endpoint only accepts well-formed moves and respects "eyes only"; links allow mail drafts and settings panes, nothing else
  r = await post(7791, '/api/pointer', { c: 'm', x: 0.5, y: 0.5 }); assert.equal(r.code, 200);
  const control = require('../engine/control');
  assert.equal(control.pointer('m 0.5 0.5; rm -rf'), false);
  await assert.rejects(control.openUrl({ url: 'file:///etc/passwd' }), /only http/);
  await assert.rejects(control.uiClick({ app: 'Finder', label: 'Move to Trash' }), /no-delete/);
  c = await call('ui_click', { label: 'Empty Trash' }); assert.ok(c.err && /no-delete/.test(c.text));
  // instant actions are passed on as context, so "now click Wi-Fi" makes sense to Claude
  await post(7791, '/api/command', { text: 'what time is it' }); await post(7791, '/api/command', { text: 'now explain that' }); await new Promise((r) => setTimeout(r, 500));
  assert.ok(/Recently, outside this lane: User: "what time is it"/.test(fs.readFileSync(inFile, 'utf8')), 'context note missing');
  // two lanes: a slow build in the project lane must not hold up a computer-control request in the system lane
  const { route } = require('../engine/router');
  assert.equal(route('open system settings and click wifi').lane, 'system'); assert.equal(route('research small vision models').lane, 'project');
  assert.equal(route('make it bigger', { atHome: false }).lane, 'project'); assert.equal(route('research x', { mode: 'system' }).lane, 'system');
  const mark = events.length;
  r = await post(7791, '/api/command', { text: 'build a slowbuild pipeline' }); assert.equal(r.body.lane, 'project');
  await new Promise((r) => setTimeout(r, 300));
  r = await post(7791, '/api/command', { text: 'click on bluetooth' }); assert.equal(r.body.lane, 'system');
  await new Promise((r) => setTimeout(r, 700));
  const dones = events.slice(mark).filter((e) => e.type === 'done').map((e) => e.data.lane); if (!dones.length) console.log(events.slice(mark).map((e) => e.type + ':' + (e.data.lane || '') + ':' + String(e.data.text || e.data.state || '').slice(0, 50)).join('\n'));
  assert.deepEqual(dones, ['system'], 'system lane should finish while the project lane is still working: ' + dones);
  assert.equal(k.snapshot().lanes.project.busy, true);
  await new Promise((r) => setTimeout(r, 1500)); assert.ok(events.slice(mark).some((e) => e.type === 'done' && e.data.lane === 'project'));
  assert.ok(events.slice(mark).filter((e) => e.type === 'activity').every((e) => e.data.lane), 'every activity line carries its lane');
  // model controller: each lane gets the model you pick, applied on its next start
  assert.equal(k.snapshot().models.system, 'haiku');
  r = await post(7791, '/api/models', { system: 'sonnet', project: 'opus', mode: 'auto' }); assert.equal(r.body.project, 'opus');
  await post(7791, '/api/command', { text: 'click on wifi' }); await new Promise((r) => setTimeout(r, 500));
  argv = JSON.parse(fs.readFileSync(argvFile, 'utf8')); assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
  r = await post(7791, '/api/models', { system: 'bad model; rm' }); assert.equal(r.body.system, 'sonnet');
  // instant commands never reach Claude
  const { Quick } = require('../engine/quick'); const opened = [], said = [];
  const q = new Quick({ say: (t) => said.push(t), activity: () => {}, deps: { openUrl: async (u) => opened.push(u), run: async (c, a) => opened.push(c + ' ' + a.join(' ')), firstVideo: async (query) => 'https://www.youtube.com/watch?v=abcdefghijk#' + query } });
  assert.equal(await q.handle('open yt and play music'), true); assert.equal(said.pop(), "What's your mood?");
  assert.equal(await q.handle('feeling chill'), true); assert.equal(opened.pop(), 'https://www.youtube.com/watch?v=abcdefghijk#chill music mix');
  assert.equal(await q.handle('Open YouTube and play lofi beats'), true); assert.ok(opened.pop().endsWith('#lofi beats'));
  assert.equal(await q.handle('open github'), true); assert.equal(opened.pop(), 'https://github.com');
  assert.equal(await q.handle('whats the weather in chennai'), false); assert.equal(await q.handle('create a file called ideas'), false);
  const { firstVideo } = require('../engine/quick');
  assert.equal(await firstVideo('x', async () => 'junk{"videoRenderer":{"videoId":"dQw4w9WgXcQ","thumbnail"'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const before = lastIn(); r = await post(7791, '/api/command', { text: 'what time is it' }); assert.equal(r.body.quick, true); assert.equal(lastIn(), before);
  const types = events.map((e) => e.type);
  for (const t of ['hello', 'graph', 'heard', 'code', 'say', 'done', 'handoffs', 'schedule']) assert.ok(types.includes(t), 'missing event ' + t);
  assert.equal(events.find((e) => e.type === 'code').data.file, 'engine.py');
  // the hook that guards Claude Code's own tools
  const hook = (ev) => new Promise((res) => { const h = spawn(process.execPath, [path.join(__dirname, '..', 'engine', 'hook-guard.js')]); let e = ''; h.stderr.on('data', (d) => (e += d)); h.on('close', (code) => res({ code, e })); h.stdin.end(JSON.stringify(ev)); });
  assert.equal((await hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf data' } })).code, 2);
  assert.equal((await hook({ tool_name: 'Bash', tool_input: { command: 'python train.py' } })).code, 0);
  assert.equal((await hook({ tool_name: 'Write', tool_input: { file_path: 'a.py', content: '' } })).code, 2);
  const settings = JSON.parse(fs.readFileSync(path.join(tmp, '.kacy', 'claude-settings.json'), 'utf8')); assert.ok(settings.hooks.PreToolUse[0].hooks[0].command.includes('hook-guard.js'));
  // projects by voice: open by fuzzy name, create new, go home
  c = await call('desk_open_project', { name: 'Bike' }); assert.ok(!c.err && k.snapshot().project === proj, c.text);
  c = await call('desk_open_project', { name: 'Rocket Lab' }); assert.ok(c.err && /create=true/.test(c.text));
  c = await call('desk_open_project', { name: 'Rocket Lab', create: true }); assert.ok(!c.err && fs.existsSync(path.join(tmp, 'projects', 'rocket-lab')));
  c = await call('desk_home', {}); assert.ok(!c.err && k.snapshot().atHome);
  await call('desk_open_project', { name: 'bike' });
  // general assistant: notes reach the desk, home folder is reachable, no project needed
  c = await call('desk_note', { title: 'Research: LoRA', text: 'findings...' }); assert.ok(!c.err);
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(events.some((e) => e.type === 'code' && e.data.action === 'note'));
  // wires carry the call site, for learning
  c = await call('desk_connect', { from: 'Engine', to: 'Front Tyre', where: 'engine.py:12', how: 'tyre.spin(rpm)' }); assert.ok(!c.err);
  assert.equal(k.snapshot().graph.links[0].where, 'engine.py:12');
  // desk -> engine endpoints: log file, gesture actions respect "eyes only"
  r = await post(7791, '/api/log', { text: 'voice error: not-allowed' }); assert.equal(r.code, 200);
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'kacy.log'), 'utf8').includes('voice error: not-allowed'));
  await post(7791, '/api/control', { level: 'eyes' }); r = await post(7791, '/api/gesture', { name: 'next' }); assert.equal(r.body.error, 'eyes only');
  await post(7791, '/api/control', { level: 'hands' }); r = await post(7791, '/api/gesture', { name: 'bogus' }); assert.equal(r.code, 400);
  assert.ok(argv.includes('--add-dir') && argv.join(' ').includes('WebSearch'));
  // not signed in: Kacy explains the one-time login instead of a vague error
  fs.writeFileSync(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"result",subtype:"success",is_error:true,result:"Invalid API key · Please run /login"}));process.exit(1);'); fs.chmodSync(fake, 0o755);
  k.brain.retire(); events.length = 0; await post(7791, '/api/command', { text: 'research lora' }); await new Promise((r) => setTimeout(r, 700));
  assert.ok(events.some((e) => e.type === 'say' && /sign in/.test(e.data.text)), 'login hint missing');
  assert.ok(!events.some((e) => e.type === 'say' && /stopped with an error/.test(e.data.text)));
  // Kacy must not answer her own voice: a voice transcript that repeats what she just said is dropped, typed text is not
  process.env.KACY_ECHO_TEST = '1';
  // a second desk window retires the first
  const got = []; const sse2 = http.get('http://127.0.0.1:7791/events', (r) => r.on('data', (d) => got.push(String(d))));
  await new Promise((r) => setTimeout(r, 200)); assert.ok(events.some((e) => e.type === 'retire'), 'old window not retired'); sse2.destroy();
  mcp.kill(); sse.destroy(); k.close();
  console.log('ALL ENGINE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
