import { TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { mentionsTime } from '@/lib/candidates';
import type { Lens } from '@/lib/proof';
import { sourcesOf } from '@/lib/rank';
import { DEFAULT_WINDOW, SOURCES, SOURCE_IDS, WINDOWS, pickSources, sourceById, type SourceId, type WindowId } from '@/lib/sources';
import type { AskState } from '@/lib/use-ask';
import { cn } from '@/lib/utils';

const WINDOW_PHRASE: Record<WindowId, string> = {
  any: 'any time',
  '24h': 'the past 24 hours',
  '7d': 'the past week',
  '30d': 'the past month',
};

function joined(parts: React.ReactNode[]): React.ReactNode[] {
  return parts.flatMap((part, i) => {
    if (i === 0) return [part];
    return [i === parts.length - 1 ? ' and ' : ', ', part];
  });
}

const pick =
  'cursor-pointer rounded-[2px] border-b-2 border-seal px-px outline-offset-4 hover:bg-seal-soft focus-visible:bg-seal-soft';
const menuItem =
  'min-h-11 rounded-[8px] border border-dashed border-input px-3 text-sm text-muted-foreground hover:border-solid hover:text-foreground sm:min-h-8';

/**
 * What Laya decided, written as one sentence the reader can edit: "Laya
 * searched Google, DuckDuckGo and Yandex from any time." Every underlined
 * word is a choice. Tapping a place strikes it out, tapping a struck place
 * brings it back, tapping the time opens the other windows. Places Laya did
 * not choose are behind "add a place".
 */
export function DecisionSentence({
  state,
  explicitWindow,
  explicitSources,
  onWindow,
  onSources,
  lenses = [],
  onSaveLens,
}: {
  state: AskState;
  explicitWindow: WindowId | undefined;
  explicitSources: SourceId[] | undefined;
  onWindow: (w: WindowId | undefined) => void;
  onSources: (s: SourceId[] | undefined) => void;
  lenses?: Lens[];
  onSaveLens?: (sources: SourceId[]) => void;
}) {
  const [menu, setMenu] = useState<'window' | 'add' | null>(null);
  const { intent } = state;

  if (!intent) {
    return (
      <div className="min-h-[4.5rem]">
        <p className="print text-[20px] leading-normal text-muted-foreground">Laya is reading your request…</p>
      </div>
    );
  }

  // What Laya chose on its own, worked out the same way the server does, so the
  // sentence can show what the reader struck out or added.
  const layaSources = pickSources(intent.inferred.sources, intent.request);
  const layaWindow = mentionsTime(intent.request) ? intent.inferred.window.choice : DEFAULT_WINDOW;
  const current = new Set(intent.sources);
  const laya = new Set(layaSources);
  const words = SOURCE_IDS.filter((id) => current.has(id) || laya.has(id));
  const struck = words.filter((id) => !current.has(id));
  const added = words.filter((id) => current.has(id) && !laya.has(id));
  const overridden = Boolean(explicitWindow || explicitSources);

  const counts = new Map<SourceId, number>();
  for (const item of state.items) for (const id of sourcesOf(item)) counts.set(id, (counts.get(id) ?? 0) + 1);

  const setCurrent = (next: Set<SourceId>) => {
    if (next.size === 0) return;
    onSources(SOURCE_IDS.filter((id) => next.has(id)));
  };
  const toggle = (id: SourceId) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCurrent(next);
  };

  const word = (id: SourceId) => {
    const source = sourceById(id);
    if (!current.has(id)) {
      return (
        <button
          aria-label={`${source.label}: struck out. Click to search it again.`}
          className="cursor-pointer text-muted-foreground line-through decoration-seal decoration-2 outline-offset-4"
          key={id}
          onClick={() => toggle(id)}
          type="button"
        >
          {source.label}
        </button>
      );
    }
    const lanes = source.lanes.map((l) => state.lanes[`${id}/${l.service}`]);
    const done = lanes.every(Boolean);
    const failed = done && lanes.every((l) => l?.error && l.items.length === 0);
    const count = counts.get(id) ?? 0;
    return (
      <span className="whitespace-nowrap" key={id}>
        <button
          aria-label={
            failed
              ? `${source.label}: search failed. Click to leave it out.`
              : `${source.label}${done ? `, ${count} ${count === 1 ? 'result' : 'results'}` : ''}. Click to leave it out.`
          }
          className={cn(pick, !laya.has(id) && 'border-dashed')}
          onClick={() => toggle(id)}
          title={laya.has(id) ? 'Laya chose this. Click to strike it out.' : 'You added this. Click to remove it.'}
          type="button"
        >
          {source.label}
        </button>
        <sup className="readout ml-0.5 text-seal">
          {failed ? <TriangleAlertIcon aria-hidden className="inline size-3 text-destructive" /> : done ? <span>{count}</span> : null}
        </sup>
      </span>
    );
  };

  const others = SOURCES.filter((s) => !words.includes(s.id));
  const changes: string[] = [];
  if (struck.length) changes.push(`${struck.map((id) => sourceById(id).label).join(', ')} struck by you`);
  if (added.length) changes.push(`${added.map((id) => sourceById(id).label).join(', ')} added by you`);
  if (explicitWindow && explicitWindow !== layaWindow) changes.push('time changed by you');

  return (
    <div className="enter" data-sentence>
      <p className="print text-[20px] leading-normal">
        Laya searched {joined(words.map(word))} from{' '}
        <button
          aria-expanded={menu === 'window'}
          className={cn(pick, explicitWindow && explicitWindow !== layaWindow && 'border-dashed')}
          onClick={() => setMenu((m) => (m === 'window' ? null : 'window'))}
          title="How far back to look"
          type="button"
        >
          {WINDOW_PHRASE[intent.window]}
        </button>
        .{' '}
        {others.length > 0 && (
          <button
            aria-expanded={menu === 'add'}
            className="cursor-pointer whitespace-nowrap border-b border-dashed border-muted-foreground text-muted-foreground outline-offset-4 hover:text-foreground"
            onClick={() => setMenu((m) => (m === 'add' ? null : 'add'))}
            type="button"
          >
            + add a place
          </button>
        )}
      </p>

      {menu === 'window' && (
        <div className="enter mt-2 flex flex-wrap gap-2" role="group" aria-label="How far back to look">
          {WINDOWS.map((w) => (
            <button
              aria-pressed={intent.window === w.id}
              className={cn(menuItem, intent.window === w.id && 'border-solid border-seal text-seal')}
              key={w.id}
              onClick={() => {
                setMenu(null);
                onWindow(w.id === layaWindow && !explicitSources ? undefined : w.id);
              }}
              type="button"
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
      {menu === 'add' && (
        <div className="enter mt-2 flex flex-wrap gap-2" role="group" aria-label="Add a place">
          {others.map((s) => (
            <button
              className={menuItem}
              key={s.id}
              onClick={() => {
                setMenu(null);
                toggle(s.id);
              }}
              type="button"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <p className="readout mt-1.5 flex flex-wrap gap-x-2 text-muted-foreground">
        <span>
          read by laya{intent.checkpoint ? `/${intent.checkpoint}` : ''} in {(intent.intentMs / 1000).toFixed(1)} s
        </span>
        {changes.map((c) => (
          <span key={c}>· {c}</span>
        ))}
        {overridden ? (
          <span>
            ·{' '}
            <button
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                onWindow(undefined);
                onSources(undefined);
              }}
              type="button"
            >
              let Laya decide
            </button>
          </span>
        ) : (
          <span className="hidden sm:inline">· tap any underlined word to change it</span>
        )}
        {onSaveLens && (
          <span>
            ·{' '}
            <button
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              onClick={() => onSaveLens(intent.sources)}
              title="Keep these places as a lens you can apply to any search"
              type="button"
            >
              save as lens
            </button>
          </span>
        )}
      </p>

      {lenses.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="readout text-muted-foreground">lenses</span>
          {lenses.map((lens) => {
            const on = lens.sources.length === intent.sources.length && lens.sources.every((id) => current.has(id));
            return (
              <button
                aria-pressed={on}
                className={cn(menuItem, 'min-h-9 sm:min-h-7', on && 'border-solid border-seal text-seal')}
                key={lens.name}
                onClick={() => onSources(lens.sources)}
                title={lens.sources.map((id) => sourceById(id).label).join(', ')}
                type="button"
              >
                {lens.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
