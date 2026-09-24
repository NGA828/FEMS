import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { appConfig } from '../../config/configuration';

/** Lightweight request logging with duration — no request bodies (PII/secret safety). */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const startedAt = Date.now();
    const { method, originalUrl } = request;

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - startedAt;
          if (appConfig().isProduction && ms < 250 && method === 'GET') return;
          this.logger.log(
            `${method} ${originalUrl} ${ms}ms${request.user ? ` user=${request.user.id.slice(0, 8)}` : ''}`,
          );
        },
        error: (error: Error) => {
          this.logger.warn(
            `${method} ${originalUrl} failed after ${Date.now() - startedAt}ms: ${error.message}`,
          );
        },
      }),
    );
  }
}
