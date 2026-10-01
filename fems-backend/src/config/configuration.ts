import { existsSync } from 'node:fs';
import path from 'node:path';

/** Minimal .env loader — keeps the API runnable without extra dependencies. */
function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

/**
 * Which AI provider answers. `AI_PROVIDER` wins when it names one; otherwise the
 * provider is inferred from the key that is actually present, preferring Groq
 * (free tier) over OpenRouter. No key at all means the deterministic rule engine.
 */
const aiProvider = (): 'groq' | 'openrouter' | 'none' => {
  const explicit = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (explicit === 'groq' || explicit === 'openrouter' || explicit === 'none') return explicit;
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return 'groq';
};

const list = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  databaseUrl: string;
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
    passwordResetTtlMinutes: number;
    maxLoginAttempts: number;
    loginLockMinutes: number;
  };
  security: {
    bcryptRounds: number;
    throttleTtlSeconds: number;
    throttleLimit: number;
    /** Limit for the authentication routes (`POST /auth/login` and friends). */
    authThrottleLimit: number;
    /** Stricter limit for the routes that send something to a user. */
    authStrictThrottleLimit: number;
  };
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    publicUrl: string;
    maxUploadSizeMb: number;
    s3: {
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint: string;
    };
  };
  payments: {
    provider: 'campay' | 'simulator';
    campay: {
      baseUrl: string;
      apiKey: string;
      username: string;
      password: string;
      webhookSecret: string;
      currency: string;
    };
  };
  ai: {
    /** Which provider answers: Groq (default, free tier), OpenRouter, or none. */
    provider: 'groq' | 'openrouter' | 'none';
    groqApiKey: string;
    groqModel: string;
    groqBaseUrl: string;
    openRouterApiKey: string;
    openRouterModel: string;
    openRouterBaseUrl: string;
    requestTimeoutMs: number;
    maxOutputTokens: number;
    reviewSlaHours: number;
    riskScheduleEnabled: boolean;
  };
  notifications: {
    pushProvider: string;
    expoPushUrl: string;
    emailProvider: string;
    smtp: { host: string; port: number; user: string; password: string; from: string };
    permitExpiryWarnDays: number;
  };
  gis: {
    tileUrl: string;
    defaultCenterLat: number;
    defaultCenterLng: number;
    defaultZoom: number;
    nearbyRadiusKm: number;
  };
}

let cached: AppConfig | null = null;

/**
 * Drops the memoised configuration so a later `appConfig()` re-reads
 * `process.env`. Used by the tests that exercise provider selection; the
 * running API never calls it (configuration is read once at boot).
 */
export function resetConfigCache(): void {
  cached = null;
}

