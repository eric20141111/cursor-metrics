export type TooltipCardTone = "neutral" | "info" | "warning" | "danger";

export type TooltipCardRenderer = (
  contentHtml: string,
  height: number,
  tone: TooltipCardTone,
) => string;

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
    `<style>table{width:100%;border-collapse:collapse}td,th{padding:2px 3px}th{color:${muted};font-weight:600}sub{color:${muted};font-size:11px}td:first-child{overflow:hidden;text-overflow:ellipsis}em{color:${foreground}}</style>`,
    contentHtml,
    `</div>`,
    `</foreignObject>`,
    `</svg>`,
  ].join("");
  const encoded = Buffer.from(svg).toString("base64");
  return `<img src="data:image/svg+xml;base64,${encoded}" width="302" height="${height}" alt="Cursor Usage section" />`;
}
