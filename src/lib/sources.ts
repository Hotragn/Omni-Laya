export type SourceId =
  | 'google'
  | 'duckduckgo'
  | 'yandex'
  | 'hackernews'
  | 'reddit'
  | 'github'
  | 'x'
  | 'arxiv'
  | 'youtube'
  | 'wikipedia'
  | 'imdb'
  | 'wechat';

/**
 * One Search1API `/search` or `/news` call. `service` is the engine; `site` restricts a
 * general engine with `include_sites`. A source runs all of its lanes in
 * parallel and merges them, so one engine going down or drifting does not
 * take the source with it, and a hit on two engines outranks a hit on one.
 *
 * Probed 2026-09-17 with site restriction + weekly window: google and
 * duckduckgo honour both and prefix snippets with an age ("3 days ago ...");
 * yahoo ignores the window, bing ignores the site, baidu returns nothing.
 */
export interface Lane {
  service: string;
  site?: string;
  /** False for engines that reject or ignore `time_range` (wikipedia, imdb, wechat). */
  timeFilter?: boolean;
  /** True for catalogue engines that want a name or title, not a sentence (imdb). */
  entityQuery?: boolean;
}

/**
 * Options of Laya's "where should this be searched" choice. Laya answers one
 * choice question far more decisively than a yes/no question per source: on
 * named or implied platforms the chosen option gets 0.9 or more, and a
 * general question spreads its probability thinly, which reads as "use the
 * open web". The three web engines share the `web` option.
 */
export type PlaceId = 'web' | 'hackernews' | 'reddit' | 'github' | 'x' | 'arxiv' | 'wikipedia' | 'imdb' | 'wechat' | 'youtube';

export const PLACES: readonly { id: PlaceId; label: string }[] = [
  { id: 'web', label: 'the open web: news, articles, blogs, docs' },
  { id: 'hackernews', label: 'Hacker News threads' },
  { id: 'reddit', label: 'Reddit threads' },
  { id: 'github', label: 'GitHub code repositories' },
  { id: 'x', label: 'posts on X (Twitter)' },
  { id: 'arxiv', label: 'arXiv research papers' },
  { id: 'wikipedia', label: 'Wikipedia encyclopedia articles' },
  { id: 'imdb', label: 'IMDb films and TV' },
  { id: 'wechat', label: 'WeChat Chinese articles' },
  { id: 'youtube', label: 'YouTube videos' },
];

export interface Source {
  id: SourceId;
  label: string;
  lanes: Lane[];
  /** The option of Laya's "where" choice that selects this source. */
  place: PlaceId;
  /** Searched when the request does not single out any source. */
  defaultOn: boolean;
}

export const SOURCES: readonly Source[] = [
  { id: 'google', label: 'Google', lanes: [{ service: 'google' }], place: 'web', defaultOn: true },
  { id: 'duckduckgo', label: 'DuckDuckGo', lanes: [{ service: 'duckduckgo' }], place: 'web', defaultOn: true },
  { id: 'yandex', label: 'Yandex', lanes: [{ service: 'yandex' }], place: 'web', defaultOn: true },
  {
    id: 'hackernews',
    label: 'Hacker News',
    lanes: [{ service: 'google', site: 'news.ycombinator.com' }, { service: 'hackernews' }],
    place: 'hackernews',
    defaultOn: false,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    lanes: [{ service: 'google', site: 'reddit.com' }, { service: 'reddit' }],
    place: 'reddit',
    defaultOn: false,
  },
  {
    id: 'github',
    label: 'GitHub',
    lanes: [{ service: 'google', site: 'github.com' }, { service: 'github' }],
    place: 'github',
    defaultOn: false,
  },
  { id: 'x', label: 'X', lanes: [{ service: 'x' }], place: 'x', defaultOn: false },
  { id: 'arxiv', label: 'arXiv', lanes: [{ service: 'arxiv' }], place: 'arxiv', defaultOn: false },
  { id: 'wikipedia', label: 'Wikipedia', lanes: [{ service: 'wikipedia', timeFilter: false }], place: 'wikipedia', defaultOn: false },
  { id: 'imdb', label: 'IMDb', lanes: [{ service: 'imdb', timeFilter: false, entityQuery: true }], place: 'imdb', defaultOn: false },
  { id: 'wechat', label: 'WeChat', lanes: [{ service: 'wechat', timeFilter: false }], place: 'wechat', defaultOn: false },
  { id: 'youtube', label: 'YouTube', lanes: [{ service: 'youtube' }], place: 'youtube', defaultOn: false },
];

