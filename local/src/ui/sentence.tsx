import { TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { WINDOWS, type WindowId } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { PLACES, placeById, type PlaceId } from '../sources';
import type { SearchState } from '../use-search';

const WINDOW_PHRASE: Record<WindowId, string> = { any: 'any time', '24h': 'the past 24 hours', '7d': 'the past week', '30d': 'the past month' };

const pick = 'cursor-pointer rounded-[2px] border-b-2 border-seal px-px outline-offset-4 hover:bg-seal-soft focus-visible:bg-seal-soft';
const menuItem = 'min-h-11 rounded-[8px] border border-dashed border-input px-3 text-sm text-muted-foreground hover:border-solid hover:text-foreground sm:min-h-8';

function joined(parts: React.ReactNode[]): React.ReactNode[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [i === parts.length - 1 ? ' and ' : ', ', part]));
}

/**
 * "Laya searched Hacker News and the open web from the past month." Each
 * underlined word is a choice the reader can change; struck words are places
 * Laya chose and the reader removed.
 */
export function Sentence({
  state,
  onPlaces,
  onWindow,
}: {
  state: SearchState;
  onPlaces: (places: PlaceId[] | undefined) => void;
  onWindow: (w: WindowId | undefined) => void;
}) {
  const [menu, setMenu] = useState<'window' | 'add' | null>(null);
  const { intent } = state;
  if (!intent) {
    return <p className="print min-h-[4.5rem] text-[20px] leading-normal text-muted-foreground">Reading your request…</p>;
  }

  const current = new Set(intent.places);
  const chosen = new Set(intent.chosen.places);
  const words = PLACES.map((p) => p.id).filter((id) => current.has(id) || chosen.has(id));
  const others = PLACES.filter((p) => !words.includes(p.id));
  const changed = intent.places.join() !== intent.chosen.places.join() || intent.window !== intent.chosen.window;
  const who = intent.by === 'laya' ? 'Laya' : 'OmniLaya';

  const toggle = (id: PlaceId) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0) return;
    onPlaces(PLACES.map((p) => p.id).filter((p) => next.has(p)));
  };

  const word = (id: PlaceId) => {
    const place = placeById(id);
    if (!current.has(id)) {
      return (
        <button
          aria-label={`${place.label}: struck out. Click to search it again.`}
          className="cursor-pointer text-muted-foreground line-through decoration-seal decoration-2"
          key={id}
          onClick={() => toggle(id)}
          type="button"
        >
          {place.label}
        </button>
      );
    }
    const lane = state.lanes[id];
    return (
      <span className="whitespace-nowrap" key={id}>
        <button
          aria-label={`${place.label}${lane ? (lane.error ? ': did not answer' : `, ${lane.count} results`) : ''}. Click to leave it out.`}
          className={cn(pick, !chosen.has(id) && 'border-dashed')}
          onClick={() => toggle(id)}
          type="button"
        >
          {place.label}
        </button>
        <sup className="readout ml-0.5 text-seal">
          {lane?.error ? <TriangleAlertIcon aria-hidden className="inline size-3 text-destructive" /> : lane ? lane.count : null}
        </sup>
      </span>
    );
  };

  return (
    <div className="enter" data-sentence>
      <p className="print text-[20px] leading-normal">
        {who} searched {joined(words.map(word))} from{' '}
        <button aria-expanded={menu === 'window'} className={pick} onClick={() => setMenu((m) => (m === 'window' ? null : 'window'))} type="button">
          {WINDOW_PHRASE[intent.window]}
        </button>
        .{' '}
        {others.length > 0 && (
          <button
            aria-expanded={menu === 'add'}
            className="cursor-pointer whitespace-nowrap border-b border-dashed border-muted-foreground text-muted-foreground hover:text-foreground"
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
                onWindow(w.id === intent.chosen.window ? undefined : w.id);
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
          {others.map((p) => (
            <button
              className={menuItem}
              key={p.id}
              onClick={() => {
                setMenu(null);
                toggle(p.id);
              }}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <p className="readout mt-1.5 flex flex-wrap gap-x-2 text-muted-foreground">
        <span>
          {intent.by === 'laya' ? `read by Laya on this device in ${(intent.ms / 1000).toFixed(1)} s` : 'chosen by rule: Laya is not on this device yet'}
        </span>
        <span>· keywords: {intent.query}</span>
        {changed && (
          <span>
            ·{' '}
            <button
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                onPlaces(undefined);
                onWindow(undefined);
              }}
              type="button"
            >
              let {who} decide
            </button>
          </span>
        )}
      </p>
    </div>
  );
}
