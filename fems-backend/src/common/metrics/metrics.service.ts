import { Injectable, Logger } from '@nestjs/common';

/**
 * In-process runtime metrics.
 *
 * FEMS runs as a single modular monolith, so "how is this deployment behaving
 * right now" can be answered without a metrics backend: every HTTP request is
 * counted here by an interceptor, and every scheduled job reports its outcome.
 *
 * Deliberately bounded and in-memory: 60 one-minute buckets, 200 route
 * aggregates, the 20 slowest recent requests and the last 10 runs of each job.
 * Nothing here is persisted — a restart starts a fresh window, which is stated
 * in the payload through `since`.
 */

export interface RouteStat {
  route: string;
  count: number;
  errors: number;
  averageMs: number;
  maxMs: number;
}

export interface SlowRequest {
  route: string;
  ms: number;
  status: number;
  at: string;
}

export interface JobRun {
  status: 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  message: string | null;
}

export interface JobReport {
  name: string;
  runs: number;
  failures: number;
  lastRun: JobRun | null;
  history: JobRun[];
}

export interface MetricsSnapshot {
  since: string;
  uptimeSeconds: number;
  requests: {
    total: number;
    errors: number;
    clientErrors: number;
    serverErrors: number;
    errorRate: number;
    averageMs: number;
    inFlight: number;
    perMinute: Array<{ minute: string; requests: number; errors: number; averageMs: number }>;
    throughputPerMinute: number;
  };
  routes: RouteStat[];
  slowest: SlowRequest[];
  jobs: JobReport[];
}

interface Bucket {
  minute: number;
  requests: number;
  errors: number;
  totalMs: number;
}

interface RouteAccumulator {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

const MINUTE = 60_000;
const BUCKETS = 60;
const MAX_ROUTES = 200;
const MAX_SLOW = 20;
const JOB_HISTORY = 10;

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly startedAt = new Date();

  private total = 0;
  private clientErrors = 0;
  private serverErrors = 0;
  private totalMs = 0;
  private inFlight = 0;

  private buckets: Bucket[] = [];
  private readonly routes = new Map<string, RouteAccumulator>();
  private slowest: SlowRequest[] = [];
  private readonly jobs = new Map<string, { runs: number; failures: number; history: JobRun[] }>();

  requestStarted(): void {
    this.inFlight += 1;
  }

  /** Called once per finished HTTP request, success or failure. */
  record(method: string, route: string, status: number, ms: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.total += 1;
    this.totalMs += ms;
    if (status >= 500) this.serverErrors += 1;
    else if (status >= 400) this.clientErrors += 1;

    const minute = Math.floor(Date.now() / MINUTE);
    let bucket = this.buckets[this.buckets.length - 1];
    if (!bucket || bucket.minute !== minute) {
      bucket = { minute, requests: 0, errors: 0, totalMs: 0 };
      this.buckets.push(bucket);
      if (this.buckets.length > BUCKETS) this.buckets = this.buckets.slice(-BUCKETS);
    }
    bucket.requests += 1;
    bucket.totalMs += ms;
    if (status >= 400) bucket.errors += 1;

    const key = `${method} ${route}`;
    const accumulator = this.routes.get(key) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    accumulator.count += 1;
    accumulator.totalMs += ms;
    accumulator.maxMs = Math.max(accumulator.maxMs, ms);
    if (status >= 400) accumulator.errors += 1;
    if (!this.routes.has(key) && this.routes.size >= MAX_ROUTES) {
      // Keep the map bounded: drop the least-used entry rather than grow forever.
      const leastUsed = [...this.routes.entries()].sort((a, b) => a[1].count - b[1].count)[0];
      if (leastUsed) this.routes.delete(leastUsed[0]);
    }
    this.routes.set(key, accumulator);

    this.slowest.push({ route: key, ms: Math.round(ms), status, at: new Date().toISOString() });
    this.slowest.sort((a, b) => b.ms - a.ms);
    if (this.slowest.length > MAX_SLOW) this.slowest = this.slowest.slice(0, MAX_SLOW);
  }

  /**
   * Wraps a scheduled job so its outcome is visible to administrators. A
   * failure is recorded and re-thrown — monitoring must never swallow an error.
   */
  async track<T>(name: string, run: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await run();
      this.completeJob(name, startedAt, 'SUCCESS', this.describeResult(result));
      return result;
    } catch (error) {
      this.completeJob(name, startedAt, 'FAILED', error instanceof Error ? error.message : 'Unknown failure');
      this.logger.error(`Scheduled job ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private describeResult(result: unknown): string | null {
    if (result === undefined || result === null) return null;
    if (typeof result === 'object') {
      const entries = Object.entries(result as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
        .map(([key, value]) => `${key}=${String(value)}`);
      return entries.length > 0 ? entries.join(', ') : null;
    }
    return String(result);
  }

  private completeJob(name: string, startedAt: Date, status: 'SUCCESS' | 'FAILED', message: string | null): void {
    const finishedAt = new Date();
    const entry = this.jobs.get(name) ?? { runs: 0, failures: 0, history: [] };
    entry.runs += 1;
    if (status === 'FAILED') entry.failures += 1;
    entry.history.unshift({
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      message,
    });
    if (entry.history.length > JOB_HISTORY) entry.history = entry.history.slice(0, JOB_HISTORY);
    this.jobs.set(name, entry);
  }

  snapshot(): MetricsSnapshot {
    const errors = this.clientErrors + this.serverErrors;
    const recent = this.buckets.slice(-15);
    const windowMinutes = Math.max(1, recent.length);
    const recentRequests = recent.reduce((sum, bucket) => sum + bucket.requests, 0);

    return {
      since: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      requests: {
        total: this.total,
        errors,
        clientErrors: this.clientErrors,
        serverErrors: this.serverErrors,
        errorRate: this.total === 0 ? 0 : Number(((errors / this.total) * 100).toFixed(2)),
        averageMs: this.total === 0 ? 0 : Math.round(this.totalMs / this.total),
        inFlight: this.inFlight,
        perMinute: recent.map((bucket) => ({
          minute: new Date(bucket.minute * MINUTE).toISOString().slice(0, 16),
          requests: bucket.requests,
          errors: bucket.errors,
          averageMs: bucket.requests === 0 ? 0 : Math.round(bucket.totalMs / bucket.requests),
        })),
        throughputPerMinute: Number((recentRequests / windowMinutes).toFixed(2)),
      },
      routes: [...this.routes.entries()]
        .map(([route, stat]) => ({
          route,
          count: stat.count,
          errors: stat.errors,
          averageMs: Math.round(stat.totalMs / stat.count),
          maxMs: Math.round(stat.maxMs),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
      slowest: this.slowest.slice(0, 10),
      jobs: [...this.jobs.entries()].map(([name, entry]) => ({
        name,
        runs: entry.runs,
        failures: entry.failures,
        lastRun: entry.history[0] ?? null,
        history: entry.history,
      })),
    };
  }

  /** Declares a job so it is listed as "never run yet" instead of being invisible. */
  declareJob(name: string): void {
    if (!this.jobs.has(name)) this.jobs.set(name, { runs: 0, failures: 0, history: [] });
  }
}
