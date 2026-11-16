// Instant commands: things Kacy can do herself in well under a second, without waking Claude.
// Anything not recognised here (or that fails) falls through to Claude Code.
const https = require('https');
const { execFile } = require('child_process');

const SITES = { youtube: 'https://www.youtube.com', yt: 'https://www.youtube.com', 'you tube': 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  github: 'https://github.com', chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', whatsapp: 'https://web.whatsapp.com', instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com', netflix: 'https://www.netflix.com', twitter: 'https://x.com', x: 'https://x.com', maps: 'https://maps.google.com', 'google maps': 'https://maps.google.com',
  drive: 'https://drive.google.com', 'google drive': 'https://drive.google.com', 'hugging face': 'https://huggingface.co', huggingface: 'https://huggingface.co', kaggle: 'https://www.kaggle.com', colab: 'https://colab.research.google.com', arxiv: 'https://arxiv.org' };
const APPS = { settings: 'System Settings', 'system settings': 'System Settings', 'system preferences': 'System Settings', chrome: 'Google Chrome', 'google chrome': 'Google Chrome',
  code: 'Visual Studio Code', vscode: 'Visual Studio Code', 'vs code': 'Visual Studio Code', 'visual studio code': 'Visual Studio Code', terminal: 'Terminal', finder: 'Finder', safari: 'Safari',
  notes: 'Notes', music: 'Music', calendar: 'Calendar', mail: 'Mail', messages: 'Messages', photos: 'Photos', calculator: 'Calculator', 'app store': 'App Store', ollama: 'Ollama',
  'activity monitor': 'Activity Monitor', preview: 'Preview', reminders: 'Reminders', facetime: 'FaceTime', steam: 'Steam', 'chat gpt': 'ChatGPT' };
const GENERIC = /^(some |a |the |any |me )*(music|songs?|something|anything|a song|tunes?|playlist)?( please)?$/i;

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 8000 }, (e, out) => (e ? rej(e) : res(out))));
const openUrl = (url) => process.platform === 'darwin' ? run('open', [url]) : process.platform === 'win32' ? run('cmd', ['/c', 'start', '', url]) : run('xdg-open', [url]);
const clean = (t) => String(t).toLowerCase().replace(/[.!?,]/g, ' ').replace(/\b(please|kindly|can you|could you|will you|for me|now|hey)\b/g, ' ').replace(/\s+/g, ' ').trim();

// Find the first video for a search and return its watch link (which starts playing when opened).
function firstVideo(query, fetchPage = getPage) {
  return fetchPage('https://www.youtube.com/results?search_query=' + encodeURIComponent(query)).then((html) => {
    const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/) || html.match(/"videoId":"([\w-]{11})"/);
    if (!m) throw new Error('no video found');
    return 'https://www.youtube.com/watch?v=' + m[1];
  });
}
function getPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 7000, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; if (d.length > 3e6) req.destroy(); }); res.on('end', () => resolve(d)); res.on('close', () => resolve(d));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}

