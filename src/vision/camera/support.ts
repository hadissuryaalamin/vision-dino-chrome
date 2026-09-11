/** The globals isCameraSupported() looks at, injectable for tests. */
export interface CameraSupportEnvironment {
  readonly isSecureContext?: boolean;
  readonly navigator?: { readonly mediaDevices?: { readonly getUserMedia?: unknown } };
}

/** True when getUserMedia exists and the page is a secure context (HTTPS or localhost). */
export function checkCameraSupport(environment: CameraSupportEnvironment): boolean {
  return (
    environment.isSecureContext === true &&
    typeof environment.navigator?.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * True when `navigator.mediaDevices.getUserMedia` exists and the page is a secure context.
 * Does not request permission and does not touch the camera.
 */
export function isCameraSupported(): boolean {
  return checkCameraSupport(globalThis);
}
