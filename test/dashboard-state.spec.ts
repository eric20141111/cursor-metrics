import { describe, expect, it } from "bun:test";
import type { UsageEvent, UsagePayload } from "../src/cursor-api";
import {
  aggregateChartSeries,
  buildDashboardState,
  filterEventsForRange,
  summarizeRange,
} from "../src/dashboard-state";

const dayMs = 86_400_000;
const now = Date.UTC(2026, 3, 20, 12, 0, 0);

const sampleData: UsagePayload = {
  includedRequests: { used: 100, limit: 500, unit: "requests" },
  onDemand: { state: "limited", spendDollars: 12.5, limitDollars: 100 },
  resetsAt: null,
};

const sampleEvents: UsageEvent[] = [
  { timestamp: now - 1 * dayMs, model: "gpt-5.3-codex", kind: "Included", totalTokens: 2000, requests: 2, spendCents: 0, maxMode: false },
  { timestamp: now - 1 * dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 3000, requests: 1.5, spendCents: 320, maxMode: true },
  { timestamp: now - 2 * dayMs, model: "composer-2", kind: "Included", totalTokens: 500, requests: 4, spendCents: 0, maxMode: false },
  { timestamp: now - 2 * dayMs, model: "composer-2", kind: "On-Demand", totalTokens: 100, requests: 0.6, spendCents: 50, maxMode: false },
  { timestamp: now - 8 * dayMs, model: "gpt-5.3-codex", kind: "Included", totalTokens: 9999, requests: 9, spendCents: 0, maxMode: false },
];

describe("buildDashboardState", () => {
  it("returns a serializable snapshot of inputs", () => {
    const state = buildDashboardState(sampleData, sampleEvents, [], true, null, now);
    expect(state.generatedAt).toBe(now);
    expect(state.data).toBe(sampleData);
    expect(state.events.length).toBe(5);
    expect(state.isTeamMember).toBeTrue();
    expect(state.quotaAwareEventDisplay).toBeTrue();
    expect(state.onDemandLimitDollars).toBe(1000);
    expect(state.error).toBeNull();
    expect(state.resetsAt).toBeNull();
  });

  it("propagates a custom on-demand display limit", () => {
    const state = buildDashboardState(sampleData, sampleEvents, [], true, null, now, true, null, 500);
    expect(state.onDemandLimitDollars).toBe(500);
  });

  it("propagates resetsAt from data", () => {
    const dataWithReset: UsagePayload = { ...sampleData, resetsAt: "2026-05-01T00:00:00.000Z" };
    const state = buildDashboardState(dataWithReset, [], [], false, null, now);
    expect(state.resetsAt).toBe("2026-05-01T00:00:00.000Z");
    expect(state.isTeamMember).toBeFalse();
  });

  it("handles null data without throwing", () => {
    const state = buildDashboardState(null, [], [], false, "boom", now);
    expect(state.data).toBeNull();
    expect(state.error).toBe("boom");
  });

  it("includes poolInsight lines and advice for cents payloads", () => {
    const data: UsagePayload = {
      includedRequests: {
        used: 2112,
        limit: 6166,
        unit: "cents",
        apiUsed: 2000,
        apiLimit: 2000,
        bonusCents: 4166,
        apiPercentUsed: 100,
        autoPercentUsed: 5.64,
        totalPercentUsed: 34.26,
      },
      onDemand: { state: "unlimited", spendDollars: 32.31, limitDollars: null },
      resetsAt: "2026-08-29T00:00:00.000Z",
    };

    const state = buildDashboardState(data, [], [], true, null, now);

    expect(state.poolInsight).not.toBeNull();
    expect(state.poolInsight!.advice).toContain("Prefer Auto / Cursor Models");
    expect(state.poolInsight!.lines.some((line) => line.label === "API pool")).toBeTrue();
  });

  it("includes spendForecast when on-demand is enabled", () => {
    const data: UsagePayload = {
      ...sampleData,
      resetsAt: "2026-05-01T00:00:00.000Z",
    };
    const events: UsageEvent[] = [
      {
        timestamp: now - dayMs,
        model: "gpt-5",
        kind: "On-Demand",
        totalTokens: 100,
        requests: 1,
        spendCents: 700,
        maxMode: false,
      },
    ];
    const state = buildDashboardState(data, events, [], false, null, now, true, 50);

    expect(state.spendForecast).not.toBeNull();
    expect(state.spendForecast!.title).toContain("Budget forecast");
    expect(state.spendForecast!.rows.some((r) => r.label === "Cycle-end estimate")).toBeTrue();
  });

  it("omits spendForecast when on-demand is disabled", () => {
    const data: UsagePayload = {
      ...sampleData,
      onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
    };
    const state = buildDashboardState(data, [], [], false, null, now);
    expect(state.spendForecast).toBeNull();
  });
});

describe("filterEventsForRange", () => {
  it("respects the 7d cutoff", () => {
    const filtered = filterEventsForRange(sampleEvents, "7d", null, "all", now);
    expect(filtered.length).toBe(4); // 8-day-old excluded
  });

  it("includes everything in 30d", () => {
    const filtered = filterEventsForRange(sampleEvents, "30d", null, "all", now);
    expect(filtered.length).toBe(5);
  });

  it("filters by Included kind", () => {
    const filtered = filterEventsForRange(sampleEvents, "7d", null, "included", now);
    expect(filtered.every((e) => e.kind === "Included")).toBeTrue();
    expect(filtered.length).toBe(2);
  });

  it("filters by On-Demand kind", () => {
    const filtered = filterEventsForRange(sampleEvents, "7d", null, "ondemand", now);
    expect(filtered.length).toBe(2);
    expect(filtered.every((e) => e.kind === "On-Demand")).toBeTrue();
  });
});

