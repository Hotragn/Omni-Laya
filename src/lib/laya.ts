/**
 * Minimal Laya client plus the two judgments this app needs.
 *
 * Laya (https://github.com/NandhaKishorM/laya, weights at
 * https://huggingface.co/convaiinnovations/laya) is a non-autoregressive
 * decision model: it answers typed `choice`, `score` and `noul` questions
 * about a state in one forward pass and generates no text. Its `laya-serve`
 * command exposes the model over HTTP on `POST /v1/systemone`, so every
 * provider here speaks that one protocol. Providers differ only in where the
 * server runs and how it is authenticated:
 * - `laya`: a `laya-serve` you run yourself (laptop, VM, container). The
 *   bearer key is optional because `laya-serve` only checks one when
 *   `LAYA_API_KEY` is set on the server.
 * - `huggingface`: a Hugging Face Inference Endpoint running the same
 *   `laya-serve` container. The Hugging Face token is the bearer key.
 * The first provider is primary; the others are tried in order when it is
 * unreachable, throttled or failing.
 */
import { PLACES, SOURCES, WINDOWS, isWindowId, type SourceId, type WindowId } from './sources';

export type ProviderId = 'laya' | 'huggingface';

export type ProviderConfig =
  | { provider: 'laya'; baseUrl: string; apiKey?: string; model?: string }
  | { provider: 'huggingface'; baseUrl: string; apiKey: string; model?: string };

export interface JudgeConfig {
  /** Ordered: the first provider is primary, the rest are fallbacks. */
  providers: ProviderConfig[];
}

type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
};
type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};
type Question = NoulQuestion | ChoiceQuestion;

type NoulAnswer = { type: 'noul'; noul: number };
type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  /**
   * Laya reports 1 minus normalised entropy here, not a rescaled top
   * probability, so a confidence threshold from another model does not carry over.
   */
  confidence: number;
};
type Answer = NoulAnswer | ChoiceAnswer;

export interface SystemOneResponse {
  model: string;
  /** Which provider produced the answers. */
  provider: ProviderId;
  /** Laya checkpoint the server's router picked (`english`, `multilingual`, `typed-decisions`), when reported. */
  checkpoint?: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class LayaError extends Error {
  status: number;
  provider: ProviderId;
  constructor(status: number, message: string, provider: ProviderId = 'laya') {
    super(message);
    this.name = 'LayaError';
    this.status = status;
    this.provider = provider;
  }
}

function failureMessage(status: number): string {
  // Server error bodies are implementation details and may contain request data.
  if (status >= 500) return 'Laya is temporarily unavailable. Please try again shortly.';
  if (status === 429) return 'Laya is receiving too many requests. Please try again shortly.';
  return `Laya could not process this request (HTTP ${status}).`;
}

/** `laya-serve` path, appended to a provider's base URL. */
export const SYSTEMONE_PATH = '/v1/systemone';

export function systemOneUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}${SYSTEMONE_PATH}`;
}

interface LayaNativeResponse {
  model?: string;
  answers?: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  routing?: { model?: string; repo?: string; reason?: string };
}

async function callProvider(
  config: ProviderConfig,
  state: unknown,
  questions: Record<string, Question>,
  signal?: AbortSignal
): Promise<SystemOneResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let response: Response;
  try {
    response = await fetch(systemOneUrl(config.baseUrl), {
      method: 'POST',
      headers,
      // No `model` lets laya-serve pick the checkpoint from the script and language of the state.
      body: JSON.stringify({ state, questions, ...(config.model ? { model: config.model } : {}) }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // A self-hosted server that is down refuses the connection instead of answering 5xx.
    // Treat that as an outage so the next provider gets a turn.
    console.warn(`[laya] ${config.provider} is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    throw new LayaError(503, failureMessage(503), config.provider);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new LayaError(response.status, failureMessage(response.status), config.provider);
  }
  const body = (await response.json()) as LayaNativeResponse | null;
  const checkpoint = body?.routing?.model;
  return {
    model: body?.model ?? config.model ?? 'laya',
    provider: config.provider,
    ...(checkpoint ? { checkpoint } : {}),
    answers: body?.answers ?? {},
    usage: {
      input_tokens: body?.usage?.input_tokens ?? 0,
      output_tokens: body?.usage?.output_tokens ?? 0,
    },
  };
}

