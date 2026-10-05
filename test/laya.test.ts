import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAbout, inferIntent, LayaError, readerAsk, readerState, relevanceQuestion, rerank, systemOne, systemOneUrl, type JudgeConfig } from '@/lib/laya';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function stubFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      };
      calls.push(call);
      return handler(call);
    })
  );
  return calls;
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const one = (provider: JudgeConfig['providers'][number]): JudgeConfig => ({ providers: [provider] });
const LOCAL = { provider: 'laya' as const, baseUrl: 'http://127.0.0.1:8000' };

const QUESTIONS = {
  window: { type: 'choice' as const, instructions: 'How recent?', criteria: { any: 'Any time', '7d': 'Past week' } },
  source_reddit: {
    type: 'noul' as const,
    instructions: 'Wants Reddit?',
    criteria: { true: 'Mentions Reddit', false: 'Does not' },
  },
  plain: { type: 'noul' as const, instructions: 'No criteria' },
};

/** What laya-serve 0.3.20 returns: typed answers plus Laya's extra fields and routing. */
const NATIVE = {
  model: 'english',
  answers: {
    window: {
      type: 'choice',
      choice: '7d',
      probabilities: { any: 0.2, '7d': 0.8 },
      confidence: 0.28,
      answer_confidence: 0.8,
      action: { act_probability: 0.5 },
    },
    source_reddit: { type: 'noul', noul: 0.91, confidence: 0.91, answer_confidence: 0.91 },
    plain: { type: 'noul', noul: 0.07, confidence: 0.93, answer_confidence: 0.93 },
  },
  usage: { input_tokens: 123, output_tokens: 0 },
  routing: { model: 'english', repo: 'convaiinnovations/laya', reason: 'Latin script, English' },
};

describe('systemOneUrl', () => {
  it.each([
    ['http://127.0.0.1:8000', 'http://127.0.0.1:8000/v1/systemone'],
    ['https://laya.example.com/', 'https://laya.example.com/v1/systemone'],
    [' https://x.endpoints.huggingface.cloud// ', 'https://x.endpoints.huggingface.cloud/v1/systemone'],
  ])('joins %s', (base, url) => {
    expect(systemOneUrl(base)).toBe(url);
  });
});

