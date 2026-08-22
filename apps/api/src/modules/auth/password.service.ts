import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm, Options } from '@node-rs/argon2';

/**
 * Argon2id, using the OWASP Password Storage Cheat Sheet's second recommended
 * configuration (19 MiB, t=2, p=1): strong against GPU cracking while staying
 * fast enough for an interactive login. `memoryCost` is in KiB.
 *
 * The algorithm is written as its numeric value rather than the library's
 * `Algorithm` const enum, because a const enum imported across a module
 * boundary does not survive SWC's transpile-only build used by the tests.
 */
const ARGON2ID = 2 as Algorithm;

const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

interface Argon2Params {
  readonly variant: string;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * Reads the parameters back out of a PHC-format hash:
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<digest>`
 */
export function parseArgon2Params(encoded: string): Argon2Params | null {
  const match = /^\$(argon2(?:i|d|id))\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(encoded);
  if (!match) return null;

  const [, variant, memory, time, parallel] = match;
  return {
    variant: variant as string,
    memoryCost: Number(memory),
    timeCost: Number(time),
    parallelism: Number(parallel),
  };
}

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * A real hash of a random secret, computed once at boot. Verifying against
   * it costs the same as a genuine verification, so a login for an unknown
   * email takes as long as one for a real account and response timing does
   * not disclose which addresses are registered.
   */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
  }

  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, ARGON2_OPTIONS);
    } catch (error) {
      // A malformed hash in the database must read as "wrong password", never
      // as a 500 that tells an attacker something about the account.
      this.logger.warn({ err: error }, 'Password verification failed on a malformed hash');
      return false;
    }
  }

  /** Burns the same CPU as a real verification. Always resolves to false. */
  async verifyDummy(plaintext: string): Promise<false> {
    if (!this.dummyHash) {
      this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
    }
    await this.verify(this.dummyHash, plaintext);
    return false;
  }

  /**
   * True when the stored hash was produced with a weaker configuration than
   * the current one, so the caller can transparently upgrade it during a
   * successful login. An unparseable hash counts as needing a rehash.
   */
  needsRehash(storedHash: string): boolean {
    const params = parseArgon2Params(storedHash);
    if (!params) return true;

    return (
      params.variant !== 'argon2id' ||
      params.memoryCost < (ARGON2_OPTIONS.memoryCost ?? 0) ||
      params.timeCost < (ARGON2_OPTIONS.timeCost ?? 0) ||
      params.parallelism !== (ARGON2_OPTIONS.parallelism ?? 1)
    );
  }
}
