/**
 * What a reader marks on the page, kept in this browser only: where the
 * cutting floor sits, per-domain lens rules, saved source sets, and the
 * results they disagreed with Laya about. Nothing here is sent to a server.
 */
import type { Cluster } from './rank';
import { isSourceId, type SourceId } from './sources';

/**
 * Default cutting floor. On labelled pairs Laya put off-topic results at
 * 0.08 to 0.20 and on-topic ones at 0.28 and up.
 */
export const OFF_TOPIC = 0.25;

export type DomainRule = 'raise' | 'lower' | 'block';

export interface Lens {
  name: string;
  sources: SourceId[];
}

export interface Disagreement {
  /** ISO time of the stamp. */
  at: string;
  request: string;
  query: string;
  url: string;
  title: string;
  /** Laya's on-topic score when the reader stamped it. */
  relevance: number;
  checkpoint?: string;
}

export interface Proofs {
  floor: number;
  rules: Record<string, DomainRule>;
  lenses: Lens[];
  disagreements: Disagreement[];
  /** Single-key proofing shortcuts (j, k, o, x, d, e, /). Readers can turn them off (WCAG 2.1.4). */
  keys: boolean;
}

export const EMPTY_PROOFS: Proofs = { floor: OFF_TOPIC, rules: {}, lenses: [], disagreements: [], keys: true };

const KEY = 'omnilaya-proofs';
/** Enough for a long proofing session; the oldest stamps go first. */
const MAX_DISAGREEMENTS = 500;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A rule on `github.com` also covers `gist.github.com`. */
export function ruleFor(url: string, rules: Record<string, DomainRule>): DomainRule | undefined {
  const host = domainOf(url);
  if (!host) return undefined;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const rule = rules[parts.slice(i).join('.')];
    if (rule) return rule;
  }
  return undefined;
}

/** Raised domains move to the top and lowered ones to the bottom, keeping order within each group; blocked ones go. */
export function applyRules(clusters: Cluster[], rules: Record<string, DomainRule>): { kept: Cluster[]; blocked: number } {
  const raised: Cluster[] = [];
  const plain: Cluster[] = [];
  const lowered: Cluster[] = [];
  let blocked = 0;
  for (const cluster of clusters) {
    const rule = ruleFor(cluster.lead.url, rules);
    if (rule === 'block') blocked++;
    else if (rule === 'raise') raised.push(cluster);
    else if (rule === 'lower') lowered.push(cluster);
    else plain.push(cluster);
  }
  return { kept: [...raised, ...plain, ...lowered], blocked };
}

/** One JSON object per line, ready for a labelled-data file. */
export function toJsonl(list: Disagreement[]): string {
  return list.map((d) => JSON.stringify(d)).join('\n') + (list.length ? '\n' : '');
}

function clean(raw: unknown): Proofs {
  const p = (raw ?? {}) as Partial<Proofs>;
  const floor = typeof p.floor === 'number' && p.floor >= 0 && p.floor <= 1 ? p.floor : OFF_TOPIC;
  const rules: Record<string, DomainRule> = {};
  if (p.rules && typeof p.rules === 'object') {
    for (const [domain, rule] of Object.entries(p.rules)) {
      if (rule === 'raise' || rule === 'lower' || rule === 'block') rules[domain] = rule;
    }
  }
  const lenses = Array.isArray(p.lenses)
    ? p.lenses
        .filter((l): l is Lens => typeof l?.name === 'string' && Array.isArray(l.sources))
        .map((l) => ({ name: l.name.slice(0, 40), sources: l.sources.filter((s) => typeof s === 'string' && isSourceId(s)) }))
        .filter((l) => l.sources.length > 0)
    : [];
  const disagreements = Array.isArray(p.disagreements)
    ? p.disagreements.filter((d): d is Disagreement => typeof d?.url === 'string' && typeof d.at === 'string')
    : [];
  const keys = typeof p.keys === 'boolean' ? p.keys : true;
  return { floor, rules, lenses, disagreements, keys };
}

export function loadProofs(): Proofs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : EMPTY_PROOFS;
  } catch {
    return EMPTY_PROOFS;
  }
}

export function saveProofs(proofs: Proofs): void {
  const trimmed = { ...proofs, disagreements: proofs.disagreements.slice(-MAX_DISAGREEMENTS) };
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* Private windows and blocked storage: the page still works, marks last until reload. */
  }
}
