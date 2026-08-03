import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

describe("dashboard security hardening", () => {
  it("guards CSV exports against spreadsheet formula injection", () => {
    const dashboardScript = readFileSync("media/dashboard/dashboard.js", "utf-8");

    expect(dashboardScript).toContain("/^\\s*[=+\\-@]/");
    expect(dashboardScript).toContain("\"'\" + s");
  });

  it("forces Events section collapsed on every dashboard load", () => {
    const dashboardScript = readFileSync("media/dashboard/dashboard.js", "utf-8");

    expect(dashboardScript).toContain("events: false");
    expect(dashboardScript).not.toContain("events: persisted.sectionOpen?.events !== false");
  });

  it("renders On-Demand summary using the shared onDemandLimitDollars ceiling", () => {
    const dashboardScript = readFileSync("media/dashboard/dashboard.js", "utf-8");

    expect(dashboardScript).toContain("state.onDemandLimitDollars");
    expect(dashboardScript).not.toContain("onDemand.limitDollars || 0");
  });
});