export function appConfig(): AppConfig {
  if (cached) return cached;
  const env = process.env.NODE_ENV ?? 'development';
  cached = {
    env,
    isProduction: env === 'production',
    port: num(process.env.PORT, 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: list(process.env.CORS_ORIGINS),
    databaseUrl: process.env.DATABASE_URL ?? '',
    jwt: {
      secret: process.env.JWT_SECRET ?? 'fems-development-access-secret-change-me',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'fems-development-refresh-secret-change-me',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
      passwordResetTtlMinutes: num(process.env.PASSWORD_RESET_TTL_MINUTES, 30),
      maxLoginAttempts: num(process.env.MAX_LOGIN_ATTEMPTS, 5),
      loginLockMinutes: num(process.env.LOGIN_LOCK_MINUTES, 15),
    },
    security: {
      bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),
      throttleTtlSeconds: num(process.env.THROTTLE_TTL_SECONDS, 60),
      throttleLimit: num(process.env.THROTTLE_LIMIT, 120),
      // Auth routes are rate limited harder than the rest of the API because
      // they are the brute-force surface. The limits stay configurable so a
      // test run can raise them instead of disabling the guard.
      authThrottleLimit: num(process.env.THROTTLE_AUTH_LIMIT, 10),
      authStrictThrottleLimit: num(process.env.THROTTLE_AUTH_STRICT_LIMIT, 5),
    },
    storage: {
      driver: (process.env.STORAGE_DRIVER as 'local' | 's3') ?? 'local',
      localDir: process.env.STORAGE_LOCAL_DIR ?? './uploads',
      publicUrl: process.env.STORAGE_PUBLIC_URL ?? '',
      maxUploadSizeMb: num(process.env.MAX_UPLOAD_SIZE_MB, 15),
      s3: {
        bucket: process.env.S3_BUCKET ?? '',
        region: process.env.S3_REGION ?? '',
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        endpoint: process.env.S3_ENDPOINT ?? '',
      },
    },
    payments: {
      provider: (process.env.PAYMENT_PROVIDER as 'campay' | 'simulator') ?? 'simulator',
      campay: {
        baseUrl: process.env.CAMPAY_BASE_URL ?? 'https://demo.campay.net/api',
        apiKey: process.env.CAMPAY_API_KEY ?? '',
        username: process.env.CAMPAY_USERNAME ?? '',
        password: process.env.CAMPAY_PASSWORD ?? '',
        webhookSecret: process.env.CAMPAY_WEBHOOK_SECRET ?? '',
        currency: process.env.CAMPAY_CURRENCY ?? 'XAF',
      },
    },
    ai: {
      provider: aiProvider(),
      groqApiKey: process.env.GROQ_API_KEY ?? '',
      // Free on GroqCloud: 30 requests/minute, 1 000 requests and 100 000
      // tokens per day. `llama-3.1-8b-instant` is the higher-volume free
      // alternative, `openai/gpt-oss-120b` the stronger one.
      groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      groqBaseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
      openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
      openRouterModel: process.env.OPENROUTER_MODEL ?? 'openrouter/auto',
      openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      requestTimeoutMs: num(process.env.AI_REQUEST_TIMEOUT_MS, 30_000),
      maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 2048),
      reviewSlaHours: num(process.env.AI_ALERT_REVIEW_SLA_HOURS, 72),
      riskScheduleEnabled: bool(process.env.AI_RISK_SCHEDULE_ENABLED, true),
    },
    notifications: {
      pushProvider: process.env.PUSH_PROVIDER ?? 'none',
      expoPushUrl: process.env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send',
      // An operator who filled in SMTP_HOST clearly wants email: default the
      // provider to `smtp` in that case instead of silently staying `none`,
      // which used to make the server report "configured" and "missing
      // EMAIL_PROVIDER" at the same time.
      emailProvider: process.env.EMAIL_PROVIDER || (process.env.SMTP_HOST ? 'smtp' : 'none'),
      smtp: {
        host: process.env.SMTP_HOST ?? '',
        port: num(process.env.SMTP_PORT, 587),
        user: process.env.SMTP_USER ?? '',
        password: process.env.SMTP_PASSWORD ?? '',
        from: process.env.SMTP_FROM ?? 'FEMS <no-reply@fems.cm>',
      },
      permitExpiryWarnDays: num(process.env.PERMIT_EXPIRY_WARN_DAYS, 30),
    },
    gis: {
      tileUrl: process.env.MAPS_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      defaultCenterLat: Number(process.env.GIS_DEFAULT_CENTER_LAT ?? 3.848),
      defaultCenterLng: Number(process.env.GIS_DEFAULT_CENTER_LNG ?? 11.5021),
      defaultZoom: Number(process.env.GIS_DEFAULT_ZOOM ?? 7),
      nearbyRadiusKm: num(process.env.GIS_NEARBY_RADIUS_KM, 50),
    },
  };
  return cached;
}

/** The AI provider in force, as reported to clients (never the key itself). */
export function aiIntegrationStatus() {
  const { ai } = appConfig();
  const key = ai.provider === 'groq' ? ai.groqApiKey : ai.provider === 'openrouter' ? ai.openRouterApiKey : '';
  const configured = Boolean(key);
  return {
    selected: ai.provider,
    provider: (configured ? (ai.provider === 'groq' ? 'GROQ' : 'OPENROUTER') : 'LOCAL_RULE_ENGINE') as 'GROQ' | 'OPENROUTER' | 'LOCAL_RULE_ENGINE',
    configured,
    model: configured ? (ai.provider === 'groq' ? ai.groqModel : ai.openRouterModel) : 'deterministic-rule-engine',
    missing: configured ? [] : ai.provider === 'openrouter' ? ['OPENROUTER_API_KEY'] : ai.provider === 'none' ? [] : ['GROQ_API_KEY'],
    /** Older clients read this name. */
    providerConfigured: configured,
  };
}

/** Integration status surfaced to clients (never leaks secret values). */
export function integrationStatus() {
  const config = appConfig();
  return {
    payments: {
      provider: config.payments.provider,
      campayConfigured: Boolean(
        config.payments.campay.apiKey && config.payments.campay.username && config.payments.campay.password,
      ),
    },
    ai: aiIntegrationStatus(),
    notifications: {
      pushProvider: config.notifications.pushProvider,
      emailProvider: config.notifications.emailProvider,
    },
    storage: { driver: config.storage.driver },
    gis: { tileUrlConfigured: Boolean(config.gis.tileUrl) },
  };
}
