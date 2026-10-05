import { useState } from 'react';
import { formatPublicationAge } from '@/lib/freshness';
import { OFF_TOPIC, domainOf, ruleFor, type DomainRule } from '@/lib/proof';
import type { Cluster, RankedItem } from '@/lib/rank';
import { sourceById } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { SourceIcon } from './source-icon';

export { OFF_TOPIC };

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id') ?? u.searchParams.get('v');
    const path = u.pathname.replace(/\/$/, '') + (id ? `?${u.searchParams.has('id') ? 'id' : 'v'}=${id}` : '');
    return `${u.hostname.replace(/^www\./, '')}${path.length > 48 ? `${path.slice(0, 48)}…` : path}`;
  } catch {
    return url;
  }
}

/** Laya's yes probability at or above this reads as "yes". */
export const YES = 0.5;

export interface Proofing {
  /** Laya's answers to the reader's own question, by result id. */
  answers?: Record<string, number>;
  question?: string;
  focusedId?: string | null;
  folded?: ReadonlySet<string>;
  /** URLs the reader stamped as wrongly judged. */
  disagreed?: ReadonlySet<string>;
  rules?: Record<string, DomainRule>;
  onFocus?: (id: string) => void;
  onFold?: (id: string) => void;
  onDisagree?: (item: RankedItem) => void;
  onRule?: (domain: string, rule: DomainRule | undefined) => void;
}

const action = 'cursor-pointer underline-offset-2 hover:text-foreground hover:underline';

/** Laya's marks for one result, written in the margin. */
function MarginMark({
  item,
  streaming,
  floor,
  proofing,
}: {
  item: RankedItem;
  streaming: boolean;
  floor: number;
  proofing: Proofing;
}) {
  const { answers, question, disagreed, rules, onFold, onDisagree, onRule } = proofing;
  const answer = answers?.[item.id];
  const domain = domainOf(item.url);
  const rule = rules ? ruleFor(item.url, rules) : undefined;
  const pct = Math.round(item.relevance * 100);

  return (
    <div className="readout flex flex-wrap items-center gap-x-3 gap-y-1.5 md:block">
      {item.ranked ? (
        <div className="mark-in flex items-center gap-2 md:block" title="How sure Laya is that this result is about what you asked">
          <span className={cn('mark-num', item.relevance >= floor ? 'text-seal' : 'text-muted-foreground')}>{pct} on topic</span>
          <span aria-hidden className="tick meter relative block h-1 w-[92px] overflow-hidden rounded-[2px] bg-seal-soft md:my-1.5">
            <span
              className={cn('absolute inset-y-0 left-0 rounded-[2px]', item.relevance >= floor ? 'bg-seal' : 'bg-muted-foreground/50')}
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </span>
        </div>
      ) : (
        <span className="text-muted-foreground">{streaming ? 'judging…' : 'not scored'}</span>
      )}

      {question && (
        <span
          className={cn(
            'stamp mr-1.5 inline-block whitespace-nowrap rounded-[4px] border px-1.5',
            answer === undefined ? 'border-dashed border-border text-muted-foreground' : answer >= YES ? 'border-seal text-seal' : 'border-muted-foreground/60 text-muted-foreground'
          )}
          title={`Laya's answer to "${question}"`}
        >
          {answer === undefined ? 'not asked' : `${answer >= YES ? 'yes' : 'no'} ${Math.round(answer * 100)}`}
        </span>
      )}
      {disagreed?.has(item.url) && (
        <span className="stamp inline-block rounded-[4px] border-[1.5px] border-seal px-1.5 font-semibold uppercase tracking-[0.04em] text-seal">
          disagreed
        </span>
      )}
      {rule && rule !== 'block' && <span className="block text-muted-foreground">{rule === 'raise' ? 'raised' : 'lowered'} by your lens</span>}

      {(onDisagree || onFold || onRule) && (
        <span className="flex flex-wrap gap-x-2 text-muted-foreground transition-opacity md:mt-2 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:group-data-focused:opacity-100">
          {onDisagree && item.ranked && (
            <button className={action} onClick={() => onDisagree(item)} title="Laya judged this wrongly (d)" type="button">
              {disagreed?.has(item.url) ? 'undo' : 'disagree'}
            </button>
          )}
          {onFold && (
            <button className={action} onClick={() => onFold(item.id)} title="Fold this result (x)" type="button">
              {proofing.folded?.has(item.id) ? 'unfold' : 'fold'}
            </button>
          )}
          {onRule && domain && (
            <details className="relative">
              <summary className={cn(action, 'list-none [&::-webkit-details-marker]:hidden')} title={`Lens rules for ${domain}`}>
                lens
              </summary>
              <span className="absolute right-0 z-10 mt-1 flex w-max flex-col rounded-[10px] border bg-card p-1 md:left-0 md:right-auto">
                <span className="px-2 py-1 text-muted-foreground">{domain}</span>
                {(['raise', 'lower', 'block'] as const).map((r) => (
                  <button
                    aria-pressed={rule === r}
                    className={cn('min-h-9 rounded-[6px] px-2 text-left hover:bg-accent sm:min-h-7', rule === r ? 'text-seal' : 'text-foreground')}
                    key={r}
                    onClick={(event) => {
                      onRule(domain, rule === r ? undefined : r);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                    type="button"
                  >
                    {r}
                  </button>
                ))}
              </span>
            </details>
          )}
        </span>
      )}
    </div>
  );
}

function ResultRow({
  cluster,
  streaming,
  floor,
  proofing,
}: {
  cluster: Cluster;
  streaming: boolean;
  floor: number;
  proofing: Proofing;
}) {
  const item = cluster.lead;
  const age = formatPublicationAge(item);
  const folded = proofing.folded?.has(item.id) ?? false;
  const focused = proofing.focusedId === item.id;

  return (
    <li
      className={cn(
        'enter group relative border-t border-border py-[18px] md:grid md:grid-cols-[minmax(0,1fr)_184px] md:gap-x-7',
        focused && 'before:absolute before:-left-3 before:top-[18px] before:bottom-[18px] before:w-0.5 before:bg-seal md:before:-left-4'
      )}
      data-focused={focused ? '' : undefined}
      data-row={item.id}
      id={`row-${item.id}`}
      onClick={() => proofing.onFocus?.(item.id)}
    >
      <article className="min-w-0">
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-foreground/70" title={sourceById(item.source).label}>
            <SourceIcon className="size-3.5" id={item.source} ink />
          </span>
          <span className="truncate">{displayUrl(item.url)}</span>
          {age && <span className="shrink-0">· <time dateTime={item.publishedDate}>{age}</time></span>}
          {item.engines.length > 1 && (
            <span className="hidden shrink-0 sm:inline" title={item.engines.join(' + ')}>· found by {item.engines.length} engines</span>
          )}
        </div>
        <a
          className={cn(
            'print mt-0.5 block font-medium text-link visited:text-visited hover:underline',
            folded ? 'text-base' : 'text-[19px] leading-[1.35]'
          )}
          href={item.url}
          rel="noreferrer"
          target="_blank"
        >
          {item.title}
        </a>
        {!folded && item.snippet && (
          <p className="print mt-1 line-clamp-3 text-[15px] leading-[1.6] text-[color-mix(in_oklch,var(--foreground)_80%,var(--background))]">
            {item.snippet}
          </p>
        )}
        {!folded && cluster.others.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-l border-dashed border-input pl-3 text-sm">
            {cluster.others.map((other) => (
              <li className="min-w-0" key={other.id}>
                <a className="print text-link visited:text-visited hover:underline" href={other.url} rel="noreferrer" target="_blank">
                  {other.title}
                </a>
                <span className="text-xs text-muted-foreground"> · {displayUrl(other.url)}</span>
                {other.ranked && <span className="readout text-muted-foreground"> · {Math.round(other.relevance * 100)}</span>}
              </li>
            ))}
          </ul>
        )}
      </article>
      <div className="mt-2.5 md:mt-0.5 md:border-l md:border-[color-mix(in_oklch,var(--seal)_35%,transparent)] md:pl-4">
        <MarginMark floor={floor} item={item} proofing={proofing} streaming={streaming} />
      </div>
    </li>
  );
}

/**
 * Where the page is cut: results Laya scored below the floor fold away under
 * it. The reader moves the floor; the default is Laya's own off-topic line.
 */
export function CuttingFloor({
  floor,
  below,
  open,
  onFloor,
  onOpen,
}: {
  floor: number;
  below: number;
  open: boolean;
  onFloor: (value: number) => void;
  onOpen: () => void;
}) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[12px] bg-fold px-[18px] py-4 text-sm">
      <label className="flex items-center gap-3">
        <span className="font-semibold uppercase tracking-[0.1em] text-[11px] text-muted-foreground">Cutting floor</span>
        <input
          aria-label="Cutting floor: hide results Laya scored below this"
          className="w-44 accent-seal"
          max={90}
          min={0}
          onChange={(event) => onFloor(Number(event.target.value) / 100)}
          step={5}
          type="range"
          value={Math.round(floor * 100)}
        />
        <span className="readout w-8 text-seal">{Math.round(floor * 100)}</span>
      </label>
      {below > 0 ? (
        <button className="min-h-11 text-left text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0" onClick={onOpen} type="button">
          {open ? 'Hide' : 'Show'} {below} {below === 1 ? 'result' : 'results'} below the floor
        </button>
      ) : (
        <span className="text-muted-foreground">Nothing below the floor</span>
      )}
      {Math.abs(floor - OFF_TOPIC) > 0.001 && (
        <button className="readout text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => onFloor(OFF_TOPIC)} type="button">
          reset to Laya&apos;s line ({Math.round(OFF_TOPIC * 100)})
        </button>
      )}
    </div>
  );
}

