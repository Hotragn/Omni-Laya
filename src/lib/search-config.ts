import type { Search1ApiConfig } from './search1api';
import type { SearxngConfig } from './searxng';

export interface SearchEnv {
  /** `search1api` (default) or `searxng`. */
  SEARCH_PROVIDER?: string;
  SEARCH1API_API_KEY?: string;
  SEARCH1API_BASE_URL?: string;
  SEARXNG_BASE_URL?: string;
  SEARXNG_API_KEY?: string;
}

export type SearchConfig =
  | { search1api: Search1ApiConfig; searxng?: undefined }
  | { search1api?: undefined; searxng: SearxngConfig };

/** Which search backend answers the engine lanes, from the environment. Throws when it is not configured. */
export function searchConfig(env: SearchEnv): SearchConfig {
  const provider = (env.SEARCH_PROVIDER ?? '').trim().toLowerCase() || 'search1api';
  if (provider === 'searxng') {
    const baseUrl = env.SEARXNG_BASE_URL?.trim();
    if (!baseUrl) throw new Error('SEARCH_PROVIDER=searxng needs SEARXNG_BASE_URL (see .dev.vars.example)');
    return { searxng: { baseUrl, ...(env.SEARXNG_API_KEY ? { apiKey: env.SEARXNG_API_KEY } : {}) } };
  }
  if (provider !== 'search1api') {
    throw new Error(`SEARCH_PROVIDER "${env.SEARCH_PROVIDER}" is unknown; use search1api or searxng`);
  }
  if (!env.SEARCH1API_API_KEY) throw new Error('SEARCH1API_API_KEY is not set (see .dev.vars.example)');
  return { search1api: { apiKey: env.SEARCH1API_API_KEY, baseUrl: env.SEARCH1API_BASE_URL } };
}
