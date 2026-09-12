import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, contentSecurityPolicy, cspMetaTag } from "../../vite.config";

describe("production Content Security Policy", () => {
  const directives = CONTENT_SECURITY_POLICY.split(";").map((directive) => directive.trim());

  it("keeps connect-src 'self', which blocks MediaPipe's telemetry (decision O-13)", () => {
    expect(directives).toContain("connect-src 'self'");
  });

  it("allows WebAssembly compilation but no other eval, inline code or wildcards", () => {
    expect(directives).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/'unsafe-eval'|'unsafe-inline'|\*/);
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("default-src 'self'");
  });

  it("is injected as the first head element, in production builds only", () => {
    const plugin = contentSecurityPolicy();
    expect(plugin.apply).toBe("build");
    expect(cspMetaTag()).toEqual({
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
      injectTo: "head-prepend",
    });
  });
});