describe('self-hosted laya-serve', () => {
  it.each([
    [503, 'Laya is temporarily unavailable. Please try again shortly.'],
    [500, 'Laya is temporarily unavailable. Please try again shortly.'],
    [429, 'Laya is receiving too many requests. Please try again shortly.'],
    [422, 'Laya could not process this request (HTTP 422).'],
    [401, 'Laya could not process this request (HTTP 401).'],
  ])('shows a readable message for HTTP %i without exposing the server body', async (status, message) => {
    stubFetch(() => json(status, { detail: 'question "window" options exceed head_max_len=192' }));
    await expect(systemOne(one(LOCAL), 'test', {})).rejects.toMatchObject({ status, message, provider: 'laya' });
  });

  it('posts state and untouched questions, with no model and no key by default', async () => {
    const calls = stubFetch(() => json(200, NATIVE));
    const res = await systemOne(one(LOCAL), { request: 'x' }, QUESTIONS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8000/v1/systemone');
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[0]!.body).toEqual({ state: { request: 'x' }, questions: QUESTIONS });
    expect(res).toMatchObject({ model: 'english', provider: 'laya', checkpoint: 'english', usage: NATIVE.usage });
    expect(res.answers.source_reddit).toMatchObject({ type: 'noul', noul: 0.91 });
    expect(res.answers.window).toMatchObject({ type: 'choice', choice: '7d', probabilities: { any: 0.2, '7d': 0.8 } });
  });

  it('sends the bearer key and a pinned checkpoint when configured', async () => {
    const calls = stubFetch(() => json(200, NATIVE));
    await systemOne(one({ ...LOCAL, apiKey: 'lk', model: 'multilingual' }), 'x', QUESTIONS);
    expect(calls[0]!.headers.authorization).toBe('Bearer lk');
    expect(calls[0]!.body.model).toBe('multilingual');
  });

  it('fills in missing model, routing and usage', async () => {
    stubFetch(() => json(200, { answers: NATIVE.answers }));
    const res = await systemOne(one(LOCAL), 'x', QUESTIONS);
    expect(res.model).toBe('laya');
    expect(res).not.toHaveProperty('checkpoint');
    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('treats a refused connection as an outage', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(systemOne(one(LOCAL), 'x', QUESTIONS)).rejects.toMatchObject({ status: 503, provider: 'laya' });
  });
});

describe('Hugging Face endpoint', () => {
  it('posts to the endpoint with the Hugging Face token', async () => {
    const calls = stubFetch(() => json(200, NATIVE));
    const res = await systemOne(
      one({ provider: 'huggingface', baseUrl: 'https://abc.us-east-1.aws.endpoints.huggingface.cloud', apiKey: 'hf_x' }),
      'x',
      QUESTIONS
    );
    expect(calls[0]!.url).toBe('https://abc.us-east-1.aws.endpoints.huggingface.cloud/v1/systemone');
    expect(calls[0]!.headers.authorization).toBe('Bearer hf_x');
    expect(res.provider).toBe('huggingface');
  });
});

describe('provider chain', () => {
  const chain: JudgeConfig = {
    providers: [LOCAL, { provider: 'huggingface', baseUrl: 'https://hf.example', apiKey: 'hf' }],
  };

  it.each([429, 500, 503])('moves to the next provider after HTTP %i', async (status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls = stubFetch((call) => (call.url.startsWith('http://127.0.0.1') ? json(status, {}) : json(200, NATIVE)));
    const res = await systemOne(chain, 'x', QUESTIONS);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['127.0.0.1:8000', 'hf.example']);
    expect(res.provider).toBe('huggingface');
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      `[laya] laya returned HTTP ${status}; retrying with huggingface`,
    ]);
  });

  it('moves on when the self-hosted server is down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (String(input).startsWith('http://127.0.0.1')) throw new TypeError('fetch failed');
      return json(200, NATIVE);
    }));
    expect((await systemOne(chain, 'x', QUESTIONS)).provider).toBe('huggingface');
  });

  it.each([400, 401, 413, 422])('does not fall back on client error HTTP %i', async (status) => {
    const calls = stubFetch(() => json(status, {}));
    await expect(systemOne(chain, 'x', QUESTIONS)).rejects.toBeInstanceOf(LayaError);
    expect(calls).toHaveLength(1);
  });

  it('surfaces the last error when every provider fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch((call) => json(call.url.startsWith('http://127.0.0.1') ? 503 : 429, {}));
    await expect(systemOne(chain, 'x', QUESTIONS)).rejects.toMatchObject({ status: 429, provider: 'huggingface' });
  });

  it('does not fall back once the request was aborted', async () => {
    const controller = new AbortController();
    const calls = stubFetch(() => {
      controller.abort();
      return json(503, {});
    });
    await expect(systemOne(chain, 'x', QUESTIONS, controller.signal)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it('rejects an empty chain', async () => {
    await expect(systemOne({ providers: [] }, 'x', QUESTIONS)).rejects.toThrow(/No Laya provider/);
  });
});

describe('inferIntent', () => {
  const answer = (window: string, where: Record<string, number>) =>
    json(200, {
      answers: {
        window: { type: 'choice', choice: window, probabilities: { [window]: 0.6 }, confidence: 0.3 },
        where: { type: 'choice', choice: Object.keys(where)[0], probabilities: where, confidence: 0.9 },
      },
      usage: { input_tokens: 40, output_tokens: 0 },
      routing: { model: 'multilingual' },
    });

  it('asks two choice questions in one request and maps places onto sources', async () => {
    const calls = stubFetch(() => answer('30d', { hackernews: 0.96, web: 0.02, reddit: 0.01 }));
    const intent = await inferIntent(one(LOCAL), { request: 'Rust on HN this month', query: 1, entity: 2 });
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body as { state: unknown; questions: Record<string, { type: string; criteria: Record<string, string> }> };
    expect(body.state).toEqual({ request: 'Rust on HN this month' });
    expect(Object.keys(body.questions)).toEqual(['window', 'where']);
    expect(Object.keys(body.questions.where!.criteria)).toContain('web');
    expect(Object.keys(body.questions.window!.criteria)).toEqual(['any', '24h', '7d', '30d']);
    expect(intent.window.choice).toBe('30d');
    expect(intent.sources.hackernews).toBe(0.96);
    // The three web engines share the web option.
    expect([intent.sources.google, intent.sources.duckduckgo, intent.sources.yandex]).toEqual([0.02, 0.02, 0.02]);
    expect(intent.sources.imdb).toBe(0);
    expect(intent.query).toEqual({ index: 1, confidence: 1 });
    expect(intent.entity).toEqual({ index: 2, confidence: 1 });
    expect(intent.checkpoint).toBe('multilingual');
  });

  it('falls back to any time for a window it does not know', async () => {
    stubFetch(() => answer('forever', { web: 1 }));
    const intent = await inferIntent(one(LOCAL), { request: 'x', query: 0, entity: 0 });
    expect(intent.window).toEqual({ choice: 'any', confidence: 0 });
  });
});

describe('relevanceQuestion', () => {
  it('puts the result in the question so the request can be the shared state', () => {
    expect(relevanceQuestion({ title: 'Bun 1.3 released', snippet: 'Faster installs.' })).toEqual({
      type: 'noul',
      instructions: 'Is this search result about the request? Title: Bun 1.3 released Snippet: Faster installs.',
    });
  });

  it('clips long text so the question fits the head budget', () => {
    const q = relevanceQuestion({ title: 't'.repeat(400), snippet: 's '.repeat(400) });
    expect(q.instructions.length).toBeLessThan(520);
    expect(q.instructions).toContain('…');
  });

  it('omits an empty snippet', () => {
    expect(relevanceQuestion({ title: 'Only a title', snippet: '  ' }).instructions).toBe(
      'Is this search result about the request? Title: Only a title'
    );
  });
});

describe('rerank', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: `id${i}`,
    source: 'google',
    title: i % 2 === 0 ? `Bun runtime ${i}` : `Hair bun ${i}`,
    snippet: 'snippet',
  }));

  it('scores a whole lane in one request with the request as state', async () => {
    const calls = stubFetch((call) => {
      const questions = call.body.questions as Record<string, { instructions: string }>;
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [id, { type: 'noul', noul: q.instructions.includes('Hair') ? 0.1 : 0.8 }])
      );
      return json(200, { answers, usage: { input_tokens: 50, output_tokens: 0 } });
    });
    const out = await rerank(one(LOCAL), 'Bun runtime', items);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.state).toEqual({ request: 'Bun runtime' });
    expect(Object.keys(calls[0]!.body.questions as object)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(out.relevance).toEqual({ id0: 0.8, id1: 0.1, id2: 0.8, id3: 0.1, id4: 0.8 });
    expect(out.usage.input_tokens).toBe(50);
  });

  it('splits more than 32 results across requests', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, source: 'google', title: `t${i}`, snippet: '' }));
    const calls = stubFetch((call) =>
      json(200, { answers: Object.fromEntries(Object.keys(call.body.questions as object).map((id) => [id, { type: 'noul', noul: 0.5 }])) })
    );
    const out = await rerank(one(LOCAL), 'x', many);
    expect(calls.map((c) => Object.keys(c.body.questions as object).length)).toEqual([32, 8]);
    expect(Object.keys(out.relevance)).toHaveLength(40);
  });

  it('fails the lane when Laya fails', async () => {
    stubFetch(() => json(422, {}));
    await expect(rerank(one(LOCAL), 'Bun', items)).rejects.toMatchObject({ status: 422 });
  });

  it('makes no request for an empty lane', async () => {
    const calls = stubFetch(() => json(200, {}));
    expect(await rerank(one(LOCAL), 'Bun', [])).toEqual({ relevance: {}, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(calls).toHaveLength(0);
  });
});

