import { describeGoogleError, googleRequest } from './httpClient.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Read-only Search Console access. Nothing broader is ever requested. */
export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

/** Raised when Google rejects the credentials outright (revoked/invalid grant). */
export class GoogleAuthError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'GoogleAuthError';
    this.retryable = retryable;
  }
}

/**
 * Builds the consent URL.
 *
 * `access_type=offline` + `prompt=consent` are required to receive a refresh
 * token; without them Google returns only a short-lived access token and the
 * connection cannot survive an hour.
 */
export function buildAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(AUTH_ENDPOINT);

  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SEARCH_CONSOLE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function toTokenSet(parsed: TokenResponse, fallbackRefresh: string | null): GoogleTokenSet {
  if (typeof parsed.access_token !== 'string' || parsed.access_token === '') {
    throw new GoogleAuthError('Google did not return an access token.');
  }

  const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;

  return {
    accessToken: parsed.access_token,
    refreshToken:
      typeof parsed.refresh_token === 'string' && parsed.refresh_token !== ''
        ? parsed.refresh_token
        : fallbackRefresh,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: typeof parsed.scope === 'string' ? parsed.scope.split(' ').filter(Boolean) : [],
  };
}

async function postToken(form: URLSearchParams, fallbackRefresh: string | null): Promise<GoogleTokenSet> {
  const response = await googleRequest(TOKEN_ENDPOINT, {
    method: 'POST',
    body: form.toString(),
    contentType: 'application/x-www-form-urlencoded',
  });

  let parsed: TokenResponse;

  try {
    parsed = JSON.parse(response.body) as TokenResponse;
  } catch {
    throw new GoogleAuthError(`Google returned an unreadable token response (HTTP ${response.status}).`);
  }

  if (response.status !== 200) {
    // invalid_grant means the user revoked access or the refresh token died.
    const permanent = parsed.error === 'invalid_grant' || parsed.error === 'invalid_client';

    throw new GoogleAuthError(
      // error_description is Google's text; it never contains our secret.
      parsed.error_description ?? describeGoogleError(response.status, response.body),
      !permanent,
    );
  }

  return toTokenSet(parsed, fallbackRefresh);
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GoogleTokenSet> {
  const form = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });

  return await postToken(form, null);
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<GoogleTokenSet> {
  const form = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });

  return await postToken(form, refreshToken);
}

/** Best-effort revocation; a failure here must not block disconnecting locally. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await googleRequest(REVOKE_ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({ token }).toString(),
      contentType: 'application/x-www-form-urlencoded',
    });

    return response.status === 200;
  } catch {
    return false;
  }
}
