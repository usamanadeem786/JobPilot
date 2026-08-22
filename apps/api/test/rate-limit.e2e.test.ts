import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, isDatabaseReachable, uniqueEmail, type Harness } from './app-harness';

const dbUp = await isDatabaseReachable();
const describeIfDb = dbUp ? describe : describe.skip;

/**
 * The only suite that runs with the real ThrottlerGuard in place. Everything
 * else disables it, so this is what proves the credential endpoints are
 * actually rate limited in the shipped configuration.
 */
describeIfDb('credential endpoint rate limiting (e2e)', () => {
  let harness: Harness;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    harness = await createHarness({ throttling: true });
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await harness.prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
      await harness.close();
    }
  });

  it('returns 429 with a RATE_LIMITED code once the login limit is exceeded', async () => {
    const http = () => request(harness.app.getHttpServer());
    const email = uniqueEmail('throttle');
    createdEmails.push(email);

    const statuses: number[] = [];
    // The configured limit is 5 per minute; the 6th attempt must be rejected.
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await http()
        .post('/api/auth/login')
        .send({ email, password: 'Wr0ngPassword!23' });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const last = await http().post('/api/auth/login').send({ email, password: 'Wr0ngPassword!23' });
    expect(last.body.code).toBe('RATE_LIMITED');
  });

  it('does not throttle unauthenticated health checks at the same rate', async () => {
    const http = () => request(harness.app.getHttpServer());

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await http().get('/api/health');
      expect(response.status).toBe(200);
    }
  });
});
