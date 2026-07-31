import type { UsageEvent, UsagePayload } from "./cursor-api";

const DAY_MS = 86_400_000;
const BURN_WINDOW_DAYS = 7;
/** Cycle-end estimate at or above this multiple of baseline → high pace. */
export const HIGH_PACE_RATIO = 1.2;

export type ForecastLevel = "on_track" | "high" | "unknown";

export type SpendForecast = {
  currentOnDemandDollars: number;
  dailyBurnDollars: number;
  daysLeft: number;
  cycleEstimateDollars: number;
  baselineDollars: number | null;
  baselineSource: "hard_limit" | "monthly_budget" | null;
  level: ForecastLevel;
  statusMark: "⚠" | null;
  tooltipLine: string | null;
  advice: string | null;
};

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Sum On-Demand charged cents over the last N calendar days (empty days count as $0). */
export function sumOnDemandCentsLastCalendarDays(
  events: UsageEvent[],
  now = Date.now(),
  windowDays = BURN_WINDOW_DAYS,
): number {
  const todayStart = startOfUtcDay(now);
  const cutoff = todayStart - (windowDays - 1) * DAY_MS;
  let sum = 0;
  for (const event of events) {
    if (event.kind !== "On-Demand") continue;
    if (event.timestamp < cutoff || event.timestamp > now) continue;
    sum += event.spendCents;
  }
  return sum;
}

export function calendarDailyBurnDollars(
  events: UsageEvent[],
  now = Date.now(),
  windowDays = BURN_WINDOW_DAYS,
): number {
  return sumOnDemandCentsLastCalendarDays(events, now, windowDays) / 100 / windowDays;
}

export function daysUntilReset(resetAtIso: string | null, now = Date.now()): number {
  if (!resetAtIso) return 0;
  const resetAt = new Date(resetAtIso).getTime();
  if (Number.isNaN(resetAt)) return 0;
  return Math.max(0, Math.ceil((resetAt - now) / DAY_MS));
}

export function resolveOnDemandBaseline(
  onDemand: UsagePayload["onDemand"],
  monthlyBudgetDollars: number | null,
): { dollars: number; source: "hard_limit" | "monthly_budget" } | null {
  if (onDemand.state === "limited" && onDemand.limitDollars !== null && onDemand.limitDollars > 0) {
    return { dollars: onDemand.limitDollars, source: "hard_limit" };
  }
  if (monthlyBudgetDollars !== null && monthlyBudgetDollars > 0) {
    return { dollars: monthlyBudgetDollars, source: "monthly_budget" };
  }
  return null;
}

export function buildSpendForecast(input: {
  onDemand: UsagePayload["onDemand"];
  resetsAt: string | null;
  events: UsageEvent[];
  monthlyBudgetDollars?: number | null;
  now?: number;
}): SpendForecast {
  const now = input.now ?? Date.now();
  const currentOnDemandDollars =
    input.onDemand.state === "disabled" ? 0 : input.onDemand.spendDollars;
  const dailyBurnDollars = calendarDailyBurnDollars(input.events, now);
  const daysLeft = daysUntilReset(input.resetsAt, now);
  const cycleEstimateDollars = currentOnDemandDollars + dailyBurnDollars * daysLeft;
  const baseline = resolveOnDemandBaseline(input.onDemand, input.monthlyBudgetDollars ?? null);

  let level: ForecastLevel = "unknown";
  if (baseline) {
    level = cycleEstimateDollars >= baseline.dollars * HIGH_PACE_RATIO ? "high" : "on_track";
  }

  const statusMark = level === "high" ? "⚠" : null;

  let tooltipLine: string | null = null;
  if (level === "high" && baseline) {
    tooltipLine = `High pace · cycle estimate ~$${cycleEstimateDollars.toFixed(0)}`;
  } else if (level === "on_track" && baseline) {
    tooltipLine = null;
  } else if (!baseline && input.onDemand.state !== "disabled") {
    tooltipLine = `Cycle estimate ~$${cycleEstimateDollars.toFixed(0)} (set a monthly On-demand budget to rate pace)`;
  }

  let advice: string | null = null;
  if (level === "high") {
    advice = "Prefer Auto / Cursor Models for routine work to slow On-demand spend.";
  } else if (!baseline && input.onDemand.state !== "disabled") {
    advice = "Set cursorUsage.monthlyOnDemandBudget to enable pace warnings.";
  }

  return {
    currentOnDemandDollars,
    dailyBurnDollars,
    daysLeft,
    cycleEstimateDollars,
    baselineDollars: baseline?.dollars ?? null,
    baselineSource: baseline?.source ?? null,
    level,
    statusMark,
    tooltipLine,
    advice,
  };
}

export function formatForecastDashboard(forecast: SpendForecast): {
  title: string;
  rows: Array<{ label: string; value: string }>;
  advice: string | null;
} {
  const paceLabel =
    forecast.level === "high"
      ? "Pace high"
      : forecast.level === "on_track"
        ? "On track"
        : "No baseline";

  const baselineLabel =
    forecast.baselineSource === "hard_limit"
      ? "Hard limit"
      : forecast.baselineSource === "monthly_budget"
        ? "Monthly budget"
        : "—";

  return {
    title: `Budget forecast · ${paceLabel}`,
    rows: [
      { label: "7-day daily burn", value: `$${forecast.dailyBurnDollars.toFixed(2)}` },
      { label: "Days left", value: String(forecast.daysLeft) },
      { label: "Current On-demand", value: `$${forecast.currentOnDemandDollars.toFixed(2)}` },
      { label: "Cycle-end estimate", value: `~$${forecast.cycleEstimateDollars.toFixed(0)}` },
      {
        label: "Baseline",
        value:
          forecast.baselineDollars !== null
            ? `$${forecast.baselineDollars.toFixed(2)} (${baselineLabel})`
            : "Not set",
      },
    ],
    advice: forecast.advice,
  };
}
