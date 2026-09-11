import { assertNever, otherPlayer } from "../shared";
import type {
  CalibrationFailureReason,
  CalibrationStep,
  GameResult,
  GestureKind,
  PlayerId,
  PlayerTrackingState,
  VisionErrorCode,
} from "../shared";
import type { Announcement, NoticeView } from "./view-model";

// All user-facing text (English; assumption A-03). Kept in one place so it can be reviewed
// and tested, and so the UI never shows developer error messages to players.

/** Shown before the permission prompt and in the camera view (AGENTS.md, Privacy). */
export const LOCAL_PROCESSING_NOTICE =
  "Camera processing happens only in this browser; video is never uploaded or saved.";

export interface ErrorCopy {
  readonly title: string;
  readonly body: string;
  /** Concrete next steps. Keyboard play is always offered as a button as well. */
  readonly steps: readonly string[];
  /** Whether "Try again" can help. */
  readonly canRetry: boolean;
}

export const VISION_ERROR_COPY: Readonly<Record<VisionErrorCode, ErrorCopy>> = {
  "camera-unsupported": {
    title: "Camera play is not available here",
    body: "This browser cannot use the camera on this page. Camera access needs a browser with camera support and a secure page: an https:// address, or localhost.",
    steps: [
      "Open the game over https:// in an up-to-date desktop browser.",
      "Or choose Keyboard only to play without the camera.",
    ],
    canRetry: false,
  },
  "camera-permission-denied": {
    title: "Camera permission was blocked",
    body: "The camera is needed to see blinks and mouth movements. Processing stays in this browser.",
    steps: [
      "Select the camera or lock icon in the address bar and allow the camera for this site.",
      "If your operating system blocks the camera, allow the browser to use it in the system privacy settings.",
      "Then choose Try again, or choose Keyboard only.",
    ],
    canRetry: true,
  },
  "camera-not-found": {
    title: "No camera found",
    body: "The browser could not find a camera.",
    steps: [
      "Connect a webcam, or check that the built-in camera is switched on.",
      "Then choose Try again.",
    ],
    canRetry: true,
  },
  "camera-in-use": {
    title: "The camera is busy",
    body: "Another application or browser tab may be using the camera.",
    steps: [
      "Close other apps or tabs that use the camera, such as video calls.",
      "Then choose Try again.",
    ],
    canRetry: true,
  },
  "camera-disconnected": {
    title: "The camera was disconnected",
    body: "The camera stopped sending video.",
    steps: ["Check the camera's cable or connection.", "Then choose Try again."],
    canRetry: true,
  },
  "model-load-failed": {
    title: "Face tracking could not be loaded",
    body: "The face-tracking files did not load.",
    steps: ["Check your connection and reload the page.", "Then choose Try again."],
    canRetry: true,
  },
  "inference-failed": {
    title: "Face tracking stopped working",
    body: "The browser could not run face tracking on this device.",
    steps: [
      "Choose Try again. Closing other demanding tabs can help.",
      "An up-to-date desktop browser gives the best chance.",
    ],
    canRetry: true,
  },
  unknown: {
    title: "The camera could not be started",
    body: "Something unexpected went wrong.",
    steps: ["Choose Try again.", "If it keeps happening, reload the page."],
    canRetry: true,
  },
};

export const CALIBRATION_FAILURE_COPY: Readonly<
  Record<CalibrationFailureReason, { readonly title: string; readonly body: string }>
