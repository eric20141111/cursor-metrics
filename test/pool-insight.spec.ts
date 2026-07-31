import { describe, expect, it } from "bun:test";
import type { UsagePayload } from "../src/cursor-api";
import {
  buildPoolAdvice,
  buildPoolBreakdown,
  buildPoolInsightView,
  formatPoolInsightMarkdown,
} from "../src/pool-insight";

function centsPayload(partial: {
  used: number;
  limit: number;
  apiUsed: number;
  apiLimit: number;
  bonusCents?: number | null;
  apiPercentUsed?: number | null;
  autoPercentUsed?: number | null;
  totalPercentUsed?: number | null;
  onDemand?: UsagePayload["onDemand"];
}): Pick<UsagePayload, "includedRequests" | "onDemand"> {
  return {
    includedRequests: {
      used: partial.used,
      limit: partial.limit,
      unit: "cents",
      apiUsed: partial.apiUsed,
      apiLimit: partial.apiLimit,
      bonusCents: partial.bonusCents ?? null,
      apiPercentUsed: partial.apiPercentUsed ?? null,
      autoPercentUsed: partial.autoPercentUsed ?? null,
      totalPercentUsed: partial.totalPercentUsed ?? null,
    },
    onDemand: partial.onDemand ?? {
      state: "unlimited",
      spendDollars: 32.31,
      limitDollars: null,
    },
  };
}

describe("buildPoolBreakdown", () => {
  it("derives bonus used from totalUsed - apiLimit and marks hasPools", () => {
    const b = buildPoolBreakdown(
      centsPayload({
        used: 2112,
        limit: 6166,
        apiUsed: 2000,
        apiLimit: 2000,
        bonusCents: 4166,
        apiPercentUsed: 100,
        autoPercentUsed: 5.64,
        totalPercentUsed: 34.26,
      }),
    );
    expect(b.hasPools).toBe(true);
    expect(b.api).toEqual({ usedCents: 2000, limitCents: 2000, percentUsed: 100 });
    expect(b.bonus).toEqual({ usedCents: 112, limitCents: 4166 });
    expect(b.autoPercentUsed).toBe(5.64);
    expect(b.apiRatio).toBe(1);
    expect(b.totalRatio).toBeCloseTo(2112 / 6166, 5);
  });

  it("returns hasPools false for request-unit or missing apiLimit", () => {
    const b = buildPoolBreakdown({
      includedRequests: { used: 10, limit: 500, unit: "requests" },
      onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
    });
    expect(b.hasPools).toBe(false);
    expect(b.api).toBeNull();
    expect(b.bonus).toBeNull();
  });

  it("returns hasPools false for cents with apiLimit but no breakdown metadata", () => {
    const data = centsPayload({
      used: 1500,
      limit: 2000,
      apiUsed: 1500,
      apiLimit: 2000,
      bonusCents: null,
      apiPercentUsed: 75,
    });
    const b = buildPoolBreakdown(data);
    expect(b.hasPools).toBe(false);
    expect(b.api).toBeNull();
    expect(b.bonus).toBeNull();
    expect(buildPoolAdvice(b, data.onDemand)).toBeNull();
    expect(buildPoolInsightView(data)).toBeNull();
    expect(formatPoolInsightMarkdown(b, data.onDemand, null)).toBe("");
  });
});

describe("buildPoolAdvice", () => {
  const base = () =>
    buildPoolBreakdown(
      centsPayload({
        used: 2112,
        limit: 6166,
        apiUsed: 2000,
        apiLimit: 2000,
        bonusCents: 4166,
        apiPercentUsed: 100,
        autoPercentUsed: 5.64,
      }),
    );

  it("returns null when hasPools is false", () => {
    const empty = buildPoolBreakdown({
      includedRequests: { used: 1, limit: 1, unit: "requests" },
      onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
    });
    expect(buildPoolAdvice(empty, { state: "disabled", spendDollars: 0, limitDollars: null })).toBeNull();
  });

  it("prefers Auto when API >= 80% and total < 90%", () => {
    expect(
      buildPoolAdvice(base(), { state: "unlimited", spendDollars: 32.31, limitDollars: null }),
    ).toBe(
      "Prefer Auto / Cursor Models for routine work; manual premium models keep drawing Bonus / On-demand.",
    );
  });

  it("allows manual models when API < 80%", () => {
    const b = buildPoolBreakdown(
      centsPayload({
        used: 500,
        limit: 6166,
        apiUsed: 1000,
        apiLimit: 2000,
        bonusCents: 4166,
        apiPercentUsed: 50,
      }),
    );
    expect(buildPoolAdvice(b, { state: "unlimited", spendDollars: 0, limitDollars: null })).toBe(
      "Manual models are fine; watch the API pool on expensive picks.",
    );
  });

  it("warns on-demand when total >= 90% and on-demand enabled", () => {
    const b = buildPoolBreakdown(
      centsPayload({
        used: 5800,
        limit: 6166,
        apiUsed: 2000,
        apiLimit: 2000,
        bonusCents: 4166,
      }),
    );
    expect(buildPoolAdvice(b, { state: "unlimited", spendDollars: 10, limitDollars: null })).toBe(
      "Included is nearly gone — further use is mostly On-demand.",
    );
  });

  it("warns when exhausted and on-demand disabled", () => {
    const b = buildPoolBreakdown(
      centsPayload({
        used: 6166,
        limit: 6166,
        apiUsed: 2000,
        apiLimit: 2000,
        bonusCents: 4166,
        onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
      }),
    );
    expect(buildPoolAdvice(b, { state: "disabled", spendDollars: 0, limitDollars: null })).toBe(
      "Included exhausted and On-demand is off — usage may be limited until the next cycle.",
    );
  });
});

describe("formatPoolInsightMarkdown", () => {
  it("returns empty string when hasPools is false", () => {
    const b = buildPoolBreakdown({
      includedRequests: { used: 1, limit: 1, unit: "requests" },
      onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
    });
    expect(formatPoolInsightMarkdown(b, { state: "disabled", spendDollars: 0, limitDollars: null }, null)).toBe("");
  });

  it("includes API, Bonus, Auto, On-demand lines and advice", () => {
    const data = centsPayload({
      used: 2112,
      limit: 6166,
      apiUsed: 2000,
      apiLimit: 2000,
      bonusCents: 4166,
      apiPercentUsed: 100,
      autoPercentUsed: 5.64,
    });
    const b = buildPoolBreakdown(data);
    const advice = buildPoolAdvice(b, data.onDemand);
    const md = formatPoolInsightMarkdown(b, data.onDemand, advice);
    expect(md).toContain("API pool");
    expect(md).toContain("Bonus");
    expect(md).toContain("Auto / Cursor Models");
    expect(md).toContain("On-demand");
    expect(md).toContain("Prefer Auto / Cursor Models");
    expect(md).toContain("**$(layers) Pool breakdown**");
    expect(md).toContain("**$(lightbulb) Recommendation**");
    expect(md).toContain(
      '<table width="302" cellspacing="0" cellpadding="8" border="2" bordercolor="#D97706">',
    );
  });
});
