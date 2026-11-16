// The project graph: the single source of truth the desk renders. Lives at <project>/.kacy/graph.json
const fs = require('fs');
const path = require('path');
const TYPES = ['llm', 'agent', 'encoder', 'retriever', 'database', 'api', 'tool', 'ui', 'data', 'trainer', 'sensor', 'actuator', 'service', 'generic'];
const STATUSES = ['planned', 'building', 'ready', 'error', 'retired'];

class Graph {
  constructor() { this.dir = null; this.data = { name: 'untitled', parts: [], links: [] }; }
  file() { return path.join(this.dir, '.kacy', 'graph.json'); }
  load(dir) {
    this.dir = dir;
    this.data = { name: path.basename(dir) === 'home-base' ? 'home base' : path.basename(dir), parts: [], links: [] };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file(), 'utf8'))); } catch {}
    return this.data;
  }
  save() {
    if (!this.dir) return;
    fs.mkdirSync(path.dirname(this.file()), { recursive: true });
    fs.writeFileSync(this.file(), JSON.stringify(this.data, null, 2));
  }
  slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part'; }
  addPart({ id, name, type, description, files, status }) {
    if (!name && !id) throw new Error('a part needs a name');
    id = this.slug(id || name);
    let p = this.data.parts.find((x) => x.id === id);
    if (!p) { p = { id, status: 'planned', files: [] }; this.data.parts.push(p); }
    if (name) p.name = name;
    p.name = p.name || id;
    p.type = TYPES.includes(type) ? type : p.type || 'generic';
    if (description) p.description = description;
    if (Array.isArray(files)) p.files = [...new Set([...(p.files || []), ...files])];
    if (STATUSES.includes(status)) p.status = status;
    this.save();
    return p;
  }
  connect({ from, to, label, where, how }) {
    from = this.slug(from); to = this.slug(to);
    for (const id of [from, to]) if (!this.data.parts.find((p) => p.id === id)) throw new Error(`no part called "${id}" on the desk`);
    let l = this.data.links.find((x) => x.from === from && x.to === to);
    if (!l) { l = { from, to }; this.data.links.push(l); }
    if (label) l.label = label;
    if (where) l.where = String(where);
    if (how) l.how = String(how);
    this.save();
    return l;
  }
  setStatus({ id, status, note }) {
    const p = this.data.parts.find((x) => x.id === this.slug(id));
    if (!p) throw new Error(`no part called "${id}" on the desk`);
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    p.status = status; if (note) p.note = note;
    this.save();
    return p;
  }
  partForFile(file) {
    if (!this.dir || !file) return null;
    const rel = path.relative(this.dir, path.resolve(this.dir, file));
    return this.data.parts.find((p) => (p.files || []).some((f) => rel === f || rel.startsWith(f.replace(/\/?$/, '/')))) || null;
  }
}
module.exports = { Graph, TYPES, STATUSES };
