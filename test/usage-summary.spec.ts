import { describe, expect, it } from "bun:test";
import {
  parseUsageSummary,
  resolveIncludedDisplay,
  usagePayloadFromSummary,
} from "../src/cursor-api";
import {
  buildIncludedBarModel,
  formatIncludedBarCaption,
  formatIncludedUsage,
  formatIncludedUsageSpaced,
} from "../src/format";
import { buildUsageOverviewMarkdown } from "../src/tooltip";

describe("parseUsageSummary", () => {
  it("parses plan breakdown and percent fields from usage-summary payload", () => {
    const parsed = parseUsageSummary({
      billingCycleEnd: "2026-08-29T12:47:47.000Z",
      membershipType: "enterprise",
      limitType: "team",
      individualUsage: {
        plan: {
          enabled: true,
          used: 2000,
          limit: 2000,
          remaining: 0,
          breakdown: { included: 2000, bonus: 4166, total: 6166 },
          totalPercentUsed: 34.25555555555555,
          apiPercentUsed: 100,
          autoPercentUsed: 5.64,
        },
        onDemand: {
          enabled: true,
          used: 3231,
          limit: null,
          remaining: null,
        },
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.plan).toEqual({
      used: 2000,
      limit: 2000,
      remaining: 0,
      enabled: true,
      breakdown: { included: 2000, bonus: 4166, total: 6166 },
      totalPercentUsed: 34.25555555555555,
      apiPercentUsed: 100,
      autoPercentUsed: 5.64,
    });
    expect(parsed!.onDemand).toEqual({
      enabled: true,
      usedCents: 3231,
      limitCents: null,
    });
    expect(parsed!.billingCycleEnd).toBe("2026-08-29T12:47:47.000Z");
  });

  it("returns null when individualUsage is missing", () => {
    expect(parseUsageSummary({ membershipType: "pro" })).toBeNull();
  });

  it("ignores disabled plan buckets", () => {
    const parsed = parseUsageSummary({
      individualUsage: {
        plan: { enabled: false, used: 0, limit: 0 },
        onDemand: { enabled: true, used: 100, limit: 500 },
      },
    });
    expect(parsed!.plan).toBeNull();
    expect(parsed!.onDemand?.usedCents).toBe(100);
    expect(parsed!.onDemand?.limitCents).toBe(500);
  });
});

describe("resolveIncludedDisplay", () => {
  it("uses included+bonus total pool when breakdown and totalPercentUsed exist", () => {
    const display = resolveIncludedDisplay({
      used: 2000,
      limit: 2000,
      remaining: 0,
      enabled: true,
      breakdown: { included: 2000, bonus: 4166, total: 6166 },
      totalPercentUsed: 34.25555555555555,
      apiPercentUsed: 100,
      autoPercentUsed: 5.64,
    });

    expect(display).toEqual({
      used: 2112,
      limit: 6166,
      apiUsed: 2000,
      apiLimit: 2000,
      bonusCents: 4166,
    });
    expect(formatIncludedUsage(display.used, display.limit, "cents")).toBe("$21.12/$61.66");
  });

  it("falls back to API pool when breakdown is missing", () => {
    const display = resolveIncludedDisplay({
      used: 500,
      limit: 500,
      remaining: 0,
      enabled: true,
      breakdown: null,
      totalPercentUsed: null,
      apiPercentUsed: null,
      autoPercentUsed: null,
    });
    expect(display).toEqual({
      used: 500,
      limit: 500,
      apiUsed: 500,
      apiLimit: 500,
      bonusCents: null,
    });
  });
});

describe("usagePayloadFromSummary", () => {
  it("copies percent fields onto UsagePayload.includedRequests", () => {
    const parsed = parseUsageSummary({
      billingCycleEnd: "2026-08-29T12:47:47.000Z",
      individualUsage: {
        plan: {
          enabled: true,
          used: 2000,
          limit: 2000,
          remaining: 0,
          breakdown: { included: 2000, bonus: 4166, total: 6166 },
          totalPercentUsed: 34.25,
          apiPercentUsed: 100,
          autoPercentUsed: 5.64,
        },
        onDemand: { enabled: true, used: 3231, limit: null },
      },
    });
    const payload = usagePayloadFromSummary(parsed!);
    expect(payload!.includedRequests.apiPercentUsed).toBe(100);
    expect(payload!.includedRequests.autoPercentUsed).toBe(5.64);
    expect(payload!.includedRequests.totalPercentUsed).toBe(34.25);
  });

  it("keeps On-Demand visible from the summary flag alone", () => {
    const parsed = parseUsageSummary({
      billingCycleEnd: "2026-08-29T12:47:47.000Z",
      individualUsage: {
        plan: { enabled: true, used: 2000, limit: 2000, remaining: 0 },
        onDemand: { enabled: true, used: 11478, limit: null },
      },
    });
    const payload = usagePayloadFromSummary(parsed!);
    expect(payload!.onDemand.state).toBe("unlimited");
    expect(payload!.onDemand.spendDollars).toBeCloseTo(114.78, 5);
  });

  it("reports disabled only when the summary says On-Demand is off", () => {
    const parsed = parseUsageSummary({
      individualUsage: {
        plan: { enabled: true, used: 2000, limit: 2000, remaining: 0 },
        onDemand: { enabled: false, used: 0, limit: null },
      },
    });
    const payload = usagePayloadFromSummary(parsed!);
    expect(payload!.onDemand.state).toBe("disabled");
  });
});

describe("formatIncludedUsage", () => {
  it("formats request counts and cents pools", () => {
    expect(formatIncludedUsage(278, 500, "requests")).toBe("278/500");
    expect(formatIncludedUsage(2000, 2000, "cents")).toBe("$20.00/$20.00");
    expect(formatIncludedUsageSpaced(2000, 2000, "cents")).toBe("$20.00 / $20.00");
  });
});

describe("buildIncludedBarModel", () => {
  it("splits API and Bonus fill ratios across the total pool", () => {
    const model = buildIncludedBarModel({
      used: 2112,
      limit: 6166,
      unit: "cents",
      apiUsed: 2000,
      apiLimit: 2000,
      bonusCents: 4166,
    });

    expect(model.segments).not.toBeNull();
    expect(model.segments!.apiShare).toBeCloseTo(2000 / 6166, 5);
    expect(model.segments!.apiFilled).toBeCloseTo(2000 / 6166, 5);
    expect(model.segments!.bonusFilled).toBeCloseTo(112 / 6166, 5);
    expect(model.segments!.bonusUsed).toBe(112);
    expect(model.segments!.bonusLimit).toBe(4166);
    expect(formatIncludedBarCaption(model.segments!, "cents")).toBe(
      "API $20.00/$20.00 · Bonus $1.12/$41.66",
    );
  });

  it("returns a plain ratio when there is no bonus pool", () => {
    const model = buildIncludedBarModel({ used: 100, limit: 500, unit: "requests" });
    expect(model.ratio).toBeCloseTo(0.2, 5);
    expect(model.segments).toBeNull();
  });
});

describe("buildUsageOverviewMarkdown cents unit", () => {
  it("renders dollar amounts and segmented caption for included+bonus pools", () => {
    const progressBar = {
      markdown: (ratio: number) => `[bar:${ratio.toFixed(2)}]`,
      html: (ratio: number) => `<bar:${ratio.toFixed(2)}>`,
      htmlIncluded: (ratio: number, segments: { apiFilled: number; bonusFilled: number } | null) =>
        segments
          ? `<seg:${segments.apiFilled.toFixed(2)}+${segments.bonusFilled.toFixed(2)}>`
          : `<bar:${ratio.toFixed(2)}>`,
      divider: () => "<divider />",
    };

    const markdown = buildUsageOverviewMarkdown(
      {
        includedRequests: {
          used: 2112,
          limit: 6166,
          unit: "cents",
          apiUsed: 2000,
          apiLimit: 2000,
          bonusCents: 4166,
        },
        onDemand: { state: "unlimited", spendDollars: 32.31, limitDollars: null },
      },
      progressBar,
    );

    expect(markdown).toContain("Included (total)");
    expect(markdown).toContain("<strong>$21.12 / $61.66</strong>");
    expect(markdown).toContain("<seg:0.32+0.02>");
    expect(markdown).toContain("API $20.00/$20.00 · Bonus $1.12/$41.66");
    expect(markdown).toContain("<strong>$32.31</strong>");
  });
});
