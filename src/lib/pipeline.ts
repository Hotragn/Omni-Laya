import { cachedSearch, type ResultCache } from './cache';
import { candidateRoles, mentionsTime } from './candidates';
import { judgmentCache } from './judgment-cache';
import { freshnessScore, isPublicationStale, resolvePublication, stripAgePrefix } from './freshness';
import { mergeItems } from './merge';
import { canonicalUrl, type RankedItem } from './rank';
import { search, type RawResult, type Search1ApiConfig, type SearchParams } from './search1api';
import { searxngSearch, type SearxngConfig } from './searxng';
import {
  DEFAULT_WINDOW,
  pickSources,
  sourceById,
  windowById,
  type Lane,
  type SourceId,
  type WindowId,
} from './sources';
import { inferIntent, rerank, type Intent, type JudgeConfig, type ProviderId } from './laya';

export interface SearchInput {
  request: string;
  /** Explicit user choice; undefined lets the judge decide. */
  window?: WindowId;
  /** Explicit user choice; undefined lets the judge decide. */
  sources?: SourceId[];
}

export interface LaneError {
  source: SourceId;
  engine: string;
  message: string;
}

export interface IntentEvent {
  type: 'intent';
  request: string;
  /** Keyword query actually sent to the engines. */
  query: string;
  /** Name-or-title query sent to catalogue engines such as IMDb. */
  entityQuery: string;
  candidates: string[];
  window: WindowId;
  sources: SourceId[];
  inferred: {
    window: Intent['window'];
    sources: Intent['sources'];
    query: Intent['query'];
    entity: Intent['entity'];
  };
  intentMs: number;
  /** Laya provider that interpreted the request. */
  judge: ProviderId;
  /** Laya checkpoint that read the request (`english`, `multilingual`), when the server reports it. */
  checkpoint?: string;
}

/** An engine has answered; the UI shows its count while the judge scores its rows. */
export interface FoundEvent {
  type: 'found';
  source: SourceId;
  engine: string;
  items: RankedItem[];
  searchMs: number;
}

export interface LaneEvent {
  type: 'lane';
  source: SourceId;
  engine: string;
  /** Scored results from this engine; empty when it failed. */
  items: RankedItem[];
  /** Rows the engine returned but which were provably older than the window. */
  stale: number;
  /** Engine round trip. */
  searchMs: number;
  /** Judge round trip for this lane's rows. */
  scoreMs: number;
  error?: string;
}

export interface DoneEvent {
  type: 'done';
  totalMs: number;
  tokens: number;
}

export type AskEvent = IntentEvent | FoundEvent | LaneEvent | DoneEvent;

const RESULTS_PER_LANE = 8;
/** Engines apply time filters loosely; drop anything provably older than this multiple of the window. */
const WINDOW_TOLERANCE = 1.5;

export interface PipelineDeps {
  /** Search backend: Search1API, or a self-hosted SearXNG when `searxng` is set. */
  search1api?: Search1ApiConfig;
  searxng?: SearxngConfig;
  /** Laya providers, primary first. */
  judge: JudgeConfig;
  /** Optional KV-like store; lanes are cached by query, engine and window. */
  cache?: ResultCache;
  now?: () => Date;
}

/**
 * The whole search as a stream of events: first what the judge understood
 * (so the UI can show chips immediately), then every engine lane as soon as
 * it has answered and its rows are scored, then a summary. Lanes of one
 * source are not waited on together: the client folds them by URL.
 */
