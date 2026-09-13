/** Display helpers. Every function renders "—" or null for missing data rather than inventing a value. */

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const numberFormat = new Intl.NumberFormat();
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function parseDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);

  return date === null ? '—' : dateTimeFormat.format(date);
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);

  return date === null ? '—' : dateFormat.format(date);
}

const RELATIVE_STEPS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelative(value: string | null | undefined, now: number = Date.now()): string {
  const date = parseDate(value);

  if (date === null) {
    return '—';
  }

  const seconds = Math.round((date.getTime() - now) / 1000);
  const magnitude = Math.abs(seconds);

  if (magnitude < 45) {
    return 'just now';
  }

  for (const [unit, size] of RELATIVE_STEPS) {
    if (magnitude >= size) {
      return relativeFormat.format(Math.round(seconds / size), unit);
    }
  }

  return relativeFormat.format(Math.round(seconds / 60), 'minute');
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Percentage of part in whole, or null when the whole is zero (no data yet). */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) {
    return null;
  }

  return (part / whole) * 100;
}

export function formatPercent(part: number, whole: number, digits = 0): string {
  const value = percentOf(part, whole);

  return value === null ? '—' : `${value.toFixed(digits)}%`;
}

/** "not_indexed" -> "Not indexed", "SUBMITTED_AND_INDEXED" -> "Submitted and indexed". */
export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim().toLowerCase();

  return spaced === '' ? value : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function initials(name: string, email: string): string {
  const source = name.trim() !== '' ? name : email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2);

  return letters.toUpperCase();
}

export interface SiteUrlInfo {
  kind: 'domain' | 'url-prefix';
  label: string;
  host: string;
}

/** Search Console properties are either "sc-domain:example.com" or a URL prefix. */
export function describeSiteUrl(siteUrl: string): SiteUrlInfo {
  if (siteUrl.startsWith('sc-domain:')) {
    const host = siteUrl.slice('sc-domain:'.length);

    return { kind: 'domain', label: 'Domain property', host };
  }

  let host = siteUrl;

  try {
    host = new URL(siteUrl).hostname;
  } catch {
    // Keep the raw value; it is still shown verbatim.
  }

  return { kind: 'url-prefix', label: 'URL-prefix property', host };
}

/** Picks the Search Console property that covers a project domain, if any. */
export function propertyForDomain<T extends { siteUrl: string }>(properties: T[], domain: string): T | undefined {
  const target = domain.toLowerCase().replace(/^www\./, '');

  const covers = (property: T): boolean => {
    const host = describeSiteUrl(property.siteUrl).host.toLowerCase().replace(/^www\./, '');

    return host === target || target.endsWith(`.${host}`);
  };

  return (
    properties.find((property) => property.siteUrl.startsWith('sc-domain:') && covers(property)) ??
    properties.find(covers)
  );
}
