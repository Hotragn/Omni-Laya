import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSearch } from '@/lib/pipeline';
import { searchConfig } from '@/lib/search-config';
import { normaliseDate, searxngEngine, searxngSearch } from '@/lib/searxng';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(handler: (url: URL, init?: RequestInit) => Response) {
  const calls: { url: URL; headers: Headers }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return handler(url, init);
  }));
  return calls;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('searxngSearch', () => {
  it('asks one engine with the site restriction in the query and the bearer key', async () => {
    const calls = stub(() => json({
      results: [
        { url: 'https://reddit.com/r/bun/1', title: 'Bun &amp; Node', content: 'fast', publishedDate: '2026-09-20T10:00:00' },
        { url: 'https://reddit.com/r/bun/2', title: 'No date', content: null, publishedDate: null },
        { title: 'missing url' },
      ],
    }));
    const rows = await searxngSearch(
      { baseUrl: 'https://search.example/', apiKey: 'k' },
      { query: 'Bun 1.3', service: 'google', timeRange: 'week', includeSites: ['reddit.com'], maxResults: 8 }
    );
    expect(calls[0]!.url.pathname).toBe('/search');
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      q: 'Bun 1.3 site:reddit.com', format: 'json', engines: 'google', safesearch: '0', time_range: 'week',
    });
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer k');
    expect(rows).toEqual([
      { title: 'Bun & Node', link: 'https://reddit.com/r/bun/1', snippet: 'fast', published_date: '2026-09-20T10:00:00Z' },
      { title: 'No date', link: 'https://reddit.com/r/bun/2', snippet: '' },
    ]);
  });

  it('sends no time filter or key when none is set, and caps the rows', async () => {
    const calls = stub(() => json({ results: Array.from({ length: 20 }, (_, i) => ({ url: `https://a.com/${i}`, title: `t${i}` })) }));
    const rows = await searxngSearch({ baseUrl: 'http://127.0.0.1:8080' }, { query: 'x', service: 'wechat', maxResults: 8 });
    expect(calls[0]!.url.searchParams.has('time_range')).toBe(false);
    expect(calls[0]!.url.searchParams.get('engines')).toBe('sogou wechat');
    expect(calls[0]!.headers.has('authorization')).toBe(false);
    expect(rows).toHaveLength(8);
  });

  it('turns a Wikipedia infobox into a row', async () => {
    stub(() => json({
      results: [],
      infoboxes: [
        { infobox: 'Transistor', id: 'https://en.wikipedia.org/wiki/Transistor', content: 'A semiconductor device.' },
        { infobox: 'No link', id: 'transistor', content: '' },
      ],
    }));
    expect(await searxngSearch({ baseUrl: 'http://s' }, { query: 'transistor', service: 'wikipedia' })).toEqual([
      { title: 'Transistor', link: 'https://en.wikipedia.org/wiki/Transistor', snippet: 'A semiconductor device.' },
    ]);
  });

  it('reports engines SearXNG does not have instead of calling it', async () => {
    const calls = stub(() => json({}));
    await expect(searxngSearch({ baseUrl: 'http://s' }, { query: 'x', service: 'x' })).rejects.toThrow(/x is not available/);
    await expect(searxngSearch({ baseUrl: 'http://s' }, { query: 'x', service: 'reddit' })).rejects.toThrow(/reddit is not available/);
    expect(calls).toHaveLength(0);
  });

  it('turns an HTTP failure into a lane error without the body', async () => {
    stub(() => new Response('secret details', { status: 401 }));
    await expect(searxngSearch({ baseUrl: 'http://s' }, { query: 'x' })).rejects.toThrow('search backend answered HTTP 401');
  });
});

describe('helpers', () => {
  it.each([
    ['2026-09-20', '2026-09-20'],
    ['2026-09-20T10:00:00', '2026-09-20T10:00:00Z'],
    ['2026-09-20T10:00:00.123+02:00', '2026-09-20T08:00:00Z'],
    ['not a date', undefined],
    [null, undefined],
  ])('normalises %s', (input, output) => {
    expect(normaliseDate(input)).toBe(output);
  });

  it('maps the services OmniLaya uses', () => {
    expect(searxngEngine(undefined)).toBe('google');
    expect(searxngEngine('hackernews')).toBe('hackernews');
    expect(searxngEngine('x')).toBeUndefined();
  });
});

describe('searchConfig', () => {
  it('uses Search1API by default', () => {
    expect(searchConfig({ SEARCH1API_API_KEY: 's1' })).toEqual({ search1api: { apiKey: 's1', baseUrl: undefined } });
    expect(() => searchConfig({})).toThrow(/SEARCH1API_API_KEY is not set/);
  });

  it('switches to SearXNG and needs its URL', () => {
    expect(searchConfig({ SEARCH_PROVIDER: ' SearXNG ', SEARXNG_BASE_URL: 'https://s.example', SEARXNG_API_KEY: 'k' }))
      .toEqual({ searxng: { baseUrl: 'https://s.example', apiKey: 'k' } });
    expect(() => searchConfig({ SEARCH_PROVIDER: 'searxng' })).toThrow(/needs SEARXNG_BASE_URL/);
  });

  it('rejects an unknown provider', () => {
    expect(() => searchConfig({ SEARCH_PROVIDER: 'bing', SEARCH1API_API_KEY: 's1' })).toThrow(/unknown/);
  });
});

describe('pipeline on SearXNG', () => {
  it('runs every lane through SearXNG and marks X as unavailable', async () => {
    stub((url) => {
      if (url.pathname.endsWith('/v1/systemone')) {
        return json({ answers: { window: { type: 'choice', choice: 'any', probabilities: { any: 1 }, confidence: 1 }, r0: { type: 'noul', noul: 0.8 } } });
      }
      return json({ results: [{ url: `https://a.com/${url.searchParams.get('engines')}`, title: 'Bun' }] });
    });
    const out = await runSearch(
      { searxng: { baseUrl: 'http://search.test' }, judge: { providers: [{ provider: 'laya', baseUrl: 'http://laya.test' }] } },
      { request: 'Bun', sources: ['google', 'x'], window: 'any' }
    );
    expect(out.items.map((i) => i.url)).toEqual(['https://a.com/google']);
    expect(out.errors).toEqual([{ source: 'x', engine: 'x', message: 'x is not available on this search backend' }]);
  });
});
