import type { ResultCache } from './cache';
import type { Intent, JudgeConfig } from './laya';

/**
 * Remembers Laya's judgments so a repeated search skips the model. Laya gives
 * the same answer for the same input and checkpoint, so its reading of a
 * request and its score for each result URL can be reused.
 *
 * Two entries per search, not one per result: Cloudflare KV's free plan allows
 * 1,000 writes a day, and a write per result would use that up in a few dozen
 * searches. One entry holds the intent, the other a map of URL to score.
 */

/** Bump when a Laya question's wording changes, so old judgments are not reused. */
const VERSION = 'j1';
/** Same lifetime as the longest engine-result cache entry. */
const TTL_SECONDS = 6 * 60 * 60;

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A pinned checkpoint changes the answers; automatic routing is one setting. */
function judgeFingerprint(judge: JudgeConfig): string {
  return judge.providers.map((p) => p.model ?? 'auto').join(',');
}

export interface JudgmentCache {
  intent(): Promise<Intent | null>;
  saveIntent(intent: Intent): Promise<void>;
  scores(): Promise<Map<string, number>>;
  saveScores(scores: Map<string, number>): Promise<void>;
  /** The reader's own question: Laya's yes probability per result URL. One entry per question. */
  answers(question: string): Promise<Map<string, number>>;
  saveAnswers(question: string, answers: Map<string, number>): Promise<void>;
}

/** No cache configured: every call is a miss and every save is dropped. */
const NONE: JudgmentCache = {
  intent: async () => null,
  saveIntent: async () => undefined,
  scores: async () => new Map(),
  saveScores: async () => undefined,
  answers: async () => new Map(),
  saveAnswers: async () => undefined,
};

export async function judgmentCache(
  cache: ResultCache | undefined,
  judge: JudgeConfig,
  request: string
): Promise<JudgmentCache> {
  if (!cache) return NONE;
  const normalised = request.trim().replace(/\s+/g, ' ').toLowerCase();
  const id = await digest(`${judgeFingerprint(judge)}|${normalised}`);
  const intentKey = `${VERSION}|intent|${id}`;
  const scoresKey = `${VERSION}|scores|${id}`;
  const answersKey = async (question: string) =>
    `${VERSION}|answers|${id}|${await digest(question.trim().replace(/\s+/g, ' ').toLowerCase())}`;

  // A broken cache must never break a search: every failure reads as a miss.
  const read = async <T>(key: string): Promise<T | null> => {
    try {
      const hit = await cache.get(key);
      return hit ? (JSON.parse(hit) as T) : null;
    } catch {
      return null;
    }
  };
  const write = async (key: string, value: unknown) => {
    await cache.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS }).catch(() => undefined);
  };

  return {
    intent: () => read<Intent>(intentKey),
    saveIntent: (intent) => write(intentKey, intent),
    scores: async () => new Map(Object.entries((await read<Record<string, number>>(scoresKey)) ?? {})),
    saveScores: (scores) => write(scoresKey, Object.fromEntries(scores)),
    answers: async (question) =>
      new Map(Object.entries((await read<Record<string, number>>(await answersKey(question))) ?? {})),
    saveAnswers: async (question, answers) => write(await answersKey(question), Object.fromEntries(answers)),
  };
}
