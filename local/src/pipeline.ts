/**
 * The search, run entirely in the reader's browser.
 *
 * 1. Read the request. With Laya on the device: one call with two choice
 *    questions (how recent, where to search), the same wording and the same
 *    pick rule as the server app. Without it: the places the request names,
 *    else the open web and Wikipedia.
 * 2. Search the chosen places in parallel, straight from the browser.
 * 3. With Laya: score every result with the relevance question the server
 *    uses (the result in the question, the request as the state).
 */
import { candidateRoles, mentionsTime } from '@/lib/candidates';
import { readerAsk, readerState, relevanceQuestion } from '@/lib/laya';
import { canonicalUrl } from '@/lib/rank';
import { DEFAULT_WINDOW, PLACE_PICK, WINDOWS, type WindowId } from '@/lib/sources';
import type { Question } from './laya/runtime';
import { DEFAULT_PLACES, PLACE_WORDS, PLACES, placeById, type Hit, type PlaceId } from './sources';

export interface Judge {
  readonly ready: boolean;
  decide(state: string, questions: Question[], onPart?: (from: number, part: number[][]) => void): Promise<number[][]>;
  decideMany(pairs: { state: string; question: Question }[], onPart?: (from: number, part: number[][]) => void): Promise<number[][]>;
}

export interface LocalIntent {
  request: string;
  /** Keywords sent to the places. */
  query: string;
  places: PlaceId[];
  window: WindowId;
  /** Who chose places and window. */
  by: 'laya' | 'rules';
  /** Laya's "where" probability per place, when Laya chose. */
  shares: Partial<Record<PlaceId, number>>;
  /** What Laya (or the rules) chose before the reader changed anything. */
  chosen: { places: PlaceId[]; window: WindowId };
  ms: number;
}

/** The state exactly as laya-serve sees `{ request }`: Python's json.dumps(state, ensure_ascii=False). */
export function stateText(request: string): string {
  return `{"request": ${JSON.stringify(request)}}`;
}

