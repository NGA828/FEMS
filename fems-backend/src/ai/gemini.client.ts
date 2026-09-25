import { Injectable, Logger } from '@nestjs/common';
import { appConfig } from '../config/configuration';

export interface GeminiRequest {
  /** The user turn: the question plus the data the caller is allowed to see. */
  prompt: string;
  /** Standing instructions (never contains data — it is a fixed policy text). */
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the model for `application/json` output. */
  json?: boolean;
}

export interface GeminiResponse {
  text: string;
  model: string;
  latencyMs: number;
  tokensUsed: number | null;
  finishReason: string | null;
}

/** Raised when no API key is configured — the caller must surface this, not hide it. */
export class AiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';

  constructor(message = 'The Gemini provider is not configured. Set GEMINI_API_KEY to enable it.') {
    super(message);
    this.name = 'AiNotConfiguredError';
  }
}

/** Raised when a configured provider refuses or fails the call. */
export class AiProviderError extends Error {
  readonly code = 'AI_PROVIDER_UNAVAILABLE';
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
  }
}

/**
 * Google Gemini client.
 *
 * The whole integration lives on the server: the API key never leaves the
 * backend and the mobile app only ever talks to FEMS endpoints. When
 * `GEMINI_API_KEY` is empty the client reports "not configured" instead of
 * pretending to answer — the AI module then uses its deterministic rule engine.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  get model(): string {
    return appConfig().ai.geminiModel;
  }

  get isConfigured(): boolean {
    return Boolean(appConfig().ai.geminiApiKey);
  }

  describe() {
    const ai = appConfig().ai;
    return {
      provider: (ai.geminiApiKey ? 'GEMINI' : 'LOCAL_RULE_ENGINE') as 'GEMINI' | 'LOCAL_RULE_ENGINE',
      configured: Boolean(ai.geminiApiKey),
      model: ai.geminiApiKey ? ai.geminiModel : 'deterministic-rule-engine',
      baseUrl: ai.geminiBaseUrl,
      timeoutMs: ai.requestTimeoutMs,
      maxOutputTokens: ai.maxOutputTokens,
      message: ai.geminiApiKey
        ? 'Google Gemini is configured; regulatory decisions still remain with FEMS officers.'
        : 'GEMINI_API_KEY is empty. Gemini-backed answers are disabled and the deterministic rule engine is used instead.',
    };
  }

  /**
   * Single-turn generation. Throws `AiNotConfiguredError` when no key is set and
   * `AiProviderError` when the provider rejects the call or times out.
   */
  async generate(request: GeminiRequest): Promise<GeminiResponse> {
    const ai = appConfig().ai;
    if (!ai.geminiApiKey) throw new AiNotConfiguredError();

    const url = `${ai.geminiBaseUrl.replace(/\/$/, '')}/models/${this.model}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.requestTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The key travels in a header, never in the URL — so it cannot leak
          // into proxy or server access logs.
          'x-goog-api-key': ai.geminiApiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          ...(request.systemInstruction
            ? { systemInstruction: { role: 'system', parts: [{ text: request.systemInstruction }] } }
            : {}),
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxOutputTokens ?? ai.maxOutputTokens,
            ...(request.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const raw = await response.text();

      if (!response.ok) {
        // Never echo the key or the request body back to the caller.
        throw new AiProviderError(
          `Gemini rejected the request (HTTP ${response.status}): ${raw.slice(0, 300)}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AiProviderError('Gemini returned a response that is not valid JSON.');
      }

      const candidate = this.firstCandidate(payload);
      const text = (candidate?.content?.parts ?? [])
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();

      if (!text) {
        throw new AiProviderError('Gemini returned an empty answer.', response.status);
      }

      const tokensUsed = this.numberOf(payload, ['usageMetadata', 'totalTokenCount']);
      this.logger.log(`Gemini ${this.model} answered in ${latencyMs} ms (${tokensUsed ?? 'n/a'} tokens)`);

      return {
        text,
        model: this.model,
        latencyMs,
        tokensUsed,
        finishReason: candidate?.finishReason ?? null,
      };
    } catch (error) {
      if (error instanceof AiNotConfiguredError || error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiProviderError(`The Gemini call exceeded ${ai.requestTimeoutMs} ms and was aborted.`);
      }
      throw new AiProviderError(`The Gemini call failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private firstCandidate(payload: unknown): {
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  } | null {
    const candidates = (payload as { candidates?: unknown[] } | null)?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    return candidates[0] as { content?: { parts?: Array<{ text?: string }> }; finishReason?: string };
  }

  private numberOf(payload: unknown, path: string[]): number | null {
    let cursor: unknown = payload;
    for (const key of path) {
      if (typeof cursor !== 'object' || cursor === null) return null;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return typeof cursor === 'number' ? cursor : null;
  }
}
