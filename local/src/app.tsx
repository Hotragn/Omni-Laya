import { ArrowRightIcon, SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AskLaya, type AnswerView } from '@/components/ask-laya';
import { ThemeToggle } from '@/components/theme-toggle';
import { YES } from '@/components/results';
import { ruleFor, toJsonl, type Disagreement, type DomainRule } from '@/lib/proof';
import { isWindowId, type WindowId } from '@/lib/sources';
import { useProofs } from '@/lib/use-proofs';
import { cn } from '@/lib/utils';
import { hasFp16WebGpu } from './laya/gpu';
import { laya, type LayaStatus } from './laya/client';
import { orderRows, type Row } from './pipeline';
import { PLACES, placeById, type PlaceId } from './sources';
import { CACHED_FLAG, dropStale, keepStored, removeStored } from './laya/storage';
import { LayaCard, StoredLine } from './ui/laya-card';
import { Mark } from './ui/mark';
import { Results } from './ui/results';
import { Sentence } from './ui/sentence';
import { useLocalAsk, useSearch } from './use-search';

const ASK_LIMIT = 24;

interface Params {
  q: string;
  places?: PlaceId[];
  window?: WindowId;
}

function readParams(): Params {
  const s = new URLSearchParams(location.search);
  const places = (s.get('p') ?? '').split(',').filter((p): p is PlaceId => PLACES.some((x) => x.id === p));
  const w = s.get('w') ?? '';
  return { q: (s.get('q') ?? '').slice(0, 300), ...(places.length ? { places } : {}), ...(isWindowId(w) ? { window: w } : {}) };
}

