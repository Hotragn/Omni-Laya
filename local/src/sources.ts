/**
 * Places the browser can search on its own: free, keyless APIs that answer
 * cross-origin requests (probed 2026-10-02). Reddit, arXiv, Lobsters and
 * public SearXNG instances refuse browser requests, so they are not here.
 *
 * Every request goes from the reader's browser straight to that service;
 * nothing passes through an OmniLaya server, because there is none.
 */
import { decodeEntities } from '@/lib/search1api';
import type { WindowId } from '@/lib/sources';

export type PlaceId = 'web' | 'wikipedia' | 'hackernews' | 'github' | 'stackoverflow' | 'papers' | 'books' | 'packages';

export interface Hit {
  id: string;
  place: PlaceId;
  title: string;
  url: string;
  snippet: string;
  /** ISO date when the service gives one. */
  date?: string;
  /** Rank within its place, 1-based. */
  position: number;
}

export interface Place {
  id: PlaceId;
  /** Shown in the decision sentence. */
  label: string;
  /** The option text Laya reads in its "where" choice. */
  option: string;
  /** How a request names this place outright. */
  named: RegExp;
  /** Whether the service can filter by date. */
  dated: boolean;
  search(query: string, window: WindowId, signal: AbortSignal): Promise<Hit[]>;
}

const WINDOW_DAYS: Record<WindowId, number | null> = { any: null, '24h': 1, '7d': 7, '30d': 30 };

