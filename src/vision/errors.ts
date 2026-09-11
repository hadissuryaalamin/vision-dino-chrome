/** The `name` of an Error or DOMException-like value, or null. */
export function errorName(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "name" in error) {
    return typeof error.name === "string" ? error.name : null;
  }
  return null;
}

/** Developer-facing one-line description of any thrown value. */
export function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const name = errorName(error) ?? "Error";
    const message =
      "message" in error && typeof error.message === "string" ? error.message.trim() : "";
    return message.length > 0 ? `${name}: ${message}` : name;
  }
  return "Unknown error";
}
