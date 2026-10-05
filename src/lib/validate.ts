import { SOURCE_IDS, isSourceId, isWindowId, type SourceId, type WindowId } from './sources';

export interface AskRequest {
  q: string;
  w?: WindowId;
  s?: SourceId[];
}

export interface JudgeRequest {
  q: string;
  question: string;
  items: { id: string; title: string; snippet: string; url?: string }[];
}

/** Ask Laya about the results on screen: one page of results at most. */
export const JUDGE_MAX_ITEMS = 64;

export function validateJudgeRequest(input: unknown): JudgeRequest {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid input');
  const { q, question, items } = input as Record<string, unknown>;
  if (typeof q !== 'string' || q.trim().length === 0 || q.length > 300) {
    throw new Error('q must be a non-empty string up to 300 characters');
  }
  if (typeof question !== 'string' || question.trim().length < 3 || question.length > 200) {
    throw new Error('question must be 3 to 200 characters');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > JUDGE_MAX_ITEMS) {
    throw new Error(`items must hold 1 to ${JUDGE_MAX_ITEMS} results`);
  }
  const out = items.map((raw) => {
    const { id, title, snippet, url } = (raw ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 200 || typeof title !== 'string') {
      throw new Error('each item needs an id and a title');
    }
    return {
      id,
      title: title.slice(0, 400),
      snippet: typeof snippet === 'string' ? snippet.slice(0, 1000) : '',
      ...(typeof url === 'string' && url.length <= 2000 ? { url } : {}),
    };
  });
  return { q: q.trim(), question: question.trim(), items: out };
}

export function validateAskRequest(input: unknown): AskRequest {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid input');
  }
  const { q, w, s } = input as Record<string, unknown>;
  if (typeof q !== 'string' || q.trim().length === 0 || q.length > 300) {
    throw new Error('q must be a non-empty string up to 300 characters');
  }
  const out: AskRequest = { q: q.trim() };
  if (typeof w === 'string' && isWindowId(w)) out.w = w;
  if (Array.isArray(s)) {
    // Bound the raw list before filtering so duplicates and invalid entries count too.
    if (s.length > SOURCE_IDS.length) {
      throw new Error(`s must contain at most ${SOURCE_IDS.length} entries`);
    }
    const ids = [...new Set(s.filter((v): v is SourceId => typeof v === 'string' && isSourceId(v)))];
    if (ids.length > 0) out.s = ids;
  }
  return out;
}
