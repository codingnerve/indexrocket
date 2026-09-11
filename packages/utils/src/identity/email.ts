/**
 * Email handling for account identity.
 *
 * Normalization is intentionally conservative: lowercase and trim only. Provider
 * specific tricks (stripping dots or +tags from Gmail) are NOT applied, because
 * treating two addresses the user considers distinct as one account is worse
 * than allowing both to register.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const EMAIL_MAX_LENGTH = 254;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: unknown): email is string {
  if (typeof email !== 'string') {
    return false;
  }

  const normalized = normalizeEmail(email);

  return normalized.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(normalized);
}
