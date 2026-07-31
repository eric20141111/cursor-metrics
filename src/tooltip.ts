import type { UsagePayload } from "./cursor-api";
import { getDurationLabel } from "./duration-options";
import {
  buildIncludedBarModel,
  formatIncludedBarCaption,
  formatIncludedUsageSpaced,
  type IncludedBarSegments,
} from "./format";
import type { UsageDuration } from "./model-breakdown";
import {
  buildPoolAdvice,
  buildPoolBreakdown,
  formatPoolInsightMarkdown,
} from "./pool-insight";

type IncludedRequestsUsage = UsagePayload["includedRequests"];
type OnDemandUsage = UsagePayload["onDemand"];

type ProgressBarRenderer = {
  markdown: (ratio: number) => string;
  html: (ratio: number) => string;
  /** Segmented API+Bonus bar when bonus pool exists; falls back to html(ratio). */
  htmlIncluded?: (ratio: number, segments: IncludedBarSegments | null) => string;
  divider: () => string;
};

export const OPEN_DURATION_SETTING_COMMAND = "cursor-usage.openDurationSetting";

function getOnDemandRatio(onDemand: OnDemandUsage): number | null {
  if (onDemand.state !== "limited") return null;
  if (onDemand.limitDollars === null || onDemand.limitDollars <= 0) return null;
  return onDemand.spendDollars / onDemand.limitDollars;
}

type SummaryColumn = {
  label: string;
  value: string;
  footer: string;
};

function formatIncludedValue(includedRequests: IncludedRequestsUsage): string {
  return formatIncludedUsageSpaced(
    includedRequests.used,
    includedRequests.limit,
    includedRequests.unit ?? "requests",
  );
}

function formatOnDemandValue(onDemand: OnDemandUsage): string {
  if (onDemand.state === "unlimited") {
    return `$${onDemand.spendDollars.toFixed(2)}`;
  }
  return `$${onDemand.spendDollars.toFixed(2)} / $${(onDemand.limitDollars ?? 0).toFixed(2)}`;
}

function buildSummaryTable(columns: SummaryColumn[], renderProgressBar: ProgressBarRenderer): string {
  if (columns.length === 1) {
    return [
      `<table width="100%" cellspacing="0" cellpadding="0">`,
      `  <tr><td width="100%"><sub>${columns[0]!.label}</sub></td></tr>`,
      `  <tr><td><strong>${columns[0]!.value}</strong></td></tr>`,
      `  <tr><td>${columns[0]!.footer}</td></tr>`,
      `</table>`,
      ``,
    ].join("\n");
  }

  return [
    `<table width="100%" cellspacing="0" cellpadding="0">`,
    `  <tr><td><sub>${columns[0]!.label}</sub></td><td width="2%" rowspan="3" valign="top">${renderProgressBar.divider()}</td><td><sub>${columns[1]!.label}</sub></td></tr>`,
    `  <tr><td><strong>${columns[0]!.value}</strong></td><td><strong>${columns[1]!.value}</strong></td></tr>`,
    `  <tr><td>${columns[0]!.footer}</td><td>${columns[1]!.footer}</td></tr>`,
    `</table>`,
    ``,
  ].join("\n");
}

function renderIncludedFooter(
  includedRequests: IncludedRequestsUsage,
  renderProgressBar: ProgressBarRenderer,
): string {
  const model = buildIncludedBarModel(includedRequests);
  const bar = renderProgressBar.htmlIncluded
    ? renderProgressBar.htmlIncluded(model.ratio, model.segments)
    : renderProgressBar.html(model.ratio);

  if (!model.segments) {
    return bar;
  }

  const caption = formatIncludedBarCaption(
    model.segments,
    includedRequests.unit ?? "requests",
  );
  return `${bar}<br/><sub>${caption}</sub>`;
}

function buildSummaryColumns(
  includedRequests: IncludedRequestsUsage,
  onDemand: OnDemandUsage,
  renderProgressBar: ProgressBarRenderer,
): SummaryColumn[] {
  const hasBonus = (includedRequests.bonusCents ?? 0) > 0
    && includedRequests.apiLimit != null
    && includedRequests.limit !== includedRequests.apiLimit;
  const includedColumn: SummaryColumn = {
    label: hasBonus ? "Included (total)" : "Included",
    value: formatIncludedValue(includedRequests),
    footer: renderIncludedFooter(includedRequests, renderProgressBar),
  };

  if (onDemand.state === "disabled") {
    return [includedColumn];
  }

  if (onDemand.state === "unlimited") {
    return [
      includedColumn,
      {
        label: "On-demand",
        value: formatOnDemandValue(onDemand),
        footer: "<sub>Unlimited</sub>",
      },
    ];
  }

  const spendRatio = getOnDemandRatio(onDemand);

  return [
    includedColumn,
    {
      label: "On-demand",
      value: formatOnDemandValue(onDemand),
      footer: spendRatio === null ? "<sub>Spend unavailable</sub>" : renderProgressBar.html(spendRatio),
    },
  ];
}

export function buildUsageOverviewMarkdown(
  data: Pick<UsagePayload, "includedRequests" | "onDemand">,
  renderProgressBar: ProgressBarRenderer,
): string {
  const { includedRequests, onDemand } = data;
  const overview = buildSummaryTable(
    buildSummaryColumns(includedRequests, onDemand, renderProgressBar),
    renderProgressBar,
  );
  const breakdown = buildPoolBreakdown(data);
  const advice = buildPoolAdvice(breakdown, onDemand);
  return overview + formatPoolInsightMarkdown(breakdown, onDemand, advice);
}

export function buildUsageByModelHeadingMarkdown(duration: UsageDuration): string {
  return `**Usage by Model** *(${getDurationLabel(duration)})* &nbsp;[Change](command:${OPEN_DURATION_SETTING_COMMAND})\n\n`;
}
