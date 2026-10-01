import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('counts requests and separates client from server failures', () => {
    metrics.record('GET', '/permits', 200, 20);
    metrics.record('GET', '/permits/:id', 404, 10);
    metrics.record('POST', '/permits', 500, 80);

    const snapshot = metrics.snapshot();
    expect(snapshot.requests.total).toBe(3);
    expect(snapshot.requests.clientErrors).toBe(1);
    expect(snapshot.requests.serverErrors).toBe(1);
    expect(snapshot.requests.errorRate).toBeCloseTo(66.67, 1);
    expect(snapshot.requests.averageMs).toBe(37);
  });

  it('aggregates per route and keeps the slowest requests', () => {
    metrics.record('GET', '/permits', 200, 10);
    metrics.record('GET', '/permits', 200, 30);
    metrics.record('GET', '/reports', 200, 900);

    const snapshot = metrics.snapshot();
    const permits = snapshot.routes.find((route) => route.route === 'GET /permits');
    expect(permits).toMatchObject({ count: 2, errors: 0, averageMs: 20, maxMs: 30 });
    expect(snapshot.slowest[0]).toMatchObject({ route: 'GET /reports', ms: 900 });
  });

  it('tracks in-flight requests', () => {
    metrics.requestStarted();
    metrics.requestStarted();
    expect(metrics.snapshot().requests.inFlight).toBe(2);
    metrics.record('GET', '/permits', 200, 5);
    expect(metrics.snapshot().requests.inFlight).toBe(1);
  });

  it('records the outcome of a scheduled job and returns its result', async () => {
    const result = await metrics.track('permit-lifecycle', async () => ({ expired: 3, warned: 1 }));
    expect(result).toEqual({ expired: 3, warned: 1 });

    const job = metrics.snapshot().jobs.find((entry) => entry.name === 'permit-lifecycle');
    expect(job).toMatchObject({ runs: 1, failures: 0 });
    expect(job?.lastRun?.status).toBe('SUCCESS');
    expect(job?.lastRun?.message).toBe('expired=3, warned=1');
  });

  it('records a failed job and re-throws so nothing is swallowed', async () => {
    await expect(metrics.track('ai-risk-sweep', async () => {
      throw new Error('Gemini unreachable');
    })).rejects.toThrow('Gemini unreachable');

    const job = metrics.snapshot().jobs.find((entry) => entry.name === 'ai-risk-sweep');
    expect(job).toMatchObject({ runs: 1, failures: 1 });
    expect(job?.lastRun).toMatchObject({ status: 'FAILED', message: 'Gemini unreachable' });
  });

  it('lists a declared job that has never run', () => {
    metrics.declareJob('violation-remediation-sweep');
    const job = metrics.snapshot().jobs.find((entry) => entry.name === 'violation-remediation-sweep');
    expect(job).toMatchObject({ runs: 0, failures: 0, lastRun: null });
  });

  it('keeps only the last ten runs of a job', async () => {
    for (let run = 0; run < 12; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      await metrics.track('permit-lifecycle', async () => run);
    }
    const job = metrics.snapshot().jobs.find((entry) => entry.name === 'permit-lifecycle');
    expect(job?.runs).toBe(12);
    expect(job?.history).toHaveLength(10);
    expect(job?.history[0].message).toBe('11');
  });

  it('reports throughput per minute', () => {
    for (let index = 0; index < 5; index += 1) metrics.record('GET', '/permits', 200, 10);
    const snapshot = metrics.snapshot();
    expect(snapshot.requests.perMinute).toHaveLength(1);
    expect(snapshot.requests.perMinute[0].requests).toBe(5);
    expect(snapshot.requests.throughputPerMinute).toBe(5);
  });
});
