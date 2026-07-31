import { describe, expect, it } from "bun:test";
import type { DailySpendRow, UsageEvent } from "../src/cursor-api";
import {
  aggregateByModel,
  aggregateSpendByCategory,
  filterZeroTokenModels,
  formatDollarsFromCents,
  getDurationCutoff,
} from "../src/model-breakdown";

const now = Date.UTC(2026, 3, 20, 12, 0, 0);
const dayMs = 86_400_000;

function ev(
  partial: Omit<UsageEvent, "maxMode" | "spendCents"> & { spendCents?: number; maxMode?: boolean },
): UsageEvent {
  return {
    maxMode: false,
    spendCents: 0,
    ...partial,
  };
}

describe("model breakdown aggregation", () => {
  it("sums spend by category for the selected duration", () => {
    const spendRows: DailySpendRow[] = [
      { day: now - 2 * dayMs, category: "gpt-5.3-codex", spendCents: 120, totalTokens: 10_000 },
      { day: now - 2 * dayMs, category: "gpt-5.3-codex", spendCents: 80, totalTokens: 20_000 },
      { day: now - 1 * dayMs, category: "gpt-5.4-high", spendCents: 55, totalTokens: 5_000 },
      { day: now - 40 * dayMs, category: "gpt-5.3-codex", spendCents: 999, totalTokens: 100_000 },
    ];

    const totals = aggregateSpendByCategory(spendRows, "7d", null, now);
    expect(totals.get("gpt-5.3-codex")).toBe(200);
    expect(totals.get("gpt-5.4-high")).toBe(55);
    expect(totals.has("unknown")).toBeFalse();
  });

  it("sums tokens, requests, and spend from events (Dashboard-aligned)", () => {
    const events: UsageEvent[] = [
      ev({ timestamp: now - 1 * dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 2000, requests: 2, spendCents: 200 }),
      ev({ timestamp: now - 2 * dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 3000, requests: 1, spendCents: 120 }),
      ev({ timestamp: now - 1 * dayMs, model: "composer-2", kind: "Included", totalTokens: 1000, requests: 4, spendCents: 0 }),
    ];
    // Mismatched / orphan category rows must NOT zero out event spend.
    const spendRows: DailySpendRow[] = [
      { day: now - 1 * dayMs, category: "GPT-5.3 Codex", spendCents: 999, totalTokens: 5000 },
    ];

    const rows = aggregateByModel(events, spendRows, "7d", null, now);
    expect(rows).toEqual([
      { model: "gpt-5.3-codex", totalTokens: 5000, requests: 3, spendCents: 320 },
      { model: "composer-2", totalTokens: 1000, requests: 4, spendCents: 0 },
    ]);
  });

  it("keeps event spend when daily-spend category names do not match", () => {
    const events: UsageEvent[] = [
      ev({
        timestamp: now - 1 * dayMs,
        model: "claude-4.6-sonnet-medium-thinking",
        kind: "On-Demand",
        totalTokens: 8000,
        requests: 1,
        spendCents: 450,
      }),
    ];
    const spendRows: DailySpendRow[] = [
      { day: now - 1 * dayMs, category: "claude-4.6-sonnet", spendCents: 450, totalTokens: 8000 },
    ];

    const rows = aggregateByModel(events, spendRows, "7d", null, now);
    expect(rows).toEqual([
      {
        model: "claude-4.6-sonnet-medium-thinking",
        totalTokens: 8000,
        requests: 1,
        spendCents: 450,
      },
    ]);
  });

  it("hides Included chargedCents when quotaAwareEventDisplay is on (matches Dashboard)", () => {
    const events: UsageEvent[] = [
      ev({
        timestamp: now - 1 * dayMs,
        model: "Cursor Grok 4.5 (Auto Balanced)",
        kind: "Included",
        totalTokens: 18_500_000,
        requests: 321,
        spendCents: 1283,
      }),
      ev({
        timestamp: now - 1 * dayMs,
        model: "gpt-5.6-sol-medium",
        kind: "Included",
        totalTokens: 20_000_000,
        requests: 700,
        spendCents: 4986,
      }),
      ev({
        timestamp: now - 1 * dayMs,
        model: "gpt-5.6-sol-medium",
        kind: "On-Demand",
        totalTokens: 38_000_000,
        requests: 1035,
        spendCents: 3405,
      }),
    ];

    const quotaAware = aggregateByModel(events, [], "7d", null, now, "tokens", "desc", true);
    expect(quotaAware).toEqual([
      { model: "gpt-5.6-sol-medium", totalTokens: 58_000_000, requests: 1735, spendCents: 3405 },
      {
        model: "Cursor Grok 4.5 (Auto Balanced)",
        totalTokens: 18_500_000,
        requests: 321,
        spendCents: 0,
      },
    ]);

    const raw = aggregateByModel(events, [], "7d", null, now, "tokens", "desc", false);
    expect(raw.find((r) => r.model === "gpt-5.6-sol-medium")?.spendCents).toBe(4986 + 3405);
    expect(raw.find((r) => r.model === "Cursor Grok 4.5 (Auto Balanced)")?.spendCents).toBe(1283);
  });

  it("supports sorting by selected column and direction", () => {
    const events: UsageEvent[] = [
      ev({ timestamp: now - 1 * dayMs, model: "zeta", kind: "On-Demand", totalTokens: 100, requests: 3, spendCents: 100 }),
      ev({ timestamp: now - 1 * dayMs, model: "alpha", kind: "On-Demand", totalTokens: 200, requests: 1, spendCents: 25 }),
      ev({ timestamp: now - 1 * dayMs, model: "beta", kind: "On-Demand", totalTokens: 150, requests: 2, spendCents: 50 }),
    ];

    const modelAsc = aggregateByModel(events, [], "7d", null, now, "model", "asc");
    expect(modelAsc.map((row) => row.model)).toEqual(["alpha", "beta", "zeta"]);

    const requestsDesc = aggregateByModel(events, [], "7d", null, now, "requests", "desc");
    expect(requestsDesc.map((row) => row.model)).toEqual(["zeta", "beta", "alpha"]);

    const spendAsc = aggregateByModel(events, [], "7d", null, now, "spend", "asc");
    expect(spendAsc.map((row) => row.model)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("applies duration cutoffs for 1d, 7d, and 30d", () => {
    const events: UsageEvent[] = [
      ev({ timestamp: now - 6 * dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 100, requests: 1, spendCents: 50 }),
      ev({ timestamp: now - 20 * dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 200, requests: 1, spendCents: 80 }),
      ev({ timestamp: now - 35 * dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 300, requests: 1, spendCents: 90 }),
    ];

    const oneDay = aggregateByModel(events, [], "1d", null, now);
    expect(oneDay).toHaveLength(0);

    const sevenDays = aggregateByModel(events, [], "7d", null, now);
    expect(sevenDays[0]).toEqual({
      model: "gpt-5.3-codex",
      totalTokens: 100,
      requests: 1,
      spendCents: 50,
    });

    const thirtyDays = aggregateByModel(events, [], "30d", null, now);
    expect(thirtyDays[0]).toEqual({
      model: "gpt-5.3-codex",
      totalTokens: 300,
      requests: 2,
      spendCents: 130,
    });
  });

  it("uses previous cycle boundary for billingCycle", () => {
    const resetsAt = "2026-05-15T00:00:00.000Z";
    const cycleStart = Date.UTC(2026, 3, 15, 0, 0, 0);

    const events: UsageEvent[] = [
      ev({ timestamp: cycleStart - 1_000, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 50, requests: 1, spendCents: 20 }),
      ev({ timestamp: cycleStart + 1_000, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 75, requests: 1, spendCents: 30 }),
    ];

    const rows = aggregateByModel(events, [], "billingCycle", resetsAt, now);
    expect(rows).toEqual([
      { model: "gpt-5.3-codex", totalTokens: 75, requests: 1, spendCents: 30 },
    ]);
  });

  it("keeps full current cycle for a 31-day month", () => {
    const may31Noon = Date.UTC(2026, 4, 31, 12, 0, 0);
    const resetsAt = "2026-06-01T00:00:00.000Z";
    const cycleStart = Date.UTC(2026, 4, 1, 0, 0, 0);

    const events: UsageEvent[] = [
      ev({ timestamp: cycleStart + 1000, model: "gpt-5.3-codex", kind: "Included", totalTokens: 111, requests: 1 }),
      ev({ timestamp: cycleStart - 1000, model: "gpt-5.3-codex", kind: "Included", totalTokens: 222, requests: 1 }),
    ];

    const rows = aggregateByModel(events, [], "billingCycle", resetsAt, may31Noon);
    expect(rows).toEqual([
      { model: "gpt-5.3-codex", totalTokens: 111, requests: 1, spendCents: 0 },
    ]);
  });
});

describe("model breakdown formatting", () => {
  it("formats cents into dollars", () => {
    expect(formatDollarsFromCents(0)).toBe("$0.00");
    expect(formatDollarsFromCents(229)).toBe("$2.29");
    expect(formatDollarsFromCents(12345)).toBe("$123.45");
  });

  it("computes cutoff timestamps for all durations", () => {
    expect(getDurationCutoff("1d", null, now)).toBe(now - 1 * dayMs);
    expect(getDurationCutoff("7d", null, now)).toBe(now - 7 * dayMs);
    expect(getDurationCutoff("30d", null, now)).toBe(now - 30 * dayMs);
    expect(getDurationCutoff("billingCycle", "2026-05-01T00:00:00.000Z", now)).toBe(Date.UTC(2026, 3, 1, 0, 0, 0));
  });

  it("optionally filters out models with zero tokens", () => {
    const rows = [
      { model: "gpt-5.4-high", totalTokens: 10_000, requests: 10, spendCents: 500 },
      { model: "gpt-5.3-codex-spark-preview-high", totalTokens: 0, requests: 2, spendCents: 0 },
    ];

    expect(filterZeroTokenModels(rows, false)).toEqual(rows);
    expect(filterZeroTokenModels(rows, true)).toEqual([
      { model: "gpt-5.4-high", totalTokens: 10_000, requests: 10, spendCents: 500 },
    ]);
  });
});
