import {
  checkPasswordPolicy,
  generateSecureToken,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
  PasswordError,
  verifyPassword,
} from '@indexrocket/utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('password hashing', () => {
  it('never stores the plaintext', async () => {
    const password = 'a-very-secret-passphrase';
    const hash = await hashPassword(password);

    assert.equal(hash.includes(password), false);
    assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/);
  });

  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    assert.equal(await verifyPassword('Correct horse battery staple', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  it('salts, so identical passwords produce different hashes', async () => {
    assert.notEqual(await hashPassword('same-password-value'), await hashPassword('same-password-value'));
  });

  it('rejects legacy or malformed stored hashes without throwing', async () => {
    assert.equal(await verifyPassword('x', 'not-a-real-hash-auth-is-a-later-step'), false);
    assert.equal(await verifyPassword('x', ''), false);
    assert.equal(await verifyPassword('x', 'scrypt$bad$bad$bad$bad$bad'), false);
  });

  it('refuses to hash a password that fails the policy', async () => {
    await assert.rejects(() => hashPassword('short'), PasswordError);
  });
});

describe('password policy', () => {
  it('requires a minimum length', () => {
    assert.equal(checkPasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH - 1)).valid, false);
    assert.equal(checkPasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH)).valid, true);
  });

  it('rejects non-strings and whitespace-only values', () => {
    assert.equal(checkPasswordPolicy(undefined).valid, false);
    assert.equal(checkPasswordPolicy(12345678901).valid, false);
    assert.equal(checkPasswordPolicy('              ').valid, false);
  });

  it('rejects absurdly long values (hashing DoS guard)', () => {
    assert.equal(checkPasswordPolicy('a'.repeat(5000)).valid, false);
  });
});

describe('email identity', () => {
  it('normalizes case and surrounding space', () => {
    assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
  });

  it('accepts ordinary addresses', () => {
    assert.equal(isValidEmail('person@example.com'), true);
    assert.equal(isValidEmail('first.last+tag@sub.example.co.uk'), true);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'no-at-sign', 'a@b', 'a@@b.com', 'a b@example.com', '@example.com', undefined, 42]) {
      assert.equal(isValidEmail(bad), false, `should reject ${String(bad)}`);
    }
  });

  it('does not merge distinct addresses (no dot/plus stripping)', () => {
    assert.notEqual(normalizeEmail('first.last@gmail.com'), normalizeEmail('firstlast@gmail.com'));
    assert.notEqual(normalizeEmail('user+a@gmail.com'), normalizeEmail('user@gmail.com'));
  });
});

describe('session identifiers', () => {
  it('are long, URL-safe and unpredictable', () => {
    const id = generateSecureToken(32);

    assert.match(id, /^[A-Za-z0-9_-]+$/);
    assert.ok(id.length >= 40);
  });

  it('never collide across many generations', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 5000; i += 1) {
      seen.add(generateSecureToken(32));
    }

    assert.equal(seen.size, 5000);
  });
});
