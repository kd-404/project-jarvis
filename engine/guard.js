// Kacy's hard rule: she never deletes, formats or erases. Those actions belong to the user.
// Shared by the Claude Code hook (hook-guard.js) and the Mac control driver.
//
// The check is deliberately strict: when a command could remove or wipe something, or hides what it
// runs (eval, a command inside a variable, text piped into a shell), it is refused and handed to the user.

// Commands that only ever remove things: refused wherever they appear as a word.
const ALWAYS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'rimraf', 'wipefs', 'dropdb', 'dropuser', 'gshred', 'grm']);
// Refused when they are the command being run (they are ordinary words elsewhere).
const AS_COMMAND = new Set(['del', 'erase', 'rd', 'trash', 'truncate', 'eval', 'fdisk', 'parted', 'gparted', 'asr', 'format', 'purge']);
const WRAPPERS = new Set(['sudo', 'env', 'nohup', 'time', 'command', 'exec', 'builtin', 'nice', 'ionice', 'xargs', 'then', 'do', 'else', 'doas', 'caffeinate', 'arch', 'stdbuf', 'timeout', 'watch', 'busybox', 'unbuffer']);
const TEXT_ONLY = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'man', 'which', 'type', 'whatis', 'apropos', 'help', 'tldr', 'whereis']);
const SHELLS = /^(sh|bash|zsh|dash|ksh|fish|tcsh|csh)$/;

