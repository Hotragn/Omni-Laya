import { env as workerEnv } from 'cloudflare:workers';
import { judgeConfig } from '@/lib/judge-config';
import { searchConfig } from '@/lib/search-config';

export function getEnv() {
  // Optional bindings and secrets may be removed by self-hosters without changing application code.
  const env: typeof workerEnv & {
    CACHE?: KVNamespace;
    SEARCH_RATE_LIMIT?: RateLimit;
    LAYA_PROVIDERS?: string;
    LAYA_BASE_URL?: string;
    LAYA_API_KEY?: string;
    HF_ENDPOINT_URL?: string;
    HF_TOKEN?: string;
    SEARCH_PROVIDER?: string;
    SEARXNG_BASE_URL?: string;
    SEARXNG_API_KEY?: string;
  } = workerEnv;
  // Throws when the chosen search backend is not configured.
  searchConfig(env);
  // Throws when no Laya provider is configured.
  judgeConfig(env);
  return env;
}

/** The search backend derived from the Worker environment. */
export function getSearchConfig(env: ReturnType<typeof getEnv>) {
  return searchConfig(env);
}

/** The Laya provider chain derived from the Worker environment. */
export function getJudgeConfig(env: ReturnType<typeof getEnv>) {
  return judgeConfig(env);
}
