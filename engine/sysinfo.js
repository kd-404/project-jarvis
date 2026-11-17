'use strict';
// Live machine load for the bottom bar: whole-Mac CPU and memory, plus what Kacy itself and her brain
// processes are using. Read-only: it only runs vm_stat and ps, never changes anything.
const os = require('os');
const { execFile } = require('child_process');

const run = (cmd, args) => new Promise((ok) => execFile(cmd, args, { timeout: 1500 }, (e, out) => ok(e ? '' : String(out))));

let prevCpu = null;
function cpuPercent() { // share of all cores busy since the last call
  const now = os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
  const prev = prevCpu; prevCpu = now;
  if (!prev || now.total <= prev.total) return null;
  return Math.max(0, Math.min(100, 100 * (1 - (now.idle - prev.idle) / (now.total - prev.total))));
}

// os.freemem() on macOS leaves out cached files the system can drop at once, so it makes an 8 GB Mac look
// full all the time. vm_stat gives the same "memory used" figure Activity Monitor shows.
async function memory() {
  const total = os.totalmem();
  if (process.platform === 'darwin') {
    const out = await run('vm_stat', []);
    const page = Number((out.match(/page size of (\d+)/) || [])[1]) || 16384;
    const get = (k) => Number((out.match(new RegExp(k + ':\\s+(\\d+)')) || [])[1]) || 0;
    if (out) {
      const used = (get('Pages active') + get('Pages wired down') + get('Pages occupied by compressor') - get('Pages purgeable')) * page;
      return { used: Math.max(0, Math.min(total, used)), total };
    }
  }
  return { used: total - os.freemem(), total };
}

async function procs(pids) { // cpu % and resident memory for the brain processes
  const list = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (!list.length || process.platform === 'win32') return { cpu: 0, mem: 0, count: 0 };
  const out = await run('ps', ['-o', '%cpu=,rss=', '-p', list.join(',')]);
  let cpu = 0, mem = 0, count = 0;
  for (const line of out.trim().split('\n')) { const [c, r] = line.trim().split(/\s+/).map(Number); if (Number.isFinite(c)) { cpu += c; mem += (r || 0) * 1024; count++; } }
  return { cpu, mem, count };
}

let prevSelf = null;
function self() {
  const now = { t: process.hrtime.bigint(), u: process.cpuUsage() }, prev = prevSelf; prevSelf = now;
  const mem = process.memoryUsage().rss;
  if (!prev) return { cpu: 0, mem };
  const wall = Number(now.t - prev.t) / 1000; // microseconds
  const used = now.u.user - prev.u.user + now.u.system - prev.u.system;
  return { cpu: wall > 0 ? 100 * used / wall : 0, mem };
}

let cache = null, cacheAt = 0;
async function stats(brainPids = []) {
  if (cache && Date.now() - cacheAt < 900) return cache; // several windows polling share one reading
  const [mem, brain] = await Promise.all([memory(), procs(brainPids)]);
  const cpu = cpuPercent();
  cache = { cpu: cpu == null ? (cache ? cache.cpu : 0) : Math.round(cpu), cores: os.cpus().length, mem, kacy: self(), brain, load: os.loadavg()[0], at: Date.now() };
  cacheAt = Date.now();
  return cache;
}

module.exports = { stats };
