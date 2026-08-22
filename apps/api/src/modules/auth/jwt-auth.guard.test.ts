import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/errors/app-exception';
import type { RequestWithUser } from '../../common/types/request';
import { extractBearerToken, JwtAuthGuard } from './jwt-auth.guard';
import type { TokenService } from './token.service';

function makeContext(request: Partial<RequestWithUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request as RequestWithUser }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function makeGuard(options: {
  isPublic?: boolean;
  verify?: TokenService['verifyAccessToken'];
}): JwtAuthGuard {
  const reflector = { getAllAndOverride: () => options.isPublic } as unknown as Reflector;
  const tokens = {
    verifyAccessToken:
      options.verify ??
      vi.fn(async () => ({
        sub: 'user-1',
        email: 'ada@example.com',
        role: 'USER' as const,
        iat: 0,
        exp: 0,
      })),
  } as unknown as TokenService;
  return new JwtAuthGuard(reflector, tokens);
}

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['BEARER abc', 'abc'],
  ])('accepts %s', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });

  it.each([undefined, '', 'abc.def.ghi', 'Basic abc', 'Bearer', 'Bearer  '])(
    'rejects %s',
    (header) => {
      expect(extractBearerToken(header)).toBeNull();
    },
  );
});

describe('JwtAuthGuard', () => {
  it('lets a @Public() route through without a token', async () => {
    const guard = makeGuard({ isPublic: true });
    await expect(guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects a protected route with no Authorization header', async () => {
    const guard = makeGuard({});
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('attaches the identity from a valid token', async () => {
    const guard = makeGuard({});
    const request: Partial<RequestWithUser> = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'ada@example.com', role: 'USER' });
  });

  it('propagates the token error when verification fails', async () => {
    const verify = vi.fn(async () => {
      throw AppException.unauthorized('TOKEN_EXPIRED');
    }) as unknown as TokenService['verifyAccessToken'];
    const guard = makeGuard({ verify });

    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer expired' } })),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});
