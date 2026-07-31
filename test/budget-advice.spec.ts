import { describe, expect, it } from "bun:test";
import type { UsageEvent, UsagePayload } from "../src/cursor-api";
import {
  BUDGET_ADVICE_FALLBACK,
  buildBudgetAdvice,
} from "../src/budget-advice";

const DAY_MS = 86_400_000;

function payload(partial?: Partial<UsagePayload>): UsagePayload {
  return {
    includedRequests: {
      used: 1800,
      limit: 2000,
      unit: "cents",
      apiUsed: 1800,
      apiLimit: 2000,
      bonusCents: 0,
      apiPercentUsed: 90,
      autoPercentUsed: 10,
      totalPercentUsed: 90,
    },
    onDemand: {
      state: "limited",
      spendDollars: 32.31,
      limitDollars: 50,
    },
    resetsAt: new Date(Date.UTC(2026, 6, 31)).toISOString(),
    ...partial,
  };
}

function onDemandEvent(
  timestamp: number,
  model: string,
  spendCents: number,
  totalTokens: number,
): UsageEvent {
  return {
    timestamp,
    model,
    kind: "On-Demand",
    totalTokens,
    requests: 1,
    spendCents,
    maxMode: false,
  };
}

describe("buildBudgetAdvice", () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0);

  it("builds a status line with included, on-demand, and cycle estimate", () => {
    const report = buildBudgetAdvice({
      data: payload(),
      events: [],
      monthlyBudgetDollars: null,
      usageDuration: "7d",
      excludeZeroTokenModels: false,
      now,
    });
    expect(report.statusLine).toContain("Included $18.00/$20.00");
    expect(report.statusLine).toContain("On-demand $32.31/$50.00");
    expect(report.statusLine).toMatch(/cycle est\. ~\$\d+/);
  });

  it("omits cycle estimate when on-demand is disabled", () => {
    const report = buildBudgetAdvice({
      data: payload({
        onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
      }),
      events: [],
      monthlyBudgetDollars: null,
      usageDuration: "7d",
      excludeZeroTokenModels: false,
      now,
    });
    expect(report.statusLine).toContain("On-demand off");
    expect(report.statusLine).not.toContain("cycle est.");
  });

  it("toasts only the highest-priority tip (Pace → Pool → Efficiency)", () => {
    const events = [
      onDemandEvent(now - DAY_MS, "opus", 2000, 1_000_000),
      onDemandEvent(now - DAY_MS, "sonnet", 100, 1_000_000),
      onDemandEvent(now, "opus", 700, 100_000),
      onDemandEvent(now - DAY_MS, "opus", 700, 100_000),
      onDemandEvent(now - 2 * DAY_MS, "opus", 700, 100_000),
      onDemandEvent(now - 3 * DAY_MS, "opus", 700, 100_000),
      onDemandEvent(now - 4 * DAY_MS, "opus", 700, 100_000),
      onDemandEvent(now - 5 * DAY_MS, "opus", 700, 100_000),
      onDemandEvent(now - 6 * DAY_MS, "opus", 700, 100_000),
    ];

    const report = buildBudgetAdvice({
      data: payload({
        includedRequests: {
          used: 1900,
          limit: 2000,
          unit: "cents",
          apiUsed: 1900,
          apiLimit: 2000,
          bonusCents: 4166,
          apiPercentUsed: 95,
          autoPercentUsed: 5,
          totalPercentUsed: 95,
        },
      }),
      events,
      monthlyBudgetDollars: null,
      usageDuration: "7d",
      excludeZeroTokenModels: false,
      now,
    });

    expect(report.poolAdvice).toBeTruthy();
    expect(report.paceLine).toBeTruthy();
    expect(report.efficiencyAdvice).toContain("Most expensive:");
    expect(report.tips[0]).toBe(report.paceLine);
    expect(report.toastTip).toBe(report.paceLine);
    expect(report.toastMessage).toBe(`${report.statusLine}\nTip: ${report.paceLine}`);
    expect(report.toastMessage).not.toContain("• ");
    expect(report.detailText).toContain("── Status");
    expect(report.detailText).toContain("── Pool");
    expect(report.detailText).toContain("── Pace");
    expect(report.detailText).toContain("── Model efficiency");
    expect(report.detailText).toContain("Most expensive");
    expect(report.detailText).toContain("Try instead");
  });

  it("uses fallback toast when no tips fire", () => {
    const report = buildBudgetAdvice({
      data: {
        includedRequests: {
          used: 10,
          limit: 500,
          unit: "requests",
        },
        onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
        resetsAt: null,
      },
      events: [],
      monthlyBudgetDollars: null,
      usageDuration: "7d",
      excludeZeroTokenModels: false,
      now,
    });
    expect(report.tips).toEqual([]);
    expect(report.toastTip).toBeNull();
    expect(report.toastMessage).toContain(BUDGET_ADVICE_FALLBACK);
    expect(report.detailText).toContain("── Pool");
    expect(report.detailText).toContain("  —");
  });

  it("writes detail sections with generated timestamp", () => {
    const report = buildBudgetAdvice({
      data: payload(),
      events: [],
      monthlyBudgetDollars: null,
      usageDuration: "7d",
      excludeZeroTokenModels: false,
      now,
    });
    expect(report.detailText).toContain("Cursor Usage — Budget Advice");
    expect(report.detailText).toContain(`Generated: ${new Date(now).toISOString()}`);
    expect(report.detailText).toContain("Open Dashboard for charts");
    expect(report.detailText).toContain("Included   $18.00/$20.00");
  });
});