function writeParams(p: Params, replace = false) {
  const s = new URLSearchParams();
  if (p.q) s.set('q', p.q);
  if (p.places?.length) s.set('p', p.places.join(','));
  if (p.window) s.set('w', p.window);
  const url = `${location.pathname}${s.size ? `?${s}` : ''}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

function SearchForm({ initial, compact, onSearch }: { initial: string; compact?: boolean; onSearch: (q: string) => void }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.replace(/\s+/g, ' ').trim();
        if (q) onSearch(q);
      }}
      role="search"
    >
      <SearchIcon aria-hidden className={cn('pointer-events-none absolute left-4 text-muted-foreground', compact ? 'top-3 size-4' : 'top-4 size-5')} />
      <input
        aria-label="Search"
        autoComplete="off"
        className={cn(
          'block w-full rounded-[14px] border border-input bg-card pl-11 outline-none placeholder:text-muted-foreground hover:border-foreground/40 focus-visible:border-foreground',
          compact ? 'h-11 pr-12 text-[15px]' : 'h-14 pr-14 text-base'
        )}
        enterKeyHint="search"
        maxLength={300}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask the web any way you like"
        value={value}
      />
      <button
        aria-label="Search"
        className={cn('absolute right-2 inline-flex items-center justify-center rounded-[10px] bg-primary text-primary-foreground hover:opacity-85 disabled:opacity-25', compact ? 'top-1.5 size-8' : 'top-2 size-10')}
        disabled={!value.trim()}
        type="submit"
      >
        <ArrowRightIcon aria-hidden className="size-4" />
      </button>
    </form>
  );
}

const EXAMPLES = [
  'Rust async runtimes on Hacker News this month',
  'How do I debounce a function in JavaScript?',
  'New papers on speculative decoding',
];

const PROMISES = [
  ['Runs on your device', 'Laya, the model that reads your request and ranks the results, runs in this tab. There is no OmniLaya server.'],
  ['Every score in the open', 'Each result shows how sure Laya is, and you can strike a place, move the cutoff, or mark Laya wrong.'],
  ['Free, no account', 'Keyless open sources: an open web index, Wikipedia, Hacker News, GitHub, Stack Overflow, OpenAlex, Open Library and npm.'],
] as const;

export function App() {
  const [params, setParams] = useState<Params>(readParams);
  const [status, setStatus] = useState<LayaStatus>(laya.status);
  const [fastGpu, setFastGpu] = useState<boolean | null>(null);
  const [proofs, updateProofs] = useProofs();
  const [view, setView] = useState<AnswerView>('mark');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => laya.subscribe(setStatus), []);
  useEffect(() => {
    void hasFp16WebGpu().then(setFastGpu);
    let cached = false;
    try {
      cached = localStorage.getItem(CACHED_FLAG) === '1';
    } catch {
      /* storage blocked: the reader can still load Laya by hand */
    }
    if (cached) laya.load();
    const onPop = () => setParams(readParams());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (status.phase !== 'ready') return;
    try {
      localStorage.setItem(CACHED_FLAG, '1');
    } catch {
      /* fine */
    }
    void keepStored();
    void dropStale();
  }, [status.phase]);

  const removeLaya = useCallback(async () => {
    laya.unload();
    await removeStored();
  }, []);

  // Result pages are one HTML file with a query string: keep them out of search
  // indexes and give each tab a title that says what it holds.
  useEffect(() => {
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (params.q) {
      robots ??= Object.assign(document.createElement('meta'), { name: 'robots' });
      robots.content = 'noindex';
      document.head.appendChild(robots);
      document.title = `${params.q} · OmniLaya Search`;
    } else {
      robots?.remove();
      document.title = 'OmniLaya Search: search that runs on your device';
    }
  }, [params.q]);

  const go = useCallback((next: Params, replace = false) => {
    writeParams(next, replace);
    setParams(next);
    setFolded(new Set());
    setFocusedId(null);
    setView('mark');
    scrollTo({ top: 0 });
  }, []);

  const judgeVersion = status.phase === 'ready' ? 'laya' : 'rules';
  const state = useSearch(params.q, { places: params.places, window: params.window }, laya, judgeVersion);
  const ask = useLocalAsk(params.q, laya);
  const answers = ask.state.answers;

  const ordered = useMemo(() => {
    const rows = orderRows(state.rows).filter((r) => ruleFor(r.url, proofs.rules) !== 'block');
    const raised = rows.filter((r) => ruleFor(r.url, proofs.rules) === 'raise');
    const lowered = rows.filter((r) => ruleFor(r.url, proofs.rules) === 'lower');
    return [...raised, ...rows.filter((r) => !raised.includes(r) && !lowered.includes(r)), ...lowered];
  }, [state.rows, proofs.rules]);
  const blocked = state.rows.length - ordered.length;
  const shown = useMemo(() => {
    if (!ask.state.question || view === 'mark') return ordered;
    if (view === 'filter') return ordered.filter((r) => (answers[r.id] ?? 0) >= YES);
    return [...ordered].sort((a, b) => (answers[b.id] ?? -1) - (answers[a.id] ?? -1));
  }, [ordered, answers, ask.state.question, view]);
  const askable = useMemo(
    () => ordered.filter((r) => r.score === undefined || r.score >= proofs.floor).slice(0, ASK_LIMIT),
    [ordered, proofs.floor]
  );
  const pending = askable.filter((r) => !(r.id in answers)).length;

  const disagreed = useMemo(
    () => new Set(proofs.disagreements.filter((d) => d.request === params.q).map((d) => d.url)),
    [proofs.disagreements, params.q]
  );
  const toggleDisagree = useCallback(
    (row: Row) =>
      updateProofs((p) => {
        const mine = (d: Disagreement) => d.request === params.q && d.url === row.url;
        if (p.disagreements.some(mine)) return { ...p, disagreements: p.disagreements.filter((d) => !mine(d)) };
        const stamp: Disagreement = {
          at: new Date().toISOString(),
          request: params.q,
          query: state.intent?.query ?? params.q,
          url: row.url,
          title: row.title,
          relevance: row.score ?? 0,
          checkpoint: 'multilingual (browser)',
        };
        return { ...p, disagreements: [...p.disagreements, stamp] };
      }),
    [updateProofs, params.q, state.intent]
  );
  const toggleFold = useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setRule = useCallback(
    (domain: string, rule: DomainRule | undefined) =>
      updateProofs((p) => {
        const rules = { ...p.rules };
        if (rule) rules[domain] = rule;
        else delete rules[domain];
        return { ...p, rules };
      }),
    [updateProofs]
  );

  // Keyboard proofing, as in the server app; off when the reader turns keys off.
  const latest = useRef({ focusedId, rows: state.rows, toggleFold, toggleDisagree, keys: proofs.keys });
  latest.current = { focusedId, rows: state.rows, toggleFold, toggleDisagree, keys: proofs.keys };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const t = event.target;
      if (!latest.current.keys || event.metaKey || event.ctrlKey || event.altKey) return;
      if (t instanceof HTMLElement && t.closest('input, textarea, select')) return;
      if (document.querySelector('[data-row] details[open]')) return;
      const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
      const { focusedId: current, rows: all } = latest.current;
      const index = rows.findIndex((r) => r.dataset.row === current);
      const row = all.find((r) => r.id === current);
      switch (event.key) {
        case 'j':
        case 'k': {
          if (rows.length === 0) return;
          const next = rows[event.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)]!;
          setFocusedId(next.dataset.row ?? null);
          next.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'x':
          if (!current) return;
          latest.current.toggleFold(current);
          break;
        case 'd':
          if (!row || row.score === undefined) return;
          latest.current.toggleDisagree(row);
          break;
        case 'o':
          if (index < 0) return;
          rows[index]!.querySelector<HTMLAnchorElement>('a[href]')?.click();
          break;
        case 'e':
          document.querySelector<HTMLElement>('[data-sentence] button')?.focus();
          break;
        case '/':
          document.querySelector<HTMLElement>('[data-ask] input')?.focus();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const head = (
    <div className="absolute right-4 top-4 flex items-center gap-1 sm:right-6">
      <ThemeToggle />
    </div>
  );

  if (!params.q) {
    return (
      <main className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-4 py-20">
        {head}
        <Mark className="size-16 sm:size-20" />
        <h1 className="display mt-4 text-center text-[clamp(2.6rem,6vw,3.9rem)] leading-none tracking-[-0.02em]">
          OmniLaya <span className="font-medium text-muted-foreground">Search</span>
        </h1>
        <p className="mt-3 max-w-md text-balance text-center text-[15px] text-muted-foreground sm:text-base">
          Search that runs on your device. No server, no account, every score in the open.
        </p>
        <div className="mt-8 w-full">
          <SearchForm initial="" onSearch={(q) => go({ q })} />
        </div>
        <ul aria-label="Example searches" className="mt-3 w-full divide-y divide-dashed divide-border text-[15px] sm:text-sm">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <button className="flex min-h-11 w-full items-center px-4 py-2.5 text-left text-muted-foreground hover:text-foreground hover:underline" onClick={() => go({ q })} type="button">
                {q}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-10 w-full">
          <LayaCard fastGpu={fastGpu} onLoad={() => laya.load()} onRemove={removeLaya} status={status} />
        </div>
        <dl className="mt-12 grid w-full gap-5 border-t-[3px] border-double border-border pt-6 text-sm sm:grid-cols-3">
          {PROMISES.map(([title, body]) => (
            <div key={title}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</dt>
              <dd className="mt-1.5 text-foreground/85">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="readout mt-10 text-center text-muted-foreground">
          Judgment by{' '}
          <a className="underline underline-offset-2" href="https://huggingface.co/convaiinnovations/laya" rel="noreferrer" target="_blank">
            Laya
          </a>{' '}
          · browser runtime adapted from{' '}
          <a className="underline underline-offset-2" href="https://github.com/shreyaskarnik/open-jev" rel="noreferrer" target="_blank">
            open-jev
          </a>{' '}
          · no generated answers ·{' '}
          <a className="underline underline-offset-2" href="about">
            about and privacy
          </a>
        </p>
      </main>
    );
  }

  const shares = state.intent?.shares ?? {};
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-dashed bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[70rem] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-5">
          <button className="inline-flex min-h-11 items-center gap-2" onClick={() => go({ q: '' })} type="button" aria-label="OmniLaya Search home">
            <Mark className="size-7" />
            <span className="display text-[1.35rem] leading-tight tracking-[-0.015em]">OmniLaya</span>
          </button>
          <div className="order-last w-full min-w-0 max-w-2xl sm:order-none sm:flex-1">
            <SearchForm compact initial={params.q} onSearch={(q) => go({ q })} />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[70rem] px-4 py-6 sm:px-5">
        <h1 className="sr-only">Results for {params.q}</h1>
        {state.phase === 'error' ? (
          <p className="text-destructive">Search failed: {state.message}</p>
        ) : (
          <>
            <Sentence onPlaces={(places) => go({ ...params, places }, true)} onWindow={(window) => go({ ...params, window }, true)} state={state} />
            <p className="readout mt-3 text-muted-foreground" aria-live="polite">
              {state.phase === 'reading' && 'Reading your request…'}
              {state.phase === 'searching' && `Asking ${state.intent?.places.map((p) => placeById(p).label).join(', ')}…`}
              {state.phase === 'scoring' && `Laya is judging ${state.rows.length} results on this device…`}
              {state.phase === 'done' &&
                `${state.rows.length} found${state.scoreMs !== null ? ` · judged on this device in ${(state.scoreMs / 1000).toFixed(1)} s` : ''}${
                  state.totalMs !== null ? ` · page in ${(state.totalMs / 1000).toFixed(1)} s` : ''
                }`}
            </p>
            {status.phase !== 'ready' && (
              <div className="mt-4 rounded-[12px] bg-fold px-[18px] py-4">
                <LayaCard compact fastGpu={fastGpu} onLoad={() => laya.load()} onRemove={removeLaya} status={status} />
              </div>
            )}
            {status.phase === 'ready' && state.rows.length > 0 && (
              <div data-ask>
                <AskLaya
                  disabled={askable.length === 0}
                  limit={askable.length}
                  onAsk={(question) => {
                    const again = question.trim() === ask.state.question;
                    void ask.ask(question, again ? askable.filter((r) => !(r.id in answers)) : askable);
                    if (!again && view === 'mark') setView('sort');
                  }}
                  onClear={() => {
                    ask.clear();
                    setView('mark');
                  }}
                  onView={setView}
                  pending={pending}
                  state={ask.state}
                  view={view}
                />
              </div>
            )}
            {blocked > 0 && <p className="readout mt-3 text-muted-foreground">{blocked} hidden by your lens rules</p>}
            <Results
              floor={proofs.floor}
              laya={status.phase === 'ready'}
              marks={{
                answers,
                question: ask.state.question || undefined,
                focusedId,
                folded,
                disagreed,
                rules: proofs.rules,
                onFocus: setFocusedId,
                onFold: toggleFold,
                onDisagree: toggleDisagree,
                onRule: setRule,
              }}
              onFloor={(floor) => updateProofs((p) => ({ ...p, floor }))}
              phase={state.phase}
              rows={shown}
            />
            {state.phase === 'done' && (
              <footer aria-label="Colophon" className="mt-9 grid gap-x-7 gap-y-5 border-t-[3px] border-double border-border pt-5 text-sm [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
                <div>
                  <b className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Where Laya looked</b>
                  {state.intent?.by === 'laya' ? (
                    PLACES.map((p) => ({ p, v: shares[p.id] ?? 0 }))
                      .sort((a, b) => b.v - a.v)
                      .slice(0, 4)
                      .map(({ p, v }) => (
                        <div className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2" key={p.id}>
                          <span className={cn('truncate', state.intent?.places.includes(p.id) ? '' : 'text-muted-foreground')}>{p.label}</span>
                          <span aria-hidden className="relative h-1 overflow-hidden rounded-[2px] bg-seal-soft">
                            <span className="absolute inset-y-0 left-0 bg-seal" style={{ width: `${Math.max(2, Math.round(v * 100))}%` }} />
                          </span>
                          <span className="readout text-right text-muted-foreground">{Math.round(v * 100)}</span>
                        </div>
                      ))
                  ) : (
                    <p className="text-muted-foreground">Chosen by rule. Bring Laya here to let it choose.</p>
                  )}
                </div>
                <div>
                  <b className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Set by</b>
                  <p>
                    {status.phase === 'ready'
                      ? `Laya multilingual, on this device (${status.device === 'webgpu' ? 'GPU' : 'CPU'}, ${status.dtype}).`
                      : 'Rules in this page; Laya is not on this device.'}
                  </p>
                  <p className="readout mt-1 text-muted-foreground">
                    nothing you typed went to an OmniLaya server ·{' '}
                    <a className="underline underline-offset-2 hover:text-foreground" href="about#privacy">
                      who sees what
                    </a>
                  </p>
                  {status.phase === 'ready' && (
                    <div className="readout text-muted-foreground">
                      <StoredLine onRemove={removeLaya} />
                    </div>
                  )}
                </div>
                <div>
                  <b className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Your marks</b>
                  <p>{proofs.disagreements.length === 0 ? 'No disagreements yet.' : `${proofs.disagreements.length} kept in this browser.`}</p>
                  {proofs.disagreements.length > 0 && (
                    <button
                      className="readout mt-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        const url = URL.createObjectURL(new Blob([toJsonl(proofs.disagreements)], { type: 'application/x-ndjson' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'omnilaya-disagreements.jsonl';
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                      type="button"
                    >
                      export JSONL
                    </button>
                  )}
                </div>
                <div className="hidden md:block">
                  <b className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Proofing keys</b>
                  <button
                    aria-pressed={proofs.keys}
                    className="readout mb-1 block text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => updateProofs((p) => ({ ...p, keys: !p.keys }))}
                    type="button"
                  >
                    {proofs.keys ? 'keys on: turn off' : 'keys off: turn on'}
                  </button>
                  <p className={cn('readout leading-6 text-muted-foreground', !proofs.keys && 'opacity-50')}>
                    <kbd>j</kbd> <kbd>k</kbd> move · <kbd>o</kbd> open · <kbd>x</kbd> fold · <kbd>d</kbd> disagree · <kbd>/</kbd> ask
                  </p>
                </div>
              </footer>
            )}
          </>
        )}
      </main>
    </>
  );
}
