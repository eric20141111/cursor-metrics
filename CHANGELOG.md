# Changelog

All notable changes to this project are documented in this file.

## [0.5.22] - 2026-08-03

### Changed
- Renamed `cursorUsage.statusBarOnDemandLimit` to `cursorUsage.onDemandLimit` and apply that ceiling in both the status bar and dashboard On-Demand card.

## [0.5.21] - 2026-08-03

### Added
- `cursorUsage.statusBarOnDemandLimit` setting (default `1000`) to control the On-Demand ceiling shown in the status bar.

## [0.5.20] - 2026-08-03

### Changed
- Status bar now shows only On-Demand spend against a fixed `$1000` ceiling (for example `$114.78/$1000`), or `N/A` when On-Demand is disabled.
- Dashboard Events section always starts collapsed on open; expand is manual each visit.

## [0.5.18] - 2026-05-07

### Added
- Added `cursorUsage.quotaAwareEventDisplay` to control whether dashboard events show included usage as requests and on-demand usage as spend.

### Fixed
- Dashboard events, chart spend, model breakdown spend, and CSV export now treat included premium-request usage as request quota usage by default instead of on-demand spend.

## [0.5.15] - 2026-05-07

### Added
- Dashboard sections (Your Usage, Usage by Model, Events) are now collapsible. Section state is persisted across reloads.
- Dark mode support for the dashboard's filter dropdowns (Usage, Metric, sort selectors) so they match the rest of the themed UI in dark VS Code themes.

### Changed
- Replaced the unicode collapse glyphs with a 16×16 SVG chevron that uses `currentColor` and rotates 90° when a section is collapsed. Toggle hitbox enlarged from 14×14 to 20×20 for easier clicking.

## [0.5.12] - 2026-05-07

### Fixed
- Read Cursor auth tokens directly from `state.vscdb` without requiring a `sqlite3` CLI on PATH, native SQLite bindings, or platform-specific binaries.
- Support Cursor databases using WAL mode so freshly written auth values are visible.
- Avoid loading multi-GB Cursor databases into memory by traversing the SQLite table B-tree and reading only the auth rows needed.
- Harden dashboard CSV export against spreadsheet formula injection.
- Escape model names in trusted tooltip HTML and restrict trusted Markdown commands to known extension commands.
- Add request timeouts and a pagination cap for Cursor API fetches so refreshes cannot hang indefinitely.

## [0.5.11] - 2026-04-29

### Fixed
- Dashboard chart axis labels, gridlines, and legend text are now visible in light themes. VS Code webviews don't honor `prefers-color-scheme`, so light tokens are now applied via the `body.vscode-light` / `body.vscode-high-contrast-light` selectors that VS Code sets on the webview body.
- Chart tooltip uses themed surface, border, and foreground tokens instead of hardcoded dark colors so it remains readable in light themes.

## [0.5.10] - 2026-04-29

### Changed
- README now includes a screenshot of the in-editor dashboard alongside the existing tooltip screenshot, and lists the new `Cursor Usage: Open Dashboard` command.

## [0.5.7] - 2026-04-29

### Added
- Dashboard now has a `Usage by Model` section between the chart and the events table, with sortable Model / Requests / Tokens / Spend columns. Each row reuses the chart's color tinting so it visually maps to the chart series.
- Chart tooltip is now a real HTML table with a header row, a colored model dot, and a per-row Spend column when viewing Tokens or Requests.

### Changed
- Constrained dashboard content to a 1000px max width for readability on wide monitors.
- Centered the chart legend.
- When the `Current Billing Cycle` range is selected, the chart's x-axis now extends through the last day of the cycle so the full span is visible even before later days have data.
- Y-axis tick labels drop the trailing `.0` (`60M` instead of `60.0M`).
- Events table rows are tinted with the model color and gain a 3px left accent border, replacing the previous inline dot.
- Refined the `MAX` badge to match Cursor's gradient text treatment (purple → pink → peach).

## [0.5.2] - 2026-04-29

### Added
- Dashboard events table now shows a per-event Spend column (sortable, in USD).
- Chart tooltip now appends each model's spend on that day alongside the selected metric value when viewing Tokens or Requests.

## [0.5.1] - 2026-04-29

### Fixed
- VS Marketplace package now includes the `media/` directory so the dashboard webview's CSS, JavaScript, and bundled Chart.js load correctly. Previous 0.5.0 build shipped only `dist/` and `test/`, leaving the dashboard unstyled and non-interactive on VSCode.

## [0.5.0] - 2026-04-29

### Added
- New `cursor-usage.openDashboard` command opens a full Cursor Usage dashboard in a VSCode editor tab.
- Dashboard renders Included-Request and On-Demand summary cards, a stacked bar chart of per-day usage, and a sortable Events table with Export CSV.
- Range tabs (Last 24 hours / Last 7 days / Last 30 days / Current Billing Cycle) match the `cursorUsage.usageDuration` setting labels.
- Chart filters for Usage (All / Included / On-Demand) and Metric (Spend / Tokens / Requests); per-event spend now derives from `chargedCents` so Spend works for solo and team accounts.
- Events table shows `MAX` mode badges and a colored model dot that matches the chart palette.

