import { Injectable, Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { appConfig } from '../../config/configuration';

export interface ProviderPaymentRequest {
  amount: number;
  currency: string;
  method: PaymentMethod;
  phone: string;
  reference: string;
  description: string;
}

export interface ProviderPaymentResult {
  providerReference: string | null;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  payload: Record<string, unknown>;
  failureReason?: string;
}

/**
 * Campay mobile-money client.
 *
 * This is a real HTTP client: it authenticates against Campay, requests the
 * collection and reads the transaction back. When Campay is not configured the
 * methods throw a `CampayNotConfiguredError` — FEMS never fabricates a provider
 * answer. Connectivity or credential failures are surfaced to the caller and
 * written to the payment failure reason so the audit trail reflects reality.
 */
export class CampayNotConfiguredError extends Error {
  readonly code = 'CAMPAY_NOT_CONFIGURED';
  constructor(missing: string[]) {
    super(
      `Campay is not configured (missing ${missing.join(', ')}). Set CAMPAY_API_KEY and CAMPAY_USERNAME/CAMPAY_PASSWORD, or use PAYMENT_PROVIDER=simulator for local testing.`,
    );
  }
}

export class CampayRequestError extends Error {
  readonly code = 'CAMPAY_REQUEST_FAILED';
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

@Injectable()
export class CampayProvider {
  private readonly logger = new Logger(CampayProvider.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  get config() {
    return appConfig().payments.campay;
  }

  get configured(): boolean {
    const { apiKey, username, password } = this.config;
    return Boolean(apiKey && username && password);
  }

  missingConfiguration(): string[] {
    const missing: string[] = [];
    if (!this.config.apiKey) missing.push('CAMPAY_API_KEY');
    if (!this.config.username) missing.push('CAMPAY_USERNAME');
    if (!this.config.password) missing.push('CAMPAY_PASSWORD');
    return missing;
  }

  private ensureConfigured(): void {
    if (!this.configured) throw new CampayNotConfiguredError(this.missingConfiguration());
  }

  private async authenticate(): Promise<string> {
    this.ensureConfigured();
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const response = await this.request('/token/', {
      method: 'POST',
      body: { username: this.config.username, password: this.config.password },
      skipAuth: true,
    });
    const token = typeof response.token === 'string' ? response.token : null;
    if (!token) {
      throw new CampayRequestError('Campay did not return an access token for the configured credentials.');
    }
    this.token = token;
    // Campay tokens are short-lived; refresh a minute early.
    this.tokenExpiresAt = Date.now() + 9 * 60_000;
    return token;
  }

  private async request(
    path: string,
    options: { method: 'GET' | 'POST'; body?: Record<string, unknown>; skipAuth?: boolean },
  ): Promise<Record<string, unknown>> {
    const { baseUrl } = this.config;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!options.skipAuth) {
      headers.Authorization = `Token ${await this.authenticate()}`;
    }
    if (this.config.apiKey) headers['X-API-Key'] = this.config.apiKey;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown network error';
      throw new CampayRequestError(`Campay is unreachable (${message}). The payment was not sent to the provider.`);
    }

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      const detail =
        (typeof payload.detail === 'string' && payload.detail) ||
        (typeof payload.message === 'string' && payload.message) ||
        `HTTP ${response.status}`;
      throw new CampayRequestError(`Campay rejected the request: ${detail}`, response.status);
    }
    return payload;
  }

  /** Requests a mobile-money collection (USSD push) for the payer. */
  async collect(request: ProviderPaymentRequest): Promise<ProviderPaymentResult> {
    this.ensureConfigured();
    const payload = await this.request('/collect/', {
      method: 'POST',
      body: {
        amount: String(Math.round(request.amount)),
        currency: request.currency,
        from: request.phone,
        description: request.description,
        external_reference: request.reference,
      },
    });

    const providerReference = typeof payload.reference === 'string' ? payload.reference : null;
    this.logger.log(`Campay collection requested for ${request.reference} (provider ref ${providerReference ?? 'n/a'})`);
    return {
      providerReference,
      status: 'PENDING',
      payload,
    };
  }

  /** Reads the authoritative status of a transaction back from Campay. */
  async getTransaction(providerReference: string): Promise<ProviderPaymentResult> {
    this.ensureConfigured();
    const payload = await this.request(`/transaction/${encodeURIComponent(providerReference)}/`, { method: 'GET' });
    const rawStatus = typeof payload.status === 'string' ? payload.status.toUpperCase() : 'PENDING';
    const status = rawStatus === 'SUCCESSFUL' || rawStatus === 'SUCCESS' ? 'SUCCESSFUL' : rawStatus === 'FAILED' ? 'FAILED' : 'PENDING';
    return {
      providerReference,
      status,
      payload,
      failureReason: typeof payload.reason === 'string' ? payload.reason : undefined,
    };
  }

  /** Verifies the shared secret sent by the Campay webhook. */
  verifyWebhookSecret(headerValue: string | undefined): boolean {
    const secret = this.config.webhookSecret;
    if (!secret) return false;
    return Boolean(headerValue) && headerValue === secret;
  }
}
