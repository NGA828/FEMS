import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { appConfig } from '../config/configuration';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness/readiness probe.
 *
 * Public on purpose: a monitoring system, a load balancer or the mobile app's
 * connectivity check must be able to tell whether the API and its database are
 * reachable without holding a session. It exposes no business data.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Service health',
    description: 'Reports whether the API is up and whether the database answers a trivial query.',
  })
  async check() {
    const startedAt = Date.now();
    let database: 'up' | 'down' = 'down';
    let databaseError: string | undefined;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch (error) {
      databaseError = error instanceof Error ? error.message.split('\n')[0] : 'database unavailable';
    }

    const config = appConfig();
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'fems-api',
      version: process.env.APP_VERSION ?? '1.0.0',
      environment: config.env,
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        database,
        databaseLatencyMs: Date.now() - startedAt,
        ...(databaseError ? { databaseError } : {}),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
