import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { firstValueFrom, isObservable, type Observable } from 'rxjs';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../decorators';

type GuardResult = boolean | Promise<boolean> | Observable<boolean>;

/**
 * Global authentication guard (passport "jwt" strategy).
 *
 * - Protected routes require a valid, non-expired access token.
 * - `@Public()` routes are reachable anonymously, but if the caller *does*
 *   send a token the principal is still loaded (soft authentication) so public
 *   endpoints can personalise the response — e.g. officers see non-public
 *   forests in the same endpoint a visitor uses to browse public ones.
 * - Role, permission and account status are re-read from the database on every
 *   request, so revoking access takes effect immediately.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      const request = context.switchToHttp().getRequest<Request>();
      const hasToken = Boolean(request.headers.authorization || request.query?.access_token);
      if (!hasToken) return true;
      try {
        return await this.resolve(super.canActivate(context) as GuardResult);
      } catch {
        // An invalid token on a public route is ignored: the visitor stays anonymous.
        return true;
      }
    }

    return this.resolve(super.canActivate(context) as GuardResult);
  }

  private async resolve(result: GuardResult): Promise<boolean> {
    if (isObservable(result)) return firstValueFrom(result);
    return Boolean(await result);
  }

  handleRequest<TUser = AuthenticatedUser>(
    error: Error | null,
    user: TUser | false,
    info: { name?: string; message?: string } | undefined,
  ): TUser {
    if (error) throw error;
    if (!user) {
      const expired = info?.name === 'TokenExpiredError';
      throw new UnauthorizedException({
        code: expired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
        message: expired
          ? 'Access token expired. Refresh it using POST /auth/refresh.'
          : 'A valid access token is required for this resource.',
      });
    }
    return user;
  }
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
