import * as vscode from "vscode";
import {
  configure,
  fetchDailySpendByCategory,
  fetchUsageData,
  fetchUsageEvents,
  isTeamMemberCached,
  resetSecurityCheckpointFlag,
  wasSecurityCheckpointHit,
  type DailySpendRow,
  type UsagePayload,
  type UsageEvent,
} from "./cursor-api";
import { DashboardPanel, OPEN_DASHBOARD_COMMAND } from "./dashboard-panel";
import { buildDashboardState, type DashboardState } from "./dashboard-state";
import { buildBudgetAdvice } from "./budget-advice";
import {
  resolveConfiguredUsageDuration,
} from "./duration-options";
import { formatTokens, formatIncludedUsage, formatStatusBarOnDemandText, resolveOnDemandLimit } from "./format";
import type { IncludedBarSegments } from "./format";
import {
  aggregateByModel,
  filterZeroTokenModels,
  formatDollarsFromCents,
  type ModelBreakdownSortBy,
  type SortOrder,
  type UsageDuration,
} from "./model-breakdown";
import {
  buildModelEfficiency,
  formatCostPerM,
  type ModelEfficiencyRow,
} from "./model-efficiency";
import { formatTooltipNoticeMarkdown } from "./pool-insight";
import {
  buildUsageByModelHeadingMarkdown,
  buildUsageOverviewMarkdown,
  OPEN_DURATION_SETTING_COMMAND,
} from "./tooltip";
import { buildSpendForecast } from "./spend-forecast";
import {
  cardHeightForRows,
  renderTooltipRoundedCard as renderTooltipRoundedCardSvg,
  toMarkdownBlock,
  type TooltipCardTone,
} from "./tooltip-card";

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastData: UsagePayload | null = null;
let lastError: string | null = null;
let lastFetchTime = 0;
let isFetching = false;
let lastEvents: UsageEvent[] | null = null;
let lastDailySpend: DailySpendRow[] | null = null;

const DEBOUNCE_MS = 30_000;

const SECURITY_CHECKPOINT_MESSAGE =
  "cursor.com answered with a security checkpoint (HTTP 403) instead of usage data. "
  + "It usually clears within minutes; if you use a VPN or proxy, try switching it off.";

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  outputChannel.appendLine(`[${ts}] ${msg}`);
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("cursorUsage");
  const modelBreakdownSortBy = cfg.get<ModelBreakdownSortBy>("modelBreakdownSortBy", "tokens");
  const modelBreakdownSortOrder = cfg.get<SortOrder>("modelBreakdownSortOrder", "desc");
  return {
    pollInterval: cfg.get<number>("pollInterval", 5),
    minimalMode: cfg.get<boolean>("minimalMode", false),
    usageDuration: cfg.get<string>("usageDuration", "billingCycle"),
    modelBreakdownSortBy,
    modelBreakdownSortOrder,
    excludeZeroTokenModels: cfg.get<boolean>("excludeZeroTokenModels", false),
    quotaAwareEventDisplay: cfg.get<boolean>("quotaAwareEventDisplay", true),
    monthlyOnDemandBudget: cfg.get<number | null>("monthlyOnDemandBudget", null),
    onDemandLimit: resolveOnDemandLimit(cfg.get<number>("onDemandLimit", 1000)),
  };
}

function getCooldownMs(): number {
  return getConfig().pollInterval * 60_000;
}

function scheduleRefresh() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    if (Date.now() - lastFetchTime >= getCooldownMs()) {
      updateUsage();
    }
  }, DEBOUNCE_MS);
}

function refreshOnFocus(state: vscode.WindowState) {
  if (state.focused && Date.now() - lastFetchTime >= getCooldownMs()) {
    updateUsage();
  }
}

function formatResetDate(iso: string): string {
  const resetDate = new Date(iso);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(diffMs / 86_400_000));
  const formatted = resetDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} on ${formatted}`;
}

function isLightTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

function renderTooltipRoundedCard(
  contentHtml: string,
  height: number,
  tone: TooltipCardTone,
): string {
  return renderTooltipRoundedCardSvg(contentHtml, height, tone, isLightTheme());
}

type ProgressTone = "included" | "onDemand";

function progressBarDataUri(
  ratio: number,
  barWidth = 220,
  tone: ProgressTone = "included",
): string {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const width = barWidth;
  const height = 10;
  const r = height / 2;
  const fillWidth = Math.round(clamped * width);

  const light = isLightTheme();
  const trackColor = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.18)";
  const fillColor =
    tone === "onDemand"
      ? (light ? "#D97706" : "#F59E0B")
      : (light ? "#2563EB" : "#60A5FA");

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="${trackColor}"/>`;
  if (fillWidth > 0) {
    svg += `<rect width="${fillWidth}" height="${height}" rx="${r}" ry="${r}" fill="${fillColor}"/>`;
  }
  svg += `</svg>`;

  const encoded = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

