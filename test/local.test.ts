import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askRows,
  keywords,
  kindRule,
  mergeHits,
  orderRows,
  pickPlaces,
  placesByRule,
  readRequest,
  stateText,
  windowByRule,
  type Judge,
} from '../local/src/pipeline';
import { PLACES, abstractText, placeById, type Hit } from '../local/src/sources';
import { CACHED_FLAG, MODEL_CACHE, dropStale, keepStored, removeStored, stored } from '../local/src/laya/storage';
import { MODEL_ID, MODEL_REVISION } from '../local/src/laya/model';
import { memoryWarning } from '../local/src/ui/laya-card';

afterEach(() => vi.unstubAllGlobals());

describe('reading a request in the browser', () => {
  it('serialises the state exactly like laya-serve (Python json.dumps)', () => {
    expect(stateText('Rust "async" café')).toBe('{"request": "Rust \\"async\\" café"}');
  });

  it('strips time, place and filler words from the keywords', () => {
    expect(keywords('Rust async runtimes on Hacker News this month')).toBe('Rust async runtimes');
    expect(keywords('How do I debounce a function on Stack Overflow')).toBe('How do I debounce a function');
    expect(keywords('this month')).toBe('this month');
  });

  it('reads the window from time words when Laya is not on the device', () => {
    expect(windowByRule('news today')).toBe('24h');
    expect(windowByRule('papers from last week')).toBe('7d');
    expect(windowByRule('Rust on HN this month')).toBe('30d');
    expect(windowByRule('how to debounce')).toBe('any');
  });

  it('searches named places alone, else the open web and Wikipedia', () => {
    expect(placesByRule('Rust async runtimes on Hacker News')).toEqual(['hackernews']);
    expect(placesByRule('what is a monad')).toEqual(['web', 'wikipedia']);
  });

  it('picks places from Laya with the server rule', () => {
    expect(pickPlaces({ hackernews: 0.96 }, 'Rust on Hacker News')).toEqual(['hackernews']);
    expect(pickPlaces({ papers: 0.9 }, 'speculative decoding, recent work')).toEqual(['web', 'papers']);
    expect(pickPlaces({ web: 0.3, github: 0.2 }, 'anything')).toEqual(['web', 'wikipedia']);
  });

  it('asks Laya both choices in one call and keeps the window only when time is mentioned', async () => {
    const calls: { state: string; n: number }[] = [];
    const judge: Judge = {
      ready: true,
      decideMany: async () => [],
      decide: async (state, questions) => {
        calls.push({ state, n: questions.length });
        const where = PLACES.map((p) => (p.id === 'hackernews' ? 0.9 : 0.1 / (PLACES.length - 1)));
        return [[0.1, 0.1, 0.1, 0.7], where];
      },
    };
    const timed = await readRequest('Rust on Hacker News this month', judge);
    expect(calls).toEqual([{ state: stateText('Rust on Hacker News this month'), n: 2 }]);
    expect(timed).toMatchObject({ by: 'laya', places: ['hackernews'], window: '30d', query: 'Rust' });

    const untimed = await readRequest('Rust on Hacker News', judge);
    expect(untimed.window).toBe('any');

    const changed = await readRequest('Rust on Hacker News', judge, { places: ['github'], window: '7d' });
    expect(changed).toMatchObject({ places: ['github'], window: '7d', chosen: { places: ['hackernews'], window: 'any' } });
  });

  it('falls back to rules without Laya', async () => {
    const judge: Judge = { ready: false, decide: async () => [], decideMany: async () => [] };
    expect(await readRequest('papers on speculative decoding', judge)).toMatchObject({ by: 'rules', places: ['papers'] });
  });
});

describe('asking about rows', () => {
  it('sends each row as its own state with where it came from', async () => {
    const seen: { state: string; question: unknown }[] = [];
    const judge: Judge = {
      ready: true,
      decide: async () => [],
      decideMany: async (pairs, onPart) => {
        seen.push(...pairs);
        const part = pairs.map((p) => (p.state.includes('npm') ? [0.1, 0.9] : [0.8, 0.2]));
        onPart?.(0, part);
        return part;
      },
    };
    const rows = mergeHits({
      packages: [{ id: 'packages:1', place: 'packages', url: 'https://www.npmjs.com/package/debounce', title: 'debounce', snippet: 'Delay a function', position: 1 }],
      web: [{ id: 'web:1', place: 'web', url: 'https://blog.example/debounce', title: 'Debounce explained', snippet: 'How it works', position: 1 }],
    });
    const got: Record<string, number> = {};
    await askRows('debounce', 'Is this official documentation?', rows, judge, (a) => Object.assign(got, a));
    expect(seen[0]).toEqual({
      state: 'Title: Debounce explained\nSnippet: From the open web, blog.example. How it works',
      question: { type: 'noul', instructions: 'Is this official documentation?' },
    });
    expect(got).toEqual({ 'web:1': 0.2, 'packages:1': 0.9 });
  });
});

