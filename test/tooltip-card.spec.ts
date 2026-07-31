import { describe, expect, it } from "bun:test";
import {
  CARD_ROW_HEIGHT,
  cardHeightForRows,
  renderTooltipRoundedCard,
} from "../src/tooltip-card";

function decodeSvg(imageHtml: string): string {
  const encoded = imageHtml.match(/base64,([^"]+)/)?.[1];
  if (!encoded) throw new Error("Missing SVG data URI");
  return Buffer.from(encoded, "base64").toString("utf8");
}

describe("renderTooltipRoundedCard", () => {
  it("renders a real rounded rectangle with a visible dark-theme border", () => {
    const html = renderTooltipRoundedCard("<strong>Usage</strong>", 72, "info", false);
    const svg = decodeSvg(html);

    expect(svg).toContain("border:2px solid #60A5FA");
    expect(svg).toContain("border-radius:10px");
    expect(svg).toContain("background:#111827");
    expect(svg).toContain("<foreignObject");
  });

  it("uses the light-theme warning palette", () => {
    const svg = decodeSvg(
      renderTooltipRoundedCard("<em>Recommendation</em>", 64, "warning", true),
    );

    expect(svg).toContain("border:2px solid #D97706");
    expect(svg).toContain("background:#F8FAFC");
  });

  it("ends with a line break so a following card cannot render beside it", () => {
    const html = renderTooltipRoundedCard("<strong>Usage</strong>", 72, "info", false);

    expect(html.endsWith("<br>")).toBe(true);
  });

  it("pins row tables to one line per row so the card height fits the content", () => {
    const svg = decodeSvg(
      renderTooltipRoundedCard(`<table class="rows"></table>`, cardHeightForRows(4), "neutral", false),
    );

    expect(svg).toContain("table.rows{table-layout:fixed}");
    expect(svg).toContain(`height:${CARD_ROW_HEIGHT}px`);
    expect(svg).toContain("white-space:nowrap");
    expect(svg).toContain("text-overflow:ellipsis");
    expect(svg).toContain(`height="${cardHeightForRows(4)}"`);
  });
});

describe("cardHeightForRows", () => {
  it("grows linearly with the row count and leaves room for the card chrome", () => {
    expect(cardHeightForRows(1)).toBe(24 + CARD_ROW_HEIGHT);
    expect(cardHeightForRows(9) - cardHeightForRows(8)).toBe(CARD_ROW_HEIGHT);
  });
});
