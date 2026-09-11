import type { Page } from "@playwright/test";

export const LOCAL_PROCESSING_NOTICE =
  "Camera processing happens only in this browser; video is never uploaded or saved.";

interface Probe {
  getUserMedia: { audio: unknown; video: boolean }[];
  /** "name: message" of each getUserMedia rejection. */
  getUserMediaErrors: string[];
  streams: MediaStream[];
  cspViolations: string[];
}

declare global {
  interface Window {
    __visionDinoProbe?: Probe;
  }
}

export interface PageObservations {
  /** Every request URL the page made. */
  readonly requests: string[];
  /** Completed requests to any host other than the local preview server. */
  readonly externalRequests: string[];
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

/**
 * Install probes before any page script runs: getUserMedia calls and their streams, and CSP
 * violations. Also records network requests, console errors and uncaught page errors.
 */
export async function observePage(page: Page): Promise<PageObservations> {
  const observations: PageObservations = {
    requests: [],
    externalRequests: [],
    consoleErrors: [],
    pageErrors: [],
  };
  page.on("request", (request) => observations.requests.push(request.url()));
  page.on("requestfinished", (request) => {
    const { hostname, protocol } = new URL(request.url());
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    if (!local && protocol.startsWith("http")) observations.externalRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") observations.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => observations.pageErrors.push(error.message));

  await page.addInitScript(() => {
    const probe: Probe = {
      getUserMedia: [],
      getUserMediaErrors: [],
      streams: [],
      cspViolations: [],
    };
    window.__visionDinoProbe = probe;
    document.addEventListener("securitypolicyviolation", (event) => {
      probe.cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (devices && typeof devices.getUserMedia === "function") {
      const original = devices.getUserMedia.bind(devices);
      devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        probe.getUserMedia.push({
          audio: constraints?.audio,
          video: constraints?.video !== undefined,
        });
        try {
          const stream = await original(constraints);
          probe.streams.push(stream);
          return stream;
        } catch (error) {
          const { name, message } = error as { name?: unknown; message?: unknown };
          probe.getUserMediaErrors.push(`${String(name)}: ${String(message)}`);
          throw error;
        }
      };
    }
  });
  return observations;
}

export interface ProbeReading {
  readonly getUserMedia: { audio: unknown; video: boolean }[];
  readonly getUserMediaErrors: string[];
  readonly trackCount: number;
  readonly liveTracks: number;
  readonly cspViolations: string[];
}

export function readProbe(page: Page): Promise<ProbeReading> {
  return page.evaluate(() => {
    const probe = window.__visionDinoProbe;
    const tracks = (probe?.streams ?? []).flatMap((stream) => stream.getTracks());
    return {
      getUserMedia: probe?.getUserMedia ?? [],
      getUserMediaErrors: probe?.getUserMediaErrors ?? [],
      trackCount: tracks.length,
      liveTracks: tracks.filter((track) => track.readyState === "live").length,
      cspViolations: probe?.cspViolations ?? [],
    };
  });
}

const TELEMETRY_HOST = "odml.pa.googleapis.com";

/** CSP violations other than the intended block of MediaPipe's telemetry (decision O-13). */
export function unexpectedViolations(violations: readonly string[]): string[] {
  return violations.filter(
    (violation) => !(violation.startsWith("connect-src") && violation.includes(TELEMETRY_HOST)),
  );
}

/** Console errors other than the browser's report of the blocked telemetry request. */
export function unexpectedConsoleErrors(errors: readonly string[]): string[] {
  return errors.filter((error) => !error.includes(TELEMETRY_HOST));
}
