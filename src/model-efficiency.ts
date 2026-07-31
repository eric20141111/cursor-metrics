import type { ModelAggregate } from "./model-breakdown";

/** Minimum on-demand spend (cents) before a model can be labeled most expensive. */
export const MIN_SPEND_CENTS = 50;

/** Y must be at least this many times cheaper than X ($/M). */
export const COST_RATIO = 2;

export type ModelEfficiencyRow = ModelAggregate & { costPerM: number | null };

export type ModelEfficiency = {
  rows: ModelEfficiencyRow[];
  expensive: ModelEfficiencyRow | null;
  cheaper: ModelEfficiencyRow | null;
  advice: string | null;
};

export function costPerMillionTokens(spendCents: number, totalTokens: number): number | null {
  if (totalTokens <= 0) return null;
  return (spendCents * 10_000) / totalTokens;
}

export function formatCostPerM(value: number | null): string {
  if (value === null) return "—";
  if (value >= 100) return `$${Math.round(value)}/M`;
  const rounded = Math.round(value * 10) / 10;
  return `$${rounded}/M`;
}

function isBetterCheaperCandidate(candidate: ModelEfficiencyRow, current: ModelEfficiencyRow): boolean {
  if (candidate.totalTokens !== current.totalTokens) {
    return candidate.totalTokens > current.totalTokens;
  }
  const c = candidate.costPerM as number;
  const cur = current.costPerM as number;
  if (c !== cur) return c < cur;
  return candidate.model.localeCompare(current.model) < 0;
}

export function buildModelEfficiency(rows: ModelAggregate[]): ModelEfficiency {
  const annotated: ModelEfficiencyRow[] = rows.map((r) => ({
    ...r,
    costPerM: costPerMillionTokens(r.spendCents, r.totalTokens),
  }));

  let expensive: ModelEfficiencyRow | null = null;
  for (const r of annotated) {
    if (r.costPerM === null || r.spendCents < MIN_SPEND_CENTS) continue;
    if (!expensive || r.costPerM > (expensive.costPerM as number)) {
      expensive = r;
    }
  }

  let cheaper: ModelEfficiencyRow | null = null;
  if (expensive && expensive.costPerM !== null) {
    const threshold = expensive.costPerM / COST_RATIO;
    for (const r of annotated) {
      if (r === expensive || r.costPerM === null) continue;
      if (r.costPerM > threshold) continue;
      if (!cheaper || isBetterCheaperCandidate(r, cheaper)) {
        cheaper = r;
      }
    }
  }

  let advice: string | null = null;
  if (expensive && expensive.costPerM !== null) {
    const xCost = formatCostPerM(expensive.costPerM);
    advice =
      cheaper && cheaper.costPerM !== null
        ? `Most expensive: ${expensive.model} · ${xCost} · try ${cheaper.model} (${formatCostPerM(cheaper.costPerM)})`
        : `Most expensive: ${expensive.model} · ${xCost}`;
  }

  return { rows: annotated, expensive, cheaper, advice };
}
