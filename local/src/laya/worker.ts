/// <reference lib="webworker" />
/**
 * Laya runs here, off the main thread, so scrolling and typing stay smooth
 * while the model reads. Messages in: `load`, `decide`. Messages out:
 * `progress`, `ready`, `result`, `error`.
 */
import { LayaRuntime, type Question } from './runtime';

export type WorkerRequest =
  | { type: 'load'; device?: 'webgpu' | 'wasm' }
  | { type: 'decide'; id: number; state: string; questions: Question[] }
  | { type: 'decideMany'; id: number; pairs: { state: string; question: Question }[] };

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string; dtype: string; ms: number }
  | { type: 'result'; id: number; probabilities: number[][]; ms: number }
  | { type: 'error'; id?: number; message: string };

let runtime: Promise<LayaRuntime> | null = null;
const post = (message: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'load') {
    const started = performance.now();
    runtime ??= LayaRuntime.load((p) => post({ type: 'progress', loaded: p.loaded, total: p.total }), { device: message.device });
    try {
      const r = await runtime;
      post({ type: 'ready', device: r.device, dtype: r.dtype, ms: Math.round(performance.now() - started) });
    } catch (error) {
      runtime = null;
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === 'decide' || message.type === 'decideMany') {
    const started = performance.now();
    try {
      if (!runtime) throw new Error('Laya is not loaded on this device yet.');
      const r = await runtime;
      const probabilities =
        message.type === 'decide' ? await r.decide(message.state, message.questions) : await r.decideMany(message.pairs);
      post({ type: 'result', id: message.id, probabilities, ms: Math.round(performance.now() - started) });
    } catch (error) {
      post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
};
