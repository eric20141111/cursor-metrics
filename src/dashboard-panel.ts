import { randomBytes } from "crypto";
import * as vscode from "vscode";
import type { DashboardState } from "./dashboard-state";

export const OPEN_DASHBOARD_COMMAND = "cursor-usage.openDashboard";

type RefreshFn = () => Promise<void>;
type StateProvider = () => DashboardState | null;

function makeNonce(): string {
  return randomBytes(16).toString("base64url");
}

export class DashboardPanel {
  static currentPanel: DashboardPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    onRefresh: RefreshFn,
    getState: StateProvider,
  ): DashboardPanel {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "cursorUsageDashboard",
      "Cursor Usage",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, context, onRefresh, getState);
    return DashboardPanel.currentPanel;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    onRefresh: RefreshFn,
    getState: StateProvider,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml(panel.webview, context.extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "ready") {
          const state = getState();
          if (state) this.postState(state);
        } else if (msg.type === "refresh") {
          this.postLoading(true);
          try {
            await onRefresh();
          } finally {
            this.postLoading(false);
          }
        }
      },
      null,
      this.disposables,
    );
  }

  postState(state: DashboardState): void {
    this.panel.webview.postMessage({ type: "state", state });
  }

  postLoading(on: boolean): void {
    this.panel.webview.postMessage({ type: "loading", on });
  }

  private dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }

  private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const mediaUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dashboard", file));

    const cssUri = mediaUri("dashboard.css");
    const jsUri = mediaUri("dashboard.js");
    const chartUri = mediaUri("chart.umd.js");
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cursor Usage</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  <header class="dashboard-header">
    <h1>Cursor Usage</h1>
    <div class="header-actions">
      <span id="last-updated" class="muted"></span>
      <button id="refresh-btn" type="button">Refresh</button>
    </div>
  </header>

  <section class="summary-cards" id="summary-cards"></section>

  <section class="guide-section collapsible-section collapsed" data-section="guide">
    <div class="events-header">
      <div class="section-title-row" data-toggle-section="guide">
        <button
          type="button"
          class="section-toggle"
          data-toggle-section="guide"
          aria-expanded="false"
          aria-controls="section-body-guide"
          aria-label="Toggle Quota guide section"
        >
          <svg class="section-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div>
          <h2>Quota guide</h2>
          <p class="muted">Which models draw from which pool</p>
        </div>
      </div>
    </div>
    <div id="section-body-guide" class="section-body hidden">
      <div class="table-scroll">
        <table class="guide-table">
          <thead>
            <tr>
              <th>How you use it</th>
              <th>Typical models</th>
              <th>Draws from</th>
              <th>In this extension</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Auto Cost</strong></td>
              <td>Auto routes for you (cost-optimized)</td>
              <td><span class="pool-tag pool-cursor">Cursor Models</span></td>
              <td>Generous included; not the API $20 bar</td>
            </tr>
            <tr>
              <td><strong>Cursor first-party</strong></td>
              <td>Composer 2.5, Cursor Grok 4.5</td>
              <td><span class="pool-tag pool-cursor">Cursor Models</span></td>
              <td>Same Cursor Models pool</td>
            </tr>
            <tr>
              <td><strong>Auto Balance / Intelligence</strong></td>
              <td>Auto may pick Claude / GPT / Gemini / …</td>
              <td><span class="pool-tag pool-api">Other Models (API)</span></td>
              <td>Billed at that model’s API rate (Teams add Cursor Token Rate)</td>
            </tr>
            <tr>
              <td><strong>Manual model pick</strong></td>
              <td>Claude Opus/Sonnet, GPT-5.x, Gemini, GLM, Kimi, …</td>
              <td><span class="pool-tag pool-api">Other Models (API)</span></td>
              <td>Dark segment: base API pool (e.g. $20)</td>
            </tr>
            <tr>
              <td><strong>Bonus / extra included</strong></td>
              <td>Same models after base API is exhausted, still “Included”</td>
              <td><span class="pool-tag pool-bonus">Bonus (total included)</span></td>
              <td>Light segment on the Included bar</td>
            </tr>
            <tr>
              <td><strong>On-demand</strong></td>
              <td>Any chargeable model after included is gone</td>
              <td><span class="pool-tag pool-ondemand">On-Demand</span></td>
              <td>Right-hand On-Demand card / spend</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small guide-note">
        Pools reset each billing cycle. Plan included “Other Models” amounts: Pro $20 · Pro Plus $70 · Ultra $400.
        Your status-bar total (API + Bonus) is the included allowance Cursor reports in usage-summary.
        Source: <span class="mono">cursor.com/docs/models-and-pricing</span>
      </p>
    </div>
  </section>

  <section class="controls">
    <div class="range-selector" id="range-selector" role="tablist">
      <button data-range="1d" type="button">Last 24 hours</button>
      <button data-range="7d" type="button">Last 7 days</button>
      <button data-range="30d" type="button">Last 30 days</button>
      <button data-range="billingCycle" type="button">Current Billing Cycle</button>
    </div>
  </section>

  <section class="chart-section collapsible-section" data-section="usage">
    <div class="chart-header">
      <div class="section-title-row" data-toggle-section="usage">
        <button
          type="button"
          class="section-toggle"
          data-toggle-section="usage"
          aria-expanded="true"
          aria-controls="section-body-usage"
          aria-label="Toggle Your Usage section"
        >
          <svg class="section-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div>
          <h2>Your Usage</h2>
          <p class="muted">Per-day usage over the selected range</p>
        </div>
      </div>
      <div class="chart-filters">
        <label>Usage:
          <select id="usage-filter">
            <option value="all">All</option>
            <option value="included">Included</option>
            <option value="ondemand">On-Demand</option>
          </select>
        </label>
        <label>Metric:
          <select id="metric-filter">
            <option value="spend">Spend</option>
            <option value="tokens" selected>Tokens</option>
            <option value="requests">Requests</option>
          </select>
        </label>
      </div>
    </div>
    <div id="section-body-usage" class="section-body">
      <div class="chart-wrapper">
        <canvas id="usage-chart"></canvas>
      </div>
      <p id="chart-note" class="muted small"></p>
    </div>
  </section>

  <section class="model-breakdown-section collapsible-section" data-section="breakdown">
    <div class="events-header">
      <div class="section-title-row" data-toggle-section="breakdown">
        <button
          type="button"
          class="section-toggle"
          data-toggle-section="breakdown"
          aria-expanded="true"
          aria-controls="section-body-breakdown"
          aria-label="Toggle Usage by Model section"
        >
          <svg class="section-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h2>Usage by Model</h2>
      </div>
      <span class="muted small" id="breakdown-range-label"></span>
    </div>
    <div id="section-body-breakdown" class="section-body">
      <div id="model-efficiency-advice" class="model-efficiency-advice hidden"></div>
      <div class="table-scroll">
        <table id="breakdown-table">
          <thead>
            <tr>
              <th data-sort="model" class="sortable">Model</th>
              <th data-sort="requests" class="sortable num">Requests</th>
              <th data-sort="totalTokens" class="sortable num">Tokens</th>
              <th data-sort="spendCents" class="sortable num">Spend</th>
              <th data-sort="costPerM" class="sortable num">$/M</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="events-section collapsible-section" data-section="events">
    <div class="events-header">
      <div class="section-title-row" data-toggle-section="events">
        <button
          type="button"
          class="section-toggle"
          data-toggle-section="events"
          aria-expanded="true"
          aria-controls="section-body-events"
          aria-label="Toggle Events section"
        >
          <svg class="section-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h2>Events</h2>
      </div>
      <button id="export-csv" type="button">Export CSV</button>
    </div>
    <div id="section-body-events" class="section-body">
      <div class="table-scroll">
        <table id="events-table">
          <thead>
            <tr>
              <th data-sort="timestamp" class="sortable">Date</th>
              <th data-sort="kind" class="sortable">Type</th>
              <th data-sort="model" class="sortable">Model</th>
              <th data-sort="totalTokens" class="sortable num">Tokens</th>
              <th data-sort="requests" class="sortable num">Requests</th>
              <th data-sort="spendCents" class="sortable num">Spend</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="pagination"></div>
    </div>
  </section>

  <div id="error-banner" class="error-banner hidden"></div>

  <script nonce="${nonce}" src="${chartUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}
