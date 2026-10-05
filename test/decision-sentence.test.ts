import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionSentence } from '@/components/decision-sentence';
import { SOURCE_IDS, type SourceId, type WindowId } from '@/lib/sources';
import type { AskState } from '@/lib/use-ask';

function render({
  error,
  sources = ['google'],
  laya = { google: 1 },
  request = 'Laya decision model news in the past 24 hours',
  window = '24h',
  explicitSources,
}: {
  error?: string;
  sources?: SourceId[];
  laya?: Partial<Record<SourceId, number>>;
  request?: string;
  window?: WindowId;
  explicitSources?: SourceId[];
} = {}) {
  const state: AskState = {
    phase: 'done', items: [], totalMs: 15_000, message: null,
    found: { 'google/google': 0 },
    lanes: {
      'google/google': {
        type: 'lane', source: 'google', engine: 'google', items: [],
        stale: 0, searchMs: 15_000, scoreMs: 0, ...(error ? { error } : {}),
      },
    },
    intent: {
      type: 'intent', request,
      query: 'Laya decision model', entityQuery: 'Laya', candidates: ['Laya decision model'],
      window, sources, intentMs: 400, judge: 'laya', checkpoint: 'english',
      inferred: {
        window: { choice: window, confidence: 1 },
        sources: Object.fromEntries(SOURCE_IDS.map((id) => [id, laya[id] ?? 0])) as Record<SourceId, number>,
        query: { index: 0, confidence: 1 }, entity: { index: 0, confidence: 1 },
      },
    },
  };
  return renderToStaticMarkup(createElement(DecisionSentence, {
    state, explicitWindow: undefined, explicitSources,
    onWindow: () => undefined, onSources: () => undefined,
  }));
}

describe('decision sentence', () => {
  it('writes what Laya chose as one sentence', () => {
    const html = render({ sources: ['google', 'duckduckgo', 'yandex'], laya: {}, request: 'python asyncio vs threading', window: 'any' });
    expect(html).toContain('Laya searched');
    expect(html).toMatch(/Google<\/button>.*, .*DuckDuckGo<\/button>.* and .*Yandex<\/button>/);
    expect(html).toContain('any time</button>');
    expect(html).toContain('read by laya/english in 0.4 s');
  });

  it('does not present a timed-out source as zero results', () => {
    const html = render({ error: 'The operation was aborted due to timeout' });
    expect(html).toContain('Google: search failed');
    expect(html).not.toContain('<span>0</span>');
  });

  it('still displays zero for a successful search with no results', () => {
    const html = render();
    expect(html).not.toContain('Google: search failed');
    expect(html).toContain('<span>0</span>');
  });

  it('strikes out a place Laya chose that the reader removed', () => {
    const html = render({
      sources: ['google', 'duckduckgo'],
      laya: {},
      request: 'python asyncio vs threading',
      window: 'any',
      explicitSources: ['google', 'duckduckgo'],
    });
    expect(html).toContain('Yandex: struck out');
    expect(html).toContain('Yandex struck by you');
    expect(html).toContain('let Laya decide');
  });
});
