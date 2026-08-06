import { describe, expect, it } from "bun:test";
import { isSecurityCheckpoint } from "../src/cursor-api";

function responseWith(status: number, headers: Record<string, string>): Response {
  return new Response("<!DOCTYPE html><title>Vercel Security Checkpoint</title>", {
    status,
    headers,
  });
}

describe("isSecurityCheckpoint", () => {
  it("detects the Vercel bot-protection interstitial", () => {
    expect(
      isSecurityCheckpoint(responseWith(403, { "x-vercel-mitigated": "challenge" })),
    ).toBe(true);
  });

  it("ignores a plain 403 without the mitigation header", () => {
    expect(isSecurityCheckpoint(responseWith(403, {}))).toBe(false);
  });

  it("ignores auth failures and successful responses", () => {
    expect(isSecurityCheckpoint(responseWith(401, {}))).toBe(false);
    expect(
      isSecurityCheckpoint(responseWith(200, { "x-vercel-mitigated": "challenge" })),
    ).toBe(false);
  });
});
