import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './index';

/**
 * Public endpoints can still personalise the answer when the caller happens to
 * be signed in (a government officer sees non-public forests in the same
 * endpoint a visitor uses to browse public ones).
 *
 * The global JwtAuthGuard still runs for `@Public()` routes only when a token
 * is present — see JwtAuthGuard.optionalAuth handling below.
 */
export const OptionalAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user;
  },
);
