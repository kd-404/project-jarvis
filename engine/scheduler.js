// "Kacy, continue the training at 5 pm": jobs that fire later. The computer must be awake and Kacy running.
const fs = require('fs');
const os = require('os');
const path = require('path');

class Scheduler {
  constructor({ run, emit }) {
    this.run = run; this.emit = emit;
    this.file = path.join(os.homedir(), '.kacy', 'schedule.json');
    this.jobs = [];
    try { this.jobs = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.timer = setInterval(() => this.tick(), 15000);
    this.timer.unref?.();
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.jobs, null, 2)); this.emit('schedule', this.list()); }
  list() { return this.jobs.slice(-30); }
  add({ when, instruction, project }) {
    const at = new Date(when);
    if (!instruction || isNaN(at)) throw new Error('schedule_task needs an ISO time in "when" and an "instruction"');
    if (at.getTime() < Date.now() - 60000) throw new Error(`that time (${at.toString()}) is already in the past`);
    const job = { id: 'job-' + Date.now().toString(36), at: at.toISOString(), instruction, project, status: 'waiting' };
    this.jobs.push(job); this.save();
    return job;
  }
  cancel(id) { const j = this.jobs.find((x) => x.id === id); if (j && j.status === 'waiting') { j.status = 'cancelled'; this.save(); } return j; }
  tick(now = Date.now()) {
    for (const j of this.jobs) {
      if (j.status !== 'waiting' || new Date(j.at).getTime() > now) continue;
      j.status = 'ran'; j.ranAt = new Date(now).toISOString();
      this.save();
      this.run(j);
    }
  }
}
module.exports = { Scheduler };
