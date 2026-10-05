import type { JudgeConfig, ProviderConfig, ProviderId } from './laya';

/** The environment that decides how Laya is reached. Every value is a plain string. */
export interface JudgeEnv {
  /** Comma-separated list of enabled providers in order of preference, e.g. `laya,huggingface`. Unlisted providers stay off. */
  LAYA_PROVIDERS?: string;
  /** Base URL of a `laya-serve` you run, e.g. `http://127.0.0.1:8000`. */
  LAYA_BASE_URL?: string;
  /** Bearer key, only when that server sets `LAYA_API_KEY`. */
  LAYA_API_KEY?: string;
  /** Hugging Face Inference Endpoint URL running the `laya-serve` container. */
  HF_ENDPOINT_URL?: string;
  HF_TOKEN?: string;
  /** Laya checkpoint to pin: `english`, `multilingual` or `typed-decisions`. Empty lets the server route. */
  LAYA_MODEL?: string;
}

export const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = ['laya'];

const ALIASES: Record<string, ProviderId> = {
  laya: 'laya',
  'laya-serve': 'laya',
  'self-hosted': 'laya',
  huggingface: 'huggingface',
  hf: 'huggingface',
  'hf-endpoint': 'huggingface',
};

const CREDENTIAL: Record<ProviderId, string> = {
  laya: 'LAYA_BASE_URL',
  huggingface: 'HF_ENDPOINT_URL and HF_TOKEN',
};

/** Checkpoint names `laya-serve` honours; anything else would be ignored by the server, so reject it here. */
export const LAYA_CHECKPOINTS = ['english', 'multilingual', 'typed-decisions'] as const;

function parseOrder(value: string | undefined): ProviderId[] {
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
  if (names.length === 0) return [...DEFAULT_PROVIDER_ORDER];
  const order: ProviderId[] = [];
  for (const name of names) {
    const id = ALIASES[name];
    if (!id) {
      throw new Error(`LAYA_PROVIDERS lists unknown provider "${name}"; use ${Object.keys(ALIASES).join(', ')}`);
    }
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

function parseModel(value: string | undefined): string | undefined {
  const model = value?.trim().toLowerCase();
  if (!model) return undefined;
  if (!(LAYA_CHECKPOINTS as readonly string[]).includes(model)) {
    throw new Error(`LAYA_MODEL "${value}" is not a Laya checkpoint; use ${LAYA_CHECKPOINTS.join(', ')} or leave it empty`);
  }
  return model;
}

function configured(env: JudgeEnv, id: ProviderId, model: string | undefined): ProviderConfig | undefined {
  switch (id) {
    case 'laya': {
      const baseUrl = env.LAYA_BASE_URL?.trim();
      if (!baseUrl) return undefined;
      return {
        provider: 'laya',
        baseUrl,
        ...(env.LAYA_API_KEY ? { apiKey: env.LAYA_API_KEY } : {}),
        ...(model ? { model } : {}),
      };
    }
    case 'huggingface': {
      const baseUrl = env.HF_ENDPOINT_URL?.trim();
      if (!baseUrl || !env.HF_TOKEN) return undefined;
      return { provider: 'huggingface', baseUrl, apiKey: env.HF_TOKEN, ...(model ? { model } : {}) };
    }
  }
}

/**
 * Builds the Laya provider chain from the environment. `LAYA_PROVIDERS` is the
 * switch: only listed providers are used, in the order given, and the default
 * is the self-hosted server alone. The first listed provider that is
 * configured is primary and the others are fallbacks for unreachable,
 * rate-limited and failing servers. A listed provider without its settings is
 * skipped.
 */
export function judgeConfig(env: JudgeEnv): JudgeConfig {
  const order = parseOrder(env.LAYA_PROVIDERS);
  const model = parseModel(env.LAYA_MODEL);
  const providers = order.map((id) => configured(env, id, model)).filter((p): p is ProviderConfig => p !== undefined);
  if (providers.length === 0) {
    throw new Error(
      `No Laya provider is configured for LAYA_PROVIDERS=${order.join(',')}; set ${order
        .map((id) => CREDENTIAL[id])
        .join(' or ')} (see .dev.vars.example)`
    );
  }
  return { providers };
}
