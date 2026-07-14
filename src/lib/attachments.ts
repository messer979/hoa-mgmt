// Content types the browser can render inline via the `/view` route
// (as opposed to forcing a download). PDFs render in the built-in viewer;
// text/html and text/plain cover typical email exports; message/rfc822 is
// what most mail clients label raw .eml files as.
const INLINE_VIEWABLE = new Set([
  "application/pdf",
  "text/html",
  "text/plain",
  "message/rfc822",
]);

export function canViewInline(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  return !!base && INLINE_VIEWABLE.has(base);
}
