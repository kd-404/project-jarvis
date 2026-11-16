// Decides which lane a request runs in, so the expensive model is only used when it earns its cost.
//   system  = operating the computer, quick questions, errands  -> small, cheap, fast model
//   project = research, building or changing software, long writing -> the strong model
// Instant commands (engine/quick.js) never reach either lane and cost nothing.
const HEAVY = /\b(research|investigate|compare|comparison|analy[sz]e|analysis|deep dive|study|survey|literature|report on|build|implement|develop|refactor|debug|bug|train|fine.?tun\w*|architecture|part model|unit tests?|pull request|deploy|commit|(create|make|start|set ?up|scaffold|generate) (me )?(a |an |the )?(new )?(\w+ )?(project|app|application|website|web ?app|agent|model|pipeline|api|tool|game|dashboard|rag|bot|chatbot|system|library|package)|add (a |an |the )?(\w+ )?(part|feature|agent|module|endpoint|test|component|layer)|write (me )?(a |an |the )?(\w+ )?(code|script|program|function|class|tests?|paper|essay|article|report|documentation|readme|blog)|fix (the|this|my|that) (code|bug|error|test|build|project)|explain (this|the|that|how) .*(code|part|works|model|pipeline|architecture)|continue (the )?(training|build|project|work))\b/i;
const LIGHT = /^(please )?(open|launch|close|quit|click|double click|right click|press|tap|type|scroll|go to|switch|show|hide|play|pause|stop|resume|skip|next|previous|mute|unmute|volume|turn|set|look at|what'?s|what is|what are|who'?s|who is|when|where|which|how (much|many|old|far|long|do i)|tell me|remind|schedule|send|mail|email|message|text|search|google|find|check|read|take|screenshot|hi|hello|hey|thanks|thank you|can you hear|change your voice|move|drag|select|copy|paste|save|minimi[sz]e|maximi[sz]e|full ?screen|new tab|refresh|reload|back|forward|yes|no|ok|okay|nothing|never ?mind)\b/i;

function route(text, { atHome = true, mode = 'auto' } = {}) {
  if (mode === 'system' || mode === 'project') return { lane: mode, why: 'you fixed the lane' };
  const t = String(text).trim();
  if (/\b(think hard|think carefully|use the (big|best|smart|strong|large) model|take your time)\b/i.test(t)) return { lane: 'project', why: 'you asked for the strong model' };
  if (/\b(quick(ly)?|fast|use the (small|cheap|fast|light) model)\b/i.test(t) && !HEAVY.test(t)) return { lane: 'system', why: 'you asked for speed' };
  if (HEAVY.test(t)) return { lane: 'project', why: 'research or build work' };
  if (LIGHT.test(t)) return { lane: 'system', why: 'computer control or a quick question' };
  if (t.split(/\s+/).length > 30) return { lane: 'project', why: 'a long request' };
  return atHome ? { lane: 'system', why: 'no project open' } : { lane: 'project', why: 'a project is open' };
}
module.exports = { route };
