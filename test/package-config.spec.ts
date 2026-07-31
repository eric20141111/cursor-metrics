import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import packageJson from "../package.json";

describe("package configuration", () => {
  it("shows a friendly label for billing cycle in the usage duration setting", () => {
    const usageDurationConfig = packageJson.contributes.configuration.properties["cursorUsage.usageDuration"];

    expect(usageDurationConfig.enum).toContain("billingCycle");
    expect(usageDurationConfig.enumItemLabels).toEqual([
      "Last 24 hours",
      "Last 7 days",
      "Last 30 days",
      "Current Billing Cycle",
    ]);
  });

  it("keeps the display name while using a unique VS Marketplace package id", () => {
    expect(packageJson.displayName).toBe("Cursor Usage");
    expect(packageJson.scripts["package:vsm"]).toContain("cursor-usage-auto");
    expect(packageJson.scripts["publish:vsm"]).toContain("cursor-usage-auto");
  });

  it("exposes model table sorting settings with token-desc defaults", () => {
    const sortByConfig = packageJson.contributes.configuration.properties["cursorUsage.modelBreakdownSortBy"];
    const sortOrderConfig = packageJson.contributes.configuration.properties["cursorUsage.modelBreakdownSortOrder"];

    expect(sortByConfig.default).toBe("tokens");
    expect(sortByConfig.enum).toEqual(["model", "requests", "tokens", "spend"]);
    expect(sortByConfig.enumItemLabels).toEqual(["Model", "Requests", "Tokens", "Spend"]);

    expect(sortOrderConfig.default).toBe("desc");
    expect(sortOrderConfig.enum).toEqual(["asc", "desc"]);
    expect(sortOrderConfig.enumItemLabels).toEqual(["Ascending", "Descending"]);
  });

  it("exposes a setting to hide zero-token models in the breakdown", () => {
    const hideZeroTokenConfig = packageJson.contributes.configuration.properties["cursorUsage.excludeZeroTokenModels"];

    expect(hideZeroTokenConfig.default).toBe(false);
    expect(hideZeroTokenConfig.type).toBe("boolean");
  });

  it("exposes a setting for quota-aware event display", () => {
    const quotaAwareConfig = packageJson.contributes.configuration.properties["cursorUsage.quotaAwareEventDisplay"];

    expect(quotaAwareConfig.default).toBe(true);
    expect(quotaAwareConfig.type).toBe("boolean");
  });

  it("exposes an optional monthly On-demand budget setting", () => {
    const budgetConfig = packageJson.contributes.configuration.properties["cursorUsage.monthlyOnDemandBudget"];

    expect(budgetConfig.default).toBeNull();
    expect(budgetConfig.type).toEqual(["number", "null"]);
    expect(budgetConfig.minimum).toBe(0);
  });

  it("exposes a Budget Advice command", () => {
    const commands = packageJson.contributes.commands;
    expect(commands.some((c) => c.command === "cursor-usage.budgetAdvice")).toBe(true);
    expect(commands.find((c) => c.command === "cursor-usage.budgetAdvice")?.title).toBe(
      "Cursor Usage: Budget Advice",
    );
  });

  it("does not depend on external sqlite binaries or native bindings", () => {
    const vscodeIgnore = readFileSync(".vscodeignore", "utf-8").split(/\r?\n/);
    const esbuildConfig = readFileSync("esbuild.config.mjs", "utf-8");

    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.scripts.package).not.toContain("--no-dependencies");
    expect(packageJson.scripts["package:vsm"]).not.toContain("--no-dependencies");
    expect(vscodeIgnore).toContain("node_modules/");
    expect(vscodeIgnore).toContain("node-compile-cache/");
    expect(esbuildConfig).toContain('external: ["vscode"]');
  });
});
