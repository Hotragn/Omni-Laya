import type { Question } from './runtime';
import type { WorkerRequest, WorkerResponse } from './worker';

export type LayaStatus =
  | { phase: 'absent' }
  | { phase: 'loading'; loaded: number; total: number }
  | { phase: 'ready'; device: string; dtype: string; ms: number }
  | { phase: 'failed'; message: string };

/** Omit that keeps each member of a union apart. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Decisions in one call share a forward pass; more than this splits so the margin fills as it goes. */
const MAX_PER_PASS = 12;

/**
 * The page's handle on Laya. One worker per tab; decide() calls queue in the
 * worker, so two searches never fight over the GPU.
 */
export class LayaClient {
  private worker: Worker | null = null;
  private next = 0;
  private waiting = new Map<number, { resolve: (p: number[][]) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(s: LayaStatus) => void>();
  status: LayaStatus = { phase: 'absent' };

  subscribe(listener: (s: LayaStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private set(status: LayaStatus) {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  get ready(): boolean {
    return this.status.phase === 'ready';
  }

  load(device?: 'webgpu' | 'wasm') {
    if (this.status.phase === 'loading' || this.status.phase === 'ready') return;
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    }
    this.set({ phase: 'loading', loaded: 0, total: 0 });
    this.worker.postMessage({ type: 'load', device } satisfies WorkerRequest);
  }

  /** Stops the worker and frees the GPU; pending decisions fail. The cached weights stay. */
  unload() {
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.reject(new Error('Laya was removed from this device.'));
    this.waiting.clear();
    this.set({ phase: 'absent' });
  }

  private receive(message: WorkerResponse) {
    switch (message.type) {
      case 'progress':
        this.set({ phase: 'loading', loaded: message.loaded, total: message.total });
        break;
      case 'ready':
        this.set({ phase: 'ready', device: message.device, dtype: message.dtype, ms: message.ms });
        break;
      case 'result':
        this.waiting.get(message.id)?.resolve(message.probabilities);
        this.waiting.delete(message.id);
        break;
      case 'error':
        if (message.id === undefined) this.set({ phase: 'failed', message: message.message });
        else {
          this.waiting.get(message.id)?.reject(new Error(message.message));
          this.waiting.delete(message.id);
        }
        break;
    }
  }

  private send(message: WithoutId<Extract<WorkerRequest, { id: number }>>): Promise<number[][]> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage({ ...message, id } as WorkerRequest);
    });
  }

  private pass(state: string, questions: Question[]): Promise<number[][]> {
    return this.send({ type: 'decide', state, questions });
  }

  /** Pairs that each carry their own state, a pass at a time. */
  async decideMany(pairs: { state: string; question: Question }[], onPart?: (from: number, part: number[][]) => void): Promise<number[][]> {
    if (!this.ready || !this.worker) throw new Error('Laya is not loaded on this device yet.');
    const out: number[][] = [];
    for (let i = 0; i < pairs.length; i += MAX_PER_PASS) {
      const part = await this.send({ type: 'decideMany', pairs: pairs.slice(i, i + MAX_PER_PASS) });
      out.push(...part);
      onPart?.(i, part);
    }
    return out;
  }

  /** Answers every question about one state; `onPart` sees each pass as it lands. */
  async decide(state: string, questions: Question[], onPart?: (from: number, part: number[][]) => void): Promise<number[][]> {
    if (!this.ready || !this.worker) throw new Error('Laya is not loaded on this device yet.');
    const out: number[][] = [];
    for (let i = 0; i < questions.length; i += MAX_PER_PASS) {
      const part = await this.pass(state, questions.slice(i, i + MAX_PER_PASS));
      out.push(...part);
      onPart?.(i, part);
    }
    return out;
  }
}

export const laya = new LayaClient();
