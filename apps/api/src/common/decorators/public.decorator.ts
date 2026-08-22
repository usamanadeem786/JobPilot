import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'jobpilot:isPublic';

/**
 * Opts a route out of the globally applied JwtAuthGuard. Authentication is
 * on by default so a new endpoint cannot accidentally ship unprotected.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