### Changed
- Status-bar click now opens the new dashboard instead of the inline message dialog.
- Tooltip "Open Dashboard" link and the no-data warning's "Open Dashboard" action now route to the new in-VSCode dashboard.
- Dashboard polling reuses the existing `cursorUsage.pollInterval` cadence; the dashboard auto-updates whenever the host fetches new data.
- Usage events now parse `requestsCosts` (fractional) and string timestamps from the Cursor API; popup table rounds requests to integers.
- Theme refresh: shadcn-style dark surface, soft pastel chart palette, rounded top corners on the topmost stack segment.

## [0.4.11] - 2026-04-23

### Added
- Added `cursorUsage.excludeZeroTokenModels` to hide usage-by-model rows where token usage is zero.

### Changed
- Updated tooltip rendering to apply zero-token model filtering when the setting is enabled.
- Added tests covering filter behavior and configuration exposure.

## [0.4.10] - 2026-04-23

### Added
- Added `cursorUsage.modelBreakdownSortBy` to choose the usage-by-model table sort column (`Model`, `Requests`, `Tokens`, `Spend`).
- Added `cursorUsage.modelBreakdownSortOrder` to choose ascending or descending table order.

### Changed
- Updated usage-by-model aggregation to apply configured column/direction sorting, defaulting to `Tokens` descending.
- Added test coverage for new sort settings and ordering behavior.

## [0.4.9] - 2026-04-21

### Changed
- Simplified and decluttered the README for extension marketplace readability.
- Added a screenshot preview near the top of the README so the extension page shows the UI tooltip.
- Removed publishing and release-process documentation from the README.

## [0.4.8] - 2026-04-20

### Changed
- Added separate Open VSX and Visual Studio Marketplace packaging flows, including a Marketplace-specific package id of `cursor-usage-auto`.
- Documented the `wrick17` publisher setup, token requirements, and release commands for both marketplaces.
- Excluded generated build assets and helper scripts from packaged VSIX artifacts and local Bun test discovery.

## [0.4.7] - 2026-04-20

### Changed
- Moved usage-duration selection back into `cursorUsage.usageDuration` in Settings and made `Current Billing Cycle` the default.
- Restored the tooltip `Change` action and routed it to the `cursorUsage.usageDuration` setting.
- Added a friendly `Current Billing Cycle` label in the settings dropdown while still falling back to `30d` when billing reset metadata is unavailable.

## [0.4.6] - 2026-04-20

### Changed
- Backfilled changelog entries for every release from `0.1.0` through `0.4.5`.
- Added the missing `0.4.4` changelog entry based on git history.

## [0.4.5] - 2026-04-20

### Added
- Added a `Current Billing Cycle` range option in the tooltip range picker when reset metadata is available.
- Added duration option helpers and tests covering picker visibility and fallback behavior.

### Changed
- Switched range selection from settings navigation to an in-tooltip QuickPick command.
- Persisted selected range in extension global state while still seeding from the legacy `cursorUsage.usageDuration` setting.
- Updated usage aggregation to support billing-cycle cutoffs derived from `resetsAt`.
- Expanded usage event and daily spend fetch windows from 30 to 31 days to cover longer billing cycles.
- Updated README to describe the new picker flow and legacy-setting migration behavior.

## [0.4.4] - 2026-04-20

### Added
- Added a per-model spend breakdown to the tooltip.

## [0.4.3] - 2026-04-15

### Added
- Added limited on-demand spend cap details to the tooltip.

## [0.4.2] - 2026-03-26

### Changed
- Polished the usage tooltip layout.

## [0.4.1] - 2026-03-16

### Changed
- Aligned dashboard usage mapping with tooltip totals and unlimited spend display.
- Routed packaged VSIX artifacts to the `build/` directory for packaging and release workflows.

## [0.4.0] - 2026-02-26

### Added
- Added a per-model usage breakdown in the tooltip.
- Added a `cursorUsage.usageDuration` setting to control the usage breakdown time range.

### Changed
- Reworked the tooltip into a side-by-side layout for usage details.

## [0.3.3] - 2026-02-26

### Changed
- Made progress bars theme-aware for light and dark modes.

## [0.3.2] - 2026-02-25

### Added
- Added an extension icon.

## [0.3.1] - 2026-02-25

### Changed
- Updated README to reflect the current feature set, settings, and smart polling behavior.

## [0.3.0] - 2026-02-25

### Added
- Added SVG progress bars in the tooltip.
- Added a loading spinner and reset countdown state.

### Changed
- Introduced smart polling behavior for usage refreshes.

## [0.2.1] - 2026-02-25

### Changed
- Reduced API calls by caching setup data and reading the account email from the local database.

## [0.2.0] - 2026-02-25

### Added
- Added `cursorUsage.pollInterval` configuration for refresh cadence.
- Added `cursorUsage.minimalMode` configuration for a simplified status bar display.

### Changed
- Refined the status bar to adapt to the new polling and minimal-display preferences.

## [0.1.1] - 2026-02-25

### Added
- Added dashboard and manual refresh actions to the extension tooltip.

### Changed
- Updated package metadata with the new publisher, license, and repository details.
- Reworked the release script to package the extension and publish using the current version from `package.json`.
- Revised README installation and usage guidance.

## [0.1.0] - 2026-02-25

### Added
- Initial release of the extension.
- Added the renamed `cursor-usage` project structure and extension scaffolding.

### Changed
- Refactored the project layout, build pipeline, and ignore files for extension development.
- Updated scripts and execution permissions to support the renamed project.