> = {
  "not-running": {
    title: "The camera is not running",
    body: "Turn the camera on again, or play with the keyboard.",
  },
  "not-enough-faces": {
    title: "Both players need to be visible",
    body: "Sit side by side facing the camera, Player 1 on the left and Player 2 on the right, then retry.",
  },
  "face-lost": {
    title: "A face moved out of view",
    body: "Stay in the camera view until calibration finishes, then retry.",
  },
  "gesture-not-detected": {
    title: "The gesture was not detected clearly",
    body: "Make each gesture bigger: blink firmly, or open your mouth wide. Then retry, or use the default settings.",
  },
  "unstable-measurements": {
    title: "The measurements were too unsteady",
    body: "Keep your head still, face the camera and light your face evenly, then retry. Reflections on glasses can make this harder.",
  },
  timeout: {
    title: "Calibration took too long",
    body: "Retry and follow the steps on screen, or use the default settings.",
  },
  cancelled: {
    title: "Calibration was cancelled",
    body: "Retry, use the default settings, or play with the keyboard.",
  },
};

export function playerName(playerId: PlayerId): string {
  return `Player ${playerId}`;
}

/** Short gesture name, e.g. for "P1 · blink". */
export function gestureLabel(gesture: GestureKind): string {
  switch (gesture) {
    case "blink":
      return "blink";
    case "mouth-open":
      return "open mouth";
    default:
      return assertNever(gesture, "Unknown gesture");
  }
}

/** For "jumps by …": "blinking", "opening their mouth". */
export function gesturePhrase(gesture: GestureKind): string {
  return gesture === "blink" ? "blinking" : "opening their mouth";
}

/** For "Player 1: … or press W": "blink", "open your mouth". */
export function gestureCommand(gesture: GestureKind): string {
  return gesture === "blink" ? "blink" : "open your mouth";
}

export function gestureDetectedLabel(gesture: GestureKind): string {
  return gesture === "blink" ? "Blink detected" : "Mouth opening detected";
}

export function calibrationStepInstruction(step: CalibrationStep, gesture: GestureKind): string {
  switch (step) {
    case "assign-players":
      return "Hold still while the camera works out who is who.";
    case "neutral":
      return "Look at the screen with your eyes open and your mouth closed.";
    case "gesture":
      return gesture === "blink"
        ? "Blink firmly three times."
        : "Open your mouth wide three times.";
    default:
      return assertNever(step, "Unknown calibration step");
  }
}

export function calibrationFailureText(
  playerId: PlayerId | null,
  reason: CalibrationFailureReason,
): { readonly title: string; readonly body: string } {
  const copy = CALIBRATION_FAILURE_COPY[reason];
  return playerId === null ? copy : { ...copy, title: `${playerName(playerId)}: ${copy.title}` };
}

export function trackingLabel(tracking: PlayerTrackingState | null): string {
  switch (tracking) {
    case null:
      return "Keyboard only";
    case "tracked":
      return "Face tracked";
    case "lost":
      return "Face not visible";
    case "unassigned":
      return "Waiting for face";
    default:
      return assertNever(tracking, "Unknown tracking state");
  }
}

export function facesDetectedText(count: number): string {
  if (count <= 0) {
    return "No faces detected yet. Face the camera and make sure your faces are well lit.";
  }
  if (count === 1) {
    return "One face detected. Both players need to be visible, or continue with one player on the camera and the other on the keyboard.";
  }
  if (count === 2) return "Two faces detected. Check the P1 and P2 labels, then continue.";
  return `${count} faces detected. Only the two players should be in view.`;
}

export function points(score: number): string {
  return score === 1 ? "1 point" : `${score} points`;
}

export function resultText(result: GameResult | null): string {
  if (!result) return "The round is over.";
  if (result.winner === null) {
    return result.scores[1] === result.scores[2]
      ? `It's a tie: both players scored ${points(result.scores[1])}.`
      : `It's a tie. Player 1: ${points(result.scores[1])}. Player 2: ${points(result.scores[2])}.`;
  }
  const loser = otherPlayer(result.winner);
  return `${playerName(result.winner)} wins with ${points(result.scores[result.winner])}. ${playerName(loser)} scored ${points(result.scores[loser])}.`;
}