const RULES = [
  [/\bfind\b.*\s-(delete|exec(dir)?\s+\S*(rm|unlink|shred))\b/, 'find and delete'],
  [/\bmk(fs|e2fs|swap)\b|\bnewfs/, 'format a disk'],
  [/\bdiskutil\s+(\w+\s+)?(erase\w*|reformat|partitiondisk|zerodisk|randomdisk|secureerase|delete\w*|resetfusion|unmountdisk\s+force)/, 'erase or format a disk'],
  [/\bformat\s+[a-z]:|\bformat-volume\b|\bclear-disk\b/, 'format a drive'],
  [/\bdd\b.*\bof=/, 'overwrite a device or file with dd'],
  [/>\|/, 'force-overwrite a file'],
  [/(^|[;&|(]\s*)>\s*[^\s&|>]/, 'empty a file with a bare redirect'],
  [/(^|[;&|(]\s*)(:|true|echo(\s+-n)?|printf|cat\s+\/dev\/null)\s*>\s*[^\s&>]/, 'empty a file by writing nothing into it'],
  [/\btee\b[^|;&]*<\s*\/dev\/null/, 'empty a file through tee'],
  [/\bsed\b.*\s-\w*i\S*\s+(\S+\s+)*?(1,\$d|d|\$d)(\s|$)/, 'erase a file\'s contents with sed'],
  [/\bgit\b[^|;&]*?\s(clean|rm|filter-branch|filter-repo)(\s|$)/, 'delete files or history with git'],
  [/\bgit\b[^|;&]*?\sreset\s+.*--(hard|merge|keep)\b/, 'discard work with git reset'],
  [/\bgit\b[^|;&]*?\scheckout\b.*(\s--(\s|$)|\s\.(\s|$)|\s-f\b|\s--force\b)/, 'discard changes with git checkout'],
  [/\bgit\b[^|;&]*?\srestore\b(?!.*--staged)(?!\s*$)/, 'discard changes with git restore'],
  [/\bgit\b[^|;&]*?\srestore\b.*--worktree/, 'discard changes with git restore'],
  [/\bgit\b[^|;&]*?\sstash\s+(drop|clear)\b/, 'delete stashed work'],
  [/\bgit\b[^|;&]*?\s(branch|tag)\s+.*(-d\b|-D\b|--delete\b)/i, 'delete a branch or tag'],
  [/\bgit\b[^|;&]*?\spush\b.*(--force|-f\b|--delete|--mirror|--prune|\s:\S|\s\+\S)/, 'force-push or delete on the remote'],
  [/\bgit\b[^|;&]*?\s(reflog\s+(expire|delete)|gc\b.*--prune|prune\b|update-ref\s+-d|worktree\s+(remove|prune)|remote\s+(remove|rm)|submodule\s+deinit|notes\s+remove)/, 'delete git data'],
  [/\b(drop\s+(table|database|schema|index|view|collection|user|role)|truncate(\s+table)?\s+\w|delete\s+from)\b/, 'delete database data'],
  [/\b(flushall|flushdb|dropdatabase|deletemany|deleteone|drop_all|drop_collection)\b|\.drop\(\)/, 'delete database data'],
  [/(\bos\.(remove|unlink|rmdir|removedirs)|\bshutil\.rmtree|rmtree\(|\.unlink\(|\.rmdir\(|\.rmtree\(|fs\.(rm|unlink|rmdir)\w*|rmsync|unlinksync|rmdirsync|remove-item|file\.delete|directory\.delete|fileutils\.rm\w*|files\.delete\w*|deletefile|removefile|send2trash)/, 'delete files from a script'],
  [/\b(python\d?(\.\d+)?|node|deno|bun|perl|ruby|php|osascript|lua|swift)\b.*\s-(c|e|r|pe|ne)\b.*(os\.system|subprocess|popen|child_process|execsync|spawnsync|\bexec\w*\(|\bsystem\s*\(|shell_exec|passthru|do shell script|`)/, 'run hidden shell commands from an inline script'],
  [/\brsync\b.*--(delete\w*|remove-source-files|del\b)/, 'delete files with rsync'],
  [/\btar\b.*--remove-files|\bzip\b.*\s(-\w*m\w*|--move)(\s|$)|\bgzip\b|\bbzip2\b|\bxz\b(?!.*(-k|--keep|-c|--stdout|-d.*-c|-l|--list|-t\b))/, 'remove the original file while archiving'],
  [/\bdocker\s+(compose\s+)?((system|volume|image|container|builder|network)\s+(prune|rm)|rm\b|rmi\b|down\b.*(-v\b|--volumes|--rmi)|prune\b)|\bdocker-compose\s+(rm\b|down\b.*(-v\b|--volumes|--rmi))/, 'delete docker data'],
  [/\b(kubectl|oc)\s+.*\bdelete\b|\bhelm\s+(uninstall|delete)\b|\bterraform\s+(destroy|.*-destroy)|\bpulumi\s+destroy/, 'destroy infrastructure'],
  [/\b(pip\d?(\.\d+)?|pipx|npm|yarn|pnpm|bun|brew|conda|mamba|apt|apt-get|dnf|yum|pacman|gem|cargo|go|uv|poetry|port|snap|choco|winget|scoop)\s+(\S+\s+)*(uninstall|remove|purge|autoremove|prune|cleanup|autoclean|unlink|rm)\b/, 'uninstall or remove software'],
  [/\b(make|cargo|go|gradle|\.\/gradlew|gradlew|mvn|bazel|dotnet|flutter|xcodebuild|ant|cmake\s+--build\s+\S+\s+--target)\s+(\S+\s+)*(clean|distclean|mrproper|clobber|purge)\b/, 'clean build outputs, which deletes files'],
  [/\b(npm|yarn|pnpm|bun)\s+(run\s+)?(clean|clear|reset|purge|nuke|wipe|distclean)\b/, 'run a clean script, which deletes files'],
  [/\b(npm|yarn|pnpm)\s+cache\s+(clean|clear)|\bpip\d?\s+cache\s+purge|\bconda\s+clean\b|\bbrew\s+(cleanup|autoremove)\b/, 'purge a cache'],
  [/\.trash\b|\btrash-put\b|\bgio\s+trash\b/, 'move things to the Trash'],
  [/\bosascript\b.*\b(delete|trash|erase|remove|empty)\b/, 'delete through AppleScript'],
  [/\b(defaults\s+delete|launchctl\s+(remove|bootout|unload\s+-w)|tmutil\s+delete\w*|crontab\s+(-\w*r\w*)(\s|$)|history\s+-c|xattr\s+-\w*[cd]\w*\s|dscl\s+.*-delete|security\s+delete-\w+|pkgutil\s+--forget|nvram\s+-[cd]|csrutil\s+clear|sqlite3\b.*\.(clear|drop))/, 'erase system data or settings'],
  [/\baws\s+s3\s+(rm|rb)\b|\baws\s+s3api\s+delete|\baws\s+\S+\s+(delete|terminate|deregister|remove)-|\b(gsutil|gcloud\s+storage)\s+(-\S+\s+)*(rm|rb)\b|\bgcloud\s+.*\bdelete\b|\baz\s+.*\bdelete\b|\bgh\s+\w+\s+delete\b|\bgh\s+api\b.*(-x|--method)\s*delete|\bcurl\b.*(-x|--request)\s*delete|\b(firebase|vercel|netlify|heroku|fly|flyctl|supabase|wrangler)\s+.*\b(delete|destroy|remove|rm)\b/, 'delete something in the cloud'],
  [/\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish)\b(\s|$)/, 'pipe generated text into a shell, which hides what will run'],
  [/\b(source|\.)\s+<\(|\bbash\s+<\(/, 'run generated text as a script, which hides what will run'],
];

// Strip the pieces that cannot run anything, and undo the quoting tricks that hide a command name.
function normalise(cmd) {
  let t = String(cmd || '');
  t = t.replace(/(\s(-\w*m|--message)(\s+|=))("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1MSG'); // commit messages are just text
  t = t.replace(/\\\n/g, ' ');
  t = t.replace(/(\d|&)?>>?\s*\/dev\/null/g, ' ').replace(/<\s*\/dev\/null(?![^|;&]*\btee\b)/g, (m, off, all) => (/\btee\b[^|;&]*$/.test(all.slice(0, off)) ? m : ' '));
  t = t.replace(/\$'([^']*)'/g, '$1').replace(/["']/g, '').replace(/\\(?=\S)/g, '');   // r""m, 'rm', \rm  ->  rm
  return t.replace(/\s+/g, ' ').trim();
}

function checkShell(cmd) {
  const raw = String(cmd || '');
  if (!raw.trim()) return null;
  const t = normalise(raw), low = t.toLowerCase();
  if (/\/dev\/null/.test(low)) return 'use /dev/null to empty or throw away a file';
  if (/\$\(|`/.test(raw.replace(/(\s(-\w*m|--message)(\s+|=))("(?:[^"\\]|\\.)*"|'[^']*')/g, '')) && /(^|[;&|(]\s*)(\$\(|`)/.test(raw)) return 'run a command built at run time, which hides what will run';
  for (const [re, what] of RULES) if (re.test(low)) return what;
  // walk the words: anything in ALWAYS anywhere, anything in AS_COMMAND when it is the command
  const words = low.split(/(\s+|[;&|(){}]+)/).filter((w) => w.trim());
  let atCommand = true, textOnly = false; // textOnly: arguments of echo, grep, man... are just text
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^[;&|(){}]+$/.test(w)) { atCommand = true; textOnly = false; continue; }
    const base = w.replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
    if (ALWAYS.has(atCommand ? base : w) && !textOnly) return 'remove files';
    if (atCommand) {
      if (TEXT_ONLY.has(base)) textOnly = true;
      if (/^\w+=/.test(w)) { if (ALWAYS.has(w.split('=')[1]) || AS_COMMAND.has(w.split('=')[1])) return 'hide a delete command in a variable'; continue; } // VAR=value prefix
      if (/^\$/.test(w)) return 'run a command held in a variable, which hides what will run';
      if (AS_COMMAND.has(base)) return base === 'eval' ? 'run text as a command with eval, which hides what will run' : 'remove or erase data';
      if (WRAPPERS.has(base)) { continue; }           // sudo rm, xargs rm, env rm ...
      if (/^-/.test(w) && i > 0 && WRAPPERS.has(words[i - 1].replace(/^.*[\\/]/, ''))) continue; // sudo -u x rm
      if (SHELLS.test(base)) { continue; }            // sh -c rm x : keep looking for the inner command
      if (/^-\w*c$/.test(w)) continue;
    }
    atCommand = false;
  }
  return null;
}

// Key combinations that delete things in macOS / Windows apps.
function checkKeys(combo) {
  const k = String(combo || '').toLowerCase().replace(/\s+/g, '');
  const parts = k.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const del = ['backspace', 'delete', 'del', 'forwarddelete', '⌫', '⌦'].includes(key);
  if (del && mods.length) return 'a delete shortcut';
  if (['delete', 'del', 'forwarddelete', '⌦'].includes(key)) return 'the Delete key';
  return null;
}

// Buttons and menu items Kacy must never press.
function checkLabel(label, app = '') {
  const l = String(label || '').toLowerCase();
  if (/\b(delete|erase|trash|bin|remove|discard|uninstall|wipe|purge|destroy|don'?t save|clear (all|history|data|browsing|cache|cookies|recents?)|reset (all|settings|to factory|network|this mac)|restore (factory|defaults)|empty|shred|unlink account|sign out and (remove|erase)|revert( to)?( saved| original)?)\b/.test(l)) return `press "${label}"`;
  if (/\bformat\b/.test(l) && (/disk utility/i.test(app) || /\b(disk|drive|volume|card|partition|usb)\b/.test(l))) return `press "${label}"`;
  if (/\b(partition|initiali[sz]e)\b/.test(l) && /disk utility/i.test(app)) return `press "${label}"`;
  return null;
}

// What a script file does when it is run: used by the hook to look inside `python x.py`, `bash x.sh`, `node x.js`.
function checkScript(text, file = '') {
  const t = String(text || '');
  if (/\.(sh|bash|zsh|command)$/i.test(file) || /^#!.*\b(sh|bash|zsh)\b/.test(t)) {
    for (const line of t.split('\n')) { if (/^\s*#/.test(line)) continue; const w = checkShell(line); if (w) return w; }
    return null;
  }
  const m = t.toLowerCase().match(/(\bos\.(remove|unlink|rmdir|removedirs)|\bshutil\.rmtree|rmtree\(|\.unlink\(|\.rmdir\(|fs\.(rm|unlink|rmdir)\w*|fspromises\.(rm|unlink|rmdir)|rmsync|unlinksync|rmdirsync|rimraf|file\.delete|fileutils\.rm\w*|send2trash|drop\s+(table|database)|delete\s+from|truncate\s+table)/);
  return m ? `delete data (the script calls ${m[0].replace(/\($/, '')})` : null;
}

// Used by the Claude Code PreToolUse hook. Returns a reason string when the call must be blocked.
function checkTool(toolName, input = {}) {
  const name = String(toolName || '');
  if (name === 'Bash' || /shell|terminal|exec|powershell/i.test(name)) {
    const w = checkShell(input.command || input.cmd || input.script || '');
    if (w) return w;
  }
  if (name === 'Write' && typeof input.content === 'string' && input.content.trim() === '') return 'erase a file by writing empty content';
  if (name === 'NotebookEdit' && String(input.edit_mode || '').toLowerCase() === 'delete') return 'delete a notebook cell';
  if (/keyboard_type/.test(name)) { const w = checkShell(input.text); if (w) return w; }
  if (/keyboard_key/.test(name)) { const w = checkKeys(input.combo); if (w) return 'press ' + w; }
  if (/ui_click/.test(name)) { const w = checkLabel(input.label, input.app); if (w) return w; }
  return null;
}

const REFUSAL = (what) =>
  `BLOCKED by Kacy's no-delete rule: this would ${what}. Kacy never deletes, formats or erases anything. ` +
  `Do not look for another way to do it. Call the request_user_delete tool with what needs removing and the exact command, then continue with the rest of the task.`;

module.exports = { checkShell, checkKeys, checkLabel, checkScript, checkTool, REFUSAL, normalise };
