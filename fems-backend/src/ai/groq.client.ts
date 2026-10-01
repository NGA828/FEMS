import { Injectable, Logger } from '@nestjs/common';
import { appConfig } from '../config/configuration';
import { AiNotConfiguredError, AiProviderError, type LlmDescription, type LlmRequest, type LlmResponse } from './llm.types';

/**
 * GroqCloud client.
 *
 * Groq serves open-weight models (Llama, GPT-OSS, Qwen…) behind an
 * OpenAI-compatible `/chat/completions` endpoint, with a permanently free tier
 * — which is why FEMS defaults to it. The key lives only on the server: the
 * mobile app never talks to Groq directly.
 *
 * The free tier is rate-limited (30 requests/minute, and a per-model daily
 * token budget). A 429 is therefore not an error in the code but an expected
 * operating condition, and it is reported to the caller in plain words instead
 * of being retried into a worse rate-limit state.
 */
@Injectable()
export class GroqClient {
  private readonly logger = new Logger(GroqClient.name);

  get model(): string {
    return appConfig().ai.groqModel;
  }

  get isConfigured(): boolean {
    return Boolean(appConfig().ai.groqApiKey);
  }

  describe(): LlmDescription {
    const ai = appConfig().ai;
    const configured = Boolean(ai.groqApiKey);
    return {
      provider: configured ? 'GROQ' : 'LOCAL_RULE_ENGINE',
      configured,
      model: configured ? ai.groqModel : 'deterministic-rule-engine',
      baseUrl: ai.groqBaseUrl,
      timeoutMs: ai.requestTimeoutMs,
      maxOutputTokens: ai.maxOutputTokens,
      missing: configured ? [] : ['GROQ_API_KEY'],
      message: configured
        ? `Groq (${ai.groqModel}) writes the narrative around findings computed by FEMS; regulatory decisions remain with officers.`
        : 'GROQ_API_KEY is empty. Model-written answers are disabled and the deterministic rule engine is used instead.',
    };
  }

  /**
   * Single-turn generation. Throws `AiNotConfiguredError` when no key is set and
   * `AiProviderError` when Groq rejects the call or times out.
   */
  async generate(request: LlmRequest): Promise<LlmResponse> {
    const ai = appConfig().ai;
    if (!ai.groqApiKey) throw new AiNotConfiguredError('The Groq provider is not configured. Set GROQ_API_KEY to enable it.');

    const url = `${ai.groqBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.requestTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The key travels in a header, never in the URL, so it cannot leak
          // into proxy or server access logs.
          authorization: `Bearer ${ai.groqApiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction }] : []),
            { role: 'user', content: request.prompt },
          ],
          temperature: request.temperature ?? 0.2,
          max_completion_tokens: request.maxOutputTokens ?? ai.maxOutputTokens,
          stream: false,
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const raw = await response.text();

      if (!response.ok) {
        throw new AiProviderError(this.explainFailure(response.status, raw), response.status);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AiProviderError('Groq returned a response that is not valid JSON.');
      }

      const choice = this.firstChoice(payload);
      const text = (choice?.message?.content ?? '').trim();
      if (!text) {
        throw new AiProviderError('Groq returned an empty answer.', response.status);
      }

      const tokensUsed = this.numberOf(payload, ['usage', 'total_tokens']);
      this.logger.log(`Groq ${this.model} answered in ${latencyMs} ms (${tokensUsed ?? 'n/a'} tokens)`);

      return {
        text,
        model: this.modelOf(payload) ?? this.model,
        latencyMs,
        tokensUsed,
        finishReason: choice?.finish_reason ?? null,
      };
    } catch (error) {
      if (error instanceof AiNotConfiguredError || error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiProviderError(`The Groq call exceeded ${ai.requestTimeoutMs} ms and was aborted.`);
      }
      throw new AiProviderError(`The Groq call failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Turns Groq's HTTP failures into something an administrator can act on. The
   * free tier's two usual answers — a wrong key and an exhausted quota — must
   * not read the same.
   */
  private explainFailure(status: number, raw: string): string {
    const detail = this.messageOf(raw) ?? raw.slice(0, 300);
    if (status === 401) return `Groq refused the API key (HTTP 401). Check GROQ_API_KEY in fems-backend/.env: ${detail}`;
    if (status === 404) {
      return `Groq does not serve the model "${this.model}" (HTTP 404). Set GROQ_MODEL to a model your account can use, e.g. llama-3.3-70b-versatile: ${detail}`;
    }
    if (status === 429) {
      return `Groq rate limit reached (HTTP 429) on the free tier — 30 requests/minute and a daily token budget per model. The deterministic rule engine still answers. Details: ${detail}`;
    }
    if (status === 413) return `The prompt was too large for ${this.model} (HTTP 413): ${detail}`;
    return `Groq rejected the request (HTTP ${status}): ${detail}`;
  }

  private messageOf(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      return typeof parsed?.error?.message === 'string' ? parsed.error.message : null;
    } catch {
      return null;
    }
  }

  private firstChoice(payload: unknown): { message?: { content?: string }; finish_reason?: string } | null {
    const choices = (payload as { choices?: unknown[] } | null)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    return choices[0] as { message?: { content?: string }; finish_reason?: string };
  }

  private modelOf(payload: unknown): string | null {
    const model = (payload as { model?: unknown } | null)?.model;
    return typeof model === 'string' && model.length > 0 ? model : null;
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