describe('reader questions', () => {
  it('makes the result the state and the reader question the question', () => {
    expect(readerState({ title: 'asyncio docs', snippet: 'Python 3.14', from: 'docs.python.org' })).toBe(
      'Title: asyncio docs\nSnippet: From docs.python.org. Python 3.14'
    );
    expect(readerAsk('Open source??  ')).toEqual({ type: 'noul', instructions: 'Open source?' });
  });

  it('clips a long question so the head still fits', () => {
    expect(readerAsk('why '.repeat(80)).instructions.length).toBeLessThanOrEqual(161);
  });

  it('asks once per item with that item as the state, in parallel', async () => {
    const calls = stubFetch((call) => {
      const state = String(call.body.state);
      return json(200, { answers: { a: { type: 'noul', noul: state.includes('docs') ? 0.9 : 0.2 } }, routing: { model: 'english' } });
    });
    const out = await askAbout(one(LOCAL), 'Is this official documentation?', [
      { id: 'a', source: '', title: 'asyncio docs', snippet: '', url: 'https://docs.python.org/3/library/asyncio.html' },
      { id: 'b', source: '', title: 'a blog post', snippet: '' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.body.state)).toContain('Title: asyncio docs\nSnippet: From docs.python.org.');
    expect(calls[0]!.body.questions).toEqual({ a: { type: 'noul', instructions: 'Is this official documentation?' } });
    expect(out).toEqual({ answers: { a: 0.9, b: 0.2 }, checkpoint: 'english' });
  });
});
