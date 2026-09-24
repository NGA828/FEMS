/**
 * HTTP client.
 *
 * One place handles the things every screen needs:
 *
 *  • the FEMS response envelope (`{ success, data, meta }`), unwrapped so callers
 *    receive the payload directly;
 *  • the failure envelope converted into a typed `ApiError` with the backend's
 *    machine-readable `code` (the UI shows the server's own message);
 *  • bearer tokens plus single-flight refresh on `TOKEN_EXPIRED`;
 *  • timeouts, bounded retries for idempotent requests and offline detection.
 *
 * The token store is injected (see `src/auth/token-store.ts`) so the client stays
 * usable from tests and from the background sync worker.
 */
import { apiConfig } from './config';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown> & {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
  timestamp?: string;
}

export interface Paginated<T> {
  items: T[];
  meta: ApiEnvelope<T[]>['meta'];
}

export interface ApiErrorBody {
  success: false;
  statusCode: number;
  error: { code: string; message: string; details?: unknown };
  path?: string;
  method?: string;
  timestamp?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly path?: string;
  readonly method?: string;
  readonly isNetworkError: boolean;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    path?: string;
    method?: string;
    isNetworkError?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.path = init.path;
    this.method = init.method;
    this.isNetworkError = init.isNetworkError ?? false;
  }

  /** No route to the API: the device is offline or the server is unreachable. */
  get isOffline(): boolean {
    return this.isNetworkError || this.status === 0;
  }

  /** The signed-in user is not allowed to do this (backend-enforced). */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Validation problem: `details` carries the per-field messages. */
  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface TokenStore {
  getTokens(): Promise<TokenBundle | null>;
  setTokens(tokens: TokenBundle | null): Promise<void>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Query string values; `undefined`, `null` and `''` are dropped. */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Send the bearer token when one is stored (default true). */
  auth?: boolean;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  /** Multipart upload: body is a FormData instance and is sent untouched. */
  formData?: FormData;
  /** Extra headers (e.g. `x-client-ref` idempotency keys). */
  headers?: Record<string, string>;
}

