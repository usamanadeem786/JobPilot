import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../../config/config.module';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Prefix so the storage format can change without ambiguity later. */
const VERSION = 'v1';

/**
 * Symmetric encryption for the handful of columns that hold personal data we
 * must store but never need to query on (phone numbers today, more later).
 *
 * The key comes from `ENCRYPTION_KEY` and is validated to be exactly 32 bytes
 * at boot, so a short or missing key stops the process instead of silently
 * weakening the cipher.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [version, encoded] = payload.split(':', 2);
    if (version !== VERSION || !encoded) {
      throw new Error('Unrecognised ciphertext format.');
    }

    const raw = Buffer.from(encoded, 'base64');
    // Equal length is legitimate: encrypting an empty string yields an IV and
    // a tag with zero ciphertext bytes between them.
    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new Error('Ciphertext is truncated.');
    }

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Returns null instead of throwing, for optional columns. */
  tryDecrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    try {
      return this.decrypt(payload);
    } catch {
      return null;
    }
  }
}

/**
 * Hash used for opaque tokens (refresh tokens). SHA-256 is correct here and
 * not a password-hashing shortcut: the input is 256 bits of entropy we
 * generated, so it is not brute-forceable and needs constant-time comparison
 * rather than a slow KDF.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
