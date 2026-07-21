/** Escapes text for HTML body content. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escapes a value for use inside an HTML attribute. */
export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
