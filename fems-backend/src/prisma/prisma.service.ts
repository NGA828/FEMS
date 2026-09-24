import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { appConfig } from '../config/configuration';

/**
 * Prisma client wired through the MariaDB driver adapter (Prisma 7 runtime).
 *
 * The adapter keeps the runtime 100% JavaScript/WASM — no native query engine
 * binary is required — while still speaking the MySQL protocol to MySQL 5.7+,
 * MySQL 8.x and MariaDB. Connection pooling, TLS and `?connection_limit` are
 * handled by the underlying driver.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const config = appConfig();
    if (!config.databaseUrl) {
      throw new Error(
        'DATABASE_URL is not configured. Copy fems-backend/.env.example to fems-backend/.env and set DATABASE_URL.',
      );
    }
    const url = new URL(config.databaseUrl);
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      connectionLimit: 10,
      acquireTimeout: 30_000,
      allowPublicKeyRetrieval: true,
    });
    super({ adapter, log: config.isProduction ? ['error', 'warn'] : ['error', 'warn'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to MySQL through the Prisma MariaDB adapter');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Run a callback inside a transaction (used by multi-step domain operations). */
  async runInTransaction<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.$transaction((tx) => callback(tx as unknown as PrismaClient));
  }
}
