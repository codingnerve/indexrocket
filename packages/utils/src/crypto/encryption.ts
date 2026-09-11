import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticated symmetric encryption for secrets at rest (OAuth tokens).
 *
 * AES-256-GCM with a random 96-bit IV per message. The stored form is
 * `v1:<iv>:<authTag>:<ciphertext>`, all base64url. GCM authenticates the
 * ciphertext, so tampering is detected on decrypt rather than silently accepted.
 */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Accepts a 32-byte key as base64 or hex. Anything else is rejected loudly:
 * a short or malformed key must never silently weaken the encryption.
 */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (trimmed === '') {
    throw new EncryptionError('Encryption key is empty.');
  }

  const candidates: Buffer[] = [];

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    candidates.push(Buffer.from(trimmed, 'hex'));
  }

  try {
    candidates.push(Buffer.from(trimmed, 'base64'));
  } catch {
    // Ignored: the hex branch may still have produced a usable key.
  }

  const key = candidates.find((candidate) => candidate.length === KEY_BYTES);

  if (key === undefined) {
    throw new EncryptionError(
      `Encryption key must decode to ${KEY_BYTES} bytes (64 hex characters or 44 base64 characters).`,
    );
  }

  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(`Encryption key must be ${KEY_BYTES} bytes.`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(`Encryption key must be ${KEY_BYTES} bytes.`);
  }

  const parts = payload.split(':');

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new EncryptionError('Encrypted payload is malformed or uses an unknown version.');
  }

  const [, ivPart, tagPart, dataPart] = parts;

  if (ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    throw new EncryptionError('Encrypted payload is malformed.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Never echo the payload or the key material in the error.
    throw new EncryptionError('Could not decrypt the stored secret; it may be corrupt or the key changed.');
  }
}

/** Constant-time comparison for opaque tokens such as OAuth state values. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/** Generates a URL-safe, cryptographically random token (OAuth state). */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
