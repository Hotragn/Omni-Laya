/**
 * Ask Laya evaluation, run in a browser with Laya loaded (dev server only;
 * the app never imports this file). Fetches live results from mixed places,
 * labels them by where they came from, and compares ways of asking a reader
 * question. In the browser console on the dev server:
 *
 *   const m = await import('/src/dev/ask-eval.ts'); await m.run();
 */
import { readerAsk, readerState } from '@/lib/laya';
import type { Question } from '../laya/runtime';
import { laya } from '../laya/client';
import { askRows, mergeHits, stateText, type Row } from '../pipeline';
import { placeById, type Hit, type PlaceId } from '../sources';

export interface Case {
  query: string;
  places: PlaceId[];
  question: string;
  label: (row: Row) => boolean;
}

export const CASES: Case[] = [
  { query: 'debounce function javascript', places: ['web', 'packages'], question: 'Is this an npm package?', label: (r) => r.place === 'packages' },
  { query: 'javascript closures', places: ['web', 'stackoverflow'], question: 'Is this a question someone asked on a forum?', label: (r) => r.place === 'stackoverflow' },
  { query: 'speculative decoding', places: ['web', 'papers', 'github'], question: 'Is this a research paper?', label: (r) => r.place === 'papers' },
  { query: 'rust async runtime', places: ['web', 'github', 'hackernews'], question: 'Is this a code repository?', label: (r) => r.place === 'github' },
  { query: 'python asyncio', places: ['web', 'wikipedia', 'stackoverflow'], question: 'Is this an encyclopedia article?', label: (r) => r.place === 'wikipedia' },
  { query: 'sorting algorithms', places: ['web', 'books', 'wikipedia'], question: 'Is this a book?', label: (r) => r.place === 'books' },
];

/** Probability that a random positive outranks a random negative. */
export function auc(scores: number[], labels: boolean[]): number {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export function accuracy(scores: number[], labels: boolean[], threshold = 0.5): number {
  return scores.filter((s, i) => s >= threshold === labels[i]).length / scores.length;
}

async function ready(): Promise<void> {
  laya.load();
  await new Promise<void>((resolve, reject) => {
    const stop = laya.subscribe((s) => {
      if (s.phase === 'ready') {
        queueMicrotask(() => stop());
        resolve();
      }
      if (s.phase === 'failed') reject(new Error(s.message));
    });
  });
}

const yes = (p: number[][]) => p.map((x) => x[1] ?? 0);

export async function rowsFor(c: Case): Promise<Row[]> {
  const found: Partial<Record<PlaceId, Hit[]>> = {};
  await Promise.all(c.places.map(async (id) => (found[id] = await placeById(id).search(c.query, 'any', AbortSignal.timeout(15_000)).catch(() => []))));
  return mergeHits(found);
}

const oldQuestion = (q: string, r: Row): Question => ({
  type: 'noul',
  instructions: `${readerAsk(q).instructions} Title: ${r.title}${r.snippet ? ` Snippet: ${r.snippet}` : ''}`,
});

/** Every method's yes probability for each row. */
export async function score(c: Case, rows: Row[]): Promise<Record<string, number[]>> {
  // Before: the row written into the question, the request as the state.
  const before = yes(await laya.decide(stateText(c.query), rows.map((r) => oldQuestion(c.question, r))));
  // Shipped: the app's own code path (each row as the state, batched on the GPU).
  const shipped: number[] = new Array(rows.length).fill(0);
  const ids = new Map(rows.map((r, i) => [r.id, i]));
  await askRows(c.query, c.question, rows, laya, (answers) => {
    for (const [id, p] of Object.entries(answers)) shipped[ids.get(id)!] = p;
  });
  // Shipped without the "From ..." source hint, to see what the hint is worth.
  const noHint = yes(
    await laya.decideMany(rows.map((r) => ({ state: readerState({ title: r.title, snippet: r.snippet }), question: readerAsk(c.question) })))
  );
  return { before, shipped, 'shipped, no source hint': noHint };
}

export async function run() {
  await ready();
  const report: Record<string, unknown>[] = [];
  const pooled: Record<string, { s: number[]; l: boolean[] }> = {};
  const timings: number[] = [];
  for (const c of CASES) {
    const rows = await rowsFor(c);
    const labels = rows.map(c.label);
    const t0 = performance.now();
    const methods = await score(c, rows);
    timings.push(Math.round(performance.now() - t0));
    const line: Record<string, unknown> = { question: c.question, n: rows.length, positives: labels.filter(Boolean).length };
    for (const [name, s] of Object.entries(methods)) {
      line[name] = `auc ${auc(s, labels).toFixed(2)} acc ${accuracy(s, labels).toFixed(2)}`;
      (pooled[name] ??= { s: [], l: [] }).s.push(...s);
      pooled[name]!.l.push(...labels);
    }
    report.push(line);
    // Progress survives a crashed tab, and short polls can read it.
    try {
      localStorage.setItem('ask-eval', JSON.stringify({ report, pooled }));
    } catch {
      /* fine */
    }
  }
  const summary = Object.fromEntries(
    Object.entries(pooled).map(([name, { s, l }]) => [name, `auc ${auc(s, l).toFixed(2)} acc ${accuracy(s, l).toFixed(2)}`])
  );
  return { report, summary, msPerQuestionAllMethods: timings };
}
