import { decodeEntities, LANE_TIMEOUT_MS, Search1ApiError, type RawResult, type SearchParams } from './search1api';

/**
 * A self-hosted SearXNG instance as a free alternative to Search1API. It
 * answers the same lanes with the same result shape, so the rest of the
 * pipeline does not know which one ran. `deploy/server` runs one behind Caddy,
 * which checks the bearer key; SearXNG itself has no authentication.
 */
export interface SearxngConfig {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Search1API service names mapped to SearXNG engine names. Reddit and X have
 * no SearXNG engine: Reddit still gets its site-restricted Google lane, and an
 * X lane reports that it cannot search.
 */
const ENGINES: Record<string, string> = {
  google: 'google',
  duckduckgo: 'duckduckgo',
  yandex: 'yandex',
  hackernews: 'hackernews',
  github: 'github',
  arxiv: 'arxiv',
  youtube: 'youtube',
  wikipedia: 'wikipedia',
  imdb: 'imdb',
  wechat: 'sogou wechat',
};

export function searxngEngine(service: string | undefined): string | undefined {
  return ENGINES[service ?? 'google'];
}

/** SearXNG dates come in several shapes; keep the two the pipeline accepts. */
export function normaliseDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ts = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(ts)) return undefined;
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface SearxngInfobox {
  infobox?: unknown;
  id?: unknown;
  content?: unknown;
}

interface SearxngResult {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  publishedDate?: unknown;
}

export async function searxngSearch(
  config: SearxngConfig,
  params: SearchParams,
  signal?: AbortSignal
): Promise<RawResult[]> {
  const engine = searxngEngine(params.service);
  if (!engine) throw new Search1ApiError(501, `${params.service} is not available on this search backend`);

  const sites = params.includeSites ?? [];
  const excluded = params.excludeSites ?? [];
  const query = [params.query, ...sites.map((s) => `site:${s}`), ...excluded.map((s) => `-site:${s}`)].join(' ');
  const url = new URL(`${config.baseUrl.trim().replace(/\/+$/, '')}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('engines', engine);
  url.searchParams.set('safesearch', '0');
  if (params.timeRange) url.searchParams.set('time_range', params.timeRange);

  const timeout = AbortSignal.timeout(LANE_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Search1ApiError(response.status, `search backend answered HTTP ${response.status}`);
  }
  const body = (await response.json()) as { results?: unknown; infoboxes?: unknown };
  const results = Array.isArray(body.results) ? (body.results as SearxngResult[]) : [];
  // The Wikipedia engine answers with an infobox (title in `infobox`, link in `id`), not a result.
  const infoboxes = (Array.isArray(body.infoboxes) ? (body.infoboxes as SearxngInfobox[]) : [])
    .filter((b) => typeof b?.id === 'string' && /^https?:\/\//.test(b.id) && typeof b.infobox === 'string')
    .map((b): SearxngResult => ({ url: b.id, title: b.infobox, content: b.content }));
  return [...infoboxes, ...results]
    .filter((r) => typeof r?.url === 'string' && typeof r?.title === 'string')
    .slice(0, params.maxResults ?? 8)
    .map((r) => {
      const published = normaliseDate(r.publishedDate);
      return {
        title: decodeEntities(r.title as string),
        link: r.url as string,
        snippet: decodeEntities(typeof r.content === 'string' ? r.content : ''),
        ...(published ? { published_date: published } : {}),
      };
    });
}
