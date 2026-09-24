import 'reflect-metadata';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = appConfig();

  const app = await NestFactory.create(AppModule, {
    logger: config.env === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug'],
  });

  // `apiPrefix` is `api/v1`: the path segment is the global prefix and the
  // trailing `v1` is the URI version, so routes resolve to /api/v1/<resource>.
  const [basePath, version] = config.apiPrefix.split('/');
  app.setGlobalPrefix(basePath);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: (version ?? 'v1').replace(/^v/, ''),
  });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  // `CORS_ORIGINS` lists the allowed web origins; `*` (or an empty list) reflects
  // whatever origin asks, which is what the Expo web preview and local tooling
  // need. Sessions are Bearer-token based, so no cookies are shared.
  const reflectsAnyOrigin = config.corsOrigins.length === 0 || config.corsOrigins.includes('*');
  app.enableCors({
    origin: reflectsAnyOrigin ? true : config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client-Ref'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    }),
  );
  // The exception filter and the response/logging interceptors are provided
  // through APP_FILTER / APP_INTERCEPTOR in AppModule so they can use DI —
  // registering them here as well would double-wrap every response.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FEMS API — Forest Exploitation Management System')
    .setDescription(
      [
        'REST API for managing, monitoring, regulating and analysing forest exploitation activities.',
        '',
        '**Authentication**: `POST /api/v1/auth/login` returns an access token (15 min) and a refresh token (30 days).',
        'Send the access token as `Authorization: Bearer <token>` on every protected endpoint.',
        '',
        '**Authorization**: every endpoint is protected by JWT + role + permission guards. Permission codes are',
        'documented per operation (e.g. `permits:approve`). The backend is the source of truth — the mobile app',
        'hides actions it cannot perform, but the API enforces them independently.',
        '',
        '**GIS**: coordinates are validated (latitude -90..90, longitude -180..180) and stored as DECIMAL(10,7).',
        '',
        '**AI**: analyses never decide for a human officer; they produce reasoned, reviewable alerts.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('auth', 'Registration, login, tokens, password reset')
    .addTag('users', 'User management and administration')
    .addTag('roles', 'Roles and permissions')
    .addTag('companies', 'Companies and company documents')
    .addTag('forests', 'Forest resources')
    .addTag('zones', 'Forest zones')
    .addTag('protected-areas', 'Protected areas')
    .addTag('tree-species', 'Tree species catalogue')
    .addTag('inventory', 'Tree inventories')
    .addTag('permits', 'Exploitation permits and their state machine')
    .addTag('exploitation', 'Exploitation activities')
    .addTag('equipment', 'Equipment registry')
    .addTag('payments', 'Fees, royalties and Campay integration')
    .addTag('inspections', 'Field inspections and evidence')
    .addTag('environmental', 'Observations and environmental violations')
    .addTag('reports', 'Reporting and exports')
    .addTag('notifications', 'Notification centre')
    .addTag('gis', 'Map data and proximity search')
    .addTag('ai', 'AI Forest Intelligence and AI Forest Assistant')
    .addTag('audit', 'Audit trail and system monitoring')
    .addTag('settings', 'System configuration')
    .addTag('health', 'Service health')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    customSiteTitle: 'FEMS API Documentation',
  });

  await app.listen(config.port, '0.0.0.0');
  logger.log(`FEMS API listening on http://0.0.0.0:${config.port}/${config.apiPrefix}`);
  logger.log(`Swagger UI at http://0.0.0.0:${config.port}/${config.apiPrefix}/docs`);
  logger.log(`Environment: ${config.env}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', error);
  process.exit(1);
});
