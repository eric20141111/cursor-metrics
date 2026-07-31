import type { UsagePayload } from "./cursor-api";

export type PoolBreakdown = {
  hasPools: boolean;
  api: { usedCents: number; limitCents: number; percentUsed: number | null } | null;
  bonus: { usedCents: number; limitCents: number } | null;
  autoPercentUsed: number | null;
  apiRatio: number;
  totalRatio: number;
};

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
  const hasPools = unitOk && typeof apiLimit === "number" && apiLimit > 0;

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

export function formatPoolInsightMarkdown(
  breakdown: PoolBreakdown,
  onDemand: UsagePayload["onDemand"],
  advice: string | null,
): string {
  if (!breakdown.hasPools) return "";

  const lines: string[] = [];
  if (breakdown.api) {
    const pct =
      breakdown.api.percentUsed !== null
        ? `${Math.round(breakdown.api.percentUsed)}% · `
        : "";
    lines.push(
      `API pool — ${pct}${dollars(breakdown.api.usedCents)} / ${dollars(breakdown.api.limitCents)}`,
    );
  }
  if (breakdown.bonus) {
    lines.push(
      `Bonus — ${dollars(breakdown.bonus.usedCents)} / ${dollars(breakdown.bonus.limitCents)}`,
    );
  }
  if (breakdown.autoPercentUsed !== null) {
    lines.push(`Auto / Cursor Models — ~${breakdown.autoPercentUsed.toFixed(1)}% used`);
  }
  if (onDemand.state !== "disabled") {
    const odText =
      onDemand.state === "unlimited"
        ? `$${onDemand.spendDollars.toFixed(2)}`
        : `$${onDemand.spendDollars.toFixed(2)} / $${(onDemand.limitDollars ?? 0).toFixed(2)}`;
    lines.push(`On-demand — ${odText}`);
  }

  let out = `\n<sub>${lines.join("<br/>")}</sub>\n`;
  if (advice) {
    out += `\n*${advice}*\n`;
  }
  return out;
}
