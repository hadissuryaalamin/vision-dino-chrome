// Dev-only playground for the game module: http://localhost:5173/src/game/playground/
// Not part of the production build (decision O-09). The real app wiring lives in src/app.
import { createGame, createKeyboardInputSource, type GameConfig } from "../index";
import type { GameEvent } from "../../shared";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const statusLine = document.querySelector<HTMLElement>("#status");
const log = document.querySelector<HTMLOListElement>("#log");
if (!canvas || !statusLine || !log) throw new Error("Playground markup is missing");

const params = new URLSearchParams(window.location.search);
const seedParam = params.get("seed");
const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : undefined;
const config: Partial<GameConfig> =
  params.get("roundEnd") === "first-crash" ? { roundEnd: "first-crash" } : {};

const game = createGame({ canvas, seed, config });
const keyboard = createKeyboardInputSource({ target: window });
keyboard.subscribe((action) => game.jumpPlayer(action.playerId));
void keyboard.start();

function describeEvent(event: GameEvent): string {
  const time = `${(event.elapsedMs / 1000).toFixed(2)} s`;
  switch (event.type) {
    case "status-changed":
      return `${time}  status ${event.previous} → ${event.status}`;
    case "player-jumped":
      return `${time}  P${event.playerId} jumped`;
    case "player-crashed":
      return `${time}  P${event.playerId} crashed with ${event.score}`;
    case "game-over":
      return `${time}  game over: ${
        event.result.winner === null ? "tie" : `Player ${event.result.winner} wins`
      } (${event.result.scores[1]} : ${event.result.scores[2]})`;
  }
}

function updateStatus(): void {
  const { status } = game.getSnapshot();
  const hint =
    status === "ready"
      ? "Press Enter to start."
      : status === "game-over"
        ? "Press Enter to play again."
        : status === "paused"
          ? "Press P to resume."
          : "W and ↑ jump. P pauses.";
  statusLine!.textContent = `Status: ${status}. ${hint}`;
}

game.subscribe((event) => {
  if (event.type === "status-changed" || event.type === "game-over") updateStatus();
  if (event.type === "player-jumped") return; // keep the log readable
  const item = document.createElement("li");
  item.textContent = describeEvent(event);
  log.prepend(item);
  while (log.childElementCount > 15) log.lastElementChild?.remove();
});
updateStatus();

// App-level keys. In the real app these belong to src/app (Agent 3).
const onKeyDown = (event: KeyboardEvent): void => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const { status } = game.getSnapshot();
  if (event.code === "Enter") {
    event.preventDefault();
    if (status === "ready") game.start();
    else game.restart();
  } else if (event.code === "KeyP") {
    if (status === "running") game.pause();
    else if (status === "paused") game.resume();
  }
};
window.addEventListener("keydown", onKeyDown);

import.meta.hot?.dispose(() => {
  window.removeEventListener("keydown", onKeyDown);
  void keyboard.stop();
  game.destroy();
});
