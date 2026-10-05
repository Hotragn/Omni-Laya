import { describe, expect, it } from 'vitest';
import { PLACES, SOURCES, namesSource, pickSources, type SourceId } from '@/lib/sources';

function probs(values: Partial<Record<SourceId | 'web', number>>): Record<SourceId, number> {
  const out = {} as Record<SourceId, number>;
  for (const s of SOURCES) out[s.id] = (s.place === 'web' ? values.web : values[s.id]) ?? 0;
  return out;
}

describe('places', () => {
  it('gives every source a place and every place a source', () => {
    const places = new Set(PLACES.map((p) => p.id));
    expect(SOURCES.every((s) => places.has(s.place))).toBe(true);
    expect([...places].every((id) => SOURCES.some((s) => s.place === id))).toBe(true);
  });
});

describe('pickSources', () => {
  it('searches the default web engines when no place clears the bar', () => {
    expect(pickSources(probs({ web: 0.2, wikipedia: 0.25, imdb: 0.14 }), 'who invented the transistor')).toEqual(['google', 'duckduckgo', 'yandex']);
  });

  it('searches a named platform on its own, as Jev Search does', () => {
    expect(pickSources(probs({ hackernews: 0.96, web: 0.01 }), 'Rust async runtimes on Hacker News this month')).toEqual(['hackernews']);
    expect(pickSources(probs({ reddit: 0.99 }), 'What do Reddit users think of the Framework laptop?')).toEqual(['reddit']);
    expect(pickSources(probs({ wechat: 0.79 }), '微信公众号上关于大模型推理优化的文章')).toEqual(['wechat']);
  });

  it('adds the open web to a platform the request only implies', () => {
    expect(pickSources(probs({ arxiv: 1 }), 'New papers on speculative decoding')).toEqual(['google', 'duckduckgo', 'yandex', 'arxiv']);
    expect(pickSources(probs({ imdb: 0.94 }), 'who directed the movie Oppenheimer')).toEqual(['google', 'duckduckgo', 'yandex', 'imdb']);
  });

  it('adds the open web when only some chosen platforms are named', () => {
    expect(pickSources(probs({ reddit: 0.5, hackernews: 0.45 }), 'what do people on reddit say about Bun')).toEqual(['google', 'duckduckgo', 'yandex', 'hackernews', 'reddit']);
  });

  it('adds the open web when it also clears the bar, even for a named platform', () => {
    expect(pickSources(probs({ web: 0.4, github: 0.55 }), 'bun on github')).toEqual(['google', 'duckduckgo', 'yandex', 'github']);
  });

  it('does not mistake a bare letter x or a word containing hn for a platform name', () => {
    expect(namesSource('x86 assembly tips', 'x')).toBe(false);
    expect(namesSource('John Carmack interview', 'hackernews')).toBe(false);
    expect(namesSource('latest tweets from Karpathy', 'x')).toBe(true);
  });
});
