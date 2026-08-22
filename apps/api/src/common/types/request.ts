import type { Request } from 'express';
import type { Role } from '@jobpilot/shared';

/** The identity attached to a request by JwtAuthGuard. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
}

/**
 * `id` is not redeclared here: pino-http already augments Express's `Request`
 * with it, and a narrower local declaration would conflict with that.
 */
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
