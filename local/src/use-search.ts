import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindowId } from '@/lib/sources';
import type { AskLayaState } from '@/lib/use-ask-laya';
import { askRows, mergeHits, readRequest, scoreRows, type Judge, type LocalIntent, type Row } from './pipeline';
import { placeById, type Hit, type PlaceId } from './sources';

export interface Lane {
  count: number;
  error?: string;
  ms: number;
}

export interface SearchState {
  phase: 'idle' | 'reading' | 'searching' | 'scoring' | 'done' | 'error';
  intent: LocalIntent | null;
  lanes: Partial<Record<PlaceId, Lane>>;
  rows: Row[];
  /** Time Laya spent scoring this page, when it did. */
  scoreMs: number | null;
  totalMs: number | null;
  message: string | null;
}

const IDLE: SearchState = { phase: 'idle', intent: null, lanes: {}, rows: [], scoreMs: null, totalMs: null, message: null };
const PLACE_TIMEOUT_MS = 10_000;

export function useSearch(
  request: string,
  override: { places?: PlaceId[]; window?: WindowId },
  judge: Judge,
  /** Changes when Laya arrives on the device, so the page is read again with it. */
  judgeVersion: string
): SearchState {
  const [state, setState] = useState<SearchState>(request.trim() ? { ...IDLE, phase: 'reading' } : IDLE);
  const key = JSON.stringify([request, override, judgeVersion]);

  useEffect(() => {
    const q = request.trim();
    if (!q) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    const live = () => !controller.signal.aborted;
    const started = performance.now();
    setState({ ...IDLE, phase: 'reading' });

    (async () => {
      try {
        const intent = await readRequest(q, judge, override);
        if (!live()) return;
        setState((s) => ({ ...s, phase: 'searching', intent }));

        const found: Partial<Record<PlaceId, Hit[]>> = {};
        await Promise.all(
          intent.places.map(async (id) => {
            const t0 = performance.now();
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PLACE_TIMEOUT_MS)]);
            try {
              found[id] = await placeById(id).search(intent.query, intent.window, signal);
              if (!live()) return;
              const rows = mergeHits(found);
              setState((s) => ({ ...s, rows, lanes: { ...s.lanes, [id]: { count: found[id]!.length, ms: Math.round(performance.now() - t0) } } }));
            } catch (error) {
              if (!live()) return;
              const message = error instanceof Error ? error.message : String(error);
              setState((s) => ({ ...s, lanes: { ...s.lanes, [id]: { count: 0, error: message, ms: Math.round(performance.now() - t0) } } }));
            }
          })
        );
        if (!live()) return;

        const rows = mergeHits(found);
        if (judge.ready && rows.length > 0) {
          setState((s) => ({ ...s, rows, phase: 'scoring' }));
          const t0 = performance.now();
          await scoreRows(q, rows, judge, (scores) => {
            if (!live()) return;
            setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id in scores ? { ...r, score: scores[r.id] } : r)) }));
          });
          if (!live()) return;
          setState((s) => ({ ...s, phase: 'done', scoreMs: Math.round(performance.now() - t0), totalMs: Math.round(performance.now() - started) }));
        } else {
          setState((s) => ({ ...s, rows, phase: 'done', totalMs: Math.round(performance.now() - started) }));
        }
      } catch (error) {
        if (!live()) return;
        setState((s) => ({ ...s, phase: 'error', message: error instanceof Error ? error.message : String(error) }));
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** Ask Laya, run on the device: same state shape as the server app's hook, so the same panel renders it. */
export function useLocalAsk(request: string, judge: Judge) {
  const [state, setState] = useState<AskLayaState>({ status: 'idle', question: '', answers: {}, ms: null, message: null });
  const run = useRef(0);

  useEffect(() => {
    run.current += 1;
    setState({ status: 'idle', question: '', answers: {}, ms: null, message: null });
  }, [request]);

  const ask = useCallback(
    async (question: string, rows: Row[]) => {
      const q = question.trim();
      if (!q || rows.length === 0 || !judge.ready) return;
      const mine = ++run.current;
      const started = performance.now();
      setState((s) => ({ status: 'asking', question: q, answers: s.question === q ? s.answers : {}, ms: null, message: null }));
      try {
        const { by } = await askRows(request, q, rows, judge, (answers) => {
          if (run.current === mine) setState((s) => ({ ...s, answers: { ...s.answers, ...answers } }));
        });
        if (run.current === mine) setState((s) => ({ ...s, status: 'done', by, ms: Math.round(performance.now() - started) }));
      } catch (error) {
        if (run.current === mine) setState((s) => ({ ...s, status: 'error', message: error instanceof Error ? error.message : String(error) }));
      }
    },
    [request, judge]
  );

  const clear = useCallback(() => {
    run.current += 1;
    setState({ status: 'idle', question: '', answers: {}, ms: null, message: null });
  }, []);

  return { state, ask, clear };
}