class Quick {
  constructor({ say, activity, deps = {} }) { this.say = say; this.activity = activity; this.pending = null; this.d = { openUrl, run, firstVideo, ...deps }; }
  // What kind of instant command is this? Returns null when Claude should handle it.
  parse(text) {
    const t = clean(text);
    if (/^(what(s| is)? ?(the )?time( is it)?|what time is it|time)$/.test(t)) return { kind: 'time' };
    if (/^(what(s| is)? ?(the |todays? )?date( today)?|what day is it( today)?|todays date)$/.test(t)) return { kind: 'date' };
    let m;
    if ((m = t.match(/^(?:set (?:the )?)?volume (?:to |at )?(\d{1,3})(?: percent)?$/))) return { kind: 'volume', level: Math.min(100, Number(m[1])) };
    if (/^(volume up|louder|turn it up|increase (the )?volume)$/.test(t)) return { kind: 'volume', delta: 15 };
    if (/^(volume down|quieter|softer|turn it down|decrease (the )?volume|lower (the )?volume)$/.test(t)) return { kind: 'volume', delta: -15 };
    if ((m = t.match(/^(double |right |left )?click( here| there| it| that| this)?$/))) return { kind: 'click', n: m[1] === 'double ' ? 2 : 1, btn: m[1] === 'right ' ? 'right' : 'left' };
    if (/^(mute|mute (the )?(sound|volume|mac|audio))$/.test(t)) return { kind: 'mute', on: true };
    if (/^(unmute|unmute (the )?(sound|volume|mac|audio))$/.test(t)) return { kind: 'mute', on: false };
    // "play lofi", "play some music on youtube", "open yt and play music", "put on some arijit singh"
    if ((m = t.match(/^(?:(?:open|go to|launch|start) (?:youtube|yt|you tube) (?:and |then )?)?(?:play|put on|i want to (?:hear|listen to)|listen to)\b(.*)$/))) {
      const q = m[1].replace(/\b(on|in|from|using|with) (youtube|yt|you tube)\b/g, ' ').replace(/\s+/g, ' ').trim();
      return GENERIC.test(q) ? { kind: 'askMood' } : { kind: 'play', query: q.replace(/^(some|a|the|me) /, '') };
    }
    if ((m = t.match(/^(?:open|launch|start|go to|show me|bring up)(?: up)? (?:the |my )?(.+?)(?: app| application| website| site)?$/)) && !/\b(and|then|project|file|folder|with)\b/.test(m[1])) {
      const name = m[1].trim();
      if (SITES[name]) return { kind: 'site', name, url: SITES[name] };
      if (/^[\w-]+\.(com|org|net|io|ai|in|dev|co|app)(\/\S*)?$/.test(name)) return { kind: 'site', name, url: 'https://' + name };
      if (APPS[name]) return { kind: 'app', name: APPS[name] };
      if (name.split(' ').length <= 3) return { kind: 'app', name: name.replace(/\b\w/g, (c) => c.toUpperCase()), guess: true };
    }
    if (this.pending && Date.now() < this.pending.until && t && t.split(' ').length <= 8) return { kind: 'mood', mood: t.replace(/^(i am|i'm|im|feeling|i feel|kind of|a bit|pretty|very|its|it's)\s+/g, '').replace(/^(feeling|kind of|a bit|pretty|very)\s+/g, '') };
    return null;
  }
  // Runs the command. Resolves true when handled, false to hand it to Claude.
  async handle(text) {
    const c = this.parse(text); if (!c) return false;
    const mac = process.platform === 'darwin';
    try {
      switch (c.kind) {
        case 'time': this.say('It is ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'); return true;
        case 'date': this.say('It is ' + new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + '.'); return true;
        case 'site': this.activity('Opening ' + c.name); await this.d.openUrl(c.url); this.say('Opening ' + c.name + '.'); return true;
        case 'app': if (!mac) return false; this.activity('Opening ' + c.name); await this.d.run('open', ['-a', c.name]); this.say('Opening ' + c.name + '.'); return true;
        case 'volume': if (!mac) return false;
          if (c.level != null) await this.d.run('osascript', ['-e', `set volume output volume ${c.level}`]);
          else await this.d.run('osascript', ['-e', `set volume output volume ((output volume of (get volume settings)) + ${c.delta})`]);
          this.activity('Volume ' + (c.level != null ? c.level + '%' : c.delta > 0 ? 'up' : 'down')); return true;
        case 'mute': if (!mac) return false; await this.d.run('osascript', ['-e', `set volume output muted ${c.on}`]); this.activity(c.on ? 'Muted' : 'Unmuted'); return true;
        case 'click': if (!this.d.click || !this.d.click(c.n, c.btn)) return false; this.activity((c.n === 2 ? 'Double click' : c.btn === 'right' ? 'Right click' : 'Click') + ' at the cursor'); return true;
        case 'askMood': this.pending = { until: Date.now() + 45000 }; this.say("What's your mood?"); return true;
        case 'mood': this.pending = null; return this.play(c.mood + ' music mix', c.mood);
        case 'play': this.pending = null; return this.play(c.query, c.query);
      }
    } catch (e) { if (c.kind === 'app' && c.guess) return false; this.activity('Could not do that myself, asking Claude'); return false; }
    return false;
  }
  async play(query, label) {
    this.activity('Finding "' + label + '" on YouTube');
    try { const url = await this.d.firstVideo(query); await this.d.openUrl(url); this.say('Playing ' + label + '.'); }
    catch { await this.d.openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(query)); this.say('I opened the results for ' + label + '. Pick one.'); }
    return true;
  }
}
module.exports = { Quick, firstVideo };
