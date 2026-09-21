/** Shared validation helpers for Telegram command arguments. */

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/** Accepts positive prices with at most 2 decimals, up to 1,000,000. */
export function parsePrice(value: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 1_000_000) return null;
  return num;
}

/**
 * Accepts either a Telegram custom emoji id (5-25 digits) or a short literal
 * emoji/symbol token (no whitespace, no HTML metacharacters, max 8 chars).
 * HTML metacharacters are rejected even though messages are HTML-escaped
 * before rendering, as defense in depth for a field that should only ever
 * hold an emoji or symbol.
 */
export function isValidEmoji(value: string): boolean {
  if (/^\d{5,25}$/.test(value)) return true;
  return value.length > 0 && value.length <= 8 && !/[\s<>&"']/.test(value);
}

/** Constant-time string comparison to avoid leaking secret length/content via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function formatPrice(price: number | string): string {
  return Number(price).toFixed(2);
}