export function Results({
  clusters,
  streaming,
  floor = OFF_TOPIC,
  onFloor,
  proofing = {},
}: {
  clusters: Cluster[];
  streaming: boolean;
  floor?: number;
  onFloor?: (value: number) => void;
  proofing?: Proofing;
}) {
  const [showBelow, setShowBelow] = useState(false);
  // Unscored rows stay above the floor until Laya has judged them.
  const above = clusters.filter((c) => !c.lead.ranked || c.lead.relevance >= floor);
  const below = clusters.filter((c) => c.lead.ranked && c.lead.relevance < floor);

  if (clusters.length === 0) {
    if (streaming) return null;
    return (
      <p className="mt-8 text-muted-foreground">
        Nothing found. Try a wider time range, or add a place to the sentence above.
      </p>
    );
  }

  const render = (list: Cluster[]) =>
    list.map((cluster) => (
      <ResultRow cluster={cluster} floor={floor} key={cluster.lead.id} proofing={proofing} streaming={streaming} />
    ));

  return (
    <>
      <ol aria-label="Results" className="mt-6 border-b border-border">{render(above)}</ol>
      {!streaming && (
        <CuttingFloor
          below={below.length}
          floor={floor}
          onFloor={onFloor ?? (() => undefined)}
          onOpen={() => setShowBelow((v) => !v)}
          open={showBelow}
        />
      )}
      {showBelow && below.length > 0 && (
        <ol aria-label="Results below the floor" className="mt-4 opacity-75">{render(below)}</ol>
      )}
    </>
  );
}
