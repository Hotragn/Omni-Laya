import { XIcon } from 'lucide-react';
import { useState } from 'react';
import type { AskLayaState } from '@/lib/use-ask-laya';
import { cn } from '@/lib/utils';

export type AnswerView = 'mark' | 'sort' | 'filter';

const chip =
  'chip inline-flex min-h-11 items-center rounded-[8px] border px-3 text-[13px] font-medium sm:min-h-8 disabled:opacity-45';

/**
 * The reader's own yes/no question about these results ("Is this official
 * documentation?"). Laya answers it for every result in one pass; the answer
 * is stamped in each row's margin, and can sort the page or keep only the yeses.
 */
export function AskLaya({
  state,
  view,
  pending,
  limit,
  disabled,
  onAsk,
  onView,
  onClear,
}: {
  state: AskLayaState;
  view: AnswerView;
  /** Results on screen that this question has not been asked about yet. */
  pending: number;
  /** How many results the question will be asked about. */
  limit: number;
  disabled: boolean;
  onAsk: (question: string) => void;
  onView: (view: AnswerView) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState('');
  const asked = state.status === 'done' || (state.status === 'asking' && Object.keys(state.answers).length > 0);
  const again = state.status === 'done' && draft.trim() === state.question && pending > 0;

  return (
    <div className="mt-5">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim().length >= 3) onAsk(draft);
        }}
      >
        <label className="flex min-h-11 min-w-0 flex-1 basis-64 items-center gap-2 rounded-[10px] border border-dashed border-border px-3 focus-within:border-solid focus-within:border-seal">
          <span className="readout shrink-0 text-seal">Ask Laya</span>
          <input
            className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground"
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="a yes/no question"
            value={draft}
          />
          {state.status !== 'idle' && (
            <button
              aria-label="Clear the question"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraft('');
                onClear();
              }}
              type="button"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          )}
        </label>
        <button
          className={cn(chip, 'border-transparent bg-primary text-primary-foreground hover:opacity-85')}
          disabled={disabled || draft.trim().length < 3 || state.status === 'asking'}
          type="submit"
        >
          {state.status === 'asking' ? 'Asking…' : again ? `Ask about ${pending} new` : 'Ask'}
        </button>
      </form>

      {state.status === 'idle' && limit > 0 && (
        <p className="readout mt-1.5 text-muted-foreground">
          Laya reads the {limit} {limit === 1 ? 'result' : 'results'} above the cutting floor.
        </p>
      )}
      {state.status === 'asking' && (
        <p className="readout mt-1.5 text-muted-foreground" aria-live="polite">
          Laya has answered {Object.keys(state.answers).length} of {limit}…
        </p>
      )}
      {state.status === 'error' && <p className="readout mt-2 text-destructive">Laya could not answer: {state.message}</p>}
      {asked && (
        <div className="enter mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Use the answer">
          {(
            [
              ['mark', 'Mark only'],
              ['sort', 'Sort by answer'],
              ['filter', 'Yes only'],
            ] as const
          ).map(([id, label]) => (
            <button
              aria-pressed={view === id}
              className={cn(
                chip,
                view === id
                  ? 'border-seal bg-seal-soft text-seal'
                  : 'border-[color-mix(in_oklch,var(--foreground)_55%,transparent)] bg-card text-foreground'
              )}
              key={id}
              onClick={() => onView(id)}
              type="button"
            >
              {label}
            </button>
          ))}
          <span className="readout text-muted-foreground">
            “{state.question}”
            {state.by === 'rule'
              ? ' · answered from where each result came from, no model needed'
              : state.ms !== null && ` · answered in ${(state.ms / 1000).toFixed(1)} s`}
          </span>
        </div>
      )}
    </div>
  );
}
