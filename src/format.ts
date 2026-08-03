export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Default On-Demand display ceiling in dollars (status bar + dashboard). */
export const DEFAULT_ON_DEMAND_LIMIT_DOLLARS = 1000;

/** Clamp / fall back invalid config values to the default ceiling. */
export function resolveOnDemandLimit(raw: number | null | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_ON_DEMAND_LIMIT_DOLLARS;
  }
  return raw;
}

function formatOnDemandLimitDollars(limitDollars: number): string {
  return Number.isInteger(limitDollars) ? String(limitDollars) : limitDollars.toFixed(2);
}

/**
 * Status bar primary text for On-Demand usage.
 * Visible → `$spend/$limit`; disabled → `N/A`. Optional riskMark is appended with a leading space.
 */
export function formatStatusBarOnDemandText(
  onDemand: { state: string; spendDollars: number },
  riskMark = "",
  limitDollars: number = DEFAULT_ON_DEMAND_LIMIT_DOLLARS,
): string {
  if (onDemand.state === "disabled") {
    return "N/A";
  }
  const mark = riskMark ? ` ${riskMark}` : "";
  const limit = resolveOnDemandLimit(limitDollars);
  return `$${onDemand.spendDollars.toFixed(2)}/$${formatOnDemandLimitDollars(limit)}${mark}`;
}

export type IncludedUnit = "requests" | "cents";

/** Format included quota for status bar / cards. Cents → dollars. */
export function formatIncludedUsage(
  used: number,
  limit: number,
  unit: IncludedUnit = "requests",
): string {
  if (unit === "cents") {
    return `$${(used / 100).toFixed(2)}/$${(limit / 100).toFixed(2)}`;
  }
  return `${used}/${limit}`;
}

/** Spaced variant for tooltip tables: `$20.00 / $20.00` or `500 / 500`. */
export function formatIncludedUsageSpaced(
  used: number,
  limit: number,
  unit: IncludedUnit = "requests",
): string {
  if (unit === "cents") {
    return `$${(used / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`;
  }
  return `${used} / ${limit}`;
}

export type IncludedBarInput = {
  used: number;
  limit: number;
  unit?: IncludedUnit;
  apiUsed?: number;
  apiLimit?: number;
  bonusCents?: number | null;
};

/** Ratios are 0–1 of the full bar width. */
export type IncludedBarSegments = {
  /** API zone ends here (boundary marker). */
  apiShare: number;
  /** Filled width inside the API zone, from the left. */
  apiFilled: number;
  /** Filled width inside the Bonus zone, starting at apiShare. */
  bonusFilled: number;
  apiUsed: number;
  apiLimit: number;
  bonusUsed: number;
  bonusLimit: number;
};

export type IncludedBarModel = {
  ratio: number;
  segments: IncludedBarSegments | null;
};

export function buildIncludedBarModel(included: IncludedBarInput): IncludedBarModel {
  const ratio = included.limit > 0 ? Math.min(1, Math.max(0, included.used / included.limit)) : 0;
  const bonusCents = included.bonusCents ?? 0;
  const hasBonus = bonusCents > 0
    && included.apiLimit != null
    && included.limit > 0
    && included.limit !== included.apiLimit;

  if (!hasBonus || included.apiLimit == null) {
    return { ratio, segments: null };
  }

  const apiLimit = included.apiLimit;
  const apiUsed = Math.min(Math.max(included.apiUsed ?? 0, 0), apiLimit);
  const bonusLimit = Math.max(included.limit - apiLimit, bonusCents);
  const bonusUsed = Math.min(Math.max(included.used - apiLimit, 0), bonusLimit);

  return {
    ratio,
    segments: {
      apiShare: apiLimit / included.limit,
      apiFilled: apiUsed / included.limit,
      bonusFilled: bonusUsed / included.limit,
      apiUsed,
      apiLimit,
      bonusUsed,
      bonusLimit,
    },
  };
}

export function formatIncludedBarCaption(
  segments: IncludedBarSegments,
  unit: IncludedUnit = "cents",
): string {
  if (unit === "cents") {
    return `API $${(segments.apiUsed / 100).toFixed(2)}/$${(segments.apiLimit / 100).toFixed(2)} · Bonus $${(segments.bonusUsed / 100).toFixed(2)}/$${(segments.bonusLimit / 100).toFixed(2)}`;
  }
  return `API ${segments.apiUsed}/${segments.apiLimit} · Bonus ${segments.bonusUsed}/${segments.bonusLimit}`;
}
