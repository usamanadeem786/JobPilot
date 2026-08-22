import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, isDatabaseReachable, uniqueEmail, type Harness } from './app-harness';
import { REFRESH_COOKIE_NAME } from '../src/modules/auth/refresh-cookie';

const dbUp = await isDatabaseReachable();
const describeIfDb = dbUp ? describe : describe.skip;

if (!dbUp) {
  console.warn(
    '[auth.e2e] Skipping: no database at DATABASE_URL. Run `pnpm infra:up && pnpm db:deploy` first.',
  );
}

const PASSWORD = 'Str0ngPassword!23';

function cookieValue(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=')[1];
}

describeIfDb('auth flow (e2e)', () => {
  let harness: Harness;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await harness.prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
      await harness.close();
    }
  });

  function http() {
    return request(harness.app.getHttpServer());
  }

  async function register(email: string) {
    createdEmails.push(email);
    return http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Ada Lovelace' });
  }

  describe('POST /api/auth/register', () => {
    it('creates an account and returns a session without the refresh token', async () => {
      const email = uniqueEmail('register');
      const response = await register(email);

      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({
        email,
        role: 'USER',
        status: 'ACTIVE',
        fullName: 'Ada Lovelace',
      });
      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
      expect(response.body.tokens.tokenType).toBe('Bearer');

      // The refresh token belongs in the cookie only.
      expect(response.body.tokens.refreshToken).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('sets an httpOnly, same-site refresh cookie scoped to the auth path', async () => {
      const response = await register(uniqueEmail('cookie'));
      const raw = response.headers['set-cookie'] as unknown;
      const cookies = Array.isArray(raw) ? raw : [String(raw)];
      const refresh = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));

      expect(refresh).toBeDefined();
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('SameSite=Lax');
      expect(refresh).toContain('Path=/api/auth');
    });

    it('stores an argon2 hash rather than the password', async () => {
      const email = uniqueEmail('hash');
      await register(email);

      const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
    });

    it('rejects a duplicate email with a 409 and a specific code', async () => {
      const email = uniqueEmail('dupe');
      await register(email);
      const second = await register(email);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('treats email as case-insensitive', async () => {
      const email = uniqueEmail('case');
      await register(email);

      const second = await http()
        .post('/api/auth/register')
        .send({ email: email.toUpperCase(), password: PASSWORD, fullName: 'Ada' });

      expect(second.status).toBe(409);
    });

    it('rejects a weak password with field-level errors', async () => {
      const response = await http()
        .post('/api/auth/register')
        .send({ email: uniqueEmail('weak'), password: 'short', fullName: 'Ada' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.fieldErrors.map((issue: { path: string }) => issue.path)).toContain(
        'password',
      );
    });

    it('includes a request id on error responses for correlation', async () => {
      const response = await http().post('/api/auth/register').send({});
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns a session for correct credentials', async () => {
      const email = uniqueEmail('login');
      await register(email);

      const response = await http().post('/api/auth/login').send({ email, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe(email);
      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
    });

    it('records lastLoginAt', async () => {
      const email = uniqueEmail('lastlogin');
      await register(email);
      await http().post('/api/auth/login').send({ email, password: PASSWORD });

      const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.lastLoginAt).not.toBeNull();
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const email = uniqueEmail('wrongpw');
      await register(email);

      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email, password: 'Wr0ngPassword!23' });
      const unknownAccount = await http()
        .post('/api/auth/login')
        .send({ email: uniqueEmail('ghost'), password: PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(unknownAccount.status).toBe(401);
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknownAccount.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
    });

    it('writes an audit entry for a failed login', async () => {
      const email = uniqueEmail('audit');
      const registered = await register(email);
      const userId = registered.body.user.id as string;

      await http().post('/api/auth/login').send({ email, password: 'Wr0ngPassword!23' });

      const entries = await harness.prisma.auditLog.findMany({
        where: { userId, action: 'user.login_failed' },
      });
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe('protected routes', () => {
    it('rejects GET /api/users/me without a token', async () => {
      const response = await http().get('/api/users/me');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a malformed token', async () => {
      const response = await http()
        .get('/api/users/me')
        .set('Authorization', 'Bearer not-a-real-token');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    it('returns the current user with a valid token', async () => {
      const email = uniqueEmail('me');
      const registered = await register(email);
      const token = registered.body.tokens.accessToken as string;

      const response = await http().get('/api/users/me').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe(email);
    });

    it('updates the profile and round-trips the encrypted phone number', async () => {
      const email = uniqueEmail('profile');
      const registered = await register(email);
      const token = registered.body.tokens.accessToken as string;
      const userId = registered.body.user.id as string;

      const response = await http()
        .patch('/api/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ headline: 'Backend Engineer', phone: '+44 7700 900123', skills: ['Python'] });

      expect(response.status).toBe(200);
      expect(response.body.headline).toBe('Backend Engineer');
      expect(response.body.phone).toBe('+44 7700 900123');

      // The column itself must hold ciphertext, not the number.
      const stored = await harness.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
      expect(stored.phone).toMatch(/^v1:/);
      expect(stored.phone).not.toContain('900123');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates the token pair when given a valid cookie', async () => {
      const email = uniqueEmail('refresh');
      const registered = await register(email);
      const refreshCookie = cookieValue(registered.headers, REFRESH_COOKIE_NAME);
      expect(refreshCookie).toBeDefined();

      const response = await http()
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookie}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe(email);
      expect(cookieValue(response.headers, REFRESH_COOKIE_NAME)).not.toBe(refreshCookie);
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      const email = uniqueEmail('replay');
      const registered = await register(email);
      const userId = registered.body.user.id as string;
      const original = cookieValue(registered.headers, REFRESH_COOKIE_NAME) as string;

      const first = await http()
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${original}`)
        .send({});
      expect(first.status).toBe(200);

      const replay = await http()
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${original}`)
        .send({});

      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('TOKEN_REUSE_DETECTED');

      // The successor issued in step one must be dead too.
      const live = await harness.prisma.refreshToken.count({ where: { userId, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('rejects a request with no refresh token at all', async () => {
      const response = await http().post('/api/auth/refresh').send({});
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the presented token and clears the cookie', async () => {
      const email = uniqueEmail('logout');
      const registered = await register(email);
      const userId = registered.body.user.id as string;
      const refreshCookie = cookieValue(registered.headers, REFRESH_COOKIE_NAME) as string;

      const response = await http()
        .post('/api/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookie}`)
        .send();

      expect(response.status).toBe(204);

      const live = await harness.prisma.refreshToken.count({ where: { userId, revokedAt: null } });
      expect(live).toBe(0);
    });
  });

  describe('security headers', () => {
    it('sets the hardening headers helmet is configured for', async () => {
      const response = await http().get('/api/health');

      expect(response.status).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });
});
