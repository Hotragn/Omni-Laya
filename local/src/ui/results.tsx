import { useState } from 'react';
import { CuttingFloor, YES } from '@/components/results';
import { formatPublicationAge } from '@/lib/freshness';
import { OFF_TOPIC, domainOf, ruleFor, type DomainRule } from '@/lib/proof';
import { cn } from '@/lib/utils';
import type { Row } from '../pipeline';
import { placeById } from '../sources';

export interface RowMarks {
  answers?: Record<string, number>;
  question?: string;
  focusedId?: string | null;
  folded?: ReadonlySet<string>;
  disagreed?: ReadonlySet<string>;
  rules?: Record<string, DomainRule>;
  onFocus?: (id: string) => void;
  onFold?: (id: string) => void;
  onDisagree?: (row: Row) => void;
  onRule?: (domain: string, rule: DomainRule | undefined) => void;
}

const action = 'cursor-pointer underline-offset-2 hover:text-foreground hover:underline';

function host(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path.length > 40 ? `${path.slice(0, 40)}…` : path}`;
  } catch {
    return url;
  }
}

function age(date: string | undefined): string | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  const hours = (Date.now() - t) / 3_600_000;
  return formatPublicationAge({ publishedDate: date, ageHours: hours });
}

function Margin({ row, floor, scoring, laya, marks }: { row: Row; floor: number; scoring: boolean; laya: boolean; marks: RowMarks }) {
  const answer = marks.answers?.[row.id];
  const domain = domainOf(row.url);
  const rule = marks.rules ? ruleFor(row.url, marks.rules) : undefined;
  return (
    <div className="readout flex flex-wrap items-center gap-x-3 gap-y-1.5 md:block">
      {row.score !== undefined ? (
        <div className="mark-in flex items-center gap-2 md:block" title="How sure Laya is that this result is about what you asked">
          <span className={cn('mark-num', row.score >= floor ? 'text-seal' : 'text-muted-foreground')}>{Math.round(row.score * 100)} on topic</span>
          <span aria-hidden className="tick relative block h-1 w-[92px] overflow-hidden rounded-[2px] bg-seal-soft md:my-1.5">
            <span
              className={cn('absolute inset-y-0 left-0 rounded-[2px]', row.score >= floor ? 'bg-seal' : 'bg-muted-foreground/50')}
              style={{ width: `${Math.max(4, Math.round(row.score * 100))}%` }}
            />
          </span>
        </div>
      ) : (
        <span className="text-muted-foreground">{scoring ? 'judging…' : laya ? 'not scored' : `#${row.position} on ${placeById(row.place).label}`}</span>
      )}
      {marks.question && (
        <span
          className={cn(
            'stamp mr-1.5 inline-block whitespace-nowrap rounded-[4px] border px-1.5',
            answer === undefined ? 'border-dashed border-border text-muted-foreground' : answer >= YES ? 'border-seal text-seal' : 'border-muted-foreground/60 text-muted-foreground'
          )}
          title={`Laya's answer to "${marks.question}"`}
        >
          {answer === undefined ? 'not asked' : `${answer >= YES ? 'yes' : 'no'} ${Math.round(answer * 100)}`}
        </span>
      )}
      {marks.disagreed?.has(row.url) && (
        <span className="stamp inline-block rounded-[4px] border-[1.5px] border-seal px-1.5 font-semibold uppercase tracking-[0.04em] text-seal">disagreed</span>
      )}
      {rule && rule !== 'block' && <span className="block text-muted-foreground">{rule === 'raise' ? 'raised' : 'lowered'} by your lens</span>}
      <span className="flex flex-wrap gap-x-2 text-muted-foreground transition-opacity md:mt-2 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:group-data-focused:opacity-100">
        {marks.onDisagree && row.score !== undefined && (
          <button className={action} onClick={() => marks.onDisagree!(row)} title="Laya judged this wrongly (d)" type="button">
            {marks.disagreed?.has(row.url) ? 'undo' : 'disagree'}
          </button>
        )}
        {marks.onFold && (
          <button className={action} onClick={() => marks.onFold!(row.id)} title="Fold this result (x)" type="button">
            {marks.folded?.has(row.id) ? 'unfold' : 'fold'}
          </button>
        )}
        {marks.onRule && domain && (
          <details className="relative">
            <summary className={cn(action, 'list-none [&::-webkit-details-marker]:hidden')}>lens</summary>
            <span className="absolute right-0 z-10 mt-1 flex w-max flex-col rounded-[10px] border bg-card p-1 md:left-0 md:right-auto">
              <span className="px-2 py-1 text-muted-foreground">{domain}</span>
              {(['raise', 'lower', 'block'] as const).map((r) => (
                <button
                  aria-pressed={rule === r}
                  className={cn('min-h-9 rounded-[6px] px-2 text-left hover:bg-accent sm:min-h-7', rule === r ? 'text-seal' : 'text-foreground')}
                  key={r}
                  onClick={(event) => {
                    marks.onRule!(domain, rule === r ? undefined : r);
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
    </div>
  );
}

function ResultRow({ row, floor, scoring, laya, marks }: { row: Row; floor: number; scoring: boolean; laya: boolean; marks: RowMarks }) {
  const folded = marks.folded?.has(row.id) ?? false;
  const focused = marks.focusedId === row.id;
  const when = age(row.date);
  return (
    <li
      className={cn(
        'enter group relative border-t border-border py-[18px] md:grid md:grid-cols-[minmax(0,1fr)_184px] md:gap-x-7',
        focused && 'before:absolute before:-left-3 before:top-[18px] before:bottom-[18px] before:w-0.5 before:bg-seal md:before:-left-4'
      )}
      data-focused={focused ? '' : undefined}
      data-row={row.id}
      onClick={() => marks.onFocus?.(row.id)}
    >
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground/70">{placeById(row.place).label}</span>
          <span className="min-w-0 truncate">· {host(row.url)}</span>
          {when && <span className="shrink-0">· {when}</span>}
          {row.places.length > 1 && <span className="shrink-0">· found on {row.places.length} places</span>}
        </div>
        <a
          className={cn('print mt-0.5 block font-medium text-link visited:text-visited hover:underline', folded ? 'text-base' : 'text-[19px] leading-[1.35]')}
          href={row.url}
          rel="noreferrer"
          target="_blank"
        >
          {row.title}
        </a>
        {!folded && row.snippet && (
          <p className="print mt-1 line-clamp-3 text-[15px] leading-[1.6] text-[color-mix(in_oklch,var(--foreground)_80%,var(--background))]">{row.snippet}</p>
        )}
      </article>
      <div className="mt-2.5 md:mt-0.5 md:border-l md:border-[color-mix(in_oklch,var(--seal)_35%,transparent)] md:pl-4">
        <Margin floor={floor} laya={laya} marks={marks} row={row} scoring={scoring} />
      </div>
    </li>
  );
}

export function Results({
  rows,
  phase,
  laya,
  floor = OFF_TOPIC,
  onFloor,
  marks = {},
}: {
  rows: Row[];
  phase: string;
  laya: boolean;
  floor?: number;
  onFloor?: (value: number) => void;
  marks?: RowMarks;
}) {
  const [showBelow, setShowBelow] = useState(false);
  const busy = phase !== 'done';
  const scoring = phase === 'scoring';
  const above = rows.filter((r) => r.score === undefined || r.score >= floor);
  const below = rows.filter((r) => r.score !== undefined && r.score < floor);

  if (rows.length === 0) {
    if (busy) return null;
    return <p className="mt-8 text-muted-foreground">Nothing found. Try a wider time range, or add a place to the sentence above.</p>;
  }
  const render = (list: Row[]) => list.map((row) => <ResultRow floor={floor} key={row.id} laya={laya} marks={marks} row={row} scoring={scoring} />);

  return (
    <>
      <ol aria-label="Results" className="mt-6 border-b border-border">{render(above)}</ol>
      {!busy && laya && (
        <CuttingFloor below={below.length} floor={floor} onFloor={onFloor ?? (() => undefined)} onOpen={() => setShowBelow((v) => !v)} open={showBelow} />
      )}
      {showBelow && below.length > 0 && <ol aria-label="Results below the floor" className="mt-4 opacity-75">{render(below)}</ol>}
    </>
  );
}
