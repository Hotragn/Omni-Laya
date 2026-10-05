import { useCallback, useEffect, useRef, useState } from 'react';
import type { RankedItem } from './rank';

export interface AskLayaState {
  status: 'idle' | 'asking' | 'done' | 'error';
  /** The question the answers belong to. */
  question: string;
  /** Laya's yes probability per result id. */
  answers: Record<string, number>;
  ms: number | null;
  message: string | null;
}

/** Results asked about per question: the ones above the cutting floor, best first. */
export const ASK_LIMIT = 24;
/** Results per request; about 5 s on a laptop CPU, well inside the server's 20 s budget. */
export const ASK_BATCH = 8;

const IDLE: AskLayaState = { status: 'idle', question: '', answers: {}, ms: null, message: null };

/** POST /api/judge for the reader's own yes/no question. Cleared when the search changes. */
export function useAskLaya(request: string) {
  const [state, setState] = useState<AskLayaState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    setState(IDLE);
  }, [request]);
  useEffect(() => () => controller.current?.abort(), []);

  const ask = useCallback(
    async (question: string, items: RankedItem[]) => {
      const q = question.trim();
      if (!q || items.length === 0) return;
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      const started = Date.now();
      setState((s) => ({ status: 'asking', question: q, answers: s.question === q ? s.answers : {}, ms: null, message: null }));
      // Batches, one after another: on a CPU laya-serve each takes a few seconds, and the
      // margin fills in batch by batch instead of waiting for the whole page.
      const list = items.slice(0, ASK_LIMIT);
      try {
        for (let i = 0; i < list.length; i += ASK_BATCH) {
          const batch = list.slice(i, i + ASK_BATCH);
          const response = await fetch('/api/judge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              q: request,
              question: q,
              items: batch.map((item) => ({ id: item.id, title: item.title, snippet: item.snippet, url: item.url })),
            }),
            signal: current.signal,
          });
          const body = (await response.json().catch(() => ({}))) as { answers?: Record<string, number>; error?: string };
          if (current.signal.aborted) return;
          if (!response.ok || !body.answers) {
            setState((s) => ({ ...s, status: 'error', message: body.error ?? `HTTP ${response.status}` }));
            return;
          }
          const last = i + ASK_BATCH >= list.length;
          setState((s) => ({
            ...s,
            status: last ? 'done' : 'asking',
            answers: { ...s.answers, ...body.answers },
            ms: last ? Date.now() - started : null,
          }));
        }
      } catch (error) {
        if (current.signal.aborted) return;
        setState((s) => ({ ...s, status: 'error', message: (error as Error).message }));
      }
    },
    [request]
  );

  const clear = useCallback(() => {
    controller.current?.abort();
    setState(IDLE);
  }, []);

  return { state, ask, clear };
}