function segmentedProgressBarDataUri(segments: IncludedBarSegments, barWidth = 220): string {
  const width = barWidth;
  const height = 10;
  const r = height / 2;
  const light = isLightTheme();
  const trackColor = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.18)";
  const apiFill = light ? "#2563EB" : "#60A5FA";
  const bonusFill = light ? "#7C3AED" : "#A78BFA";
  const boundaryColor = light ? "rgba(255,255,255,0.9)" : "rgba(15,23,42,0.9)";

  const apiFilledW = Math.round(Math.min(Math.max(segments.apiFilled, 0), 1) * width);
  const bonusStart = Math.round(Math.min(Math.max(segments.apiShare, 0), 1) * width);
  const bonusFilledW = Math.round(Math.min(Math.max(segments.bonusFilled, 0), 1) * width);
  const boundaryX = Math.min(Math.max(bonusStart, 0), width);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="${trackColor}"/>`;
  if (apiFilledW > 0) {
    svg += `<rect width="${apiFilledW}" height="${height}" rx="${r}" ry="${r}" fill="${apiFill}"/>`;
  }
  if (bonusFilledW > 0) {
    // Square the inner corners so the two fills meet cleanly at the boundary.
    svg += `<rect x="${bonusStart}" width="${bonusFilledW}" height="${height}" fill="${bonusFill}"/>`;
  }
  if (boundaryX > 0 && boundaryX < width) {
    svg += `<rect x="${boundaryX - 0.5}" y="0" width="1" height="${height}" fill="${boundaryColor}"/>`;
  }
  svg += `</svg>`;

  const encoded = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

function progressBarMarkdown(ratio: number, barWidth = 220): string {
  return `![](${progressBarDataUri(ratio, barWidth)})`;
}

function progressBarHtml(
  ratio: number,
  barWidth = 220,
  tone: ProgressTone = "included",
): string {
  return `<img src="${progressBarDataUri(ratio, barWidth, tone)}" width="${barWidth}" height="10" />`;
}

function includedProgressBarHtml(
  ratio: number,
  segments: IncludedBarSegments | null,
  barWidth = 220,
): string {
  if (!segments) {
    return progressBarHtml(ratio, barWidth);
  }
  return `<img src="${segmentedProgressBarDataUri(segments, barWidth)}" width="${barWidth}" height="10" />`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function summaryDividerHtml(height = 52): string {
  const light = isLightTheme();
  const strokeColor = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="${height}" viewBox="0 0 2 ${height}">`,
    `<rect x="0.5" y="0" width="1" height="${height}" fill="${strokeColor}"/>`,
    `</svg>`,
  ].join("");
  const encoded = Buffer.from(svg).toString("base64");
  return `<img src="data:image/svg+xml;base64,${encoded}" width="2" height="${height}" />`;
}

type OnDemandUsage = UsagePayload["onDemand"];

function buildModelBreakdownTableMarkdown(rows: ModelEfficiencyRow[]): string {
  if (rows.length === 0) {
    return toMarkdownBlock(renderTooltipRoundedCard("<em>No usage in this period</em>", 48, "neutral"));
  }

  const lines = [
    `<table class="rows" width="100%" cellspacing="0" cellpadding="0">`,
    `  <tr>`,
    `    <th align="left" width="36%">Model</th>`,
    `    <th align="right" width="12%">Reqs</th>`,
    `    <th align="right" width="18%">Tokens</th>`,
    `    <th align="right" width="16%">Spend</th>`,
    `    <th align="right" width="18%">$/M</th>`,
    `  </tr>`,
  ];

  for (const row of rows) {
    lines.push(
      `  <tr>` +
      `<td align="left">${escapeHtml(row.model)}</td>` +
      `<td align="right">${Math.round(row.requests)}</td>` +
      `<td align="right">${formatTokens(row.totalTokens)}</td>` +
      `<td align="right">${formatDollarsFromCents(row.spendCents)}</td>` +
      `<td align="right">${formatCostPerM(row.costPerM)}</td>` +
      `</tr>`,
    );
  }

  lines.push(`</table>`);
  return toMarkdownBlock(
    renderTooltipRoundedCard(lines.join("\n"), cardHeightForRows(rows.length + 1), "neutral"),
  );
}

