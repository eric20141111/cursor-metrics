import { describe, expect, it } from "bun:test";
import { renderTooltipRoundedCard } from "../src/tooltip-card";

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
});
