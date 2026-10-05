import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryCache } from '@/lib/cache';
import { handleJudge } from '@/server/judge';

afterEach(() => {
  vi.unstubAllGlobals();
});

const JUDGE = { providers: [{ provider: 'laya' as const, baseUrl: 'http://laya.test' }] };
const ORIGIN = 'https://omnilaya.test';

function post(body: unknown, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}/api/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const BODY = {
  q: 'python asyncio',
  question: 'Is this official documentation?',
  items: [
    { id: 'a', title: 'asyncio docs', snippet: '', url: 'https://docs.python.org/asyncio' },
    { id: 'b', title: 'a blog post', snippet: '', url: 'https://blog.example/asyncio' },
  ],
};

/** laya-serve that says yes to anything with "docs" in it, and counts its calls. */
function stubLaya(status = 200) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { state: string; questions: Record<string, unknown> };
    calls.push(body);
    if (status !== 200) return new Response('{}', { status });
    const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: 'noul', noul: body.state.includes('docs') ? 0.9 : 0.1 }]));
    return new Response(JSON.stringify({ answers, routing: { model: 'english' } }));
  }));
  return calls;
}

describe('POST /api/judge', () => {
  it('refuses other origins', async () => {
    const res = await handleJudge(post(BODY, { origin: 'https://evil.test' }), { judge: JUDGE });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed body', async () => {
    const res = await handleJudge(post({ q: 'x', question: 'no', items: [] }), { judge: JUDGE });
    expect(res.status).toBe(400);
  });

  it('applies the rate limit before calling Laya', async () => {
    const calls = stubLaya();
    const res = await handleJudge(post(BODY), { judge: JUDGE, limiter: { limit: async () => ({ success: false }) } });
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it('answers each result by id and reports the checkpoint', async () => {
    stubLaya();
    const res = await handleJudge(post(BODY), { judge: JUDGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answers: Record<string, number>; cached: number; checkpoint: string };
    expect(body.answers).toEqual({ a: 0.9, b: 0.1 });
    expect(body.cached).toBe(0);
    expect(body.checkpoint).toBe('english');
  });

  it('reuses cached answers by URL, so asking again skips Laya', async () => {
    const calls = stubLaya();
    const cache = memoryCache();
    await handleJudge(post(BODY), { judge: JUDGE, cache });
    const again = await handleJudge(post({ ...BODY, items: BODY.items.map((i, n) => ({ ...i, id: `other${n}` })) }), { judge: JUDGE, cache });
    const body = (await again.json()) as { answers: Record<string, number>; cached: number };
    expect(calls).toHaveLength(2);
    expect(body).toMatchObject({ answers: { other0: 0.9, other1: 0.1 }, cached: 2 });
  });

  it('maps a Laya outage to its status without leaking the server body', async () => {
    stubLaya(503);
    const res = await handleJudge(post(BODY), { judge: JUDGE });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/temporarily unavailable/);
  });

  it('maps a Laya client error to 502', async () => {
    stubLaya(422);
    const res = await handleJudge(post(BODY), { judge: JUDGE });
    expect(res.status).toBe(502);
  });
});
