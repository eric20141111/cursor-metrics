import type { DailySpendRow, UsageEvent } from "./cursor-api";

export type UsageDuration = "1d" | "7d" | "30d" | "billingCycle";

export type ModelAggregate = {
  model: string;
  totalTokens: number;
  requests: number;
  spendCents: number;
};

export type ModelBreakdownSortBy = "model" | "requests" | "tokens" | "spend";
export type SortOrder = "asc" | "desc";

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, "en-US");
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

function sortModelAggregates(
  rows: ModelAggregate[],
  sortBy: ModelBreakdownSortBy,
  sortOrder: SortOrder,
): ModelAggregate[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "model") {
      const byName = compareStrings(a.model, b.model);
      return byName === 0 ? 0 : byName * direction;
    }

    const metricDiff = sortBy === "requests"
      ? compareNumbers(a.requests, b.requests)
      : sortBy === "spend"
        ? compareNumbers(a.spendCents, b.spendCents)
        : compareNumbers(a.totalTokens, b.totalTokens);
    if (metricDiff !== 0) {
      return metricDiff * direction;
    }

    return compareStrings(a.model, b.model);
  });

  return sorted;
}

function getBillingCycleStart(resetAtIso: string, now = Date.now()): number {
  const resetAt = new Date(resetAtIso);
  if (Number.isNaN(resetAt.getTime())) {
    return now - 31 * 86_400_000;
  }
  resetAt.setMonth(resetAt.getMonth() - 1);
  return resetAt.getTime();
}

export function getDurationCutoff(
  duration: UsageDuration,
  resetAtIso: string | null,
  now = Date.now(),
): number {
  if (duration === "billingCycle") {
    if (!resetAtIso) return now - 31 * 86_400_000;
    return getBillingCycleStart(resetAtIso, now);
  }
  const daysMap: Record<Exclude<UsageDuration, "billingCycle">, number> = { "1d": 1, "7d": 7, "30d": 30 };
  return now - daysMap[duration] * 86_400_000;
}

export function aggregateSpendByCategory(
  rows: DailySpendRow[],
  duration: UsageDuration,
  resetAtIso: string | null,
  now = Date.now(),
): Map<string, number> {
  const cutoff = getDurationCutoff(duration, resetAtIso, now);
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (row.day < cutoff) continue;
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.spendCents);
  }

  return totals;
}

/** Match Dashboard: with quota-aware display, only On-Demand events contribute spend. */
export function billableSpendCents(event: UsageEvent, quotaAwareEventDisplay: boolean): number {
  if (quotaAwareEventDisplay && event.kind !== "On-Demand") return 0;
  return event.spendCents;
}

/**
 * Aggregate usage by model for the selected duration.
 * Spend comes from event.spendCents with the same quota-aware rule as Dashboard
 * (Included chargedCents are hidden when quotaAwareEventDisplay is on).
 * `spendRows` is kept for call-site compatibility; unused for the spend column.
 */
export function aggregateByModel(
  events: UsageEvent[],
  _spendRows: DailySpendRow[],
  duration: UsageDuration,
  resetAtIso: string | null,
  now = Date.now(),
  sortBy: ModelBreakdownSortBy = "tokens",
  sortOrder: SortOrder = "desc",
  quotaAwareEventDisplay = true,
): ModelAggregate[] {
  const cutoff = getDurationCutoff(duration, resetAtIso, now);
  const modelMap = new Map<string, { totalTokens: number; requests: number; spendCents: number }>();

  for (const event of events) {
    if (event.timestamp < cutoff) continue;
    const entry = modelMap.get(event.model) ?? { totalTokens: 0, requests: 0, spendCents: 0 };
    entry.totalTokens += event.totalTokens;
    entry.requests += event.requests;
    entry.spendCents += billableSpendCents(event, quotaAwareEventDisplay);
    modelMap.set(event.model, entry);
  }

  const rows = [...modelMap.entries()].map(([model, totals]) => ({
    model,
    totalTokens: totals.totalTokens,
    requests: totals.requests,
    spendCents: totals.spendCents,
  }));
  return sortModelAggregates(rows, sortBy, sortOrder);
}

export function formatDollarsFromCents(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

export function filterZeroTokenModels(rows: ModelAggregate[], excludeZeroTokenModels: boolean): ModelAggregate[] {
  if (!excludeZeroTokenModels) {
    return rows;
  }

  return rows.filter((row) => row.totalTokens > 0);
}
