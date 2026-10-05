import type { ResultCache } from '@/lib/cache';
import { judgmentCache } from '@/lib/judgment-cache';
import { LayaError, askAbout, type JudgeConfig } from '@/lib/laya';
import { validateJudgeRequest } from '@/lib/validate';
import { clientKey, json, sameOrigin } from './http';

export interface JudgeDeps {
  judge: JudgeConfig;
  cache?: ResultCache;
  limiter?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Per request; a CPU laya-serve answers a batch of 8 in about 5 s. */
  timeoutMs?: number;
}

/**
 * POST /api/judge: the reader's own yes/no question about results on screen.
 * Body `{ q, question, items: [{ id, title, snippet, url? }] }`; answers
 * `{ answers: { [id]: yes probability }, ms, cached, checkpoint? }`.
 * Answers are cached per request, question and result URL, so asking again
 * (or another reader asking the same thing) skips Laya.
 */
export async function handleJudge(request: Request, deps: JudgeDeps): Promise<Response> {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden' });

  let data: ReturnType<typeof validateJudgeRequest>;
  try {
    data = validateJudgeRequest(await request.json());
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Bad request' });
  }

  if (deps.limiter) {
    const { success } = await deps.limiter.limit({ key: clientKey(request) });
    if (!success) return json(429, { error: 'Too many requests from this address. Try again in a minute.' });
  }

  const started = Date.now();
  const store = await judgmentCache(deps.cache, deps.judge, data.q);
  const known = await store.answers(data.question);
  const answers: Record<string, number> = {};
  const missing = data.items.filter((item) => {
    const hit = item.url ? known.get(item.url) : undefined;
    if (hit === undefined) return true;
    answers[item.id] = hit;
    return false;
  });

  let checkpoint: string | undefined;
  if (missing.length > 0) {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.timeoutMs ?? 20_000)]);
    try {
      const fresh = await askAbout(deps.judge, data.question, missing.map((item) => ({ ...item, source: '' })), signal);
      checkpoint = fresh.checkpoint;
      Object.assign(answers, fresh.answers);
      for (const item of missing) {
        const value = fresh.answers[item.id];
        if (item.url && value !== undefined) known.set(item.url, value);
      }
      await store.saveAnswers(data.question, known);
    } catch (error) {
      const status = error instanceof LayaError && (error.status >= 500 || error.status === 429) ? error.status : 502;
      const message = error instanceof Error ? error.message : 'Laya could not answer';
      console.error('[judge] failed', message);
      return json(status, { error: message });
    }
  }

  return json(200, {
    answers,
    ms: Date.now() - started,
    cached: data.items.length - missing.length,
    ...(checkpoint ? { checkpoint } : {}),
  });
}