describe('kind-of-result questions', () => {
  const rows = mergeHits({
    packages: [{ id: 'packages:1', place: 'packages', url: 'https://www.npmjs.com/package/debounce', title: 'debounce', snippet: '', position: 1 }],
    web: [
      { id: 'web:1', place: 'web', url: 'https://www.30secondsofcode.org/js/s/debounce-function', title: 'Debounce', snippet: '', position: 1 },
      { id: 'web:2', place: 'web', url: 'https://github.com/component/debounce', title: 'component/debounce', snippet: '', position: 2 },
    ],
  });

  it('answers by rule when the question only asks what kind of result it is', () => {
    const yesFor = (rule: (r: (typeof rows)[number]) => boolean) => rows.filter(rule).map((r) => r.id);
    expect(yesFor(kindRule('Is this an npm package?')!)).toEqual(['packages:1']);
    expect(yesFor(kindRule('is this a GitHub repo')!)).toEqual(['web:2']);
    expect(kindRule('Is this a research paper?')).not.toBeNull();
    expect(kindRule('Is this a question someone asked on a forum?')).not.toBeNull();
  });

  it('leaves questions with a condition to Laya', () => {
    expect(kindRule('Is this a maintained npm package?')).toBeNull();
    expect(kindRule('Is this official documentation?')).toBeNull();
    expect(kindRule('Does this use TypeScript?')).toBeNull();
  });

  it('skips the model for rule answers', async () => {
    const judge: Judge = { ready: true, decide: async () => [], decideMany: vi.fn(async () => []) };
    const got: Record<string, number> = {};
    const { by } = await askRows('debounce', 'Is this an npm package?', rows, judge, (a) => Object.assign(got, a));
    expect(by).toBe('rule');
    expect(judge.decideMany).not.toHaveBeenCalled();
    expect(got).toEqual({ 'packages:1': 0.99, 'web:1': 0.01, 'web:2': 0.01 });
  });
});

describe('merging and ordering rows', () => {
  const hit = (place: Hit['place'], url: string, position: number): Hit => ({ id: `${place}:${position}`, place, url, title: url, snippet: '', position });

  it('folds the same URL from two places into one row', () => {
    const rows = mergeHits({ web: [hit('web', 'https://www.a.com/x/', 1)], hackernews: [hit('hackernews', 'https://a.com/x', 2)] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.places).toEqual(['web', 'hackernews']);
  });

  it('puts scored rows first by score, then unscored by rank', () => {
    const rows = mergeHits({ web: [hit('web', 'https://a.com', 1), hit('web', 'https://b.com', 2), hit('web', 'https://c.com', 3)] });
    rows[1]!.score = 0.9;
    rows[2]!.score = 0.4;
    expect(orderRows(rows).map((r) => r.url)).toEqual(['https://b.com', 'https://c.com', 'https://a.com']);
  });
});

describe('browser sources', () => {
  function stub(body: unknown) {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(body));
    }));
    return urls;
  }
  const signal = new AbortController().signal;

  it('reads the Mwmbl index', async () => {
    stub([{ url: 'https://tokio.rs', title: [{ value: 'Tokio' }, { value: ' runtime' }], extract: [{ value: 'An async &amp; fast runtime' }] }]);
    const [h] = await placeById('web').search('rust async', 'any', signal);
    expect(h).toMatchObject({ title: 'Tokio runtime', snippet: 'An async & fast runtime', url: 'https://tokio.rs', place: 'web', position: 1 });
  });

  it('filters Hacker News by date and links to the thread', async () => {
    const urls = stub({ hits: [{ objectID: '42', title: 'Tokio 2', url: 'https://tokio.rs/blog', points: 300, num_comments: 120, created_at: '2026-09-30T00:00:00Z' }] });
    const [h] = await placeById('hackernews').search('tokio', '7d', signal);
    expect(urls[0]).toMatch(/numericFilters=created_at_i>\d+/);
    expect(h).toMatchObject({ url: 'https://news.ycombinator.com/item?id=42', snippet: 'tokio.rs · 300 points, 120 comments' });
  });

  it('decodes Stack Overflow titles and rebuilds OpenAlex abstracts', async () => {
    stub({ items: [{ link: 'https://stackoverflow.com/q/1', title: 'What&#39;s a closure?', tags: ['js'], is_answered: true, answer_count: 3, score: 9 }] });
    const [so] = await placeById('stackoverflow').search('closure', 'any', signal);
    expect(so!.title).toBe("What's a closure?");
    expect(abstractText({ world: [1], hello: [0] })).toBe('hello world');
  });

  it('cleans README markup out of npm descriptions', async () => {
    stub({
      objects: [
        { package: { name: 'perfect-debounce', description: '<!-- automd:badges color=yellow -->', keywords: ['debounce', 'promise'] } },
        { package: { name: 'debounce-fn', description: 'Debounce a <b>function</b>' } },
      ],
    });
    const rows = await placeById('packages').search('debounce', 'any', signal);
    expect(rows.map((r) => r.snippet)).toEqual(['debounce, promise', 'Debounce a function']);
  });

  it('drops rows without a usable link', async () => {
    stub({ docs: [{ key: '/works/OL1W', title: 'Rust in Action', author_name: ['Tim McNamara'], first_publish_year: 2021 }, { key: '', title: '' }] });
    const rows = await placeById('books').search('rust', 'any', signal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: 'https://openlibrary.org/works/OL1W', snippet: 'Tim McNamara · first published 2021' });
  });
});