/** Keyword query: the server's rule (time, source and filler words removed) plus this app's place names. */
export function keywords(request: string): string {
  const roles = candidateRoles(request);
  const stripped = (roles.candidates[roles.query] ?? request).replace(PLACE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return stripped || request.trim();
}

/** Time window by rule, for when Laya is not on the device. */
export function windowByRule(request: string): WindowId {
  if (!mentionsTime(request)) return DEFAULT_WINDOW;
  if (/\b(today|24\s*hours?|tonight|yesterday|right\s+now)\b|今天|今日|昨天/i.test(request)) return '24h';
  if (/\b(week|few\s+days|days?)\b|本周|这周|上周/i.test(request)) return '7d';
  if (/\b(month|weeks)\b|本月|这个月/i.test(request)) return '30d';
  return '7d';
}

/** Same three outcomes as the server's pickSources, over this app's places. */
export function pickPlaces(shares: Partial<Record<PlaceId, number>>, request: string): PlaceId[] {
  const platforms = PLACES.filter((p) => p.id !== 'web' && (shares[p.id] ?? 0) >= PLACE_PICK).map((p) => p.id);
  if (platforms.length === 0) return [...DEFAULT_PLACES];
  const allNamed = platforms.every((id) => placeById(id).named.test(request));
  const withWeb = !allNamed || (shares.web ?? 0) >= PLACE_PICK;
  return PLACES.map((p) => p.id).filter((id) => platforms.includes(id) || (withWeb && id === 'web'));
}

export function placesByRule(request: string): PlaceId[] {
  const named = PLACES.filter((p) => p.id !== 'web' && p.named.test(request)).map((p) => p.id);
  return named.length > 0 ? named : [...DEFAULT_PLACES];
}

export async function readRequest(
  request: string,
  judge: Judge,
  override: { places?: PlaceId[]; window?: WindowId } = {}
): Promise<LocalIntent> {
  const started = performance.now();
  const query = keywords(request);
  let chosen: LocalIntent['chosen'];
  let shares: LocalIntent['shares'] = {};
  let by: LocalIntent['by'] = 'rules';

  if (judge.ready) {
    const [windowP, whereP] = await judge.decide(stateText(request), [
      {
        type: 'choice',
        instructions: 'How recent should the results be?',
        options: WINDOWS.map((w) => w.id),
        descriptions: Object.fromEntries(WINDOWS.map((w) => [w.id, w.description])),
      },
      {
        type: 'choice',
        instructions: 'Where should this request be searched?',
        options: PLACES.map((p) => p.id),
        descriptions: Object.fromEntries(PLACES.map((p) => [p.id, p.option])),
      },
    ]);
    shares = Object.fromEntries(PLACES.map((p, i) => [p.id, whereP![i] ?? 0]));
    const best = WINDOWS[windowP!.indexOf(Math.max(...windowP!))]!.id;
    // As on the server: Laya's window only counts when the request mentions time.
    chosen = { places: pickPlaces(shares, request), window: mentionsTime(request) ? best : DEFAULT_WINDOW };
    by = 'laya';
  } else {
    chosen = { places: placesByRule(request), window: windowByRule(request) };
  }

  return {
    request,
    query,
    places: override.places?.length ? override.places : chosen.places,
    window: override.window ?? chosen.window,
    by,
    shares,
    chosen,
    ms: Math.round(performance.now() - started),
  };
}

export interface Row extends Hit {
  /** Every place that returned this URL. */
  places: PlaceId[];
  /** Laya's probability that the result is about the request; undefined until scored. */
  score?: number;
}

/** Fold hits from all places by URL; the first place to return a URL keeps the row. */
export function mergeHits(lanes: Partial<Record<PlaceId, Hit[]>>): Row[] {
  const byUrl = new Map<string, Row>();
  for (const place of PLACES) {
    for (const hit of lanes[place.id] ?? []) {
      const key = canonicalUrl(hit.url);
      const existing = byUrl.get(key);
      if (existing) existing.places.push(hit.place);
      else byUrl.set(key, { ...hit, places: [hit.place] });
    }
  }
  return [...byUrl.values()];
}

/**
 * Scored rows by score (ties by engine rank); unscored rows after them,
 * interleaved by rank so no single place floods the top.
 */
export function orderRows(rows: Row[]): Row[] {
  const scored = rows.filter((r) => r.score !== undefined).sort((a, b) => b.score! - a.score! || a.position - b.position);
  const unscored = rows.filter((r) => r.score === undefined).sort((a, b) => a.position - b.position);
  return [...scored, ...unscored];
}

/** Relevance for every row, a pass at a time; `onScores` sees each pass. */
export async function scoreRows(
  request: string,
  rows: Row[],
  judge: Judge,
  onScores: (scores: Record<string, number>) => void
): Promise<void> {
  const questions = rows.map((r) => relevanceQuestion({ title: r.title, snippet: r.snippet }));
  await judge.decide(stateText(request), questions, (from, part) => {
    const scores: Record<string, number> = {};
    part.forEach((p, i) => {
      scores[rows[from + i]!.id] = p[1] ?? 0;
    });
    onScores(scores);
  });
}

/** What Laya reads about a row for a reader question: the row as the state, with where it came from. */
export function rowState(row: Row): string {
  let host = '';
  try {
    host = new URL(row.url).hostname.replace(/^www\./, '');
  } catch {
    /* keep it empty */
  }
  return readerState({ title: row.title, snippet: row.snippet, from: [placeById(row.place).label, host].filter(Boolean).join(', ') });
}

/** The reader's own yes/no question about the rows: each row is the state (see readerState in src/lib/laya.ts). */
export async function askRows(
  _request: string,
  question: string,
  rows: Row[],
  judge: Judge,
  onAnswers: (answers: Record<string, number>) => void
): Promise<void> {
  const ask = readerAsk(question);
  await judge.decideMany(rows.map((r) => ({ state: rowState(r), question: ask })), (from, part) => {
    const answers: Record<string, number> = {};
    part.forEach((p, i) => {
      answers[rows[from + i]!.id] = p[1] ?? 0;
    });
    onAnswers(answers);
  });
}
