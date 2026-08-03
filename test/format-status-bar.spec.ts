import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ON_DEMAND_LIMIT_DOLLARS,
  formatStatusBarOnDemandText,
  resolveOnDemandLimit,
} from "../src/format";

describe("formatStatusBarOnDemandText", () => {
  it("defaults to the $1000 ceiling for limited on-demand spend", () => {
    expect(
      formatStatusBarOnDemandText({ state: "limited", spendDollars: 114.78 }),
    ).toBe("$114.78/$1000");
    expect(DEFAULT_ON_DEMAND_LIMIT_DOLLARS).toBe(1000);
  });

  it("uses a custom ceiling when provided", () => {
    expect(
      formatStatusBarOnDemandText({ state: "limited", spendDollars: 114.78 }, "", 500),
    ).toBe("$114.78/$500");
  });

  it("uses the same ceiling for unlimited on-demand spend", () => {
    expect(
      formatStatusBarOnDemandText({ state: "unlimited", spendDollars: 32.31 }),
    ).toBe("$32.31/$1000");
  });

  it("shows N/A when on-demand is disabled", () => {
    expect(
      formatStatusBarOnDemandText({ state: "disabled", spendDollars: 0 }),
    ).toBe("N/A");
  });

  it("appends an optional risk mark with a leading space", () => {
    expect(
      formatStatusBarOnDemandText({ state: "limited", spendDollars: 114.78 }, "⚠"),
    ).toBe("$114.78/$1000 ⚠");
  });

  it("ignores risk mark when on-demand is disabled", () => {
    expect(
      formatStatusBarOnDemandText({ state: "disabled", spendDollars: 10 }, "⚠"),
    ).toBe("N/A");
  });

  it("falls back to the default ceiling for invalid limit values", () => {
    expect(
      formatStatusBarOnDemandText({ state: "limited", spendDollars: 10 }, "", 0),
    ).toBe("$10.00/$1000");
    expect(
      formatStatusBarOnDemandText({ state: "limited", spendDollars: 10 }, "", -5),
    ).toBe("$10.00/$1000");
  });
});

describe("resolveOnDemandLimit", () => {
  it("keeps positive finite values", () => {
    expect(resolveOnDemandLimit(250)).toBe(250);
    expect(resolveOnDemandLimit(99.5)).toBe(99.5);
  });

  it("falls back for null, NaN, and non-positive values", () => {
    expect(resolveOnDemandLimit(null)).toBe(1000);
    expect(resolveOnDemandLimit(undefined)).toBe(1000);
    expect(resolveOnDemandLimit(0)).toBe(1000);
    expect(resolveOnDemandLimit(Number.NaN)).toBe(1000);
  });
});
