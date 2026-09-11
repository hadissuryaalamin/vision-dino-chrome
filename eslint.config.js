// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Architecture boundaries from docs/architecture.md ("Dependency rules").
// Imports are relative, so rules match whole path segments such as "../vision/x".
/** @param {string[]} names */
const segments = (names) => `(^|/)(${names.join("|")})(/|$)`;

const noMediaPipe = {
  regex: "^@mediapipe/",
  message: "Only src/vision may depend on MediaPipe.",
};

const noCameraAccess = {
  selector: "MemberExpression[property.name=/^(mediaDevices|getUserMedia|getDisplayMedia)$/]",
  message:
    "Only src/vision may access the camera. Use the VisionSession contract (see AGENTS.md, Privacy and security rules).",
};

const noPersistence = ["localStorage", "sessionStorage", "indexedDB"].map((name) => ({
  name,
  message: "Do not persist camera frames, landmarks or calibration data (AGENTS.md, Privacy).",
}));

const noTransmission = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((name) => ({
  name,
  message:
    "Camera-derived data must never leave the browser. Loading same-origin model assets is the only exception; justify it with an eslint-disable comment.",
}));

export default defineConfig(
  globalIgnores(["dist/", "coverage/", "public/"]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    name: "project/type-aware-parsing",
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    name: "project/plain-js",
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    name: "boundaries/shared",
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              message: "src/shared is the dependency root; it must not import other src modules.",
            },
            {
              regex: "^(?!\\.)",
              message: "src/shared must stay free of runtime dependencies.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", noCameraAccess],
    },
  },
  {
    name: "boundaries/game",
    files: ["src/game/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: segments(["vision", "app", "ui"]),
              message:
                "src/game must not depend on vision, app or ui. Depend on src/shared contracts.",
            },
            noMediaPipe,
          ],
        },
      ],
      "no-restricted-syntax": ["error", noCameraAccess],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Inject a seeded random source so game logic stays deterministic.",
        },
        {
          object: "Date",
          property: "now",
          message: "Use time supplied by the injected frame scheduler.",
        },
      ],
    },
  },
  {
    name: "boundaries/vision",
    files: ["src/vision/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: segments(["game", "app", "ui"]),
              message:
                "src/vision must not depend on game, app or ui. Emit VisionEvents from src/shared instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...noPersistence, ...noTransmission],
      "no-restricted-properties": [
        "error",
        {
          object: "navigator",
          property: "sendBeacon",
          message: "Camera-derived data must never leave the browser.",
        },
        {
          object: "window",
          property: "localStorage",
          message: "Do not persist camera-derived data.",
        },
        {
          object: "window",
          property: "sessionStorage",
          message: "Do not persist camera-derived data.",
        },
        {
          object: "window",
          property: "indexedDB",
          message: "Do not persist camera-derived data.",
        },
      ],
    },
  },
  {
    name: "boundaries/app",
    files: ["src/app/**/*.ts", "src/main.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(game|vision)/(?!index(\\.ts)?$).",
              message:
                "Import game and vision only through their public entry points (src/game/index.ts, src/vision/index.ts).",
            },
            noMediaPipe,
          ],
        },
      ],
      "no-restricted-syntax": ["error", noCameraAccess],
    },
  },
  {
    name: "boundaries/ui",
    files: ["src/ui/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: segments(["game", "vision", "app"]),
              message:
                "src/ui renders data passed in by src/app. Import only src/shared types and other ui modules.",
            },
            noMediaPipe,
          ],
        },
      ],
      "no-restricted-syntax": ["error", noCameraAccess],
    },
  },
);
