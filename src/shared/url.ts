/**
 * Redacts `user:pass@` from URL text used in public messages and UI.
 * Prefers the URL parser; falls back to a conservative string replace.
 */
export function redactUrlUserinfo(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      parsed.username = '***';
      parsed.password = '';
      return parsed.toString();
    }
    return url;
  } catch {
    return url.replace(/\/\/([^/?#]*@)/u, '//***@');
  }
}
