import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser, RequestWithUser } from '../types/request';
import { AppException } from '../errors/app-exception';

/**
 * Injects the authenticated user. Throwing rather than returning `undefined`
 * keeps handlers free of null checks: reaching a handler without a user means
 * the route was misconfigured, not that the request is anonymous.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw AppException.unauthorized('UNAUTHENTICATED');
    return field ? user[field] : user;
  },
);