function isOnDemandVisible(onDemand: OnDemandUsage): boolean {
  return onDemand.state !== "disabled";
}

function getOnDemandRatio(onDemand: OnDemandUsage): number | null {
  if (onDemand.state !== "limited") return null;
  if (onDemand.limitDollars === null || onDemand.limitDollars <= 0) return null;
  return onDemand.spendDollars / onDemand.limitDollars;
}

function formatOnDemandTooltipCell(onDemand: OnDemandUsage): string {
  if (onDemand.state === "unlimited") {
    return `$${onDemand.spendDollars.toFixed(2)}`;
  }
  const ratio = getOnDemandRatio(onDemand);
  const pct = ratio === null ? 0 : Math.round(ratio * 100);
  return `$${onDemand.spendDollars.toFixed(2)} / $${(onDemand.limitDollars ?? 0).toFixed(2)} (${pct}%)`;
}

function updateStatusBar(data: UsagePayload) {
  const { includedRequests, onDemand } = data;

  const config = getConfig();
  const forecast =
    onDemand.state === "disabled"
      ? null
      : buildSpendForecast({
          onDemand,
          resetsAt: data.resetsAt,
          events: lastEvents ?? [],
          monthlyBudgetDollars: config.monthlyOnDemandBudget,
        });
  const riskMark = forecast?.statusMark ?? "";

  statusBarItem.text = `$(pulse) ${formatStatusBarOnDemandText(onDemand, riskMark, config.onDemandLimit)}`;

  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = {
    enabledCommands: [OPEN_DASHBOARD_COMMAND, "cursor-usage.refresh", OPEN_DURATION_SETTING_COMMAND],
  };
  tooltip.supportThemeIcons = true;
  tooltip.supportHtml = true;

  const barW = 150;
  let md = `### $(pulse) Cursor Usage\n\n`;
  md += buildUsageOverviewMarkdown(
    { includedRequests, onDemand, resetsAt: data.resetsAt },
    {
      markdown: (ratio) => progressBarMarkdown(ratio, barW),
      html: (ratio) => progressBarHtml(ratio, barW, "onDemand"),
      htmlIncluded: (ratio, segments) => includedProgressBarHtml(ratio, segments, barW),
      divider: () => summaryDividerHtml(),
      card: renderTooltipRoundedCard,
    },
    {
      events: lastEvents ?? [],
      monthlyBudgetDollars: config.monthlyOnDemandBudget,
    },
  );

  if (lastEvents && lastEvents.length > 0) {
    const usageDuration: UsageDuration = resolveConfiguredUsageDuration(config.usageDuration, Boolean(data.resetsAt));
    const models = aggregateByModel(
      lastEvents,
      lastDailySpend ?? [],
      usageDuration,
      data.resetsAt,
      Date.now(),
      config.modelBreakdownSortBy,
      config.modelBreakdownSortOrder,
    );
    const filteredModels = filterZeroTokenModels(models, config.excludeZeroTokenModels);
    const efficiency = buildModelEfficiency(filteredModels);
    md += buildUsageByModelHeadingMarkdown(usageDuration);
    if (efficiency.advice) {
      md += `**$(lightbulb) Model tip**\n\n${formatTooltipNoticeMarkdown(
        efficiency.advice,
        "💡",
        "warning",
        renderTooltipRoundedCard,
      )}`;
    }
    md += buildModelBreakdownTableMarkdown(efficiency.rows);
  }

  if (data.resetsAt) {
    md += toMarkdownBlock(
      renderTooltipRoundedCard(`📅 <em>Resets ${formatResetDate(data.resetsAt)}</em>`, 48, "neutral"),
    );
  }

  const actionBackground = isLightTheme() ? "#DBEAFE" : "#1E3A5F";
  md += [
    `<span style="background-color:${actionBackground};border-radius:6px;">&nbsp;$(dashboard) <a href="command:${OPEN_DASHBOARD_COMMAND}">Open Dashboard</a>&nbsp;</span>`,
    `&nbsp;`,
    `<span style="background-color:${actionBackground};border-radius:6px;">&nbsp;$(refresh) <a href="command:cursor-usage.refresh">Refresh</a>&nbsp;</span>`,
  ].join("");

  tooltip.appendMarkdown(md);
  statusBarItem.tooltip = tooltip;
}

