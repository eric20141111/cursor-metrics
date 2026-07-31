export type TooltipCardTone = "neutral" | "info" | "warning" | "danger";

export type TooltipCardRenderer = (
  contentHtml: string,
  height: number,
  tone: TooltipCardTone,
) => string;

/** Markdown needs a blank line after block content, otherwise the next heading flows beside it. */
export function toMarkdownBlock(html: string): string {
  return `${html.replace(/\s+$/, "")}\n\n`;
}

/** Rows are clipped by the card's fixed height, so keep them single-line and predictable. */
export const CARD_ROW_HEIGHT = 20;

/** Card chrome: 2px border plus 10px padding on both sides. */
export const CARD_CHROME_HEIGHT = 24;

export function cardHeightForRows(rowCount: number): number {
  return CARD_CHROME_HEIGHT + rowCount * CARD_ROW_HEIGHT;
}

export function renderTooltipRoundedCard(
  contentHtml: string,
  height: number,
  tone: TooltipCardTone,
  lightTheme: boolean,
): string {
  const borderByTone: Record<TooltipCardTone, string> = {
    neutral: lightTheme ? "#64748B" : "#94A3B8",
    info: lightTheme ? "#2563EB" : "#60A5FA",
    warning: lightTheme ? "#D97706" : "#F59E0B",
    danger: lightTheme ? "#DC2626" : "#F87171",
  };
  const foreground = lightTheme ? "#1F2937" : "#E5E7EB";
  const muted = lightTheme ? "#64748B" : "#94A3B8";
  const background = lightTheme ? "#F8FAFC" : "#111827";
  const border = borderByTone[tone];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="302" height="${height}" viewBox="0 0 302 ${height}">`,
    `<foreignObject x="0" y="0" width="302" height="${height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:302px;height:${height}px;border:2px solid ${border};border-radius:10px;background:${background};padding:10px;color:${foreground};font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;">`,
    `<style>table{width:100%;border-collapse:collapse}td,th{padding:0 3px}th{color:${muted};font-weight:600}sub{color:${muted};font-size:11px}em{color:${foreground}}table.rows{table-layout:fixed}table.rows td,table.rows th{height:${CARD_ROW_HEIGHT}px;line-height:${CARD_ROW_HEIGHT}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>`,
    contentHtml,
    `</div>`,
    `</foreignObject>`,
    `</svg>`,
  ].join("");
  const encoded = Buffer.from(svg).toString("base64");
  // An <img> is inline and Markdown does not wrap raw HTML in a paragraph, so
  // without the <br> the next card would render beside this one.
  return `<img src="data:image/svg+xml;base64,${encoded}" width="302" height="${height}" alt="Cursor Usage section" /><br>`;
}
