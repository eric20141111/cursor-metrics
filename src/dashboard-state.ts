import type { DailySpendRow, UsageEvent, UsagePayload } from "./cursor-api";
import { DEFAULT_ON_DEMAND_LIMIT_DOLLARS, resolveOnDemandLimit } from "./format";
import { getDurationCutoff, type UsageDuration } from "./model-breakdown";
import { buildPoolInsightView } from "./pool-insight";
import { buildSpendForecast, formatForecastDashboard, type SpendForecast } from "./spend-forecast";

export type ChartMetric = "spend" | "tokens" | "requests";
export type UsageFilter = "all" | "included" | "ondemand";

export type ChartDataset = {
  model: string;
  data: number[];
};

export type ChartSeries = {
  labels: string[];
  datasets: ChartDataset[];
};

export type ForecastDashboardView = ReturnType<typeof formatForecastDashboard> & {
  level: SpendForecast["level"];
};

export type DashboardState = {
  generatedAt: number;
  data: UsagePayload | null;
  events: UsageEvent[];
  dailySpend: DailySpendRow[];
  resetsAt: string | null;
  isTeamMember: boolean;
  quotaAwareEventDisplay: boolean;
  onDemandLimitDollars: number;
  poolInsight: ReturnType<typeof buildPoolInsightView>;
  spendForecast: ForecastDashboardView | null;
  error: string | null;
};

const DAY_MS = 86_400_000;

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isIncluded(event: UsageEvent): boolean {
  return event.kind === "Included";
}

function isOnDemand(event: UsageEvent): boolean {
  return event.kind === "On-Demand";
}

function billableSpendCents(event: UsageEvent, quotaAwareEventDisplay: boolean): number {
  return quotaAwareEventDisplay && !isOnDemand(event) ? 0 : event.spendCents;
}

function matchesUsageFilter(event: UsageEvent, filter: UsageFilter): boolean {
  if (filter === "all") return true;
  if (filter === "included") return isIncluded(event);
  return isOnDemand(event);
}

export function buildDashboardState(
  data: UsagePayload | null,
  events: UsageEvent[],
  dailySpend: DailySpendRow[],
  isTeamMember: boolean,
  error: string | null,
  now: number,
  quotaAwareEventDisplay = true,
  monthlyOnDemandBudget: number | null = null,
  onDemandLimitDollars = DEFAULT_ON_DEMAND_LIMIT_DOLLARS,
): DashboardState {
  let spendForecast: ForecastDashboardView | null = null;
  if (data && data.onDemand.state !== "disabled") {
    const forecast = buildSpendForecast({
      onDemand: data.onDemand,
      resetsAt: data.resetsAt,
      events,
      monthlyBudgetDollars: monthlyOnDemandBudget,
      now,
    });
    spendForecast = { ...formatForecastDashboard(forecast), level: forecast.level };
  }

  return {
    generatedAt: now,
    data,
    events,
    dailySpend,
    resetsAt: data?.resetsAt ?? null,
    isTeamMember,
    quotaAwareEventDisplay,
    onDemandLimitDollars: resolveOnDemandLimit(onDemandLimitDollars),
    poolInsight: data ? buildPoolInsightView(data) : null,
    spendForecast,
    error,
  };
}

export function filterEventsForRange(
  events: UsageEvent[],
  range: UsageDuration,
  resetAtIso: string | null,
  usageFilter: UsageFilter,
  now: number,
): UsageEvent[] {
  const cutoff = getDurationCutoff(range, resetAtIso, now);
  return events.filter((e) => e.timestamp >= cutoff && matchesUsageFilter(e, usageFilter));
}

function buildDayBuckets(cutoff: number, now: number): number[] {
  const start = startOfUtcDay(cutoff);
  const end = startOfUtcDay(now);
  const days: number[] = [];
  for (let d = start; d <= end; d += DAY_MS) {
    days.push(d);
  }
  if (days.length === 0) days.push(end);
  return days;
}

function formatDayLabel(dayMs: number): string {
  const d = new Date(dayMs);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function eventValue(event: UsageEvent, metric: ChartMetric, quotaAwareEventDisplay: boolean): number {
  if (metric === "tokens") return event.totalTokens;
  if (metric === "requests") return event.requests;
  return billableSpendCents(event, quotaAwareEventDisplay) / 100;
}

export function aggregateChartSeries(
  events: UsageEvent[],
  dailySpend: DailySpendRow[],
  range: UsageDuration,
  resetAtIso: string | null,
  metric: ChartMetric,
  usageFilter: UsageFilter,
  now: number,
  quotaAwareEventDisplay = true,
): ChartSeries {
  const cutoff = getDurationCutoff(range, resetAtIso, now);
  const days = buildDayBuckets(cutoff, now);
  const dayIndex = new Map<number, number>();
  days.forEach((d, i) => dayIndex.set(d, i));

  const perModelDaily = new Map<string, number[]>();
  const ensureModel = (model: string): number[] => {
    let arr = perModelDaily.get(model);
    if (!arr) {
      arr = new Array(days.length).fill(0);
      perModelDaily.set(model, arr);
    }
    return arr;
  };

  // All metrics (spend/tokens/requests) come from per-event data so the usage filter applies uniformly.
  // dailySpend is kept as a fallback signal for team membership but is no longer used for the chart series.
  void dailySpend;
  for (const event of events) {
    if (event.timestamp < cutoff) continue;
    if (!matchesUsageFilter(event, usageFilter)) continue;
    const day = startOfUtcDay(event.timestamp);
    const idx = dayIndex.get(day);
    if (idx === undefined) continue;
    const arr = ensureModel(event.model);
    arr[idx] = (arr[idx] ?? 0) + eventValue(event, metric, quotaAwareEventDisplay);
  }

  // Per-day (non-cumulative) totals per model.
  const datasets: ChartDataset[] = [];
  for (const [model, arr] of perModelDaily.entries()) {
    datasets.push({ model, data: arr.slice() });
  }

  // Sort datasets by total over the range (descending) for consistent stacking order.
  const totalOf = (ds: ChartDataset) => ds.data.reduce((a, b) => a + (b ?? 0), 0);
  datasets.sort((a, b) => totalOf(b) - totalOf(a));

  return {
    labels: days.map(formatDayLabel),
    datasets,
  };
}

export type RangeSummary = {
  totalRequests: number;
  includedRequests: number;
  onDemandSpendDollars: number;
  totalTokens: number;
};

export function summarizeRange(
  events: UsageEvent[],
  range: UsageDuration,
  resetAtIso: string | null,
  now: number,
): RangeSummary {
  const cutoff = getDurationCutoff(range, resetAtIso, now);
  let includedRequests = 0;
  let totalTokens = 0;
  let onDemandSpendCents = 0;

  for (const event of events) {
    if (event.timestamp < cutoff) continue;
    totalTokens += event.totalTokens;
    if (isIncluded(event)) includedRequests += event.requests;
    onDemandSpendCents += billableSpendCents(event, true);
  }

  return {
    totalRequests: includedRequests,
    includedRequests,
    onDemandSpendDollars: onDemandSpendCents / 100,
    totalTokens,
  };
}