describe('Laya stored on the device', () => {
  function stubCache(entries: Record<string, number | null>) {
    const store = new Map(Object.entries(entries));
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      has: async (name: string) => name === MODEL_CACHE && store.size > 0,
      open: async () => ({
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        match: async (r: Request) => {
          const n = store.get(r.url);
          return new Response('', { headers: n === null || n === undefined ? {} : { 'content-length': String(n) } });
        },
      }),
      delete: async (name: string) => {
        deleted.push(name);
        store.clear();
        return true;
      },
    });
    return deleted;
  }
  const flags = new Map<string, string>();
  function stubBrowser(persisted: boolean, usage = 0) {
    flags.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => flags.get(k) ?? null,
      setItem: (k: string, v: string) => flags.set(k, v),
      removeItem: (k: string) => flags.delete(k),
    });
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => persisted, persist: async () => true, estimate: async () => ({ usage }) },
    });
  }

  it('adds up the cached files', async () => {
    stubBrowser(true);
    stubCache({ 'https://hf.co/a': 600 * 1024 * 1024, 'https://hf.co/b': 14 * 1024 * 1024 });
    expect(await stored()).toEqual({ bytes: 614 * 1024 * 1024, persisted: true });
  });

  it('falls back to the site usage when a file has no length', async () => {
    stubBrowser(false, 700);
    stubCache({ 'https://hf.co/a': 10, 'https://hf.co/b': null });
    expect(await stored()).toEqual({ bytes: 700, persisted: false });
  });

  it('asks the browser to keep it only when it is not kept already', async () => {
    stubBrowser(false);
    expect(await keepStored()).toBe(true);
  });

  it('removes the weights and the auto-load flag', async () => {
    stubBrowser(true);
    const deleted = stubCache({ 'https://hf.co/a': 1 });
    flags.set(CACHED_FLAG, '1');
    await removeStored();
    expect(deleted).toEqual([MODEL_CACHE]);
    expect(flags.has(CACHED_FLAG)).toBe(false);
    expect(await stored()).toMatchObject({ bytes: 0 });
  });
});

describe('pinned model and device warnings', () => {
  it('drops cached files from other model revisions only', async () => {
    const urls = [
      `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_fp16.onnx_data`,
      `https://hotragn.github.io/${MODEL_ID}/${MODEL_REVISION}/onnx/model_fp16.onnx_data`,
      'https://cdn.example/other-model/file.bin',
    ];
    const kept = new Set(urls);
    vi.stubGlobal('caches', {
      has: async () => true,
      open: async () => ({
        keys: async () => [...kept].map((u) => new Request(u)),
        delete: async (r: Request) => kept.delete(r.url),
      }),
    });
    expect(await dropStale()).toBe(1);
    expect([...kept]).toEqual(urls.slice(1));
  });

  it('warns on low memory, and on the CPU path', () => {
    expect(memoryWarning(true, 2)).toMatch(/reports 2 GB of memory.*more than 1 GB/);
    expect(memoryWarning(false, 2)).toMatch(/more than 2 GB/);
    expect(memoryWarning(false, 8)).toMatch(/no WebGPU/);
    expect(memoryWarning(true, 8)).toBeNull();
    expect(memoryWarning(true, undefined)).toBeNull();
  });
});
