/** Options read from the page URL. */
export interface AppUrlOptions {
  /** `?debug=1`: show the vision debug overlay from the start. */
  readonly debug: boolean;
  /**
   * `?vision=simulated`: requested dev-only simulated vision. Only honoured by a development
   * build (`import.meta.env.DEV`); the composition root decides.
   */
  readonly simulatedVision: boolean;
}

export function parseAppUrlOptions(search: string): AppUrlOptions {
  const params = new URLSearchParams(search);
  const debug = params.get("debug");
  return {
    debug: debug !== null && debug !== "0" && debug.toLowerCase() !== "false",
    simulatedVision: params.get("vision") === "simulated",
  };
}