export const DEFAULT_SOURCE_IDS = SOURCES.filter((s) => s.defaultOn).map((s) => s.id);

export const SOURCE_IDS = SOURCES.map((s) => s.id) as readonly SourceId[];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

/** A place needs at least this share of Laya's "where" choice to be searched. */
export const PLACE_PICK = 0.35;

/**
 * How a request names each platform outright. A named platform is searched on
 * its own, as Jev Search does ("on Hacker News" searches Hacker News only);
 * a platform Laya infers without a name ("new papers" means arXiv) is searched
 * together with the open web.
 */
const NAMED: Partial<Record<SourceId, RegExp>> = {
  hackernews: /\b(hacker\s*news|hn)\b/i,
  reddit: /\b(reddit|subreddits?)\b|(^|\s)r\/\w+/i,
  github: /\bgithub\b/i,
  x: /\b(twitter|tweets?|x\.com)\b|推特/i,
  arxiv: /\barxiv\b/i,
  wikipedia: /\b(wikipedia|wiki)\b|维基/i,
  imdb: /\bimdb\b/i,
  wechat: /\bwechat\b|微信|公众号/i,
  youtube: /\b(youtube|yt)\b/i,
};

export function namesSource(request: string, id: SourceId): boolean {
  return NAMED[id]?.test(request) ?? false;
}

/**
 * Sources to search from the probability Laya gave each source's place, the
 * same three outcomes Jev Search shows:
 * - Laya chose platforms and the request names every one of them: search only
 *   those platforms.
 * - Laya chose platforms the request only implies: search the open web too.
 * - No platform clears `PLACE_PICK`: the default web engines answer.
 * The open web clearing the bar on its own also brings the web engines in.
 */
export function pickSources(probability: Record<SourceId, number>, request = ''): SourceId[] {
  const platforms = SOURCES.filter((s) => s.place !== 'web' && probability[s.id] >= PLACE_PICK).map((s) => s.id);
  if (platforms.length === 0) return [...DEFAULT_SOURCE_IDS];
  const allNamed = platforms.every((id) => namesSource(request, id));
  const withWeb = !allNamed || probability.google >= PLACE_PICK;
  const wanted = new Set<SourceId>([...(withWeb ? DEFAULT_SOURCE_IDS : []), ...platforms]);
  return SOURCE_IDS.filter((id) => wanted.has(id));
}

export function sourceById(id: SourceId): Source {
  const found = SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown source: ${id}`);
  return found;
}

export type WindowId = 'any' | '24h' | '7d' | '30d';

export interface Window {
  id: WindowId;
  label: string;
  /** Infinity for no limit. */
  hours: number;
  /** Search1API `time_range` value; undefined sends no filter. */
  timeRange?: 'day' | 'week' | 'month';
  /** Option text for Laya's window choice. */
  description: string;
}

export const WINDOWS: readonly Window[] = [
  {
    id: 'any',
    label: 'Any time',
    hours: Number.POSITIVE_INFINITY,
    description: 'no time mentioned, any date is fine',
  },
  {
    id: '24h',
    label: 'Past 24 hours',
    hours: 24,
    timeRange: 'day',
    description: 'today or the last 24 hours',
  },
  {
    id: '7d',
    label: 'Past week',
    hours: 24 * 7,
    timeRange: 'week',
    description: 'this week or the last few days',
  },
  {
    id: '30d',
    label: 'Past month',
    hours: 24 * 30,
    timeRange: 'month',
    description: 'this month or the last few weeks',
  },
];

export const DEFAULT_WINDOW: WindowId = 'any';

export function isWindowId(value: string): value is WindowId {
  return WINDOWS.some((w) => w.id === value);
}

export function windowById(id: WindowId): Window {
  const found = WINDOWS.find((w) => w.id === id);
  if (!found) throw new Error(`Unknown window: ${id}`);
  return found;
}