const KEY_NAMES: Readonly<Record<string, { readonly label: string; readonly spoken: string }>> = {
  ArrowUp: { label: "↑", spoken: "Up arrow" },
  ArrowDown: { label: "↓", spoken: "Down arrow" },
  ArrowLeft: { label: "←", spoken: "Left arrow" },
  ArrowRight: { label: "→", spoken: "Right arrow" },
  Space: { label: "Space", spoken: "Space" },
  Enter: { label: "Enter", spoken: "Enter" },
  Escape: { label: "Esc", spoken: "Escape" },
  Backquote: { label: "`", spoken: "Backquote" },
};

/** Visible label and spoken name for a KeyboardEvent.code value, e.g. "KeyW" → "W". */
export function keyName(code: string): { readonly label: string; readonly spoken: string } {
  const named = KEY_NAMES[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code)) {
    const label = code.slice(-1);
    return { label, spoken: label };
  }
  return { label: code, spoken: code };
}

export type Politeness = "polite" | "assertive";

export function announcementText(announcement: Announcement): {
  readonly text: string;
  readonly politeness: Politeness;
} {
  const polite = (text: string) => ({ text, politeness: "polite" as const });
  switch (announcement.kind) {
    case "faces-detected": {
      const { count } = announcement;
      if (count === 0) return polite("No faces detected.");
      if (count === 1) return polite("One face detected.");
      if (count === 2) return polite("Two faces detected. You can continue.");
      return polite(`${count} faces detected. Only the two players should be in view.`);
    }
    case "players-assigned": {
      const reason = announcement.reason;
      switch (reason) {
        case "calibration":
          return polite("Players assigned: Player 1 on the left, Player 2 on the right.");
        case "swapped":
          return polite("Players swapped. Check the P1 and P2 labels.");
        case "reset":
          return polite("Players assigned again by position. Check the P1 and P2 labels.");
        case "reacquired":
          return polite("Players were re-assigned. Check the P1 and P2 labels.");
        default:
          return assertNever(reason, "Unknown assignment reason");
      }
    }
    case "face-lost":
      return polite(`${playerName(announcement.playerId)}: face not visible.`);
    case "face-found":
      return polite(`${playerName(announcement.playerId)}: face tracked again.`);
    case "calibration-complete":
      return polite(
        announcement.mode === "default"
          ? `${playerName(announcement.playerId)} is using the default settings.`
          : `${playerName(announcement.playerId)} is calibrated.`,
      );
    case "calibration-failed": {
      const { title } = calibrationFailureText(announcement.playerId, announcement.reason);
      return { text: `Calibration failed. ${title}.`, politeness: "assertive" };
    }
    case "vision-error":
      return {
        text: `${VISION_ERROR_COPY[announcement.code].title}. Keyboard controls still work.`,
        politeness: "assertive",
      };
    case "camera-off":
      return polite(
        announcement.reason === "page-hidden"
          ? "Camera turned off because the page was hidden."
          : "Camera turned off. Keyboard controls still work.",
      );
    case "game-started":
      return polite("Game started.");
    case "game-paused":
      return polite("Game paused.");
    case "game-resumed":
      return polite("Game resumed.");
    case "player-crashed":
      return polite(
        `${playerName(announcement.playerId)} crashed with ${points(announcement.score)}.`,
      );
    case "game-over":
      return polite(`Game over. ${resultText(announcement.result)}`);
    case "debug-overlay":
      return polite(announcement.visible ? "Debug overlay shown." : "Debug overlay hidden.");
    default:
      return assertNever(announcement, "Unknown announcement");
  }
}

export function noticeText(notice: NoticeView): string {
  switch (notice.kind) {
    case "vision-error":
      return `${VISION_ERROR_COPY[notice.code].title}. The camera is off; keyboard controls still work.`;
    case "camera-stopped-hidden":
      return "The camera was turned off when you left the page. Keyboard controls still work.";
    case "players-reassigned":
      return "Players were re-assigned after both faces were lost. Check the P1 and P2 labels, or use Swap players.";
    default:
      return assertNever(notice, "Unknown notice");
  }
}