export async function* askStream(
  deps: PipelineDeps,
  input: SearchInput,
  signal?: AbortSignal
): AsyncGenerator<AskEvent> {
  const started = performance.now();
  const now = deps.now ? deps.now() : new Date();
  const request = input.request.trim();
  const roles = candidateRoles(request);
  const { candidates } = roles;
  const query = candidates[roles.query] ?? candidates[0]!;
  const entityQuery = candidates[roles.entity] ?? query;

  const runSearch = (params: SearchParams) =>
    cachedSearch(deps.cache, params, () =>
      deps.searxng ? searxngSearch(deps.searxng, params, signal) : search(deps.search1api!, params, signal));

  // 0. Speculate: Google with the final query, fired alongside Laya. The query
  //    is chosen by rule, so only the window can make this call unusable:
  //    it is reused when Laya wants no time window and Google is searched.
  const speculative: SearchParams = { query, service: 'google', maxResults: RESULTS_PER_LANE };
  const speculativePromise = input.sources && !input.sources.includes('google')
    ? null
    : runSearch(speculative).catch(() => null);

  // 1. Understand the request, or reuse Laya's reading of the same request.
  const judged = await judgmentCache(deps.cache, deps.judge, request);
  const [cachedIntent, cachedScores] = await Promise.all([judged.intent(), judged.scores()]);
  const intent = cachedIntent
    ? { ...cachedIntent, query: { index: roles.query, confidence: 1 }, entity: { index: roles.entity, confidence: 1 }, usage: { input_tokens: 0, output_tokens: 0 } }
    : await inferIntent(deps.judge, { request, query: roles.query, entity: roles.entity }, signal);
  if (!cachedIntent) void judged.saveIntent(intent);
  const intentMs = Math.round(performance.now() - started);

  // A window Laya picks only counts when the request has a time phrase; an explicit choice always counts.
  const window = input.window ?? (mentionsTime(request) ? intent.window.choice : DEFAULT_WINDOW) ?? DEFAULT_WINDOW;
  // Direct callers can bypass HTTP validation; never start a lane twice.
  const sources: SourceId[] = input.sources && input.sources.length > 0
    ? [...new Set(input.sources)]
    : pickSources(intent.sources, request);
  const win = windowById(window);
  const maxAge = win.hours * WINDOW_TOLERANCE;
  let tokens = intent.usage.input_tokens;

  yield {
    type: 'intent',
    request,
    query,
    entityQuery,
    candidates,
    window,
    sources,
    inferred: { window: intent.window, sources: intent.sources, query: intent.query, entity: intent.entity },
    intentMs,
    judge: intent.provider,
    ...(intent.checkpoint ? { checkpoint: intent.checkpoint } : {}),
  };

  // 2. Every lane searches, filters by age, and gets scored on its own. The
  //    'found' event goes out between the two steps so the page can show the
  //    rows before they are ordered.
  const found: FoundEvent[] = [];
  let wake: (() => void) | null = null;
  const announce = (event: FoundEvent) => {
    found.push(event);
    wake?.();
  };
  /** Laya's score for each URL in this search, shared by every lane that returns it. */
  const scoreByUrl = new Map<string, Promise<number | undefined>>();
  // Scores from an earlier run of the same request answer without asking Laya again.
  for (const [url, score] of cachedScores) scoreByUrl.set(url, Promise.resolve(score));
  let newScores = 0;
  const runLane = async (source: SourceId, lane: Lane): Promise<LaneEvent> => {
    const t0 = performance.now();
    const params: SearchParams = {
      query: lane.entityQuery ? entityQuery : query,
      service: lane.service,
      timeRange: lane.timeFilter === false ? undefined : win.timeRange,
      maxResults: RESULTS_PER_LANE,
      includeSites: lane.site ? [lane.site] : [],
    };
    const sameAsSpeculative =
      speculativePromise !== null &&
      params.service === speculative.service &&
      params.query === speculative.query &&
      params.timeRange === undefined &&
      params.includeSites!.length === 0;
    let raw: RawResult[];
    try {
      const got = sameAsSpeculative ? await speculativePromise : null;
      raw = got ? got.results : (await runSearch(params)).results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'lane',
        source,
        engine: lane.service,
        items: [],
        stale: 0,
        searchMs: Math.round(performance.now() - t0),
        scoreMs: 0,
        error: message,
      };
    }
    const searchMs = Math.round(performance.now() - t0);

    const items: RankedItem[] = [];
    let stale = 0;
    raw.forEach((row, index) => {
      const publication = resolvePublication(row.published_date, row.snippet, now.getTime());
      const { ageHours } = publication;
      if (isPublicationStale(publication, maxAge)) {
        stale += 1; // maxAge is Infinity for 'any'
        return;
      }
      items.push({
        id: `${source}:${lane.service}:${index + 1}`,
        source,
        title: row.title,
        url: row.link,
        snippet: stripAgePrefix(row.snippet),
        ...publication,
        relevance: 0,
        ranked: false,
        freshness: freshnessScore(ageHours, win.hours),
        position: index + 1,
        engines: [lane.service],
        sources: [source],
      });
    });
    if (items.length > 0) {
      announce({ type: 'found', source, engine: lane.service, items: items.map((it) => ({ ...it })), searchMs });
    }

    // 3. Laya judges each of this lane's rows against the original request.
    //    A URL another lane already sent is not asked again: laya-serve runs
    //    one forward pass at a time, so repeats only lengthen the queue.
    const t1 = performance.now();
    let error: string | undefined;
    const fresh: RankedItem[] = [];
    const settle = new Map<string, (score: number | undefined) => void>();
    const pending = items.map((item) => {
      const key = canonicalUrl(item.url);
      const known = scoreByUrl.get(key);
      if (known) return known;
      const score = new Promise<number | undefined>((resolve) => settle.set(key, resolve));
      scoreByUrl.set(key, score);
      fresh.push(item);
      return score;
    });
    if (fresh.length > 0) {
      try {
        const scored = await rerank(
          deps.judge,
          request,
          fresh.map((it) => ({ id: it.id, source: it.source, title: it.title, snippet: it.snippet })),
          signal
        );
        tokens += scored.usage.input_tokens;
        for (const item of fresh) settle.get(canonicalUrl(item.url))?.(scored.relevance[item.id] ?? 0);
        newScores += fresh.length;
      } catch (err) {
        error = `laya: ${err instanceof Error ? err.message : String(err)}`;
        for (const resolve of settle.values()) resolve(undefined);
      }
    }
    const scores = await Promise.all(pending);
    items.forEach((item, i) => {
      const score = scores[i];
      if (score === undefined) return; // Laya could not score it; the row stays unranked.
      item.relevance = score;
      item.ranked = true;
    });
    return {
      type: 'lane',
      source,
      engine: lane.service,
      items,
      stale,
      searchMs,
      scoreMs: Math.round(performance.now() - t1),
      ...(error ? { error } : {}),
    };
  };

  const inFlight = new Map<string, Promise<{ key: string; event: LaneEvent }>>();
  for (const source of sources) {
    for (const lane of sourceById(source).lanes) {
      const key = `${source}/${lane.service}`;
      inFlight.set(key, runLane(source, lane).then((event) => ({ key, event })));
    }
  }
  while (inFlight.size > 0) {
    // Wake on whichever comes first: an engine answering, or a lane fully scored.
    const wakeup = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const next = await Promise.race([Promise.race(inFlight.values()), wakeup]);
    wake = null;
    while (found.length > 0) yield found.shift()!;
    if (next) {
      const { key, event } = next;
      inFlight.delete(key);
      yield event;
    }
  }

  // Keep what Laya judged this time for the next run of the same request.
  if (newScores > 0) {
    const all = new Map<string, number>();
    for (const [url, score] of scoreByUrl) {
      const value = await score;
      if (value !== undefined) all.set(url, value);
    }
    await judged.saveScores(all);
  }

  yield { type: 'done', totalMs: Math.round(performance.now() - started), tokens };
}

