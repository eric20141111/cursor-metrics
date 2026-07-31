import { describe, expect, it } from "bun:test";
import type { UsageEvent } from "../src/cursor-api";
import {
  buildSpendForecast,
  calendarDailyBurnDollars,
  daysUntilReset,
  formatForecastDashboard,
  HIGH_PACE_RATIO,
  resolveOnDemandBaseline,
  sumOnDemandCentsLastCalendarDays,
} from "../src/spend-forecast";

const DAY_MS = 86_400_000;

function onDemandEvent(timestamp: number, spendCents: number): UsageEvent {
  return {
    timestamp,
    model: "gpt-5",
    kind: "On-Demand",
    totalTokens: 20,
    requests: 1,
    spendCents,
    maxMode: false,
  };
}

function includedEvent(timestamp: number, spendCents: number): UsageEvent {
  return {
    ...onDemandEvent(timestamp, spendCents),
    kind: "Included",
  };
}

describe("calendar burn window", () => {
  it("averages On-Demand spend across 7 calendar days including idle $0 days", () => {
    // Fixed "now": 2026-07-15T12:00:00Z → window Jul 9–15
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const events = [
      onDemandEvent(Date.UTC(2026, 6, 15, 1, 0, 0), 700), // $7 today
      onDemandEvent(Date.UTC(2026, 6, 10, 1, 0, 0), 700), // $7 on Jul 10
      includedEvent(Date.UTC(2026, 6, 14, 1, 0, 0), 5000), // ignored
      onDemandEvent(Date.UTC(2026, 6, 1, 1, 0, 0), 9999), // outside window
    ];
    expect(sumOnDemandCentsLastCalendarDays(events, now)).toBe(1400);
    // $14 / 7 = $2/day
    expect(calendarDailyBurnDollars(events, now)).toBeCloseTo(2, 5);
  });
});

describe("daysUntilReset", () => {
  it("ceils remaining time to whole days", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const reset = new Date(Date.UTC(2026, 6, 20, 0, 0, 0)).toISOString();
    expect(daysUntilReset(reset, now)).toBe(5);
  });

  it("returns 0 when reset is missing or past", () => {
    expect(daysUntilReset(null)).toBe(0);
    const now = Date.UTC(2026, 6, 15);
    expect(daysUntilReset(new Date(now - DAY_MS).toISOString(), now)).toBe(0);
  });
});

describe("resolveOnDemandBaseline", () => {
  it("prefers hard On-demand limit over monthly budget", () => {
    expect(
      resolveOnDemandBaseline(
        { state: "limited", spendDollars: 10, limitDollars: 50 },
        80,
      ),
    ).toEqual({ dollars: 50, source: "hard_limit" });
  });

  it("falls back to monthly budget when unlimited or no hard limit", () => {
    expect(
      resolveOnDemandBaseline(
        { state: "unlimited", spendDollars: 10, limitDollars: null },
        40,
      ),
    ).toEqual({ dollars: 40, source: "monthly_budget" });
  });

  it("returns null when neither baseline exists", () => {
    expect(
      resolveOnDemandBaseline(
        { state: "unlimited", spendDollars: 10, limitDollars: null },
        null,
      ),
    ).toBeNull();
  });
});

describe("buildSpendForecast", () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0);
  const resetsAt = new Date(Date.UTC(2026, 6, 22, 0, 0, 0)).toISOString(); // 7 days left

  it("marks high pace when cycle estimate exceeds baseline by HIGH_PACE_RATIO", () => {
    // burn $10/day over 7 days window → dailyBurn 10
    // current 20 + 10*7 = 90 vs baseline 50 → 1.8x → high
    const events = Array.from({ length: 7 }, (_, i) =>
      onDemandEvent(Date.UTC(2026, 6, 9 + i, 3, 0, 0), 1000),
    );
    const forecast = buildSpendForecast({
      onDemand: { state: "limited", spendDollars: 20, limitDollars: 50 },
      resetsAt,
      events,
      now,
    });
    expect(forecast.dailyBurnDollars).toBeCloseTo(10, 5);
    expect(forecast.daysLeft).toBe(7);
    expect(forecast.cycleEstimateDollars).toBeCloseTo(90, 5);
    expect(forecast.level).toBe("high");
    expect(forecast.statusMark).toBe("⚠");
    expect(forecast.tooltipLine).toContain("High pace");
    expect(HIGH_PACE_RATIO).toBe(1.2);
  });

  it("stays on_track when estimate is under 1.2× baseline", () => {
    // $1/day × 7 days window; current $5 + 1*7 = 12 vs baseline 50
    const events = Array.from({ length: 7 }, (_, i) =>
      onDemandEvent(Date.UTC(2026, 6, 9 + i, 3, 0, 0), 100),
    );
    const forecast = buildSpendForecast({
      onDemand: { state: "limited", spendDollars: 5, limitDollars: 50 },
      resetsAt,
      events,
      now,
    });
    expect(forecast.level).toBe("on_track");
    expect(forecast.statusMark).toBeNull();
    expect(forecast.tooltipLine).toBeNull();
  });

  it("shows estimate without pace when no baseline", () => {
    const forecast = buildSpendForecast({
      onDemand: { state: "unlimited", spendDollars: 12, limitDollars: null },
      resetsAt,
      events: [onDemandEvent(Date.UTC(2026, 6, 14, 1, 0, 0), 700)],
      monthlyBudgetDollars: null,
      now,
    });
    expect(forecast.level).toBe("unknown");
    expect(forecast.statusMark).toBeNull();
    expect(forecast.tooltipLine).toContain("Cycle estimate");
    expect(forecast.tooltipLine).toContain("monthly On-demand budget");
  });
});

describe("formatForecastDashboard", () => {
  it("renders pace label and baseline rows", () => {
    const forecast = buildSpendForecast({
      onDemand: { state: "limited", spendDollars: 10, limitDollars: 40 },
      resetsAt: new Date(Date.UTC(2026, 6, 20)).toISOString(),
      events: [],
      now: Date.UTC(2026, 6, 15),
    });
    const view = formatForecastDashboard(forecast);
    expect(view.title).toContain("On track");
    expect(view.rows.some((r) => r.label === "Baseline" && r.value.includes("Hard limit"))).toBe(true);
  });
});
