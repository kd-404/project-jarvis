# Kacy Desk

A voice and gesture driven 3D engineering desk on top of Claude Code. Every component of a
project is a physical part on the bench, wired to the parts it talks to. Kacy writes the code,
keeps the model true, can see your screen, use the mouse and keyboard, and run tasks on a schedule.

## Run

    cd ~/projects/kacy-desk
    node kacy.js            # or double-click Kacy.command

Needs Node 18+ and Claude Code installed and signed in (`claude` must work in Terminal).
No `npm install`: the engine and the 3D renderer have zero dependencies.

The desk opens in its own window (Chrome/Edge app window if installed, otherwise your default
browser). Pick a project from the hangar (top left), then say "Kacy, ..." or type.

## Permissions macOS will ask for (once)

| Feature | Grant to | Where |
|---|---|---|
| Wake word | Microphone, for Google Chrome | macOS prompt, first launch |
| Hand gestures | Camera, for Google Chrome | macOS prompt, first use |
| "Look at my screen" | Screen & System Audio Recording, for Terminal | System Settings > Privacy & Security |
| Mouse and keyboard | Accessibility, for Terminal | System Settings > Privacy & Security |

## Controls

- Voice: "Kacy, add a retriever agent between the encoder and the LLM" / "Kacy, look at my screen,
  what is this error?" / "Kacy, continue the training at 5 pm" / "Kacy, stop".
- Instant desk commands: explode, assemble, zoom in, zoom out, reset view, run mode, stop.
- Air mouse (button in the top bar, on by default with gestures): your hand moves the real Mac
  cursor in every app. Index finger up = move. Pinch thumb and index = click; keep pinching and
  move = drag. Thumb to middle finger = right click. Index and middle up, move up/down = scroll.
  Inside the desk the same pinch selects parts and drags the model. Air mouse off = a pointer that
  lives only inside the desk.
- Two hands pinched, pull apart / push together = expand / shrink the model.
- Open hand swiped sideways = next / previous desktop. Open hand held still = all windows; close
  the hand into a fist afterwards = back to the window you were in. Fist held (otherwise) = stop.
  These need "Hands: on", Accessibility permission for Terminal, and the Kacy window left open.
- Mouse: drag to orbit, scroll to zoom, click a part to inspect, double-click to explode.
- Keys: E explode, Space talk, Esc stop.
- "Hands: on / Eyes only" switches whether Kacy may use the mouse and keyboard.

## The no-delete rule

Kacy never deletes, formats or erases. Three layers enforce it:

1. `engine/hook-guard.js` is a Claude Code PreToolUse hook that blocks destructive shell commands
   (rm, rmdir, find -delete, diskutil erase, mkfs, dd of=, git reset --hard, force push, DROP TABLE,
   uninstall, emptying a file, ...) before they run.
2. `engine/control.js` refuses to type such commands or press delete shortcuts.
3. The system prompt forbids clicking Delete / Erase / Format / Trash buttons in any app.

When something needs removing, Kacy lists it under "Your hands only" with the exact command, for
you to run yourself. Layer 3 is an instruction, not a lock: a click on a Delete button in a GUI
cannot be intercepted, so use "Eyes only" when you want certainty.

## Layout

    kacy.js                launcher
    engine/server.js       local server (127.0.0.1 only), events, API
    engine/brain.js        Claude Code bridge (headless, streaming)
    engine/mcp-server.js   tools Claude gets: desk, screen, mouse, keyboard, schedule
    engine/graph.js        project graph -> <project>/.kacy/graph.json
    engine/control.js      macOS eyes and hands (Windows/Linux drivers not written yet)
    engine/scheduler.js    timed tasks (Mac must be awake, Kacy running)
    engine/guard.js        no-delete rules
    ui/index.html          the desk
    test/engine.test.js    npm test

State lives in `~/.kacy/`. Scheduled tasks only fire while Kacy is running and the Mac is awake.

## Sound and troubleshooting

Kacy speaks through the macOS `say` command, so her voice does not depend on the browser.
She listens through Chrome's speech recognition, in a dedicated Chrome window with its own profile
(`~/.kacy/chrome-profile`). Only the newest Kacy window is live; older ones retire themselves. The bottom-left line of the desk shows what the microphone hears.
Voice, gesture and brain errors are written to `kacy.log` in this folder.

## Speed and visibility

- One Claude Code process stays running per folder and is started ahead of time, so requests do
  not pay the start-up cost and the conversation carries on between requests.
- Instant commands skip Claude entirely (`engine/quick.js`): open an app or a known site, play
  something on YouTube, volume, mute, time and date. "Play some music" asks your mood first.
- The Live activity panel lists every step as it happens (searching the web, reading a file,
  running a command), with a timer. The same lines go to `kacy.log`.
- After Kacy speaks, the microphone stays open for a few seconds so you can reply without the
  wake word.
- To use a faster or different model, add `"model": "<name>"` to `~/.kacy/config.json`.

## Two lanes, two models

Requests are routed by `engine/router.js`:

| Where it runs | What goes there | Model |
|---|---|---|
| Instant (`quick.js`) | open, play, volume, click, time | none, zero tokens |
| System lane (left) | Mac control, quick questions, errands | small and cheap (default `haiku`) |
| Project lane (right) | research, building, long writing | your strong model |

The lanes run in parallel, so a build never blocks "play some music" or "click Wi-Fi". Each lane
shows its own live activity, model, tokens and cost. The project lane's process is released after
four idle minutes to give memory back. Say "think hard about ..." to force the strong model, or
"quickly ..." for the small one.

**Controls** (top bar) holds the model for each lane, the routing mode, air-mouse speed,
steadiness, pinch sensitivity, hold-to-drag time, and the clap switch. If a model name is not
accepted by your Claude Code, that lane falls back to your default and says so.

## Clap and air mouse

- Double clap = gestures and air mouse on or off (uses the microphone; tune loudness in Controls).
- Quick pinch = click. The cursor freezes while you pinch, so the click lands where you aimed.
  Two quick pinches = double click. Pinch and hold = drag; open your fingers to drop.
- Or say "click", "double click", "right click" to click wherever the cursor is.
