import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/errors/app-exception';
import type { RequestWithUser } from '../../common/types/request';
import { TokenService } from './token.service';

/**
 * Applied globally in `AppModule`, so every route requires a valid access
 * token unless it is explicitly marked `@Public()`. Defaulting to "protected"
 * means forgetting a decorator produces a locked endpoint, not an open one.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw AppException.unauthorized('UNAUTHENTICATED');

    const payload = await this.tokens.verifyAccessToken(token);
    request.user = { id: payload.sub, email: payload.email, role: payload.role };
    return true;
  }
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
