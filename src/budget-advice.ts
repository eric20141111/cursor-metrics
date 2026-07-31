import type { UsageEvent, UsagePayload } from "./cursor-api";
import { formatIncludedUsage } from "./format";
import {
  aggregateByModel,
  filterZeroTokenModels,
  type ModelBreakdownSortBy,
  type SortOrder,
  type UsageDuration,
} from "./model-breakdown";
import { buildModelEfficiency } from "./model-efficiency";
import { buildPoolAdvice, buildPoolBreakdown } from "./pool-insight";
import { buildSpendForecast } from "./spend-forecast";

export const BUDGET_ADVICE_FALLBACK =
  "You're in good shape — no budget alerts right now.";

export type BudgetAdviceInput = {
  data: UsagePayload;
  events: UsageEvent[];
  monthlyBudgetDollars: number | null;
  usageDuration: UsageDuration;
  excludeZeroTokenModels: boolean;
  modelBreakdownSortBy?: ModelBreakdownSortBy;
  modelBreakdownSortOrder?: SortOrder;
  now?: number;
};

export type BudgetAdviceReport = {
  statusLine: string;
  tips: string[];
  toastMessage: string;
  detailText: string;
  poolAdvice: string | null;
  paceLine: string | null;
  efficiencyAdvice: string | null;
};

function formatOnDemandStatusLine(onDemand: UsagePayload["onDemand"]): string {
  if (onDemand.state === "disabled") return "On-demand off";
  if (onDemand.state === "unlimited") return `$${onDemand.spendDollars.toFixed(2)}`;
  return `$${onDemand.spendDollars.toFixed(2)}/$${(onDemand.limitDollars ?? 0).toFixed(2)}`;
}

function buildStatusLine(
  data: UsagePayload,
  cycleEstimateDollars: number | null,
): string {
  const unit = data.includedRequests.unit ?? "requests";
  const included = formatIncludedUsage(
    data.includedRequests.used,
    data.includedRequests.limit,
    unit,
  );
  const parts = [
    `Included ${included}`,
    `On-demand ${formatOnDemandStatusLine(data.onDemand)}`,
  ];
  if (cycleEstimateDollars !== null && data.onDemand.state !== "disabled") {
    parts.push(`cycle est. ~$${Math.round(cycleEstimateDollars)}`);
  }
  return parts.join(" · ");
}

function sectionOrDash(label: string, value: string | null): string {
  return `${label}\n  ${value ?? "—"}`;
}

export function buildBudgetAdvice(input: BudgetAdviceInput): BudgetAdviceReport {
  const now = input.now ?? Date.now();
  const { data, events } = input;

  const breakdown = buildPoolBreakdown(data);
  const poolAdvice = buildPoolAdvice(breakdown, data.onDemand);

  const forecast =
    data.onDemand.state === "disabled"
      ? null
      : buildSpendForecast({
          onDemand: data.onDemand,
          resetsAt: data.resetsAt,
          events,
          monthlyBudgetDollars: input.monthlyBudgetDollars,
          now,
        });

  const paceLine = forecast
    ? forecast.tooltipLine ?? forecast.advice
    : null;

  const models = aggregateByModel(
    events,
    [],
    input.usageDuration,
    data.resetsAt,
    now,
    input.modelBreakdownSortBy ?? "tokens",
    input.modelBreakdownSortOrder ?? "desc",
  );
  const filtered = filterZeroTokenModels(models, input.excludeZeroTokenModels);
  const efficiency = buildModelEfficiency(filtered);
  const efficiencyAdvice = efficiency.advice;

  const tips = [poolAdvice, paceLine, efficiencyAdvice].filter(
    (t): t is string => Boolean(t),
  );

  const statusLine = buildStatusLine(data, forecast?.cycleEstimateDollars ?? null);

  const toastMessage =
    tips.length > 0
      ? `${statusLine}\n${tips.map((t) => `• ${t}`).join("\n")}`
      : `${statusLine}\n${BUDGET_ADVICE_FALLBACK}`;

  const generated = new Date(now).toISOString();
  const detailText = [
    "Cursor Usage — Budget Advice",
    `Generated: ${generated}`,
    "",
    sectionOrDash("Status", statusLine),
    "",
    sectionOrDash("Pool", poolAdvice),
    "",
    sectionOrDash("Pace", paceLine),
    "",
    sectionOrDash("Model efficiency", efficiencyAdvice),
    "",
    "Open Dashboard for charts and the full model table.",
  ].join("\n");

  return {
    statusLine,
    tips,
    toastMessage,
    detailText,
    poolAdvice,
    paceLine,
    efficiencyAdvice,
  };
}
