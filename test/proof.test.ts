import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROOFS, OFF_TOPIC, applyRules, domainOf, loadProofs, ruleFor, saveProofs, toJsonl } from '@/lib/proof';
import type { Cluster, RankedItem } from '@/lib/rank';

function cluster(url: string): Cluster {
  const lead: RankedItem = {
    id: url, source: 'google', title: url, url, snippet: '', relevance: 0.5, ranked: true,
    freshness: 0, position: 1, engines: ['google'], ageHours: null,
  };
  return { lead, others: [] };
}

describe('lens rules', () => {
  it('reads the domain without www', () => {
    expect(domainOf('https://www.Example.com/a')).toBe('example.com');
    expect(domainOf('not a url')).toBe('');
  });

  it('applies a rule on a parent domain to its subdomains', () => {
    expect(ruleFor('https://gist.github.com/x', { 'github.com': 'block' })).toBe('block');
    expect(ruleFor('https://github.community/x', { 'github.com': 'block' })).toBeUndefined();
  });

  it('raises, lowers and blocks while keeping order inside each group', () => {
    const list = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'].map((d) => cluster(`https://${d}/`));
    const { kept, blocked } = applyRules(list, { 'd.com': 'raise', 'a.com': 'lower', 'c.com': 'block' });
    expect(kept.map((c) => domainOf(c.lead.url))).toEqual(['d.com', 'b.com', 'e.com', 'a.com']);
    expect(blocked).toBe(1);
  });
});

describe('disagreement export', () => {
  it('writes one JSON object per line', () => {
    const rows = [
      { at: '2026-10-02T00:00:00Z', request: 'q', query: 'q', url: 'https://a.com', title: 'A', relevance: 0.9 },
      { at: '2026-10-02T00:01:00Z', request: 'q', query: 'q', url: 'https://b.com', title: 'B', relevance: 0.1 },
    ];
    const lines = toJsonl(rows).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toEqual(rows[1]);
    expect(toJsonl([])).toBe('');
  });
});

describe('proof storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips and drops unknown or broken values', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    saveProofs({ ...EMPTY_PROOFS, floor: 0.4, rules: { 'a.com': 'raise' }, lenses: [{ name: 'HN', sources: ['hackernews'] }] });
    expect(loadProofs()).toMatchObject({ floor: 0.4, rules: { 'a.com': 'raise' }, lenses: [{ name: 'HN', sources: ['hackernews'] }] });

    store.set('omnilaya-proofs', JSON.stringify({ floor: 7, rules: { 'b.com': 'nuke' }, lenses: [{ name: 'x', sources: ['nope'] }] }));
    expect(loadProofs()).toEqual({ floor: OFF_TOPIC, rules: {}, lenses: [], disagreements: [], keys: true });
  });

  it('falls back to defaults when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(loadProofs()).toEqual(EMPTY_PROOFS);
    expect(() => saveProofs(EMPTY_PROOFS)).not.toThrow();
  });
});
