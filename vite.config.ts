import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";

// Build and deployment settings. Owned by the orchestrator in Phase 1 and by the
// Integration, UI and QA agent from Phase 3 (see AGENTS.md, "Ownership").

/**
 * Content Security Policy of the production build (docs/architecture.md §14).
 *
 * - `connect-src 'self'` is required: the app makes no network requests except to its own
 *   origin, and it blocks MediaPipe's built-in telemetry to odml.pa.googleapis.com
 *   (decision O-13). Never widen it.
 * - `script-src 'self' 'wasm-unsafe-eval'` lets the self-hosted MediaPipe WebAssembly compile
 *   without allowing JavaScript eval.
 * - Verified with the real, self-hosted model and WASM by the Playwright tests in e2e/, which
 *   load the production build, reach the camera positioning screen and assert that no CSP
 *   violation other than the blocked telemetry occurs.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

/** The CSP `<meta>`, placed first in `<head>` so it applies to every script after it. */
export function cspMetaTag(): HtmlTagDescriptor {
  return {
    tag: "meta",
    attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
    injectTo: "head-prepend",
  };
}

/**
 * Injects the CSP into the production build only (`apply: "build"`), so the dev server's
 * HMR client (inline scripts, WebSocket) keeps working. Dev pages have no CSP (risk R-18).
 */
export function contentSecurityPolicy(): Plugin {
  return {
    name: "vision-dino:content-security-policy",
    apply: "build",
    transformIndexHtml: () => [cspMetaTag()],
  };
}

export default defineConfig({
  // Relative asset URLs keep the static build working from any sub-path
  // (e.g. GitHub Pages project sites). Runtime asset URLs must be built from
  // import.meta.env.BASE_URL, never hard-coded as "/...".
  base: "./",
  plugins: [contentSecurityPolicy()],
});
