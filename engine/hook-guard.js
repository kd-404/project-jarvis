#!/usr/bin/env node
// Claude Code PreToolUse hook. Reads the pending tool call on stdin; exit code 2 blocks it.
// If anything about the check itself goes wrong, the call is blocked rather than waved through.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkTool, checkScript, REFUSAL } = require('./guard');

const block = (msg) => { process.stderr.write(msg); process.exit(2); };
const resolve = (p, cwd) => path.resolve(cwd || process.cwd(), String(p).replace(/^~(?=$|\/)/, os.homedir()));
const words = (seg) => (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ''));

// Look inside a script before it is run: `python clean.py`, `bash x.sh`, `./x.sh`, `node tidy.js`.
function scriptsIn(cmd, cwd) {
  const found = [];
  for (const seg of String(cmd).split(/[;&|]+/)) {
    const w = words(seg.trim()); if (!w.length) continue;
    let i = 0; while (i < w.length && (/^(sudo|env|nohup|time|exec|caffeinate|nice)$/.test(w[i]) || /^\w+=/.test(w[i]))) i++;
    const runner = path.basename(w[i] || '');
    if (/^(python[\d.]*|node|bash|sh|zsh|ruby|perl|php|deno|bun|tsx|ts-node|uv|pipenv|poetry|source|\.)$/.test(runner)) {
      for (const a of w.slice(i + 1)) { if (a === '-c' || a === '-e' || a === '-m') break; if (/^-/.test(a) || /^(run|exec)$/.test(a) || /^python[\d.]*$/.test(a)) continue; found.push(a); break; }
    } else if (/[\\/]/.test(w[i] || '') && /\.(py|js|mjs|cjs|ts|sh|bash|zsh|command|rb|pl|php)$/i.test(w[i])) found.push(w[i]);
  }
  return found.map((f) => resolve(f, cwd));
}
// `mv new old` / `cp new old` onto a file that already exists wipes what was there.
function overwrites(cmd, cwd) {
  for (const seg of String(cmd).split(/[;&|]+/)) {
    const w = words(seg.trim()); let i = 0; while (i < w.length && (/^(sudo|env|command)$/.test(w[i]) || /^\w+=/.test(w[i]))) i++;
    if (!/^(mv|cp|install|ln)$/.test(path.basename(w[i] || ''))) continue;
    const args = w.slice(i + 1).filter((a) => !/^-/.test(a)); if (args.length < 2) continue;
    const dest = resolve(args[args.length - 1], cwd);
    try { const st = fs.statSync(dest); if (st.isFile() && !args.slice(0, -1).some((a) => resolve(a, cwd) === dest)) return dest; } catch {}
  }
  return null;
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    let ev; try { ev = JSON.parse(raw); } catch { return block('Kacy guard: could not read this tool call, so it was blocked. Try again.'); }
    const input = ev.tool_input || {};
    const what = checkTool(ev.tool_name, input);
    if (what) return block(REFUSAL(what));
    if (ev.tool_name === 'Bash' && input.command) {
      for (const file of scriptsIn(input.command, ev.cwd)) {
        let text = ''; try { if (fs.statSync(file).size < 400000) text = fs.readFileSync(file, 'utf8'); } catch {}
        const w = text && checkScript(text, file);
        if (w) return block(REFUSAL(`run ${path.basename(file)}, which would ${w}`));
      }
      const dest = overwrites(input.command, ev.cwd);
      if (dest) return block(REFUSAL(`overwrite the existing file ${dest}, erasing what is in it. Write to a new file name instead`));
    }
    process.exit(0);
  } catch (e) { block('Kacy guard hit an internal error and blocked this call to stay safe: ' + e.message); }
});
