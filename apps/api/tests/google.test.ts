import {
  decryptSecret,
  encryptSecret,
  EncryptionError,
  generateSecureToken,
  normalizeUrl,
  parseEncryptionKey,
  safeEquals,
} from '@indexrocket/utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAuthorizationUrl,
  describeGoogleError,
  googleRequest,
  mapInspectionStatus,
  SEARCH_CONSOLE_SCOPE,
  urlBelongsToProperty,
} from '@indexrocket/google';

const CONFIG = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  clientSecret: 'test-client-secret-value',
  redirectUri: 'http://localhost:5000/api/auth/google/callback',
};

describe('OAuth state generation', () => {
  it('produces URL-safe tokens of adequate length', () => {
    const state = generateSecureToken(32);

    assert.match(state, /^[A-Za-z0-9_-]+$/);
    assert.ok(state.length >= 40, `state too short: ${state.length}`);
  });

  it('never repeats across many generations', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 2000; i += 1) {
      seen.add(generateSecureToken(32));
    }

    assert.equal(seen.size, 2000);
  });
});

describe('OAuth state validation', () => {
  it('matches an identical state', () => {
    const state = generateSecureToken(32);

    assert.equal(safeEquals(state, state), true);
  });

  it('rejects a different state of the same length', () => {
    const a = generateSecureToken(32);
    const b = generateSecureToken(32);

    assert.equal(safeEquals(a, b), false);
  });

  it('rejects states of differing length without throwing', () => {
    assert.equal(safeEquals('short', generateSecureToken(32)), false);
    assert.equal(safeEquals('', 'x'), false);
  });
});

describe('authorization URL', () => {
  const url = new URL(buildAuthorizationUrl(CONFIG, 'state-value'));

  it('targets Google and carries the state', () => {
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('state'), 'state-value');
  });

  it('requests only the read-only Search Console scope', () => {
    assert.equal(url.searchParams.get('scope'), SEARCH_CONSOLE_SCOPE);
    assert.equal(SEARCH_CONSOLE_SCOPE, 'https://www.googleapis.com/auth/webmasters.readonly');
  });

  it('requests offline access so a refresh token is issued', () => {
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
  });

  it('uses the server-configured redirect URI, never a caller-supplied one', () => {
    assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  });

  it('never places the client secret in the authorization URL', () => {
    assert.equal(url.toString().includes(CONFIG.clientSecret), false);
  });
});

describe('token encryption at rest', () => {
  const key = parseEncryptionKey('a'.repeat(64));

  it('round-trips a token', () => {
    const token = 'ya29.a0AfH6SMB-fake-access-token-value';

    assert.equal(decryptSecret(encryptSecret(token, key), key), token);
  });

  it('never stores the plaintext in the ciphertext', () => {
    const token = 'refresh-token-secret-value';
    const encrypted = encryptSecret(token, key);

    assert.equal(encrypted.includes(token), false);
    assert.match(encrypted, /^v1:/);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    assert.notEqual(encryptSecret('same', key), encryptSecret('same', key));
  });

  it('detects tampering via the GCM auth tag', () => {
    const encrypted = encryptSecret('token', key);
    const parts = encrypted.split(':');
    const tampered = [parts[0], parts[1], parts[2], 'AAAA'].join(':');

    assert.throws(() => decryptSecret(tampered, key), EncryptionError);
  });

  it('fails to decrypt with a different key', () => {
    const other = parseEncryptionKey('b'.repeat(64));

    assert.throws(() => decryptSecret(encryptSecret('token', key), other), EncryptionError);
  });

  it('rejects malformed keys instead of weakening silently', () => {
    assert.throws(() => parseEncryptionKey('too-short'), EncryptionError);
    assert.throws(() => parseEncryptionKey(''), EncryptionError);
  });
});

describe('Google host allowlist (no SSRF via the integration)', () => {
  it('refuses a non-Google host', async () => {
    await assert.rejects(
      () => googleRequest('https://evil.example.com/steal', { method: 'GET' }),
      /non-allowlisted host/,
    );
  });

  it('refuses localhost', async () => {
    await assert.rejects(
      () => googleRequest('https://127.0.0.1/', { method: 'GET' }),
      /non-allowlisted host/,
    );
  });

  it('refuses plain HTTP', async () => {
    await assert.rejects(
      () => googleRequest('http://oauth2.googleapis.com/token', { method: 'GET' }),
      /must use HTTPS/,
    );
  });
});

describe('property membership', () => {
  it('accepts a URL under a URL-prefix property', () => {
    assert.equal(urlBelongsToProperty('https://theflyventures.com/about', 'https://theflyventures.com/'), true);
  });

  it('rejects a URL outside a URL-prefix property', () => {
    assert.equal(urlBelongsToProperty('https://evil.com/about', 'https://theflyventures.com/'), false);
    assert.equal(urlBelongsToProperty('https://theflyventures.com.evil.com/', 'https://theflyventures.com/'), false);
  });

  it('accepts the domain and subdomains of a domain property', () => {
    assert.equal(urlBelongsToProperty('https://theflyventures.com/x', 'sc-domain:theflyventures.com'), true);
    assert.equal(urlBelongsToProperty('https://blog.theflyventures.com/x', 'sc-domain:theflyventures.com'), true);
  });

  it('rejects a foreign host for a domain property', () => {
    assert.equal(urlBelongsToProperty('https://evil.com/x', 'sc-domain:theflyventures.com'), false);
    assert.equal(urlBelongsToProperty('https://nottheflyventures.com/x', 'sc-domain:theflyventures.com'), false);
  });
});

describe('inspection URL validation', () => {
  it('rejects non-URLs and unsupported schemes', () => {
    assert.throws(() => normalizeUrl('not-a-url'));
    assert.throws(() => normalizeUrl('ftp://example.com'));
    assert.throws(() => normalizeUrl('file:///etc/passwd'));
  });

  it('normalizes consistently before sending to Google', () => {
    assert.equal(normalizeUrl('HTTPS://TheFlyVentures.COM/About'), 'https://theflyventures.com/About');
  });
});

describe('mapping Google verdicts to our status', () => {
  it('reports indexed only when Google says PASS', () => {
    assert.equal(mapInspectionStatus('PASS', 'Submitted and indexed'), 'indexed');
  });

  it('never claims indexed for a FAIL verdict', () => {
    assert.equal(mapInspectionStatus('FAIL', 'URL is unknown to Google'), 'not_indexed');
  });

  it('reports not_indexed for a NEUTRAL verdict with no coverage', () => {
    assert.equal(mapInspectionStatus('NEUTRAL', 'URL is unknown to Google'), 'not_indexed');
  });

  it('reports unknown rather than guessing when signals conflict', () => {
    assert.equal(mapInspectionStatus('PARTIAL', 'Indexed, not submitted in sitemap'), 'unknown');
    assert.equal(mapInspectionStatus(null, null), 'unknown');
    assert.equal(mapInspectionStatus('VERDICT_UNSPECIFIED', null), 'unknown');
  });
});

describe('Google error descriptions', () => {
  it('surfaces Google structured error messages', () => {
    const body = JSON.stringify({ error: { code: 403, message: 'User does not have permission' } });

    assert.match(describeGoogleError(403, body), /User does not have permission/);
  });

  it('surfaces OAuth string errors', () => {
    assert.match(describeGoogleError(400, JSON.stringify({ error: 'invalid_grant' })), /invalid_grant/);
  });

  it('degrades safely on unparseable bodies', () => {
    assert.equal(describeGoogleError(500, '<html>oops</html>'), 'Google API returned HTTP 500.');
  });
});
