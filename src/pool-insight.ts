import type { UsagePayload } from "./cursor-api";

export type PoolBreakdown = {
  hasPools: boolean;
  api: { usedCents: number; limitCents: number; percentUsed: number | null } | null;
  bonus: { usedCents: number; limitCents: number } | null;
  autoPercentUsed: number | null;
  apiRatio: number;
  totalRatio: number;
};

export type PoolInsightView = {
  lines: Array<{ label: string; value: string }>;
  advice: string | null;
};

export function formatTooltipNoticeMarkdown(text: string, icon = "💡"): string {
  return [
    `<table width="302" cellspacing="0" cellpadding="6" border="1">`,
    `  <tr><td width="24" valign="top">${icon}</td><td><em>${text}</em></td></tr>`,
    `</table>`,
    ``,
  ].join("\n");
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildPoolBreakdown(
  data: Pick<UsagePayload, "includedRequests" | "onDemand">,
): PoolBreakdown {
  const inc = data.includedRequests;
  const apiLimit = inc.apiLimit;
  const apiUsed = inc.apiUsed ?? 0;
  const unitOk = (inc.unit ?? "requests") === "cents";
  const hasBreakdown =
    inc.bonusCents != null ||
    inc.totalPercentUsed != null ||
    inc.limit !== apiLimit;
  const hasPools =
    unitOk && typeof apiLimit === "number" && apiLimit > 0 && hasBreakdown;

  if (!hasPools) {
    return {
      hasPools: false,
      api: null,
      bonus: null,
      autoPercentUsed: null,
      apiRatio: 0,
      totalRatio: 0,
    };
  }

  const bonusLimit = Math.max(inc.bonusCents ?? 0, Math.max(inc.limit - apiLimit, 0));
  const bonusUsed = Math.min(Math.max(inc.used - apiLimit, 0), bonusLimit);
  const showBonus = bonusLimit > 0;

  return {
    hasPools: true,
    api: {
      usedCents: apiUsed,
      limitCents: apiLimit,
      percentUsed: inc.apiPercentUsed ?? null,
    },
    bonus: showBonus ? { usedCents: bonusUsed, limitCents: bonusLimit } : null,
    autoPercentUsed: inc.autoPercentUsed ?? null,
    apiRatio: apiLimit > 0 ? Math.min(1, apiUsed / apiLimit) : 0,
    totalRatio: inc.limit > 0 ? Math.min(1, inc.used / inc.limit) : 0,
  };
}

export function buildPoolAdvice(
  breakdown: PoolBreakdown,
  onDemand: UsagePayload["onDemand"],
): string | null {
  if (!breakdown.hasPools) return null;

  if (onDemand.state === "disabled" && breakdown.totalRatio >= 1) {
    return "Included exhausted and On-demand is off — usage may be limited until the next cycle.";
  }

  if (breakdown.totalRatio >= 0.9 && onDemand.state !== "disabled") {
    return "Included is nearly gone — further use is mostly On-demand.";
  }

  if (breakdown.apiRatio >= 0.8) {
    return "Prefer Auto / Cursor Models for routine work; manual premium models keep drawing Bonus / On-demand.";
  }

  return "Manual models are fine; watch the API pool on expensive picks.";
}

function buildPoolInsightLines(
  breakdown: PoolBreakdown,
  onDemand: UsagePayload["onDemand"],
): PoolInsightView["lines"] {
  const lines: PoolInsightView["lines"] = [];
  if (breakdown.api) {
    const percent =
      breakdown.api.percentUsed !== null ? `${Math.round(breakdown.api.percentUsed)}% · ` : "";
    lines.push({
      label: "API pool",
      value: `${percent}${dollars(breakdown.api.usedCents)} / ${dollars(breakdown.api.limitCents)}`,
    });
  }
  if (breakdown.bonus) {
    lines.push({
      label: "Bonus",
      value: `${dollars(breakdown.bonus.usedCents)} / ${dollars(breakdown.bonus.limitCents)}`,
    });
  }
  if (breakdown.autoPercentUsed !== null) {
    lines.push({
      label: "Auto / Cursor Models",
      value: `~${breakdown.autoPercentUsed.toFixed(1)}% used`,
    });
  }
  if (onDemand.state !== "disabled") {
    const value =
      onDemand.state === "unlimited"
        ? `$${onDemand.spendDollars.toFixed(2)}`
        : `$${onDemand.spendDollars.toFixed(2)} / $${(onDemand.limitDollars ?? 0).toFixed(2)}`;
    lines.push({ label: "On-demand", value });
  }
  return lines;
}

export function buildPoolInsightView(
  data: Pick<UsagePayload, "includedRequests" | "onDemand">,
): PoolInsightView | null {
  const breakdown = buildPoolBreakdown(data);
  if (!breakdown.hasPools) return null;

  return {
    lines: buildPoolInsightLines(breakdown, data.onDemand),
    advice: buildPoolAdvice(breakdown, data.onDemand),
  };
}

export function formatPoolInsightMarkdown(
  breakdown: PoolBreakdown,
  onDemand: UsagePayload["onDemand"],
  advice: string | null,
): string {
  if (!breakdown.hasPools) return "";

  const lines = buildPoolInsightLines(breakdown, onDemand).map(
    ({ label, value }) =>
      `  <tr><td><sub>${label}</sub></td><td align="right"><sub>${value}</sub></td></tr>`,
  );

  let out = [
    ``,
    `<hr>`,
    ``,
    `**$(layers) Pool breakdown**`,
    ``,
    `<table width="302" cellspacing="0" cellpadding="2">`,
    ...lines,
    `</table>`,
    ``,
  ].join("\n");
  if (advice) {
    out += [
      `<hr>`,
      ``,
      `**$(lightbulb) Recommendation**`,
      ``,
      formatTooltipNoticeMarkdown(advice),
    ].join("\n");
  }
  return out;
}