describe("aggregateChartSeries", () => {
  const sumOf = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  it("produces per-day (non-cumulative) tokens per model", () => {
    const series = aggregateChartSeries(sampleEvents, [], "7d", null, "tokens", "all", now);
    expect(series.labels.length).toBeGreaterThan(0);
    expect(series.datasets.length).toBe(2);
    const codex = series.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    const composer = series.datasets.find((d) => d.model === "composer-2")!;
    // Sum of per-day buckets equals total over the range.
    expect(sumOf(codex.data)).toBe(5000); // 2000 + 3000
    expect(sumOf(composer.data)).toBe(600); // 500 + 100
    // Confirm at least one zero day exists between the two activity days for codex (1d ago and never else in this range).
    expect(codex.data.some((v) => v === 0)).toBeTrue();
  });

  it("produces fractional requests per model (per-day)", () => {
    const series = aggregateChartSeries(sampleEvents, [], "7d", null, "requests", "all", now);
    const codex = series.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    const composer = series.datasets.find((d) => d.model === "composer-2")!;
    expect(sumOf(codex.data)).toBeCloseTo(3.5, 5); // 2 + 1.5
    expect(sumOf(composer.data)).toBeCloseTo(4.6, 5); // 4 + 0.6
  });

  it("uses per-event spend (chargedCents) for spend metric", () => {
    const series = aggregateChartSeries(sampleEvents, [], "7d", null, "spend", "all", now);
    const codex = series.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    const composer = series.datasets.find((d) => d.model === "composer-2")!;
    expect(sumOf(codex.data)).toBeCloseTo(3.2, 5); // 320c = $3.20
    expect(sumOf(composer.data)).toBeCloseTo(0.5, 5); // 50c = $0.50
  });

  it("applies usage filter to spend (only on-demand events have spend)", () => {
    const onlyIncluded = aggregateChartSeries(sampleEvents, [], "7d", null, "spend", "included", now);
    expect(onlyIncluded.datasets.every((d) => sumOf(d.data) === 0)).toBeTrue();
    const onlyOnDemand = aggregateChartSeries(sampleEvents, [], "7d", null, "spend", "ondemand", now);
    const codex = onlyOnDemand.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    expect(sumOf(codex.data)).toBeCloseTo(3.2, 5);
  });

  it("does not count chargedCents as spend while requests are included by default", () => {
    const events: UsageEvent[] = [
      { timestamp: now - dayMs, model: "gpt-5.3-codex", kind: "Included", totalTokens: 2000, requests: 2, spendCents: 450, maxMode: false },
      { timestamp: now - dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 3000, requests: 1.5, spendCents: 320, maxMode: true },
    ];

    const series = aggregateChartSeries(events, [], "7d", null, "spend", "all", now);
    const codex = series.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    expect(sumOf(codex.data)).toBeCloseTo(3.2, 5);
  });

  it("keeps included chargedCents in spend when quota-aware display is disabled", () => {
    const events: UsageEvent[] = [
      { timestamp: now - dayMs, model: "gpt-5.3-codex", kind: "Included", totalTokens: 2000, requests: 2, spendCents: 450, maxMode: false },
      { timestamp: now - dayMs, model: "gpt-5.3-codex", kind: "On-Demand", totalTokens: 3000, requests: 1.5, spendCents: 320, maxMode: true },
    ];

    const series = aggregateChartSeries(events, [], "7d", null, "spend", "all", now, false);
    const codex = series.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    expect(sumOf(codex.data)).toBeCloseTo(7.7, 5);
  });

  it("respects usage filter for token metric", () => {
    const onlyIncluded = aggregateChartSeries(sampleEvents, [], "7d", null, "tokens", "included", now);
    const incCodex = onlyIncluded.datasets.find((d) => d.model === "gpt-5.3-codex")!;
    expect(sumOf(incCodex.data)).toBe(2000);
  });

  it("returns empty datasets when no events fall in range", () => {
    const series = aggregateChartSeries([], [], "7d", null, "tokens", "all", now);
    expect(series.datasets.length).toBe(0);
    expect(series.labels.length).toBeGreaterThan(0);
  });

  it("orders datasets by descending range total", () => {
    const series = aggregateChartSeries(sampleEvents, [], "7d", null, "tokens", "all", now);
    const totals = series.datasets.map((d) => sumOf(d.data));
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i - 1]).toBeGreaterThanOrEqual(totals[i]!);
    }
  });
});

describe("summarizeRange", () => {
  it("counts included requests and on-demand spend separately", () => {
    const s = summarizeRange(sampleEvents, "7d", null, now);
    // Included in 7d: 2 (codex) + 4 (composer) = 6
    expect(s.includedRequests).toBe(6);
    expect(s.totalRequests).toBe(6); // matches Cursor's "Total" tile, which counts included
    // On-demand spend in 7d: 320 + 50 = 370c = $3.70
    expect(s.onDemandSpendDollars).toBeCloseTo(3.7, 5);
    // Tokens across all events in 7d
    expect(s.totalTokens).toBe(2000 + 3000 + 500 + 100);
  });

  it("excludes events outside the cutoff", () => {
    const s = summarizeRange(sampleEvents, "1d", null, now);
    // Only 1-day-old events: codex Included (2) + codex OnDemand (no included)
    expect(s.includedRequests).toBe(2);
    expect(s.onDemandSpendDollars).toBeCloseTo(3.2, 5);
  });
});
