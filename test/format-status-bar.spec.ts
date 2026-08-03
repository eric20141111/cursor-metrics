import { describe, expect, it } from "bun:test";
import { formatStatusBarOnDemandText, STATUS_BAR_ON_DEMAND_LIMIT_DOLLARS } from "../src/format";

describe("formatStatusBarOnDemandText", () => {
  it("uses a fixed $1000 ceiling for limited on-demand spend", () => {
    expect(
      formatStatusBarOnDemandText({ state: "limited", spendDollars: 114.78 }),
    ).toBe("$114.78/$1000");
    expect(STATUS_BAR_ON_DEMAND_LIMIT_DOLLARS).toBe(1000);
  });

  it("uses the same fixed ceiling for unlimited on-demand spend", () => {
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
});