function since(window: WindowId): Date | null {
  const days = WINDOW_DAYS[window];
  return days === null ? null : new Date(Date.now() - days * 86_400_000);
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const strip = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered HTTP ${response.status}`);
  return (await response.json()) as T;
}

function hits(place: PlaceId, rows: Omit<Hit, 'id' | 'place' | 'position'>[]): Hit[] {
  return rows
    .filter((r) => r.title && /^https?:\/\//.test(r.url))
    .map((r, i) => ({ ...r, id: `${place}:${i + 1}`, place, position: i + 1, title: clip(r.title, 200), snippet: clip(r.snippet) }));
}

type MwmblRow = { url: string; title: { value: string }[]; extract: { value: string }[] };
type WikiPage = { key: string; title: string; excerpt?: string; description?: string | null };
type HnHit = { objectID: string; title?: string; url?: string; story_text?: string; created_at?: string; points?: number; num_comments?: number };
type GhRepo = { html_url: string; full_name: string; description?: string | null; pushed_at?: string; stargazers_count?: number; language?: string | null };
type SeItem = { link: string; title: string; tags?: string[]; score?: number; is_answered?: boolean; answer_count?: number; creation_date?: number };
type OaWork = {
  id: string;
  display_name?: string;
  doi?: string | null;
  publication_date?: string;
  cited_by_count?: number;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string } | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};
type OlDoc = { key: string; title: string; author_name?: string[]; first_publish_year?: number };
type NpmObj = { package: { name: string; description?: string; keywords?: string[]; date?: string; links?: { npm?: string } } };

/** OpenAlex stores abstracts as word -> positions; rebuild the first words. */
export function abstractText(index: Record<string, number[]> | null | undefined, words = 45): string {
  if (!index) return '';
  const at: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) if (p < words) at[p] = word;
  return at.filter(Boolean).join(' ');
}

export const PLACES: readonly Place[] = [
  {
    id: 'web',
    label: 'the open web',
    option: 'the open web: articles, blogs, docs, news',
    named: /\b(the\s+web|the\s+internet|websites?|blogs?)\b/i,
    dated: false,
    // Mwmbl: a non-profit, community-built web index.
    search: async (q, _w, signal) => {
      const rows = await getJson<MwmblRow[]>(`https://api.mwmbl.org/search/?s=${encodeURIComponent(q)}`, signal);
      return hits('web', rows.slice(0, 10).map((r) => ({
        url: r.url,
        title: strip(r.title.map((t) => t.value).join('')),
        snippet: strip(r.extract.map((t) => t.value).join('')),
      })));
    },
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    option: 'Wikipedia encyclopedia articles',
    named: /\b(wikipedia|wiki)\b/i,
    dated: false,
    search: async (q, _w, signal) => {
      const { pages } = await getJson<{ pages: WikiPage[] }>(
        `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=6`,
        signal
      );
      return hits('wikipedia', pages.map((p) => ({
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
        title: p.title,
        snippet: [p.description, strip(p.excerpt ?? '')].filter(Boolean).join('. '),
      })));
    },
  },
  {
    id: 'hackernews',
    label: 'Hacker News',
    option: 'Hacker News threads',
    named: /\b(hacker\s*news|hn)\b/i,
    dated: true,
    search: async (q, w, signal) => {
      const from = since(w);
      const filter = from ? `&numericFilters=created_at_i>${Math.floor(from.getTime() / 1000)}` : '';
      const { hits: rows } = await getJson<{ hits: HnHit[] }>(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=10${filter}`,
        signal
      );
      return hits('hackernews', rows.map((h) => ({
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title ?? '',
        snippet: [
          h.url ? new URL(h.url).hostname.replace(/^www\./, '') : null,
          `${h.points ?? 0} points, ${h.num_comments ?? 0} comments`,
          h.story_text ? strip(h.story_text) : null,
        ].filter(Boolean).join(' · '),
        ...(h.created_at ? { date: h.created_at } : {}),
      })));
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    option: 'GitHub code repositories',
    named: /\b(github|repos?|repositories)\b/i,
    dated: true,
    search: async (q, w, signal) => {
      const from = since(w);
      const query = encodeURIComponent(`${q}${from ? ` pushed:>${day(from)}` : ''}`);
      const { items } = await getJson<{ items: GhRepo[] }>(`https://api.github.com/search/repositories?q=${query}&per_page=8`, signal);
      return hits('github', items.map((r) => ({
        url: r.html_url,
        title: r.full_name,
        snippet: [r.description, r.language, `${r.stargazers_count ?? 0} stars`].filter(Boolean).join(' · '),
        ...(r.pushed_at ? { date: r.pushed_at } : {}),
      })));
    },
  },
  {
    id: 'stackoverflow',
    label: 'Stack Overflow',
    option: 'Stack Overflow programming questions and answers',
    named: /\b(stack\s*overflow|stackoverflow|so\s+answers?)\b/i,
    dated: true,
    search: async (q, w, signal) => {
      const from = since(w);
      const { items } = await getJson<{ items: SeItem[] }>(
        `https://api.stackexchange.com/2.3/search/advanced?q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=8&order=desc&sort=relevance${
          from ? `&fromdate=${Math.floor(from.getTime() / 1000)}` : ''
        }`,
        signal
      );
      return hits('stackoverflow', items.map((i) => ({
        url: i.link,
        title: decodeEntities(i.title),
        snippet: [(i.tags ?? []).join(', '), i.is_answered ? `answered (${i.answer_count ?? 0})` : 'no accepted answer', `score ${i.score ?? 0}`].join(' · '),
        ...(i.creation_date ? { date: new Date(i.creation_date * 1000).toISOString() } : {}),
      })));
    },
  },
  {
    id: 'papers',
    label: 'research papers',
    option: 'research papers and preprints',
    named: /\b(papers?|preprints?|arxiv|research|studies|study|openalex)\b/i,
    dated: true,
    // OpenAlex: an open index of scholarly works, arXiv included.
    search: async (q, w, signal) => {
      const from = since(w);
      const { results } = await getJson<{ results: OaWork[] }>(
        `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=8${from ? `&filter=from_publication_date:${day(from)}` : ''}`,
        signal
      );
      return hits('papers', results.map((r) => ({
        url: r.doi ?? r.primary_location?.landing_page_url ?? r.id,
        title: r.display_name ?? '',
        snippet: [r.primary_location?.source?.display_name, `${r.cited_by_count ?? 0} citations`, abstractText(r.abstract_inverted_index)]
          .filter(Boolean)
          .join(' · '),
        ...(r.publication_date ? { date: r.publication_date } : {}),
      })));
    },
  },
  {
    id: 'books',
    label: 'Open Library',
    option: 'books',
    named: /\b(books?|novels?|open\s*library)\b/i,
    dated: false,
    search: async (q, _w, signal) => {
      const { docs } = await getJson<{ docs: OlDoc[] }>(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6&fields=key,title,author_name,first_publish_year`,
        signal
      );
      return hits('books', docs.map((d) => ({
        url: `https://openlibrary.org${d.key}`,
        title: d.title,
        snippet: [(d.author_name ?? []).slice(0, 3).join(', '), d.first_publish_year ? `first published ${d.first_publish_year}` : null]
          .filter(Boolean)
          .join(' · '),
      })));
    },
  },
  {
    id: 'packages',
    label: 'npm',
    option: 'JavaScript packages on npm',
    named: /\b(npm|packages?|node\s*modules?)\b/i,
    dated: false,
    search: async (q, _w, signal) => {
      const { objects } = await getJson<{ objects: NpmObj[] }>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=6`, signal);
      return hits('packages', objects.map((o) => ({
        url: o.package.links?.npm ?? `https://www.npmjs.com/package/${o.package.name}`,
        title: o.package.name,
        // Some descriptions are README markup (badge comments, tags); keywords stand in when nothing is left.
        snippet: strip(o.package.description ?? '') || (o.package.keywords ?? []).slice(0, 8).join(', '),
        ...(o.package.date ? { date: o.package.date } : {}),
      })));
    },
  },
];

export const DEFAULT_PLACES: PlaceId[] = ['web', 'wikipedia'];

export function placeById(id: PlaceId): Place {
  return PLACES.find((p) => p.id === id)!;
}

/** Place names to remove from the keyword query. */
export const PLACE_WORDS =
  /\b(on|from|in|at|via)\s+(the\s+web|the\s+internet|wikipedia|hacker\s*news|hn|github|stack\s*overflow|stackoverflow|npm|open\s*library|openalex|arxiv)\b/gi;
