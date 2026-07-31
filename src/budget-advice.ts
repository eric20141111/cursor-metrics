import type { UsageEvent, UsagePayload } from "./cursor-api";
import { formatIncludedUsage } from "./format";
import {
  aggregateByModel,
  filterZeroTokenModels,
  type ModelBreakdownSortBy,
  type SortOrder,
  type UsageDuration,
} from "./model-breakdown";
import { buildModelEfficiency, formatCostPerM } from "./model-efficiency";
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
  quotaAwareEventDisplay?: boolean;
  now?: number;
};

export type BudgetAdviceReport = {
  statusLine: string;
  /** All non-null tips in toast priority order: Pace → Pool → Efficiency. */
  tips: string[];
  /** Single tip shown in the notification toast (first of `tips`). */
  toastTip: string | null;
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

function statusDetailBlock(
  data: UsagePayload,
  cycleEstimateDollars: number | null,
): string {
  const unit = data.includedRequests.unit ?? "requests";
  const included = formatIncludedUsage(
    data.includedRequests.used,
    data.includedRequests.limit,
    unit,
  );
  const lines = [
    "── Status ─────────────────",
    `  Included   ${included}`,
    `  On-demand  ${formatOnDemandStatusLine(data.onDemand)}`,
  ];
  if (cycleEstimateDollars !== null && data.onDemand.state !== "disabled") {
    lines.push(`  Cycle est. ~$${Math.round(cycleEstimateDollars)}`);
  }
  return lines.join("\n");
}

function sectionBlock(title: string, body: string): string {
  const bar = "─".repeat(Math.max(1, 24 - title.length));
  return `── ${title} ${bar}\n${body}`;
}

function paceDetailBody(paceLine: string | null, paceAdvice: string | null): string {
  if (!paceLine && !paceAdvice) return "  —";
  const lines: string[] = [];
  if (paceLine) {
    const paren = paceLine.match(/^(.+?)\s*\((.+)\)$/);
    if (paren) {
      lines.push(`  ${paren[1].trim()}`);
      lines.push(`  (${paren[2].trim()})`);
    } else {
      lines.push(`  ${paceLine}`);
    }
  }
  if (paceAdvice && paceAdvice !== paceLine) {
    lines.push(`  ${paceAdvice}`);
  }
  return lines.join("\n");
}

function efficiencyDetailBody(
  advice: string | null,
  expensiveModel: string | null,
  expensiveCost: string | null,
  cheaperModel: string | null,
  cheaperCost: string | null,
): string {
  if (!advice) return "  —";
  if (expensiveModel && expensiveCost) {
    const lines = [
      `  Most expensive  ${expensiveModel}  ${expensiveCost}`,
    ];
    if (cheaperModel && cheaperCost) {
      lines.push(`  Try instead     ${cheaperModel}  ${cheaperCost}`);
    }
    return lines.join("\n");
  }
  return `  ${advice}`;
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
  const paceAdviceOnly = forecast?.advice ?? null;

  const models = aggregateByModel(
    events,
    [],
    input.usageDuration,
    data.resetsAt,
    now,
    input.modelBreakdownSortBy ?? "tokens",
    input.modelBreakdownSortOrder ?? "desc",
    input.quotaAwareEventDisplay ?? true,
  );
  const filtered = filterZeroTokenModels(models, input.excludeZeroTokenModels);
  const efficiency = buildModelEfficiency(filtered);
  const efficiencyAdvice = efficiency.advice;

  // Toast priority: Pace → Pool → Efficiency (one tip only in the notification).
  const tips = [paceLine, poolAdvice, efficiencyAdvice].filter(
    (t): t is string => Boolean(t),
  );
  const toastTip = tips[0] ?? null;

  const statusLine = buildStatusLine(data, forecast?.cycleEstimateDollars ?? null);

  const toastMessage = toastTip
    ? `${statusLine}\nTip: ${toastTip}`
    : `${statusLine}\n${BUDGET_ADVICE_FALLBACK}`;

  const generated = new Date(now).toISOString();
  const expensive = efficiency.expensive;
  const cheaper = efficiency.cheaper;
  const detailText = [
    "Cursor Usage — Budget Advice",
    `Generated: ${generated}`,
    "",
    statusDetailBlock(data, forecast?.cycleEstimateDollars ?? null),
    "",
    sectionBlock("Pool", poolAdvice ? `  ${poolAdvice}` : "  —"),
    "",
    sectionBlock("Pace", paceDetailBody(paceLine, paceAdviceOnly)),
    "",
    sectionBlock(
      "Model efficiency",
      efficiencyDetailBody(
        efficiencyAdvice,
        expensive?.model ?? null,
        expensive?.costPerM != null ? formatCostPerM(expensive.costPerM) : null,
        cheaper?.model ?? null,
        cheaper?.costPerM != null ? formatCostPerM(cheaper.costPerM) : null,
      ),
    ),
    "",
    "Open Dashboard for charts and the full model table.",
  ].join("\n");

  return {
    statusLine,
    tips,
    toastTip,
    toastMessage,
    detailText,
    poolAdvice,
    paceLine,
    efficiencyAdvice,
  };
}
