/**
 * Host matching for discovery notifications.
 *
 * THE RULE: a URL may be notified for a project only when the URL's hostname is
 * exactly the project's domain, or that domain prefixed with `www.`. The two are
 * treated as equivalent because sites routinely serve both.
 *
 * Any other subdomain (blog.example.com, shop.example.com) is a DIFFERENT host:
 * IndexNow requires the key file to live on the notified host, so a subdomain
 * needs its own project and its own key. Rejecting it here is deliberate, not an
 * oversight — silently accepting it would let one project notify URLs for hosts
 * it has not proven control over.
 */

/** Lowercases, trims a trailing dot, and drops a leading `www.`. */
export function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');

  return trimmed.startsWith('www.') ? trimmed.slice(4) : trimmed;
}

/** True when `hostname` is the project domain or its `www.` variant. */
export function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeDomain(hostname);
  const base = normalizeDomain(domain);

  if (base === '' || host === '') {
    return false;
  }

  return host === base;
}

/** The exact host a notification must be sent for, taken from the URL itself. */
export function hostOfUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    return parsed.hostname.replace(/\.+$/, '').toLowerCase();
  } catch {
    return null;
  }
}