async function updateUsage() {
  if (isFetching) return;
  isFetching = true;

  statusBarItem.text = statusBarItem.text.replace("$(pulse)", "$(loading~spin)");
  resetSecurityCheckpointFlag();
  await new Promise((r) => setTimeout(r, 0));

  try {
    const [dataResult, eventsResult, spendResult] = await Promise.allSettled([
      fetchUsageData(),
      fetchUsageEvents(),
      fetchDailySpendByCategory(),
    ]);

    if (eventsResult.status === "fulfilled") {
      lastEvents = eventsResult.value;
    } else if (eventsResult.status === "rejected") {
      log(`Usage events fetch failed: ${eventsResult.reason}`);
    }

    if (spendResult.status === "fulfilled") {
      lastDailySpend = spendResult.value;
    } else if (spendResult.status === "rejected") {
      log(`Daily spend fetch failed: ${spendResult.reason}`);
    }

    const data = dataResult.status === "fulfilled" ? dataResult.value : null;
    if (dataResult.status === "rejected") {
      log(`Usage data fetch failed: ${dataResult.reason}`);
    }

    if (data) {
      lastData = data;
      lastError = null;
      updateStatusBar(data);
    } else if (wasSecurityCheckpointHit()) {
      lastError = SECURITY_CHECKPOINT_MESSAGE;
      if (!lastData) {
        statusBarItem.text = "$(shield) Usage blocked";
        statusBarItem.tooltip = `${SECURITY_CHECKPOINT_MESSAGE} Click to see options.`;
      } else {
        statusBarItem.text = statusBarItem.text.replace("$(loading~spin)", "$(pulse)");
      }
    } else {
      lastError = "Could not fetch usage data";
      if (!lastData) {
        statusBarItem.text = "$(warning) Usage unavailable";
        statusBarItem.tooltip = "Could not fetch Cursor usage data. Click to see options.";
      } else {
        statusBarItem.text = statusBarItem.text.replace("$(loading~spin)", "$(pulse)");
      }
    }

    DashboardPanel.currentPanel?.postState(getDashboardState());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error in updateUsage: ${msg}`);
    lastError = msg;
    if (!lastData) {
      statusBarItem.text = "$(warning) Usage unavailable";
      statusBarItem.tooltip = `Error: ${msg}`;
    } else {
      statusBarItem.text = statusBarItem.text.replace("$(loading~spin)", "$(pulse)");
    }
  } finally {
    isFetching = false;
    lastFetchTime = Date.now();
  }
}

async function showDetails() {
  if (!lastData) {
    const items: string[] = ["Refresh", "Open Dashboard", "Show Logs"];
    const action = await vscode.window.showWarningMessage(
      lastError
        ? `Cursor usage unavailable: ${lastError}`
        : "Cursor usage data is not available yet.",
      ...items,
    );
    if (action === "Refresh") await updateUsage();
    else if (action === "Open Dashboard") await vscode.commands.executeCommand(OPEN_DASHBOARD_COMMAND);
    else if (action === "Show Logs") outputChannel.show();
    return;
  }

  const { includedRequests, onDemand, resetsAt } = lastData;
  const includedUnit = includedRequests.unit ?? "requests";
  const reqPct = includedRequests.limit > 0 ? Math.round((includedRequests.used / includedRequests.limit) * 100) : 0;
  const spendRatio = getOnDemandRatio(onDemand);
  const spendPct = spendRatio === null ? null : Math.round(spendRatio * 100);
  const onDemandVisible = isOnDemandVisible(onDemand);

  const includedLabel = includedUnit === "cents" ? "Included" : "Requests";
  let message = `${includedLabel}: ${formatIncludedUsage(includedRequests.used, includedRequests.limit, includedUnit)} (${reqPct}%)`;
  if (onDemandVisible) {
    const spendText = onDemand.state === "unlimited"
      ? `$${onDemand.spendDollars.toFixed(2)}`
      : `$${onDemand.spendDollars.toFixed(2)}/$${(onDemand.limitDollars ?? 0).toFixed(2)} (${spendPct ?? 0}%)`;
    message += ` | Spend: ${spendText}`;
  }
  if (resetsAt) message += ` | Resets: ${formatResetDate(resetsAt)}`;

  const action = await vscode.window.showInformationMessage(
    message,
    "Open Dashboard",
    "Refresh",
  );

  if (action === "Open Dashboard") {
    await vscode.commands.executeCommand(OPEN_DASHBOARD_COMMAND);
  } else if (action === "Refresh") {
    await updateUsage();
  }
}

async function openDurationSetting() {
  await vscode.commands.executeCommand("workbench.action.openSettings", "cursorUsage.usageDuration");
}

function getDashboardState(): DashboardState {
  const config = getConfig();
  return buildDashboardState(
    lastData,
    lastEvents ?? [],
    lastDailySpend ?? [],
    isTeamMemberCached(),
    lastError,
    Date.now(),
    config.quotaAwareEventDisplay,
    config.monthlyOnDemandBudget,
    config.onDemandLimit,
  );
}

async function showBudgetAdvice() {
  if (!lastData) {
    await updateUsage();
  }
  if (!lastData) {
    const action = await vscode.window.showErrorMessage(
      lastError
        ? `Cursor usage unavailable: ${lastError}`
        : "Cursor usage data is not available yet.",
      "Refresh",
      "Show Logs",
    );
    if (action === "Refresh") await updateUsage();
    else if (action === "Show Logs") outputChannel.show();
    return;
  }

  const config = getConfig();
  const usageDuration = resolveConfiguredUsageDuration(
    config.usageDuration,
    Boolean(lastData.resetsAt),
  );
  const report = buildBudgetAdvice({
    data: lastData,
    events: lastEvents ?? [],
    monthlyBudgetDollars: config.monthlyOnDemandBudget,
    usageDuration,
    excludeZeroTokenModels: config.excludeZeroTokenModels,
    modelBreakdownSortBy: config.modelBreakdownSortBy,
    modelBreakdownSortOrder: config.modelBreakdownSortOrder,
    quotaAwareEventDisplay: config.quotaAwareEventDisplay,
  });

  const action = await vscode.window.showInformationMessage(
    report.toastMessage,
    "Show details",
    "Open Dashboard",
  );
  if (action === "Show details") {
    outputChannel.clear();
    outputChannel.appendLine(report.detailText);
    outputChannel.show(true);
  } else if (action === "Open Dashboard") {
    await vscode.commands.executeCommand(OPEN_DASHBOARD_COMMAND);
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Cursor Usage");
  log("Extension activating...");

  configure({ logger: log });

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = OPEN_DASHBOARD_COMMAND;
  statusBarItem.text = "$(loading~spin) Usage";
  statusBarItem.show();

  const showDetailsCmd = vscode.commands.registerCommand("cursor-usage.showDetails", showDetails);
  const refreshCmd = vscode.commands.registerCommand("cursor-usage.refresh", updateUsage);
  const openDurationSettingCmd = vscode.commands.registerCommand(OPEN_DURATION_SETTING_COMMAND, openDurationSetting);
  const budgetAdviceCmd = vscode.commands.registerCommand("cursor-usage.budgetAdvice", showBudgetAdvice);
  const openDashboardCmd = vscode.commands.registerCommand(OPEN_DASHBOARD_COMMAND, () => {
    DashboardPanel.createOrShow(context, updateUsage, getDashboardState);
    DashboardPanel.currentPanel?.postState(getDashboardState());
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      lastData
      && (e.affectsConfiguration("cursorUsage.minimalMode")
        || e.affectsConfiguration("cursorUsage.usageDuration")
        || e.affectsConfiguration("cursorUsage.modelBreakdownSortBy")
        || e.affectsConfiguration("cursorUsage.modelBreakdownSortOrder")
        || e.affectsConfiguration("cursorUsage.excludeZeroTokenModels")
        || e.affectsConfiguration("cursorUsage.quotaAwareEventDisplay")
        || e.affectsConfiguration("cursorUsage.onDemandLimit")
        || e.affectsConfiguration("cursorUsage.monthlyOnDemandBudget"))
    ) {
      updateStatusBar(lastData);
      DashboardPanel.currentPanel?.postState(getDashboardState());
    }
  });

  const docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme === "file") {
      scheduleRefresh();
    }
  });

  const focusListener = vscode.window.onDidChangeWindowState(refreshOnFocus);

  const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
    if (lastData) updateStatusBar(lastData);
  });

  context.subscriptions.push(
    statusBarItem, showDetailsCmd, refreshCmd, openDurationSettingCmd, budgetAdviceCmd, openDashboardCmd,
    configListener, docChangeListener, focusListener, themeListener,
    outputChannel,
  );

  log("Extension activated, fetching initial usage...");
  updateUsage();
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
}
