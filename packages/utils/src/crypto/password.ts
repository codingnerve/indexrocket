import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

// promisify loses the options overload, so the signature is restated here.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt is a memory-hard KDF built into Node, listed by OWASP as an acceptable
 * password-hashing choice alongside argon2 and bcrypt. It is used here so the
 * project gains no native build dependency; the cost parameters below are the
 * OWASP-recommended minimum (N=2^17, r=8, p=1, ~128 MiB per hash).
 *
 * Stored format: `scrypt$N$r$p$<salt base64url>$<hash base64url>`. The parameters
 * travel with the hash so they can be raised later without invalidating
 * existing passwords.
 */
const ALGORITHM = 'scrypt';
const COST_N = 131_072;
const BLOCK_SIZE_R = 8;
const PARALLELISM_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** scrypt needs maxmem above the default 32 MiB for these parameters. */
const MAX_MEM = 256 * 1024 * 1024;

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordError';
  }
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export interface PasswordPolicyResult {
  valid: boolean;
  reason: string;
}

/**
 * Length is the dominant factor in password strength, so the policy is a
 * generous minimum length rather than composition rules that push people toward
 * predictable substitutions.
 */
export function checkPasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return { valid: false, reason: 'Password must be a string.' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }

  if (password.trim() === '') {
    return { valid: false, reason: 'Password must not be only whitespace.' };
  }

  return { valid: true, reason: 'Password accepted.' };
}

export async function hashPassword(password: string): Promise<string> {
  const policy = checkPasswordPolicy(password);

  if (!policy.valid) {
    throw new PasswordError(policy.reason);
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_BYTES, {
    N: COST_N,
    r: BLOCK_SIZE_R,
    p: PARALLELISM_P,
    maxmem: MAX_MEM,
  });

  return [
    ALGORITHM,
    COST_N,
    BLOCK_SIZE_R,
    PARALLELISM_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false for malformed or legacy hashes rather than throwing, so a record
 * written before this scheme existed simply fails to authenticate instead of
 * crashing the login route.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string') {
    return false;
  }

  const parts = stored.split('$');

  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return false;
  }

  const [, rawN, rawR, rawP, saltPart, hashPart] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltPart, 'base64url'), expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });

    if (derived.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when the stored value uses this scheme at the current parameters. */
export function isCurrentPasswordHash(stored: string): boolean {
  return stored.startsWith(`${ALGORITHM}$${COST_N}$${BLOCK_SIZE_R}$${PARALLELISM_P}$`);
}
