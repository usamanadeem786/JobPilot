import { SetMetadata } from '@nestjs/common';
import type { Role } from '@jobpilot/shared';

export const ROLES_KEY = 'jobpilot:roles';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
