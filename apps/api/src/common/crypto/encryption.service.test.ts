import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema';
import { EncryptionService, hashToken, tokensMatch } from './encryption.service';

function makeService(keyByte = 3): EncryptionService {
  const env = {
    ENCRYPTION_KEY: Buffer.alloc(32, keyByte).toString('base64'),
  } as unknown as Env;
  return new EncryptionService(env);
}

describe('EncryptionService', () => {
  it('round-trips a value', () => {
    const service = makeService();
    const plaintext = '+44 7700 900123';
    expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const service = makeService();
    const a = service.encrypt('same input');
    const b = service.encrypt('same input');

    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe(service.decrypt(b));
  });

  it('tags the payload with a format version', () => {
    expect(makeService().encrypt('x').startsWith('v1:')).toBe(true);
  });

  it('refuses a payload encrypted under a different key', () => {
    const ciphertext = makeService(3).encrypt('secret');
    expect(() => makeService(9).decrypt(ciphertext)).toThrow();
  });

  it('refuses a tampered ciphertext (GCM authentication)', () => {
    const service = makeService();
    const encoded = service.encrypt('secret').slice('v1:'.length);
    const raw = Buffer.from(encoded, 'base64');
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff;

    expect(() => service.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('rejects an unknown format version', () => {
    expect(() => makeService().decrypt('v2:abcdef')).toThrow(/Unrecognised ciphertext format/);
  });

  it('tryDecrypt returns null instead of throwing', () => {
    const service = makeService();
    expect(service.tryDecrypt(null)).toBeNull();
    expect(service.tryDecrypt('')).toBeNull();
    expect(service.tryDecrypt('v1:garbage')).toBeNull();
    expect(service.tryDecrypt(service.encrypt('ok'))).toBe('ok');
  });

  it('handles unicode and empty strings', () => {
    const service = makeService();
    expect(service.decrypt(service.encrypt(''))).toBe('');
    expect(service.decrypt(service.encrypt('日本語 — émoji 🚀'))).toBe('日本語 — émoji 🚀');
  });
});

describe('hashToken', () => {
  it('is deterministic and fixed-length', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toHaveLength(64);
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});

describe('tokensMatch', () => {
  it('compares equal-length values', () => {
    expect(tokensMatch('abcdef', 'abcdef')).toBe(true);
    expect(tokensMatch('abcdef', 'abcdeg')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });
});