type Refresher = (refreshToken: string) => Promise<TokenBundle | null>;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly store: TokenStore;
  private refreshPromise: Promise<TokenBundle | null> | null = null;
  private onSessionExpired: (() => void) | null = null;
  private offlineListeners = new Set<(offline: boolean) => void>();
  private lastOfflineState = false;

  constructor(baseUrl: string, store: TokenStore) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.store = store;
  }

  /** Called once when refresh fails: the session is over, the UI signs out. */
  setSessionExpiredHandler(handler: (() => void) | null): void {
    this.onSessionExpired = handler;
  }

  /** Registered by a global refresher so 401s can be healed transparently. */
  private refresher: Refresher | null = null;

  setRefresher(refresher: Refresher | null): void {
    this.refresher = refresher;
  }

  subscribeToConnectivity(listener: (offline: boolean) => void): () => void {
    this.offlineListeners.add(listener);
    return () => this.offlineListeners.delete(listener);
  }

  private reportConnectivity(offline: boolean): void {
    if (offline === this.lastOfflineState) return;
    this.lastOfflineState = offline;
    this.offlineListeners.forEach((listener) => listener(offline));
  }

  buildUrl(path: string, params?: RequestOptions['params']): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  private async buildHeaders(options: RequestOptions): Promise<Record<string, string>> {
    const headers: Record<string, string> = { accept: 'application/json', ...(options.headers ?? {}) };
    if (!options.formData) headers['content-type'] = 'application/json';
    if (options.auth !== false) {
      const tokens = await this.store.getTokens();
      if (tokens?.accessToken) headers.authorization = `Bearer ${tokens.accessToken}`;
    }
    return headers;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
    const method = options.method ?? 'GET';
    const retries = options.retries ?? (method === 'GET' ? apiConfig.maxRetries : 0);
    let attempt = 0;
    let refreshed = false;

    for (;;) {
      attempt += 1;
      const headers = await this.buildHeaders(options);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? apiConfig.timeoutMs);
      const abortListener = () => controller.abort();
      options.signal?.addEventListener('abort', abortListener);

      try {
        const response = await fetch(this.buildUrl(path, options.params), {
          method,
          headers,
          body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
          signal: controller.signal,
        });
        const text = await response.text();
        const payload = text ? (JSON.parse(text) as ApiEnvelope<T> | ApiErrorBody) : null;
        this.reportConnectivity(false);

        if (response.ok) {
          return (payload as ApiEnvelope<T>) ?? { success: true, data: undefined as unknown as T };
        }

        const errorBody = payload as ApiErrorBody | null;
        const code = errorBody?.error?.code ?? `HTTP_${response.status}`;

        // An expired access token is healed once, then the request is replayed.
        if (response.status === 401 && options.auth !== false && !refreshed && this.refresher) {
          refreshed = true;
          const renewed = await this.refreshTokens();
          if (renewed) continue;
        }

        if (response.status >= 500 && attempt <= retries) {
          await delay(250 * attempt);
          continue;
        }

        throw new ApiError({
          status: response.status,
          code,
          message: errorBody?.error?.message ?? `Request failed with status ${response.status}.`,
          details: errorBody?.error?.details,
          path: errorBody?.path ?? path,
          method: errorBody?.method ?? method,
        });
      } catch (error) {
        if (error instanceof ApiError) throw error;

        const aborted = error instanceof Error && error.name === 'AbortError';
        const networkIssue = aborted || error instanceof TypeError;
        if (networkIssue && attempt <= retries && !aborted) {
          await delay(300 * attempt);
          continue;
        }
        if (networkIssue) this.reportConnectivity(true);
        throw new ApiError({
          status: 0,
          code: aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE',
          message: aborted
            ? 'The request timed out. Check your connection and try again.'
            : 'Cannot reach the FEMS API. Check your connection and try again.',
          path,
          method,
          isNetworkError: true,
        });
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abortListener);
      }
    }
  }

  /** Single-flight refresh: concurrent 401s share one rotation. */
  private async refreshTokens(): Promise<TokenBundle | null> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const tokens = await this.store.getTokens();
          if (!tokens?.refreshToken || !this.refresher) return null;
          const renewed = await this.refresher(tokens.refreshToken);
          if (!renewed) {
            this.onSessionExpired?.();
            return null;
          }
          return renewed;
        } catch {
          this.onSessionExpired?.();
          return null;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }
    return this.refreshPromise;
  }

  // --------------------------------------------------------------- shortcuts

  get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /** GET for collection endpoints: returns the rows plus the pagination meta. */
  async list<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<Paginated<T>> {
    const envelope = await this.request<T[]>(path, { ...options, method: 'GET' });
    return { items: Array.isArray(envelope.data) ? envelope.data : [], meta: envelope.meta };
  }

  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  put<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  delete<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  upload<T>(
    path: string,
    formData: FormData,
    options: Omit<RequestOptions, 'method' | 'body' | 'formData'> = {},
  ): Promise<ApiEnvelope<T>> {
    return this.request<T>(path, { ...options, method: 'POST', formData, timeoutMs: options.timeoutMs ?? 60_000 });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Field-level validation errors from a 400/422 response, if any. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details) return {};
  const details = error.details;
  const map: Record<string, string> = {};
  if (Array.isArray(details)) {
    details.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        const record = entry as { property?: string; field?: string; messages?: string[]; message?: string };
        const key = record.property ?? record.field;
        const message = record.messages?.[0] ?? record.message;
        if (key && message) map[key] = message;
      }
    });
  } else if (typeof details === 'object') {
    Object.entries(details as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === 'string') map[key] = value;
      else if (Array.isArray(value) && typeof value[0] === 'string') map[key] = value[0];
    });
  }
  return map;
}
