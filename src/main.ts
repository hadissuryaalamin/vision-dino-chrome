// Application bootstrap: wires the real game and vision modules into the app (Phase 3).
// Game and vision are imported only through their public entry points.
import { createApp, parseAppUrlOptions } from "./app";
import { DEFAULT_KEY_BINDINGS, createGame, createKeyboardInputSource } from "./game";
import type { VisionSessionFactory } from "./shared";
import { createVisionSession, isCameraSupported } from "./vision";

interface VisionDependencies {
  readonly createVisionSession: VisionSessionFactory;
  readonly isCameraSupported: () => boolean;
}

/**
 * The real camera pipeline, or, in development only, `?vision=simulated`: a VisionSession
 * driven by keys instead of a camera. The condition is `false` in production builds, so the
 * dynamic import and the simulated module are removed from the bundle.
 */
async function visionDependencies(): Promise<VisionDependencies> {
  if (import.meta.env.DEV && parseAppUrlOptions(window.location.search).simulatedVision) {
    const { browserSimulatedEnvironment, createSimulatedVisionFactory } =
      await import("./app/dev/simulated-vision");
    return {
      createVisionSession: createSimulatedVisionFactory(browserSimulatedEnvironment(window)),
      isCameraSupported: () => true,
    };
  }
  return { createVisionSession, isCameraSupported };
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("Vision Dino: the #app element is missing from index.html");
  const vision = await visionDependencies();
  createApp(root, {
    // The UI shows its own ready, paused and game-over cards, so the renderer's text is off.
    createGame: ({ canvas }) => createGame({ canvas, render: { showStatusOverlay: false } }),
    createKeyboardInputSource,
    createVisionSession: vision.createVisionSession,
    isCameraSupported: vision.isCameraSupported,
    keyBindings: DEFAULT_KEY_BINDINGS,
  });
}

void main();
