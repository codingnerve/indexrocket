import type { NextConfig } from 'next';

/**
 * Production hardening only; no behaviour change for pages.
 *
 * NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time, so the
 * production build must be made with the production API URL. A build without it
 * refuses to call any API at runtime rather than silently falling back to
 * localhost (see app/lib/api.ts).
 */
const isProduction = process.env.NODE_ENV === 'production';
const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? '';

if (isProduction && apiUrl === '') {
  console.warn(
    '[web] NEXT_PUBLIC_API_URL is not set for this production build. The bundle will not be able to reach the API; rebuild with it set.',
  );
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const apiOrigin = originOf(apiUrl);

/**
 * CSP without nonces, following this Next.js version's own guide
 * (docs/01-app/02-guides/content-security-policy.md). Production only: the
 * development server needs eval and a websocket for hot reload.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${apiOrigin === null ? '' : ` ${apiOrigin}`}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isProduction ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Explicit: production builds must not ship browser source maps.
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
