import { beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('produces an argon2id hash, not the plaintext', async () => {
    const hash = await service.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse');
  });

  it('salts each hash, so identical passwords hash differently', async () => {
    const [a, b] = await Promise.all([service.hash('Passw0rd!Passw0rd'), service.hash('Passw0rd!Passw0rd')]);
    expect(a).not.toBe(b);
  });

  it('verifies the correct password', async () => {
    const hash = await service.hash('Str0ngPassword!23');
    await expect(service.verify(hash, 'Str0ngPassword!23')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('Str0ngPassword!23');
    await expect(service.verify(hash, 'Str0ngPassword!24')).resolves.toBe(false);
  });

  it('treats a corrupt stored hash as a failed login rather than an error', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('verifyDummy always resolves false', async () => {
    await expect(service.verifyDummy('anything at all')).resolves.toBe(false);
  });

  it('reports no rehash needed for a freshly created hash', async () => {
    const hash = await service.hash('Str0ngPassword!23');
    expect(service.needsRehash(hash)).toBe(false);
  });

  it('reports rehash needed for a hash with weaker parameters', () => {
    // m=4096 is far below the configured 19456 KiB.
    const weak = '$argon2id$v=19$m=4096,t=3,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA';
    expect(service.needsRehash(weak)).toBe(true);
  });
});
