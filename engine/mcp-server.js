#!/usr/bin/env node
// Minimal MCP server (stdio, JSON-RPC 2.0, no dependencies). Claude Code launches this;
// every tool call is forwarded to the Kacy engine over localhost.
const http = require('http');
const PORT = process.env.KACY_PORT || 7718, TOKEN = process.env.KACY_TOKEN || '';
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const TOOLS = [
  { name: 'desk_add_part', description: 'Add a component to the 3D desk, or update one that exists. Call whenever a component is planned or created.',
    inputSchema: S({ name: str('Short display name, e.g. "Retriever agent"'), type: str('llm | agent | encoder | retriever | database | api | tool | ui | data | trainer | sensor | actuator | service | generic'),
      description: str('One line on what it does'), files: { type: 'array', items: { type: 'string' }, description: 'Project-relative files or folders that implement it' }, status: str('planned | building | ready | error') }, ['name', 'type']) },
  { name: 'desk_connect', description: 'Wire two parts together to show data or control flowing from one to the other.',
    inputSchema: S({ from: str('Part name or id'), to: str('Part name or id'), label: str('What flows, e.g. "embeddings"'), where: str('Where in the code the call happens, as file:line, e.g. "src/retriever.py:14"'), how: str('The call itself, e.g. "self.store.search(q, k=4)"') }, ['from', 'to']) },
  { name: 'desk_set_status', description: 'Change how a part looks: planned (ghost), building (glowing), ready (solid), error (red), retired (greyed out, used instead of removing).',
    inputSchema: S({ id: str('Part name or id'), status: str('planned | building | ready | error | retired'), note: str('Optional short note') }, ['id', 'status']) },
  { name: 'desk_open_project', description: 'Put a project on the desk. Use when the user asks to open, switch to, start or create a project. Accepts a project name (matched against the projects folder) or a folder path; set create=true to make a new folder.',
    inputSchema: S({ name: str('Project name, e.g. "loomwell"'), path: str('Folder path, absolute or starting with ~'), parent: str('Folder to create the new project in, if the user named one'), create: { type: 'boolean' } }) },
  { name: 'set_voice', description: "Change Kacy's speaking voice to a macOS voice by name (e.g. Samantha, Daniel, Karen, Rishi, Veena). Empty name = system default.", inputSchema: S({ voice: str('macOS voice name') }) },
  { name: 'desk_home', description: 'Clear the bench and go back to home base (no project).', inputSchema: S({}) },
  { name: 'desk_note', description: 'Show a write-up on the desk for the user to read: research findings, an answer, a plan, a list of links. Use for anything longer than two spoken sentences.',
    inputSchema: S({ title: str('Short title'), text: str('The full text, plain or markdown') }, ['title', 'text']) },
  { name: 'desk_view', description: 'Read the current desk: all parts, their status, files and connections.', inputSchema: S({}) },
  { name: 'screen_look', description: "Take a screenshot of the user's screen and see it.", inputSchema: S({}) },
  { name: 'mouse_click', description: 'Click on the screen. Coordinates are pixels in the most recent screen_look image.',
    inputSchema: S({ x: { type: 'number' }, y: { type: 'number' }, button: str('left or right'), double: { type: 'boolean' } }, ['x', 'y']) },
  { name: 'ui_click', description: 'Click something in a Mac app by its visible name (a button, sidebar row, tab, link, menu item), e.g. label "Wi-Fi" in app "System Settings". No screenshot or coordinates needed. Prefer this over mouse_click. Leave app empty for the frontmost app.',
    inputSchema: S({ label: str('Visible text of the thing to click; partial match is fine'), app: str('App name as shown in the Dock, e.g. "System Settings", "Finder", "Google Chrome"') }, ['label']) },
  { name: 'ui_list', description: 'List the named controls in the front window of a Mac app (what can be clicked), without a screenshot. Leave app empty for the frontmost app.', inputSchema: S({ app: str('App name') }) },
  { name: 'front_app', description: 'Name of the app the user currently has in front.', inputSchema: S({}) },
  { name: 'keyboard_type', description: 'Type text into whatever is focused.', inputSchema: S({ text: str('Text to type') }, ['text']) },
  { name: 'keyboard_key', description: 'Press a key or shortcut, e.g. "return", "cmd+s", "cmd+tab", "pagedown". Delete shortcuts are blocked.', inputSchema: S({ combo: str('Key combo') }, ['combo']) },
  { name: 'open_app', description: 'Open or focus an application by name.', inputSchema: S({ name: str('App name, e.g. "Terminal"') }, ['name']) },
  { name: 'open_url', description: 'Open a link: an https page, a mailto: link (opens a pre-filled email draft: mailto:someone@x.com?subject=..&body=..), or an x-apple.systempreferences: link to jump straight to a System Settings pane.', inputSchema: S({ url: str('The link') }, ['url']) },
  { name: 'schedule_task', description: 'Queue an instruction for Kacy to carry out at a later time.',
    inputSchema: S({ when: str('ISO 8601 date-time with timezone offset'), instruction: str('Complete standalone instruction to run then') }, ['when', 'instruction']) },
  { name: 'schedule_list', description: 'List scheduled tasks.', inputSchema: S({}) },
  { name: 'request_user_delete', description: 'Kacy never deletes, formats or erases. Use this to hand a removal to the user: it appears on the desk for them to do by hand.',
    inputSchema: S({ what: str('What should be removed and why'), command: str('Exact command or steps the user can run themselves') }, ['what']) },
];
function callEngine(name, args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ name, args });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/tool', method: 'POST', headers: { 'content-type': 'application/json', 'x-kacy-token': TOKEN, 'content-length': Buffer.byteLength(body) } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: 'bad reply from Kacy engine' }); } });
    });
    req.on('error', (e) => resolve({ error: 'Kacy engine unreachable: ' + e.message }));
    req.end(body);
  });
}
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notification
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'kacy', version: '0.1.0' } } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const r = await callEngine(params.name, params.arguments || {});
    if (r.error) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.error }], isError: true } });
    const content = [];
    if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType });
    content.push({ type: 'text', text: typeof r.result === 'string' ? r.result : JSON.stringify(r.result) });
    return send({ jsonrpc: '2.0', id, result: { content } });
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
}
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { handle(JSON.parse(line)); } catch {} } }
});
