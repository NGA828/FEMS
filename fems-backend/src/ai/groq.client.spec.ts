import { GroqClient } from './groq.client';
import { LlmClient } from './llm.client';
import { AiNotConfiguredError, AiProviderError } from './llm.types';
import { resetConfigCache } from '../config/configuration';

/** Groq request contract, current model defaults and no-provider fallback. */
const ORIGINAL_ENV = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
  for (const key of [
    'AI_PROVIDER',
    'GROQ_API_KEY',
    'GROQ_MODEL',
    'GROQ_BASE_URL',
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODEL',
    'OPENROUTER_BASE_URL',
  ]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
}

function mockFetch(body: unknown, init: { status?: number } = {}) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const completion = (content: string) => ({
  model: 'openai/gpt-oss-120b',
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { total_tokens: 128 },
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetConfigCache();
  jest.restoreAllMocks();
});

describe('GroqClient', () => {
  it('reports the missing Groq key and never pretends a model is configured', async () => {
    setEnv({ AI_PROVIDER: 'groq' });
    const client = new GroqClient();

    expect(client.isConfigured).toBe(false);
    expect(client.describe()).toMatchObject({ provider: 'LOCAL_RULE_ENGINE', missing: ['GROQ_API_KEY'] });
    await expect(client.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('defaults to the current production Groq model', () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' });
    const client = new GroqClient();
    expect(client.model).toBe('openai/gpt-oss-120b');
    expect(client.describe()).toMatchObject({ provider: 'GROQ', configured: true, baseUrl: 'https://api.groq.com/openai/v1' });
  });

  it('upgrades the retired default model in existing .env files', () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', GROQ_MODEL: 'llama-3.3-70b-versatile' });
    expect(new GroqClient().model).toBe('openai/gpt-oss-120b');
  });

  it('calls Groq chat completions with the key in a header, never in the URL', async () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_secret' });
    const fetchMock = mockFetch(completion('All clear.'));

    const result = await new GroqClient().generate({ prompt: 'Summarise', systemInstruction: 'Be terse', json: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(url).not.toContain('gsk_secret');
    expect(init.headers.authorization).toBe('Bearer gsk_secret');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be terse' },
      { role: 'user', content: 'Summarise' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.stream).toBe(false);
    expect(result).toMatchObject({ text: 'All clear.', tokensUsed: 128, finishReason: 'stop' });
  });

  it('omits the system turn when there is no standing instruction', async () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' });
    const fetchMock = mockFetch(completion('ok'));
    await new GroqClient().generate({ prompt: 'Question?' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([{ role: 'user', content: 'Question?' }]);
  });

  it('explains a refused key rather than echoing a raw body', async () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_wrong' });
    mockFetch({ error: { message: 'Invalid API Key' } }, { status: 401 });

    await expect(new GroqClient().generate({ prompt: 'hi' })).rejects.toThrow(/GROQ_API_KEY.*Invalid API Key/s);
  });

  it('names the account/model quota when Groq answers 429', async () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' });
    mockFetch({ error: { message: 'Rate limit reached for model' } }, { status: 429 });

    const error = await new GroqClient().generate({ prompt: 'hi' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error.status).toBe(429);
    expect(error.message).toContain('current limits for your account and model');
    expect(error.message).toContain('deterministic rule engine still answers');
  });

  it('points at GROQ_MODEL when the model is not served', async () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', GROQ_MODEL: 'does-not-exist' });
    mockFetch({ error: { message: 'model not found' } }, { status: 404 });

    await expect(new GroqClient().generate({ prompt: 'hi' })).rejects.toThrow(/GROQ_MODEL/);
  });

  it('refuses an empty answer instead of returning a blank narrative', async () => {
    setEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' });
    mockFetch({ choices: [{ message: { content: '   ' } }] });

    await expect(new GroqClient().generate({ prompt: 'hi' })).rejects.toThrow('Groq returned an empty answer.');
  });
});

describe('LlmClient — Groq-only provider resolution', () => {
  const build = () => new LlmClient(new GroqClient());

  it('uses Groq when a Groq key is present', () => {
    setEnv({ GROQ_API_KEY: 'gsk_test' });
    expect(build().provider).toBe('groq');
    expect(build().describe().provider).toBe('GROQ');
  });

  it('never uses an OpenRouter key, even when legacy settings request it', async () => {
    setEnv({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-test' });
    const client = build();
    expect(client.provider).toBe('none');
    expect(client.describe()).toMatchObject({ provider: 'LOCAL_RULE_ENGINE', missing: ['GROQ_API_KEY'] });
    await expect(client.generate({ prompt: 'hi' })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('uses Groq, not OpenRouter, when both keys are present or AI_PROVIDER is legacy', () => {
    setEnv({ AI_PROVIDER: 'openrouter', GROQ_API_KEY: 'gsk_test', OPENROUTER_API_KEY: 'sk-or-test' });
    const client = build();
    expect(client.provider).toBe('groq');
    expect(client.describe().provider).toBe('GROQ');
  });

  it('falls back to the rule engine when no Groq key is set', () => {
    setEnv({ AI_PROVIDER: 'groq', OPENROUTER_API_KEY: 'sk-or-test' });
    expect(build().provider).toBe('none');
    expect(build().isConfigured).toBe(false);
    expect(build().describe()).toMatchObject({ provider: 'LOCAL_RULE_ENGINE', missing: ['GROQ_API_KEY'] });
  });

  it('treats AI_PROVIDER=none as a deliberate choice', async () => {
    setEnv({ AI_PROVIDER: 'none', GROQ_API_KEY: 'gsk_test' });
    const client = build();
    expect(client.provider).toBe('none');
    expect(client.describe().missing).toEqual([]);
    expect(client.describe().message).toContain('AI_PROVIDER=none');
    await expect(client.generate({ prompt: 'hi' })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('routes the call to Groq', async () => {
    setEnv({ GROQ_API_KEY: 'gsk_test', OPENROUTER_API_KEY: 'sk-or-test' });
    const fetchMock = mockFetch(completion('Routed.'));
    const result = await build().generate({ prompt: 'hi' });
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('api.groq.com');
    expect(result.text).toBe('Routed.');
  });
});