// ---------------------------------------------------------------------------
// Non-streaming convenience for tests and scripts.
// ---------------------------------------------------------------------------

export interface SearchOutput extends Omit<IntentEvent, 'type'> {
  /** Lanes folded by URL, in source order then engine rank. */
  items: RankedItem[];
  lanes: LaneEvent[];
  errors: LaneError[];
  totalMs: number;
  tokens: number;
}

export async function runSearch(
  deps: PipelineDeps,
  input: SearchInput,
  signal?: AbortSignal
): Promise<SearchOutput> {
  let intent: IntentEvent | undefined;
  let items: RankedItem[] = [];
  const lanes: LaneEvent[] = [];
  const errors: LaneError[] = [];
  let totalMs = 0;
  let tokens = 0;
  for await (const event of askStream(deps, input, signal)) {
    if (event.type === 'intent') intent = event;
    else if (event.type === 'found') continue;
    else if (event.type === 'lane') {
      lanes.push(event);
      items = mergeItems(items, event.items);
      if (event.error) errors.push({ source: event.source, engine: event.engine, message: event.error });
    } else {
      totalMs = event.totalMs;
      tokens = event.tokens;
    }
  }
  if (!intent) throw new Error('stream ended without intent');
  const { type: _type, ...rest } = intent;
  const order = new Map(intent.sources.map((s, i) => [s, i]));
  items.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0) || a.position - b.position);
  return { ...rest, items, lanes, errors, totalMs, tokens };
}
