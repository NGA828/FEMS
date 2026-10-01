import { OpenRouterClient } from './openrouter.client';

describe('OpenRouterClient', () => {
  const originalEnvironment = {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
    baseUrl: process.env.OPENROUTER_BASE_URL,
  };
  const fetchMock = jest.spyOn(global, 'fetch');

  beforeAll(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.OPENROUTER_MODEL = 'test/provider-model';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/api/v1';
  });

  afterAll(() => {
    fetchMock.mockRestore();
    if (originalEnvironment.apiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalEnvironment.apiKey;
    if (originalEnvironment.model === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalEnvironment.model;
    if (originalEnvironment.baseUrl === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = originalEnvironment.baseUrl;
  });

  it('sends scoped chat history and returns the model response metadata', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'test/provider-model',
          choices: [{ message: { content: 'A scoped answer.' }, finish_reason: 'stop' }],
          usage: { total_tokens: 23 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new OpenRouterClient();

    const result = await client.generate({
      systemInstruction: 'Answer only from the authorised context.',
      history: [{ role: 'user', text: 'Earlier question' }, { role: 'model', text: 'Earlier answer' }],
      prompt: 'Current question',
    });

    expect(client.describe().provider).toBe('OPENROUTER');
    expect(result).toEqual({
      text: 'A scoped answer.',
      model: 'test/provider-model',
      latencyMs: expect.any(Number),
      tokensUsed: 23,
      finishReason: 'stop',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-openrouter-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'test/provider-model',
      messages: [
        { role: 'system', content: 'Answer only from the authorised context.' },
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Current question' },
      ],
    });
  });
});
