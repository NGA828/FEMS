/**
 * End-to-end application harness.
 *
 * Boots the real `AppModule` with the same global prefix, URI versioning and
 * validation pipe as `main.ts`, then hands out a supertest agent.
 *
 * The rate limits stay active (they are part of what is under test) but their
 * ceiling is raised by `test/setup/env.ts`, which is loaded before the app is
 * created: the suites issue bursts that production limits are meant to stop.
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface FlowContext {
  app: INestApplication;
  api: () => request.Agent;
  prisma: PrismaService;
  /** Signs in with an email/password pair and returns the access token. */
  login: (email: string, password: string) => Promise<string>;
  /** Signs in and returns both tokens. */
  session: (email: string, password: string) => Promise<{ accessToken: string; refreshToken: string }>;
  close: () => Promise<void>;
}

/** Password of every seeded demo account. */
export const DEMO_PASSWORD = process.env.FEMS_DEMO_PASSWORD ?? 'FemsDemo#2026';

export const API = '/api/v1';

export async function createFlowContext(): Promise<FlowContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const agent = () => request(app.getHttpServer() as App);

  const session = async (email: string, password: string) => {
    const response = await agent().post(`${API}/auth/login`).send({ email, password });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    const tokens = response.body.data.tokens as { accessToken: string; refreshToken: string };
    return tokens;
  };

  return {
    app,
    api: agent,
    prisma,
    session,
    login: async (email, password) => (await session(email, password)).accessToken,
    close: async () => {
      await app.close();
    },
  };
}

/** `Authorization` header value for a token. */
export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

/** Asserts the standard success envelope and returns its `data`. */
export function unwrap<T>(body: unknown): T {
  const envelope = body as { success?: boolean; data?: T; error?: unknown };
  if (envelope?.success !== true) {
    throw new Error(`Expected a success envelope, received: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return envelope.data as T;
}
