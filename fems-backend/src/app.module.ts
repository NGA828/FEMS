import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { RbacModule } from './rbac/rbac.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { ForestsModule } from './forests/forests.module';
import { PermitsModule } from './permits/permits.module';
import { PaymentsModule } from './payments/payments.module';
import { InspectionsModule } from './inspections/inspections.module';
import { EnvironmentalModule } from './environmental/environmental.module';
import { ReportsModule } from './reports/reports.module';
import { AiModule } from './ai/ai.module';
import { HealthModule } from './health/health.module';
import { ExploitationModule } from './exploitation/exploitation.module';
import { GisModule } from './gis/gis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard, RolesGuard } from './common/guards/roles-permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

/**
 * FEMS application module — a modular monolith.
 *
 * Guards are registered application-wide (never per-controller) so that every
 * new route is authenticated and permission-checked by default: forgetting a
 * decorator fails closed (403), never open.
 *
 * Guard order matters: rate limiting → authentication → role gate → permission gate.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: appConfig().security.throttleTtlSeconds * 1000,
        limit: appConfig().security.throttleLimit,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    MailModule,
    RbacModule,
    NotificationsModule,
    StorageModule,
    GisModule,
    AuditModule,
    UsersModule,
    CompaniesModule,
    ForestsModule,
    PermitsModule,
    PaymentsModule,
    InspectionsModule,
    EnvironmentalModule,
    ReportsModule,
    HealthModule,
    AiModule,
    ExploitationModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
