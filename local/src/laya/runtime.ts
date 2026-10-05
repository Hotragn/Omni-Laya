/**
 * Laya in the browser: tokenizer, sequence building and decoding for the
 * ONNX conversion at onnx-community/laya-multilingual-ONNX.
 *
 * Adapted from open-jev's laya family (src/laya.ts on the laya-family branch,
 * https://github.com/shreyaskarnik/open-jev, MIT, Copyright (c) Nico Martin and
 * contributors). That code mirrors `build_sequence` and `Agent._decode_answers`
 * in Laya's own `laya/common.py` and `laya/agent.py`, and its authors report
 * identical token ids and |dp| <= 0.035 against Laya's Python agent at fp16.
 *
 * Each question is its own sequence:
 *   [CLS] {type} question: {question} [SEP] [MASK] opt 1 ... [MASK] opt n [SEP] state [SEP]
 * and the graph returns one logit per [MASK] marker.
 */
import { AutoModel, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import type { PreTrainedTokenizer } from '@huggingface/transformers';
import { hasFp16WebGpu } from './gpu';

export const MODEL_ID = 'onnx-community/laya-multilingual-ONNX';

export type Question =
  | { type: 'noul'; instructions: string; descriptions?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; options: string[]; descriptions?: Record<string, string> };

/** Probabilities per option, in option order (noul: [no, yes]). */
export type Probabilities = number[];

type LayaSection = {
  max_len?: number;
  head_max_len?: number;
  temperature?: number[];
  temperature_by_options?: Record<string, number>;
  split_words?: boolean;
};

type Special = { cls: number; sep: number; mask: number; pad: number; maskText: string; space: number };
type Sequence = { ids: number[]; markers: number[]; qtype: number };
type Model = (inputs: Record<string, Tensor>) => Promise<{ logits: Tensor }>;

const QTYPES = { choice: 0, score: 1, noul: 2 } as const;
const QTYPE_NAMES = ['choice', 'score', 'noul'] as const;
const NOUL_DEFAULTS = { false: 'no, the statement does not hold', true: 'yes, the statement holds' };
const MAX_OPTION_TOKENS = 48;

const clampT = (value: unknown) => {
  const t = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return Math.min(5, Math.max(0.5, t));
};

function bucket(qtype: number, count: number): string {
  const size = count <= 2 ? '2' : count <= 5 ? '3-5' : count <= 10 ? '6-10' : '11+';
  return `${QTYPE_NAMES[qtype]}:${size}`;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const e = logits.map((x) => Math.exp(x - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

export interface LoadProgress {
  /** Bytes fetched so far across model files, and the total once known. */
  loaded: number;
  total: number;
  file?: string;
}

export class LayaRuntime {
  private tokenizer!: PreTrainedTokenizer;
  private model!: Model;
  private special!: Special;
  private maxLength = 1024;
  private headLength = 256;
  private perType = [1, 1, 1];
  private byOptions: Record<string, number> = {};
  private splitWords = false;
  device: 'webgpu' | 'wasm' = 'wasm';
  dtype: 'fp16' | 'fp32' = 'fp32';

  static async load(onProgress?: (p: LoadProgress) => void, prefer?: { device?: 'webgpu' | 'wasm' }): Promise<LayaRuntime> {
    const runtime = new LayaRuntime();
    // Weights come from the Hugging Face hub and are kept in the browser's Cache Storage,
    // so the download happens once per device.
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const config = (await (await fetch(`https://huggingface.co/${MODEL_ID}/resolve/main/config.json`)).json()) as {
      laya?: LayaSection;
    };
    const section = config.laya ?? {};
    runtime.maxLength = section.max_len ?? 1024;
    runtime.headLength = section.head_max_len ?? 256;
    runtime.perType = Array.isArray(section.temperature) ? section.temperature.map(clampT) : [1, 1, 1];
    for (const [key, value] of Object.entries(section.temperature_by_options ?? {})) runtime.byOptions[key] = clampT(value);
    runtime.splitWords = section.split_words === true;

    runtime.device = prefer?.device ?? ((await hasFp16WebGpu()) ? 'webgpu' : 'wasm');
    runtime.dtype = runtime.device === 'webgpu' ? 'fp16' : 'fp32';

    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (info: unknown) => {
      const p = info as { status?: string; file?: string; loaded?: number; total?: number };
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      onProgress?.({ loaded, total, file: p.file });
    };

    runtime.tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
    runtime.model = (await AutoModel.from_pretrained(MODEL_ID, {
      dtype: runtime.dtype,
      device: runtime.device,
      progress_callback,
    })) as unknown as Model;

    const t = ((runtime.tokenizer as unknown as { config?: object }).config ?? {}) as Record<string, string | undefined>;
    const maskText = t.mask_token ?? '[MASK]';
    runtime.special = {
      cls: runtime.single(t.cls_token ?? '[CLS]'),
      sep: runtime.single(t.sep_token ?? '[SEP]'),
      mask: runtime.single(maskText),
      pad: runtime.single(t.pad_token ?? '[PAD]'),
      maskText,
      space: runtime.raw(' ')[0]!,
    };
    return runtime;
  }

  private raw(text: string): number[] {
    const { input_ids } = this.tokenizer(text, { add_special_tokens: false }) as { input_ids: Tensor };
    return Array.from(input_ids.data as ArrayLike<bigint | number>, Number);
  }

  private single(text: string): number {
    const ids = this.raw(text);
    if (ids.length !== 1) throw new Error(`Tokenizer does not know the token ${text}.`);
    return ids[0]!;
  }

  /** mmBERT's Metaspace tokenizer merges space runs differently in JS; encode word by word as open-jev does. */
  private encode(input: string): number[] {
    const text = input.split(this.special.maskText).join(' ');
    if (text === '') return [];
    if (!this.splitWords) return this.raw(text);
    const spaced = text.startsWith(' ') ? text : ` ${text}`;
    const ids: number[] = [];
    for (const piece of spaced.split(/(?= )/)) {
      const word = piece.slice(1);
      if (word === '') ids.push(this.special.space);
      else ids.push(...this.raw(word));
    }
    return ids;
  }

  private optionTexts(question: Question): string[] {
    if (question.type === 'noul') {
      return [
        `false: ${question.descriptions?.false || NOUL_DEFAULTS.false}`,
        `true: ${question.descriptions?.true || NOUL_DEFAULTS.true}`,
      ];
    }
    const d = question.descriptions ?? {};
    return question.options.map((option) => (d[option] ? `${option}: ${d[option]}` : option));
  }

  private sequence(question: Question, state: number[]): Sequence {
    const { cls, sep, mask } = this.special;
    let options = this.optionTexts(question).map((text) => [mask, ...this.encode(` ${text}`).slice(0, MAX_OPTION_TOKENS)]);
    const size = () => options.reduce((sum, option) => sum + option.length, 0);
    let budget = this.headLength - size();
    if (budget < 16) {
      const per = Math.max(4, Math.floor((this.headLength - 16) / options.length));
      options = options.map((option) => option.slice(0, per));
      budget = this.headLength - size();
    }
    const head = this.encode(`${question.type} question: ${question.instructions}`).slice(0, Math.max(8, budget));
    let ids = [cls, ...head, sep];
    const markers: number[] = [];
    for (const option of options) {
      markers.push(ids.length);
      ids.push(...option);
    }
    ids.push(sep);
    const room = Math.max(0, this.maxLength - ids.length - 1);
    ids = [...ids, ...state.slice(0, room), sep].slice(0, this.maxLength);
    return { ids, markers: markers.filter((p) => p < this.maxLength), qtype: QTYPES[question.type] };
  }

  /** All questions about one state, in one forward pass. */
  async decide(state: string, questions: Question[]): Promise<Probabilities[]> {
    const stateIds = this.encode(state);
    return this.run(questions.map((q) => this.sequence(q, stateIds)));
  }

  /** Independent (state, question) pairs in one forward pass: each sequence carries its own state. */
  async decideMany(pairs: { state: string; question: Question }[]): Promise<Probabilities[]> {
    return this.run(pairs.map((p) => this.sequence(p.question, this.encode(p.state))));
  }

  private async run(items: Sequence[]): Promise<Probabilities[]> {
    if (items.length === 0) return [];
    const batch = items.length;
    const length = Math.max(...items.map((i) => i.ids.length));
    const count = Math.max(...items.map((i) => i.markers.length));
    const ids = new BigInt64Array(batch * length).fill(BigInt(this.special.pad));
    const attention = new BigInt64Array(batch * length);
    const positions = new BigInt64Array(batch * count);
    const markerMask = new Uint8Array(batch * count);
    const qtype = new BigInt64Array(batch);
    items.forEach((item, row) => {
      item.ids.forEach((id, col) => {
        ids[row * length + col] = BigInt(id);
        attention[row * length + col] = 1n;
      });
      item.markers.forEach((pos, col) => {
        positions[row * count + col] = BigInt(pos);
        markerMask[row * count + col] = 1;
      });
      qtype[row] = BigInt(item.qtype);
    });
    const { logits } = await this.model({
      input_ids: new Tensor('int64', ids, [batch, length]),
      attention_mask: new Tensor('int64', attention, [batch, length]),
      marker_pos: new Tensor('int64', positions, [batch, count]),
      marker_mask: new Tensor('bool', markerMask, [batch, count]),
      qtype: new Tensor('int64', qtype, [batch]),
    });
    const values = Array.from(logits.to('float32').data as ArrayLike<number>);
    return items.map((item, row) => {
      const k = item.markers.length;
      const t = this.byOptions[bucket(item.qtype, k)] ?? this.perType[item.qtype] ?? 1;
      return softmax(values.slice(row * count, row * count + k).map((v) => v / t));
    });
  }
}
