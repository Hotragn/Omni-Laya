import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSearch } from '@/lib/pipeline';
import { memoryCache } from '@/lib/cache';
import { compareItems } from '@/lib/rank';

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(results?: Record<string, unknown>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });

      if (url.endsWith('/v1/systemone')) {
        const questions = body.questions as Record<string, { type: string; instructions: string }>;
        const answers: Record<string, unknown> = {};
        for (const [id, q] of Object.entries(questions)) {
          if (id === 'window') {
            answers[id] = { type: 'choice', choice: '7d', probabilities: { '7d': 0.8 }, confidence: 0.8 };
          } else if (id === 'where') {
            answers[id] = { type: 'choice', choice: 'reddit', probabilities: { reddit: 0.9, web: 0.05, hackernews: 0.05 }, confidence: 0.8 };
          } else if (q.type === 'noul') {
            // Each result is in its question: the hair bun is off topic, everything else is on topic.
            answers[id] = { type: 'noul', noul: q.instructions.includes('Title: Hair') ? 0.05 : 0.95 };
          }
        }
        return jsonResponse({ model: 'english', answers, usage: { input_tokens: 100, output_tokens: 0 }, routing: { model: 'english' } });
      }

      if (url.endsWith('/search') || url.endsWith('/news')) {
        if (results) return jsonResponse({ results });
        if (body.search_service === 'reddit') {
          return jsonResponse({
            results: [
              { title: 'Old thread', link: 'https://www.reddit.com/r/bun/old', snippet: 'Oct 10, 2025 · stale' },
              { title: 'Should I move away from Bun? - Reddit', link: 'https://reddit.com/r/bun/1/', snippet: '3 days ago ... runtime' },
            ],
          });
        }
        return jsonResponse({
          results: [
            { title: 'Should I move away from Bun? - Reddit', link: 'https://www.reddit.com/r/bun/1', snippet: '3 days ago ... runtime' },
            { title: 'Hair up in a bun : r/hair - Reddit', link: 'https://www.reddit.com/r/hair/2', snippet: '1 day ago ... hair' },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

const LAYA = { providers: [{ provider: 'laya' as const, baseUrl: 'http://laya.test' }] };

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('runSearch', () => {
  it('searches and scores each lane once even when a caller repeats sources', async () => {
    stubFetch([{ title: 'Bun discussion', link: 'https://reddit.com/r/bun/1', snippet: 'Bun runtime' }]);
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA, now: () => new Date('2026-09-18T18:30:00Z') },
      { request: 'Bun', sources: ['reddit', 'reddit', 'reddit'], window: 'any' }
    );

    const searchCalls = calls.filter((c) => c.url.endsWith('/search'));
    expect(searchCalls.map((c) => c.body.search_service).sort()).toEqual(['google', 'reddit']);
    // One intent judgment, then one relevance judgment: both lanes returned the same URL,
    // so the second lane reuses the first lane's score.
    expect(calls.filter((c) => c.url.endsWith('/v1/systemone'))).toHaveLength(2);
    expect(out.sources).toEqual(['reddit']);
    expect(out.lanes).toHaveLength(2);
    expect(out.lanes.every((l) => l.items.every((i) => i.ranked))).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.tokens).toBe(200);
  });

  it('carries API dates through filtering, scoring and Newest sorting', async () => {
    stubFetch([
      { title: 'Old', link: 'https://a.com/old', snippet: '1 hour ago ... misleading', published_date: '2025-01-01' },
      { title: 'Day only', link: 'https://a.com/day', snippet: 'plain', published_date: '2026-09-17' },
      { title: 'Recent', link: 'https://a.com/recent', snippet: '3 days ago ... misleading', published_date: '2026-09-18T17:30:00Z' },
      { title: 'Unknown', link: 'https://a.com/unknown', snippet: 'plain', published_date: null },
    ]);
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA, now: () => new Date('2026-09-18T18:30:00Z') },
      { request: 'Bun', sources: ['google'], window: '24h' }
    );
    expect(out.lanes[0]!.stale).toBe(1);
    expect(out.items).toHaveLength(3);
    expect(out.items.find((i) => i.title === 'Day only')).toMatchObject({ publishedDate: '2026-09-17', ageHours: 42.5 });
    const recent = out.items.find((i) => i.title === 'Recent')!;
    expect(recent).toMatchObject({ publishedDate: '2026-09-18T17:30:00Z', ageHours: 1 });
    expect(recent.freshness).toBeCloseTo(23 / 24);
    expect([...out.items].sort((a, b) => compareItems(a, b, 'newest')).map((i) => i.title))
      .toEqual(['Recent', 'Day only', 'Unknown']);
  });

  it('recomputes age from the cached absolute publication time', async () => {
    stubFetch([{ title: 'Recent', link: 'https://a.com', snippet: '1 hour ago ... text', published_date: '2026-09-18T17:00:00Z' }]);
    let now = new Date('2026-09-18T18:00:00Z');
    const deps = { search1api: { apiKey: 's1' }, judge: LAYA, cache: memoryCache(), now: () => now };
    const input = { request: 'Bun', sources: ['google' as const], window: 'any' as const };
    expect((await runSearch(deps, input)).items[0]!.ageHours).toBe(1);
    now = new Date('2026-09-18T18:30:00Z');
    expect((await runSearch(deps, input)).items[0]!.ageHours).toBe(1.5);
    expect(calls.filter((c) => c.url.endsWith('/search'))).toHaveLength(1);
  });

  it('infers window and sources, uses the stripped query, and scores results', async () => {
    stubFetch();
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA, now: () => new Date('2026-09-17T00:00:00Z') },
      { request: 'what are people saying about Bun 1.3 this week' }
    );

    expect(out.window).toBe('7d');
    // Reddit won the where choice but the request never names it, so the open web comes along.
    expect(out.sources).toEqual(['google', 'duckduckgo', 'yandex', 'reddit']);
    expect(out.query).toBe('Bun 1.3');
    expect(out.inferred.sources.reddit).toBe(0.9);

    const reddit = calls.filter((c) =>
      c.url.endsWith('/search') && c.body.query === 'Bun 1.3' && c.body.time_range === 'week' &&
      (c.body.search_service === 'reddit' || (c.body.include_sites as string[])[0] === 'reddit.com'));
    const searchCalls = reddit;
    expect(searchCalls.map((c) => c.body.search_service).sort()).toEqual(['google', 'reddit']);
    expect(searchCalls.find((c) => c.body.search_service === 'reddit')!.body).toMatchObject({ include_sites: [], exclude_sites: [] });
    expect(searchCalls[0]!.body).toMatchObject({
      query: 'Bun 1.3',
      time_range: 'week',
      include_sites: ['reddit.com'],
    });

    // Lanes folded by URL: the shared URL is one row with both engines; the
    // stale reddit row (Oct 2025) is outside the window and dropped.
    // Rows keep the source of whichever lane returned them first, so match by URL.
    expect(out.items).toHaveLength(2);
    const bun = out.items.find((i) => i.url.includes('/r/bun/'))!;
    const hair = out.items.find((i) => i.url.includes('/r/hair/'))!;
    expect(bun).toMatchObject({ relevance: 0.95, ageHours: 72, snippet: 'runtime' });
    expect(bun.engines.sort()).toEqual(['duckduckgo', 'google', 'reddit', 'yandex']);
    expect(hair).toMatchObject({ relevance: 0.05, ageHours: 24 });
    expect(hair.engines.sort()).toEqual(['duckduckgo', 'google', 'yandex']);
    expect(out.lanes.find((l) => l.engine === 'reddit')).toMatchObject({ stale: 1 });
    // Intent plus one relevance request: the three lanes returned the same two URLs.
    expect(calls.filter((c) => c.url.endsWith('/v1/systemone'))).toHaveLength(2);
    expect(out.tokens).toBe(200);
    expect(out.judge).toBe('laya');
    expect(out.checkpoint).toBe('english');
  });

  it('respects explicit window and sources', async () => {
    stubFetch();
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA },
      { request: 'Bun 1.3', window: '24h', sources: ['google', 'duckduckgo', 'github'] }
    );
    expect(out.window).toBe('24h');
    expect(out.sources).toEqual(['google', 'duckduckgo', 'github']);
    // 4 lanes + 1 speculative google call (dropped: the window is 24h).
    const searches = calls.filter((c) => c.url.endsWith('/search'));
    expect(searches).toHaveLength(5);
    const web = searches.filter((c) => ['google', 'duckduckgo'].includes(String(c.body.search_service)) && (c.body.include_sites as string[]).length === 0 && 'time_range' in c.body);
    const gh = searches.filter((c) => (c.body.include_sites as string[])[0] === 'github.com' || c.body.search_service === 'github');
    expect(web.map((c) => c.body.search_service).sort()).toEqual(['duckduckgo', 'google']);
    expect(web[0]!.body).toMatchObject({ time_range: 'day', exclude_sites: [] });
    expect(gh.map((c) => c.body.search_service).sort()).toEqual(['github', 'google']);
  });

  it('searches Hacker News through Google site and the native news endpoint only', async () => {
    stubFetch([{ title: 'SQLite discussion', link: 'https://news.ycombinator.com/item?id=1', snippet: 'SQLite' }]);
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA },
      { request: 'SQLite', sources: ['hackernews'], window: '30d' }
    );
    const searches = calls.filter((c) => c.url.endsWith('/search') || c.url.endsWith('/news'));
    expect(searches).toHaveLength(2);
    expect(searches.find((c) => c.url.endsWith('/news'))!.body).toMatchObject({
      search_service: 'hackernews', time_range: 'month', include_sites: [], exclude_sites: [],
    });
    expect(searches.find((c) => c.url.endsWith('/search'))!.body).toMatchObject({
      search_service: 'google', include_sites: ['news.ycombinator.com'],
    });
    expect(out.sources).toEqual(['hackernews']);
    expect(out.items[0]!.engines.sort()).toEqual(['google', 'hackernews']);
  });

  it('uses the vertical engine for vertical sources', async () => {
    stubFetch();
    await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA },
      { request: 'LLM agents', sources: ['arxiv'] }
    );
    const searches = calls.filter((c) => c.url.endsWith('/search') && c.body.search_service === 'arxiv');
    expect(searches[0]!.body).toMatchObject({ search_service: 'arxiv', include_sites: [], exclude_sites: [] });
  });

  it('sends no time filter for Any time, and never to engines that reject it', async () => {
    stubFetch();
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA },
      { request: 'Oppenheimer', window: 'any', sources: ['google', 'imdb'] }
    );
    const searches = calls.filter((c) => c.url.endsWith('/search'));
    expect(searches.every((c) => !('time_range' in c.body))).toBe(true);
    // Any time + words unchanged: the speculative google call is the google lane.
    expect(searches.filter((c) => c.body.search_service === 'google')).toHaveLength(1);
    // Any time: the stale row is kept and freshness is flat.
    expect(out.items.every((i) => i.freshness === 0.5)).toBe(true);

    calls.length = 0;
    await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA },
      { request: 'Oppenheimer', window: '7d', sources: ['google', 'imdb'] }
    );
    const again = calls.filter((c) => c.url.endsWith('/search'));
    expect(again.filter((c) => c.body.search_service === 'imdb').every((c) => !('time_range' in c.body))).toBe(true);
    // The google lane carries the window; the speculative call (no window) is dropped.
    expect(again.filter((c) => c.body.search_service === 'google' && 'time_range' in c.body).map((c) => c.body.time_range)).toEqual(['week']);
  });

  it('keeps going when one source fails', async () => {
    stubFetch();
    const original = globalThis.fetch as ReturnType<typeof vi.fn>;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { include_sites?: string[]; search_service?: string };
      if (String(input).endsWith('/search') && (body.include_sites?.[0] === 'github.com' || body.search_service === 'github')) {
        return new Response('upstream broke', { status: 502 });
      }
      return original(input, init);
    }));
    const out = await runSearch(
      { search1api: { apiKey: 's1' }, judge: LAYA },
      { request: 'Bun 1.3', sources: ['reddit', 'github'] }
    );
    expect(out.errors.map((e) => e.engine).sort()).toEqual(['github', 'google']);
    expect(out.errors.every((e) => e.source === 'github' && e.message === 'upstream broke')).toBe(true);
    expect(out.totalMs).toBeGreaterThanOrEqual(0);
    // "Bun 1.3" has no time words, so the stub's past-week window is ignored and the old row stays.
    expect(out.items.map((i) => i.source)).toEqual(['reddit', 'reddit', 'reddit']);
  });
  it('leaves rows unranked and flags the lane when Laya cannot score them', async () => {
    stubFetch([{ title: 'Bun discussion', link: 'https://reddit.com/r/bun/1', snippet: 'Bun runtime' }]);
    const original = globalThis.fetch as ReturnType<typeof vi.fn>;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { questions?: Record<string, unknown> };
      if (String(input).endsWith('/v1/systemone') && body.questions && 'r0' in body.questions) {
        return new Response('{}', { status: 500 });
      }
      return original(input, init);
    }));
    const out = await runSearch({ search1api: { apiKey: 's1' }, judge: LAYA }, { request: 'Bun', sources: ['reddit'], window: 'any' });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ ranked: false, relevance: 0 });
    // The lane that asked reports the failure; the lane that shared the URL just stays unranked.
    expect(out.errors.map((e) => e.message)).toEqual(['laya: Laya is temporarily unavailable. Please try again shortly.']);
  });
});
