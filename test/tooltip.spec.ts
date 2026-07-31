import { describe, expect, it } from "bun:test";
import { buildUsageByModelHeadingMarkdown, buildUsageOverviewMarkdown } from "../src/tooltip";

const progressBar = {
  markdown: (ratio: number) => `[bar:${ratio.toFixed(2)}]`,
  html: (ratio: number) => `<bar:${ratio.toFixed(2)}>`,
  divider: () => "<divider />",
};

describe("buildUsageOverviewMarkdown", () => {
  it("renders a balanced two-column summary for limited on-demand spend", () => {
    const markdown = buildUsageOverviewMarkdown(
      {
        includedRequests: { used: 500, limit: 500, unit: "requests" },
        onDemand: { state: "limited", spendDollars: 66.89, limitDollars: 200 },
      },
      progressBar,
    );

    expect(markdown).toContain("<td><sub>Included</sub></td>");
    expect(markdown).toContain("<td><sub>On-demand</sub></td>");
    expect(markdown).toContain("<td width=\"2%\" rowspan=\"3\" valign=\"top\"><divider /></td>");
    expect(markdown).toContain("<strong>500 / 500</strong>");
    expect(markdown).toContain("<strong>$66.89 / $200.00</strong>");
    expect(markdown).toContain("<bar:1.00>");
    expect(markdown).toContain("<bar:0.33>");
    expect(markdown.match(/<table/g)?.length).toBe(1);
    expect(markdown).not.toContain("width=\"49%\"");
    expect(markdown).not.toContain("100% used");
    expect(markdown).not.toContain("of $200.00 (33%)");
    expect(markdown).not.toContain("Included Requests");
    expect(markdown).not.toContain("On-Demand Spend");
  });

  it("renders unlimited copy on the bottom row so the columns stay aligned", () => {
    const markdown = buildUsageOverviewMarkdown(
      {
        includedRequests: { used: 500, limit: 500, unit: "requests" },
        onDemand: { state: "unlimited", spendDollars: 66.89, limitDollars: null },
      },
      progressBar,
    );

    expect(markdown).toContain("<td><sub>Included</sub></td>");
    expect(markdown).toContain("<td><sub>On-demand</sub></td>");
    expect(markdown).toContain("<td width=\"2%\" rowspan=\"3\" valign=\"top\"><divider /></td>");
    expect(markdown).toContain("<strong>500 / 500</strong>");
    expect(markdown).toContain("<strong>$66.89</strong>");
    expect(markdown).toContain("<bar:1.00>");
    expect(markdown).toContain("<tr><td><bar:1.00></td><td><sub>Unlimited</sub></td></tr>");
    expect(markdown.match(/<table/g)?.length).toBe(2);
    expect(markdown).not.toContain("width=\"49%\"");
    expect(markdown).not.toContain("100% used");
    expect(markdown).not.toContain("No spend cap");
    expect(markdown).not.toContain("Included Requests");
    expect(markdown).not.toContain("On-Demand Spend");
  });

  it("appends pool lines and advice under the overview when cents pools exist", () => {
    const markdown = buildUsageOverviewMarkdown(
      {
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
      },
      progressBar,
    );
    expect(markdown).toContain("API pool");
    expect(markdown).toContain("Prefer Auto / Cursor Models");
    expect(markdown.match(/<table width="302" cellspacing="0" cellpadding="8" border="2"/g)?.length).toBe(2);
  });

  it("renders a single-column balanced summary when on-demand is hidden", () => {
    const markdown = buildUsageOverviewMarkdown(
      {
        includedRequests: { used: 42, limit: 500, unit: "requests" },
        onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
      },
      progressBar,
    );

    expect(markdown).toContain('<table width="100%" cellspacing="0" cellpadding="0">');
    expect(markdown).toContain("<td width=\"100%\"><sub>Included</sub></td>");
    expect(markdown).toContain("<strong>42 / 500</strong>");
    expect(markdown).toContain("<bar:0.08>");
    expect(markdown).not.toContain("<divider />");
    expect(markdown).not.toContain("8% used");
    expect(markdown).not.toContain("On-demand");
  });

  it("appends a high-pace forecast line when cycle estimate is over baseline", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const events = Array.from({ length: 7 }, (_, i) => ({
      timestamp: Date.UTC(2026, 6, 9 + i, 3, 0, 0),
      model: "gpt-5",
      kind: "On-Demand" as const,
      totalTokens: 10,
      requests: 1,
      spendCents: 1000,
      maxMode: false,
    }));
    const markdown = buildUsageOverviewMarkdown(
      {
        includedRequests: { used: 100, limit: 500, unit: "requests" },
        onDemand: { state: "limited", spendDollars: 20, limitDollars: 50 },
        resetsAt: new Date(Date.UTC(2026, 6, 22)).toISOString(),
      },
      progressBar,
      { events, monthlyBudgetDollars: null, now },
    );

    expect(markdown).toContain("High pace");
    expect(markdown).toContain("cycle estimate");
    expect(markdown).toContain("**$(graph) Budget forecast**");
    expect(markdown).toContain("⚠️");
    expect(markdown.match(/<table width="302" cellspacing="0" cellpadding="8" border="2"/g)?.length).toBe(1);
  });
});

describe("buildUsageByModelHeadingMarkdown", () => {
  it("includes a Change link that routes to the duration setting", () => {
    const markdown = buildUsageByModelHeadingMarkdown("billingCycle");

    expect(markdown).toContain("**$(list-unordered) Usage by Model** *(Current Billing Cycle)*");
    expect(markdown).toContain("[Change](command:cursor-usage.openDurationSetting)");
  });
});
