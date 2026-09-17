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
 * emoji/symbol token (no whitespace, max 8 chars).
 */
export function isValidEmoji(value: string): boolean {
  if (/^\d{5,25}$/.test(value)) return true;
  return value.length > 0 && value.length <= 8 && !/\s/.test(value);
}

export function formatPrice(price: number | string): string {
  return Number(price).toFixed(2);
}
