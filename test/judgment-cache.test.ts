import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryCache, type ResultCache } from '@/lib/cache';
import { judgmentCache } from '@/lib/judgment-cache';
import { runSearch } from '@/lib/pipeline';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LAYA = { providers: [{ provider: 'laya' as const, baseUrl: 'http://laya.test' }] };

/** Search returns fixed rows; Laya answers every question. Counts calls to each. */
function stubServices(rows: { title: string; link: string }[]) {
  const counts = { laya: 0, search: 0 };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as { questions?: Record<string, { type: string }> };
    if (url.endsWith('/v1/systemone')) {
      counts.laya += 1;
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(body.questions ?? {})) {
        answers[id] = id === 'window' ? { type: 'choice', choice: 'any', probabilities: { any: 1 }, confidence: 1 }
          : id === 'where' ? { type: 'choice', choice: 'web', probabilities: { web: 0.9 }, confidence: 1 }
          : q.type === 'noul' ? { type: 'noul', noul: 0.8 } : undefined;
      }
      return new Response(JSON.stringify({ answers, usage: { input_tokens: 50, output_tokens: 0 } }));
    }
    counts.search += 1;
    return new Response(JSON.stringify({ results: rows.map((r) => ({ ...r, snippet: 's' })) }));
  }));
  return counts;
}

describe('judgment cache in the pipeline', () => {
  it('answers a repeated search without asking Laya', async () => {
    const counts = stubServices([{ title: 'Bun 1.3', link: 'https://a.com/1' }, { title: 'Bun docs', link: 'https://b.com/2' }]);
    const deps = { search1api: { apiKey: 's1' }, judge: LAYA, cache: memoryCache() };
    const first = await runSearch(deps, { request: 'Bun runtime', sources: ['google'] });
    expect(counts.laya).toBe(2); // the intent, then one lane
    expect(first.items.every((i) => i.ranked && i.relevance === 0.8)).toBe(true);

    const second = await runSearch(deps, { request: '  bun   RUNTIME ', sources: ['google'] });
    expect(counts.laya).toBe(2); // nothing new: same request after normalising, same URLs
    expect(second.items.map((i) => [i.url, i.relevance, i.ranked])).toEqual(first.items.map((i) => [i.url, i.relevance, i.ranked]));
    expect(second.tokens).toBe(0);
  });

  it('asks Laya only about URLs it has not scored for this request', async () => {
    const deps = { search1api: { apiKey: 's1' }, judge: LAYA, cache: memoryCache() };
    stubServices([{ title: 'Old', link: 'https://a.com/1' }]);
    await runSearch(deps, { request: 'Bun', sources: ['google'] });
    const counts = stubServices([{ title: 'Old', link: 'https://a.com/1' }, { title: 'New', link: 'https://c.com/3' }]);
    // A different window misses the engine-result cache, so the new URL shows up; the request is the same.
    const out = await runSearch(deps, { request: 'Bun', sources: ['google'], window: '30d' });
    expect(counts.laya).toBe(1); // intent cached; one lane request for the new URL only
    expect(out.items.every((i) => i.ranked)).toBe(true);
  });

  it('keeps searching when the cache fails', async () => {
    const counts = stubServices([{ title: 'Bun', link: 'https://a.com/1' }]);
    const broken: ResultCache = {
      get: async () => { throw new Error('KV down'); },
      put: async () => { throw new Error('KV down'); },
    };
    const out = await runSearch({ search1api: { apiKey: 's1' }, judge: LAYA, cache: broken }, { request: 'Bun', sources: ['google'] });
    expect(out.items).toHaveLength(1);
    expect(counts.laya).toBe(2);
  });
});

describe('judgmentCache keys', () => {
  it('keeps judgments of different checkpoints apart', async () => {
    const cache = memoryCache();
    const auto = await judgmentCache(cache, LAYA, 'Bun');
    await auto.saveScores(new Map([['a.com/1', 0.9]]));
    const pinned = await judgmentCache(cache, { providers: [{ provider: 'laya', baseUrl: 'http://l', model: 'multilingual' }] }, 'Bun');
    expect((await pinned.scores()).size).toBe(0);
    expect((await (await judgmentCache(cache, LAYA, 'bun')).scores()).get('a.com/1')).toBe(0.9);
  });

  it('does nothing without a cache', async () => {
    const none = await judgmentCache(undefined, LAYA, 'Bun');
    await none.saveScores(new Map([['x', 1]]));
    expect(await none.intent()).toBeNull();
    expect((await none.scores()).size).toBe(0);
  });
});
