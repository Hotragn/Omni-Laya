import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AskLaya, type AnswerView } from '@/components/ask-laya';
import { Colophon } from '@/components/colophon';
import { DecisionSentence } from '@/components/decision-sentence';
import { ModelLink } from '@/components/model-link';
import { RepositoryLink } from '@/components/repository-link';
import { Results, YES } from '@/components/results';
import { Working } from '@/components/working';
import { SearchBox } from '@/components/search-box';
import { ThemeToggle } from '@/components/theme-toggle';
import { Wordmark } from '@/components/wordmark';
import { applyRules, type Disagreement, type DomainRule } from '@/lib/proof';
import { clusterInOrder, type RankedItem, type SortMode } from '@/lib/rank';
import { HOME_CANONICAL, SEARCH_ROBOTS } from '@/lib/seo';
import { isSourceId, isWindowId, sourceById, type SourceId, type WindowId } from '@/lib/sources';
import { useAsk } from '@/lib/use-ask';
import { ASK_LIMIT, useAskLaya } from '@/lib/use-ask-laya';
import { useProofs } from '@/lib/use-proofs';
import { useStableOrder } from '@/lib/use-stable-order';

interface SearchParams {
  q: string;
  w?: WindowId;
  s?: string;
  sort?: SortMode;
}

function parseSources(s: string | undefined): SourceId[] | undefined {
  if (!s) return undefined;
  const ids = s.split(',').filter(isSourceId);
  return ids.length > 0 ? ids : undefined;
}

export const Route = createFileRoute('/search')({
  validateSearch: (raw: Record<string, unknown>): SearchParams => {
    const q = typeof raw.q === 'string' ? raw.q.slice(0, 300) : '';
    const out: SearchParams = { q };
    if (typeof raw.w === 'string' && isWindowId(raw.w)) out.w = raw.w;
    if (typeof raw.s === 'string' && raw.s) out.s = raw.s;
    if (raw.sort === 'newest') out.sort = 'newest';
    return out;
  },
  head: ({ match }) => ({
    meta: [
      { title: match.search.q ? `${match.search.q} · OmniLaya Search` : 'OmniLaya Search: open-source search ranked by Laya' },
      { name: 'robots', content: SEARCH_ROBOTS },
    ],
    links: [{ rel: 'canonical', href: HOME_CANONICAL }],
  }),
  component: SearchPage,
});

function Header({ q }: { q: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-dashed bg-background/90 backdrop-blur-md">
      <div className="relative mx-auto flex max-w-[70rem] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-5">
        <Wordmark size="sm" />
        <div className="order-last w-full min-w-0 max-w-2xl sm:order-none sm:flex-1">
          <SearchBox initial={q} compact key={q} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <RepositoryLink />
          <ModelLink />
        </div>
      </div>
    </header>
  );
}

