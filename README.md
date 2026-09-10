# Vision Dino – 3-Player Gesture Endless Runner

A browser-based endless runner game controlled entirely by **face and hand gestures**, designed for **three players sharing a single webcam**.

## Features

- **Three simultaneous players** — each occupies one third of the webcam frame.
- **Gesture controls** — no keyboard or mouse needed:
  - **Jump** — raise an open hand above your face, or raise your eyebrows quickly.
  - **Duck** — lower your chin toward your chest, or lower your hand below your face.
- **Dino-style obstacles** — tall cacti (jump over), low rocks (duck or jump), and flying birds (duck under).
- **Progressive difficulty** — game speed increases gradually as your score rises.
- **Last-player-standing** — the game ends when only one (or zero) players remain.
- **Zero build step** — pure HTML/CSS/JS loaded via CDN (MediaPipe).

## How to Play

1. Open `index.html` in a modern browser (Chrome/Edge recommended for best MediaPipe performance).
2. Click **📷 Enable Camera** and grant webcam permission.  Wait for MediaPipe to load (~5 s on a fast connection).
3. Have all three players position themselves so each occupies roughly one third of the webcam's field of view:
   - **Left third** → Player 1
   - **Centre third** → Player 2
   - **Right third** → Player 3
4. Click **▶ Start Game**.
5. Use gestures to control your character:

| Gesture | Action |
|---------|--------|
| Raise open hand above face, or raise eyebrows | **Jump** — clears tall cacti and rocks |
| Lower chin to chest, or lower hand below face | **Duck** — passes under flying birds |

6. Avoid the obstacles.  Each hit eliminates that player.  The last survivor wins!
7. Click **↺ Restart** or **Play Again** to start a new round.

## Running Locally

Simply serve the directory with any static HTTP server — the `file://` protocol is not recommended because some browsers restrict camera access on file URIs.

```bash
# Python 3
python -m http.server 8080
# then open http://localhost:8080
```

## Technical Overview

| File | Purpose |
|------|---------|
| `index.html` | Main entry point — layout, MediaPipe CDN scripts, UI logic |
| `game.js` | Core runner engine — physics, obstacles, collision, rendering |
| `gesture.js` | Webcam gesture detection using MediaPipe FaceMesh + Hands |
| `style.css` | Responsive 3-panel layout and visual theme |

### Gesture Detection

`gesture.js` feeds frames from the webcam through two MediaPipe models:

- **FaceMesh** (3 faces max) — brow-raise → jump, chin-drop → duck.
- **Hands** (6 hands max) — wrist above/below face centre → jump/duck.

The video frame is split into three equal horizontal zones; detected faces and hands are assigned to the zone containing their horizontal centre.  A short hold-off filter (3 frames) prevents gesture flicker.

## Browser Compatibility

Tested in Chrome 120+.  Requires a browser with:
- `getUserMedia` (webcam access)
- ES Module support (`type="module"`)
- WebGL (for MediaPipe WASM backend)