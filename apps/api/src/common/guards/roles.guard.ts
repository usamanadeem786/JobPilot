import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@jobpilot/shared';
import { AppException } from '../errors/app-exception';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestWithUser } from '../types/request';

/** Role-based authorization. Routes without @Roles() are open to any user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw AppException.unauthorized('UNAUTHENTICATED');
    if (!required.includes(user.role)) throw AppException.forbidden('FORBIDDEN');
    return true;
  }
}
