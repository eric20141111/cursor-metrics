# Cursor Usage

See Cursor On-Demand spend in your status bar, live while you work. Click the status bar item to open a full dashboard inside your editor.

![Cursor Usage extension tooltip](media/extensions-tooltip.png)

![Cursor Usage dashboard](media/extensions-dashboard.png)

## What you get

- Compact status bar display of On-Demand spend (for example: `$114.78/$1000`).
- Detailed hover tooltip with progress bars, reset countdown, and per-model usage.
- Full dashboard tab with summary cards, a per-day stacked bar chart, a sortable Usage by Model table, and a per-event Events table with Export CSV (Events starts collapsed).
- Loading indicator while fresh usage data is being fetched.
- Smart refresh behavior tied to editor activity and window focus.

## Commands

- `Cursor Usage: Open Dashboard` - open the in-editor dashboard.
- `Cursor Usage: Show Details` - show a quick usage summary message.
- `Cursor Usage: Refresh` - force a refresh immediately.

## Settings

- `cursorUsage.pollInterval` (default: `5`) - minimum refresh cooldown in minutes (`1`, `5`, `10`, `30`, `60`).
- `cursorUsage.minimalMode` (default: `false`) - show only the active metric.
- `cursorUsage.usageDuration` (default: `billingCycle`) - tooltip model-usage range: `1d`, `7d`, `30d`, or `billingCycle`.
- `cursorUsage.onDemandLimit` (default: `1000`) - On-Demand ceiling in dollars for status bar and dashboard (`spend / limit`).

## Privacy and behavior

- No manual API key setup required.
- Uses your existing signed-in Cursor session locally.
- Fetches on activity (editing/focus) instead of constant polling.
- Caches auth and API responses to avoid redundant requests.

## License

MIT