/** Failures worth retrying elsewhere: unreachable, throttled, or the server is failing. */
export function isProviderOutage(error: unknown): boolean {
  return error instanceof LayaError && (error.status === 429 || error.status >= 500);
}

/** Asks the provider chain; each fallback is tried once, in order, for outages only. */
export async function systemOne(
  config: JudgeConfig,
  state: unknown,
  questions: Record<string, Question>,
  signal?: AbortSignal
): Promise<SystemOneResponse> {
  if (config.providers.length === 0) throw new Error('No Laya provider is configured');
  for (let index = 0; ; index++) {
    const provider = config.providers[index]!;
    try {
      return await callProvider(provider, state, questions, signal);
    } catch (error) {
      const next = config.providers[index + 1];
      if (!next || !isProviderOutage(error) || signal?.aborted) throw error;
      const failed = error as LayaError;
      console.warn(`[laya] ${failed.provider} returned HTTP ${failed.status}; retrying with ${next.provider}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Judgment 1: what does the request ask for?
// ---------------------------------------------------------------------------

export interface Intent {
  window: { choice: WindowId; confidence: number };
  /** Share of Laya's "where" choice that went to each source's place; the web engines share one value. */
  sources: Record<SourceId, number>;
  /** Index into the candidates array; chosen by rule, see candidates.ts. */
  query: { index: number; confidence: number };
  /** Candidate that is just the name or title being asked about, for catalogue engines. */
  entity: { index: number; confidence: number };
  usage: SystemOneResponse['usage'];
  /** Which provider answered. */
  provider: ProviderId;
  /** Laya checkpoint that read the request, when the server reports it. */
  checkpoint?: string;
}

/**
 * Two choice questions in one request: how recent, and where to search.
 * The query rewrite is not asked (see candidates.ts); the caller passes the
 * indices it chose so the intent still records them.
 */
export async function inferIntent(
  config: JudgeConfig,
  input: { request: string; query: number; entity: number },
  signal?: AbortSignal
): Promise<Intent> {
  const windowCriteria: Record<string, string> = {};
  for (const w of WINDOWS) windowCriteria[w.id] = w.description;
  const placeCriteria: Record<string, string> = {};
  for (const p of PLACES) placeCriteria[p.id] = p.label;

  const questions: Record<string, Question> = {
    window: {
      type: 'choice',
      instructions: 'How recent should the results be?',
      criteria: windowCriteria,
    },
    where: {
      type: 'choice',
      instructions: 'Where should this request be searched?',
      criteria: placeCriteria,
    },
  };
  // No date in the state: Laya reads "this month" or "today" from the words and does no date
  // arithmetic, and adding one pushed "recently" from the past week to the past day.
  const state = { request: input.request };

  const res = await systemOne(config, state, questions, signal);

  const windowAnswer = res.answers.window;
  const window =
    windowAnswer?.type === 'choice' && isWindowId(windowAnswer.choice)
      ? { choice: windowAnswer.choice, confidence: windowAnswer.confidence }
      : { choice: 'any' as const, confidence: 0 };

  const whereAnswer = res.answers.where;
  const place = whereAnswer?.type === 'choice' ? whereAnswer.probabilities : {};
  const sources = {} as Record<SourceId, number>;
  for (const s of SOURCES) sources[s.id] = place[s.place] ?? 0;

  return {
    window,
    sources,
    query: { index: input.query, confidence: 1 },
    entity: { index: input.entity, confidence: 1 },
    usage: res.usage,
    provider: res.provider,
    ...(res.checkpoint ? { checkpoint: res.checkpoint } : {}),
  };
}

// ---------------------------------------------------------------------------
// Judgment 2: is each result about what was asked?
// ---------------------------------------------------------------------------

export interface RerankInput {
  id: string;
  source: string;
  title: string;
  snippet: string;
}

/**
 * Laya reads a question's instructions and options in a head budget of 192
 * tokens (256 on the multilingual checkpoint) and the state in the rest of
 * its window. Title and snippet are clipped so the question never overflows
 * the head.
 */
const TITLE_CHARS = 160;
const SNIPPET_CHARS = 280;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The relevance question for one result. The result goes in the question and
 * the request is the shared state: on labelled pairs this separated on-topic
 * from off-topic results far better than putting the result in the state
 * (AUC 1.00 against 0.70 with the result in the state), and one request
 * covers a whole lane.
 */
export function relevanceQuestion(item: Pick<RerankInput, 'title' | 'snippet'>): NoulQuestion {
  const snippet = clip(item.snippet, SNIPPET_CHARS);
  return {
    type: 'noul',
    instructions: `Is this search result about the request? Title: ${clip(item.title, TITLE_CHARS)}${snippet ? ` Snippet: ${snippet}` : ''}`,
  };
}

/** `laya-serve` accepts up to 64 questions per request; a lane has at most 8 results. */
const RERANK_BATCH = 32;

/** A reader's own yes/no question, clipped so it fits the head with its two options. */
export const ASK_CHARS = 160;
const ASK_SNIPPET_CHARS = 400;

/**
 * A reader's own question about a result is asked the other way round from
 * relevance: the result is the state and the question is the question.
 * Measured on 133 live results across six questions (Laya multilingual, fp16,
 * 2026-10-02): AUC 0.77 and 72% accuracy at 0.5 this way, against AUC 0.53 and
 * 34% with the result written into the question. Contextual calibration
 * against an empty result made both worse, so it is not used.
 */
export function readerState(item: { title: string; snippet: string; from?: string }): string {
  const snippet = clip(`${item.from ? `From ${item.from}. ` : ''}${item.snippet}`, ASK_SNIPPET_CHARS);
  return `Title: ${clip(item.title, TITLE_CHARS)}\nSnippet: ${snippet}`;
}

export function readerAsk(question: string): NoulQuestion {
  return { type: 'noul', instructions: clip(question, ASK_CHARS).replace(/[?\s]*$/, '?') };
}

/** Where a result came from, for `readerState`: its host name. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** How many single-result requests are in flight at once; laya-serve queues the rest. */
const ASK_PARALLEL = 8;

/** Asks the reader's question about every item, one state per item; returns Laya's yes probability per item id. */
export async function askAbout(
  config: JudgeConfig,
  question: string,
  items: (RerankInput & { url?: string })[],
  signal?: AbortSignal
): Promise<{ answers: Record<string, number>; checkpoint?: string }> {
  const answers: Record<string, number> = {};
  let checkpoint: string | undefined;
  const ask = readerAsk(question);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      const res = await systemOne(config, readerState({ title: item.title, snippet: item.snippet, from: hostOf(item.url) }), { a: ask }, signal);
      checkpoint ??= res.checkpoint;
      const a = res.answers.a;
      answers[item.id] = a?.type === 'noul' ? a.noul : 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(ASK_PARALLEL, items.length) }, worker));
  return { answers, ...(checkpoint ? { checkpoint } : {}) };
}

export async function rerank(
  config: JudgeConfig,
  request: string,
  items: RerankInput[],
  signal?: AbortSignal
): Promise<{ relevance: Record<string, number>; usage: SystemOneResponse['usage'] }> {
  const relevance: Record<string, number> = {};
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (items.length === 0) return { relevance, usage };

  const batches: RerankInput[][] = [];
  for (let i = 0; i < items.length; i += RERANK_BATCH) {
    batches.push(items.slice(i, i + RERANK_BATCH));
  }

  const responses = await Promise.all(
    batches.map((batch) => {
      const questions: Record<string, Question> = {};
      batch.forEach((item, i) => {
        questions[`r${i}`] = relevanceQuestion(item);
      });
      return systemOne(config, { request }, questions, signal);
    })
  );

  responses.forEach((res, b) => {
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    batches[b]!.forEach((item, i) => {
      const a = res.answers[`r${i}`];
      relevance[item.id] = a?.type === 'noul' ? a.noul : 0;
    });
  });

  return { relevance, usage };
}
