import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

/**
 * Feeds every HTTP request into the metrics service.
 *
 * The route *pattern* is recorded (`GET /permits/:id`), never the concrete URL:
 * identifiers would both explode the cardinality and leak into a screen that
 * administrators share.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { route?: { path?: string } }>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();
    this.metrics.requestStarted();

    const route = () => request.route?.path ?? this.normalise(request.originalUrl ?? request.url ?? 'unknown');

    return next.handle().pipe(
      tap({
        next: () => this.metrics.record(request.method, route(), response.statusCode ?? 200, Date.now() - startedAt),
        error: (error: { status?: number; getStatus?: () => number }) => {
          const status = typeof error?.getStatus === 'function' ? error.getStatus() : (error?.status ?? 500);
          this.metrics.record(request.method, route(), status, Date.now() - startedAt);
        },
      }),
    );
  }

  /** Collapses identifiers in a raw URL so the aggregate stays readable. */
  private normalise(url: string): string {
    return url
      .split('?')[0]
      .split('/')
      .map((segment) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) || /^\d+$/.test(segment) ? ':id' : segment,
      )
      .join('/');
  }
}
