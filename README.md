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
- Instant desk commands (no model, no delay), by voice or typed: explode, assemble, zoom in / out,
  top / front / side view, rotate left / right, spin on / off, enable / disable air mouse,
  gestures on / off, air mouse faster / slower, hide / show panels ("hide the left panel",
  "focus mode"), show / hide help, open / close controls, show / hide CPU, "how is my CPU",
  float the camera, stop listening, stop.
- Air mouse (on by default with gestures): your hand moves the real Mac cursor in every app.
  One pose = one job, nothing depends on timing:

  | Pose | Does |
  |---|---|
  | index finger up | move the cursor |
  | pinch thumb and index | click (twice fast = double click) |
  | close your hand (grab) | hold the mouse button down: move to select text, drag a window, turn the desk; open the hand to let go |
  | three fingers up | right click |
  | two fingers up | scroll, move up or down |
  | open hand, swipe / hold | next or previous desktop / all windows |

  Prefer the old way? Controls > "Drag and select with" > "Hold the pinch".
- Air mouse off, the same poses work on the desk: grab = rotate, pinch = select a part, two
  fingers up / down = zoom, both hands pinched = explode / assemble.
- Floating camera: while gestures are on, the camera preview floats above every app and tab
  (Chrome picture-in-picture). Chrome needs one click or key press on the desk to open it.
- The side panels minimize to thin edge tabs (arrow in each panel header, or the [ and ] keys).
  A tab lights up when new activity arrives. Gesture and voice help lives behind the ? button.
- The bottom bar shows Mac CPU, memory (the figure Activity Monitor uses), and what Kacy and her
  brain processes use. Say "hide CPU" to remove it.
- Mouse: drag to orbit, scroll to zoom, click a part to inspect, double-click to explode.
- Keys: E explode, Space talk, [ and ] panels, ? help, Esc stop.
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
- Speech recognition uses Indian English. If Chrome's speech service cannot be reached, Kacy
  retries with growing pauses (1s up to 30s) instead of twice a second, and switches to Chrome's
  on-device recognition when the Mac supports it.
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
steadiness, pinch sensitivity, drag style, the floating camera, and the clap switch. If a model name is not
accepted by your Claude Code, that lane falls back to your default and says so.

## Clap and air mouse

- Double clap = gestures and air mouse on or off (uses the microphone; tune loudness in Controls).
- Pinch = click. The cursor freezes while you pinch, so the click lands where you aimed.
  Two quick pinches = double click. Grab (close your hand) = drag; open it to drop.
- Or say "click", "double click", "right click" to click wherever the cursor is.
