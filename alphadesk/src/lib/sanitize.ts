/** Sanitize user-provided text. React escapes on render; these guard storage, markdown and exports. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeText(s: unknown, maxLen = 10_000): string {
  if (typeof s !== 'string') return '';
  return s.replace(CONTROL, '').replace(/\r\n/g, '\n').trim().slice(0, maxLen);
}

/** Strip HTML tags + dangerous URL schemes (for markdown bodies, comments). */
export function sanitizeMarkdown(s: unknown, maxLen = 50_000): string {
  return sanitizeText(s, maxLen)
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\]\(\s*(javascript|data|vbscript):(?:[^()]|\([^)]*\))*\)/gi, '](#)');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function sanitizeTicker(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) ? t : null;
}

/** Neutralise CSV/Excel formula injection. */
export function csvSafe(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
