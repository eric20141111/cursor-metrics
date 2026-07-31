import { describe, expect, it } from "bun:test";
import type { ModelAggregate } from "../src/model-breakdown";
import {
  buildModelEfficiency,
  costPerMillionTokens,
  formatCostPerM,
  MIN_SPEND_CENTS,
} from "../src/model-efficiency";

function row(partial: Partial<ModelAggregate> & { model: string }): ModelAggregate {
  return {
    totalTokens: 0,
    requests: 0,
    spendCents: 0,
    ...partial,
  };
}

describe("costPerMillionTokens", () => {
  it("returns null when tokens <= 0", () => {
    expect(costPerMillionTokens(100, 0)).toBeNull();
  });

  it("returns 0 when spend is 0 and tokens > 0", () => {
    expect(costPerMillionTokens(0, 1_000_000)).toBe(0);
  });

  it("uses spendCents * 10000 / totalTokens", () => {
    expect(costPerMillionTokens(100, 1_000_000)).toBeCloseTo(1, 5);
    expect(costPerMillionTokens(500, 500_000)).toBeCloseTo(10, 5);
  });
});

describe("formatCostPerM", () => {
  it("formats null as em dash", () => {
    expect(formatCostPerM(null)).toBe("—");
  });

  it("formats one decimal under 100", () => {
    expect(formatCostPerM(12.4)).toBe("$12.4/M");
  });

  it("formats >= 100 as integer dollars", () => {
    expect(formatCostPerM(100)).toBe("$100/M");
    expect(formatCostPerM(125.6)).toBe("$126/M");
  });
});

describe("buildModelEfficiency", () => {
  it("omits advice when no row meets spend floor", () => {
    const result = buildModelEfficiency([
      row({ model: "a", totalTokens: 1_000_000, spendCents: MIN_SPEND_CENTS - 1 }),
    ]);
    expect(result.advice).toBeNull();
    expect(result.expensive).toBeNull();
  });

  it("marks $0 spend as $0/M but not expensive", () => {
    const result = buildModelEfficiency([
      row({ model: "auto", totalTokens: 2_000_000, spendCents: 0 }),
      row({ model: "opus", totalTokens: 1_000_000, spendCents: 2000 }),
    ]);
    expect(result.rows.find((r) => r.model === "auto")!.costPerM).toBe(0);
    expect(result.expensive!.model).toBe("opus");
  });

  it("emits X-only advice when no 2x cheaper peer", () => {
    const result = buildModelEfficiency([
      row({ model: "a", totalTokens: 1_000_000, spendCents: 1000 }),
      row({ model: "b", totalTokens: 1_000_000, spendCents: 800 }),
    ]);
    expect(result.cheaper).toBeNull();
    expect(result.advice).toBe("Most expensive: a · $10/M");
  });

  it("picks Y with most tokens among 2x-cheaper peers", () => {
    const result = buildModelEfficiency([
      row({ model: "opus", totalTokens: 1_000_000, spendCents: 2000 }),
      row({ model: "cheap-small", totalTokens: 100_000, spendCents: 50 }),
      row({ model: "cheap-big", totalTokens: 900_000, spendCents: 450 }),
    ]);
    expect(result.cheaper!.model).toBe("cheap-big");
    expect(result.advice).toBe("Most expensive: opus · $20/M · try cheap-big ($5/M)");
  });

  it("shows X-only for a single eligible model", () => {
    const result = buildModelEfficiency([
      row({ model: "solo", totalTokens: 1_000_000, spendCents: 500 }),
    ]);
    expect(result.advice).toBe("Most expensive: solo · $5/M");
  });
});