const sortButton =
  'min-h-11 py-0.5 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-offset-4 aria-pressed:text-foreground sm:min-h-0';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function SearchPage() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: '/search' });
  const explicitSources = parseSources(params.s);
  const state = useAsk({ q: params.q, w: params.w, s: explicitSources });
  const [proofs, updateProofs] = useProofs();
  const askLaya = useAskLaya(params.q);
  const [view, setView] = useState<AnswerView>('mark');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    setFolded(new Set());
    setFocusedId(null);
    setView('mark');
  }, [params.q]);

  const sort = params.sort ?? 'best';
  const ordered = useStableOrder(state.items, sort);
  const { kept, blocked } = useMemo(() => applyRules(clusterInOrder(ordered), proofs.rules), [ordered, proofs.rules]);
  const answers = askLaya.state.answers;
  const question = askLaya.state.question;
  const clusters = useMemo(() => {
    if (!question || view === 'mark') return kept;
    if (view === 'filter') return kept.filter((c) => (answers[c.lead.id] ?? 0) >= YES);
    return [...kept].sort((a, b) => (answers[b.lead.id] ?? -1) - (answers[a.lead.id] ?? -1));
  }, [kept, answers, question, view]);
  const leads = useMemo(() => kept.map((c) => c.lead), [kept]);
  // Ask Laya only reads results above the cutting floor, best first, up to ASK_LIMIT.
  const askable = useMemo(
    () => leads.filter((item) => item.ranked && item.relevance >= proofs.floor).slice(0, ASK_LIMIT),
    [leads, proofs.floor]
  );
  const pending = askable.filter((item) => !(item.id in answers)).length;

  const setWindow = (w: WindowId | undefined) =>
    navigate({ search: (prev) => ({ ...prev, w }) });
  const setSources = (ids: SourceId[] | undefined) =>
    navigate({ search: (prev) => ({ ...prev, s: ids?.join(',') }) });
  const setSort = (mode: SortMode) =>
    navigate({
      search: (prev) => ({ ...prev, sort: mode === 'newest' ? mode : undefined }),
      resetScroll: false,
    });

  const disagreed = useMemo(
    () => new Set(proofs.disagreements.filter((d) => d.request === params.q).map((d) => d.url)),
    [proofs.disagreements, params.q]
  );

  const toggleFold = useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDisagree = useCallback(
    (item: RankedItem) => {
      updateProofs((p) => {
        const mine = (d: Disagreement) => d.request === params.q && d.url === item.url;
        if (p.disagreements.some(mine)) return { ...p, disagreements: p.disagreements.filter((d) => !mine(d)) };
        const stamp: Disagreement = {
          at: new Date().toISOString(),
          request: params.q,
          query: state.intent?.query ?? params.q,
          url: item.url,
          title: item.title,
          relevance: item.relevance,
          ...(state.intent?.checkpoint ? { checkpoint: state.intent.checkpoint } : {}),
        };
        return { ...p, disagreements: [...p.disagreements, stamp] };
      });
    },
    [updateProofs, params.q, state.intent]
  );

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

  const saveLens = (sources: SourceId[]) =>
    updateProofs((p) => {
      const name = sources.map((id) => sourceById(id).label).join(' + ').slice(0, 40);
      return { ...p, lenses: [...p.lenses.filter((l) => l.name !== name), { name, sources }] };
    });

  const ask = (text: string) => {
    const again = text.trim() === question;
    void askLaya.ask(text, again ? askable.filter((item) => !(item.id in answers)) : askable);
    if (!again && view === 'mark') setView('sort');
  };

  // Keyboard proofing. The handler reads the latest values through a ref so it is bound once.
  const latest = useRef({ focusedId, items: state.items, toggleFold, toggleDisagree, keys: proofs.keys });
  latest.current = { focusedId, items: state.items, toggleFold, toggleDisagree, keys: proofs.keys };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.keys || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      // An open menu (a lens menu, a picker) owns the keyboard until it closes.
      if (document.querySelector('[data-row] details[open]')) return;
      const { focusedId: current, items, toggleFold: fold, toggleDisagree: disagree } = latest.current;
      const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
      const index = rows.findIndex((row) => row.dataset.row === current);
      const item = items.find((i) => i.id === current);
      switch (event.key) {
        case 'j':
        case 'k': {
          if (rows.length === 0) return;
          const next = event.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
          const row = rows[next]!;
          setFocusedId(row.dataset.row ?? null);
          row.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'x':
          if (!current) return;
          fold(current);
          break;
        case 'd':
          if (!item?.ranked) return;
          disagree(item);
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Header q={params.q} />
      <main className="mx-auto w-full max-w-[70rem] px-4 py-6 sm:px-5">
        {params.q.trim() && <h1 className="sr-only">Results for {params.q}</h1>}
        {!params.q.trim() && <p className="text-muted-foreground">Type something to search.</p>}

        {state.phase === 'error' && (
          <div className="max-w-3xl rounded-[12px] border border-destructive/40 bg-card p-4 text-sm">
            <p className="font-medium">Search failed</p>
            <p className="mt-1 text-muted-foreground">{state.message}</p>
            {/laya/i.test(state.message ?? '') && (
              <p className="readout mt-3 text-muted-foreground">
                Self-hosting? Check that laya-serve is running and LAYA_BASE_URL points at it.
              </p>
            )}
          </div>
        )}

        {params.q.trim() && state.phase !== 'error' && (
          <div className="min-w-0">
            <DecisionSentence
              explicitSources={explicitSources}
              explicitWindow={params.w}
              lenses={proofs.lenses}
              onSaveLens={saveLens}
              onSources={setSources}
              onWindow={setWindow}
              state={state}
            />
            {state.intent && <Working
              state={state}
              actions={state.items.length > 0 && (
                <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs" role="group" aria-label="Sort results">
                  <button aria-pressed={sort === 'best'} className={sortButton} onClick={() => setSort('best')} type="button">
                    Best match
                  </button>
                  <span aria-hidden className="text-muted-foreground/40">/</span>
                  <button aria-pressed={sort === 'newest'} className={sortButton} onClick={() => setSort('newest')} type="button">
                    Newest
                  </button>
                </div>
              )}
            />}
            {state.items.length > 0 && (
              <div data-ask>
                <AskLaya
                  disabled={askable.length === 0}
                  limit={askable.length}
                  onAsk={ask}
                  onClear={() => {
                    askLaya.clear();
                    setView('mark');
                  }}
                  onView={setView}
                  pending={pending}
                  state={askLaya.state}
                  view={view}
                />
              </div>
            )}
            {blocked > 0 && (
              <p className="readout mt-3 text-muted-foreground">
                {blocked} {blocked === 1 ? 'result' : 'results'} hidden by your lens rules
              </p>
            )}
            {view === 'filter' && askLaya.state.status === 'done' && clusters.length === 0 && (
              <p className="mt-6 text-muted-foreground">Laya said no to every result. Try another question, or pick Mark only.</p>
            )}
            {!(view === 'filter' && askLaya.state.status === 'done' && clusters.length === 0) && <Results
              clusters={clusters}
              floor={proofs.floor}
              onFloor={(floor) => updateProofs((p) => ({ ...p, floor }))}
              proofing={{
                answers,
                question: question || undefined,
                focusedId,
                folded,
                disagreed,
                rules: proofs.rules,
                onFocus: setFocusedId,
                onFold: toggleFold,
                onDisagree: toggleDisagree,
                onRule: setRule,
              }}
              streaming={state.phase !== 'done'}
            />}
            <Colophon onProofs={updateProofs} proofs={proofs} state={state} />
          </div>
        )}
      </main>
    </>
  );
}
