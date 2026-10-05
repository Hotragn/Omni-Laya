import { PLACES, SOURCES, sourceById, type PlaceId } from '@/lib/sources';
import { toJsonl, type Proofs } from '@/lib/proof';
import type { AskState } from '@/lib/use-ask';
import { cn } from '@/lib/utils';

function placeLabel(id: PlaceId): string {
  return id === 'web' ? 'Open web' : sourceById(id).label;
}

const head = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';
const small = 'readout cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * How this page was made, printed at its end like a book's colophon: what
 * Laya read and decided, with the numbers behind it, and what the reader
 * marked. Also the place to manage lenses and export disagreements.
 */
export function Colophon({
  state,
  proofs,
  onProofs,
}: {
  state: AskState;
  proofs: Proofs;
  onProofs: (change: (p: Proofs) => Proofs) => void;
}) {
  const { intent } = state;
  if (!intent || state.phase !== 'done') return null;

  // Every source of a place carries that place's share; read it from the first one.
  const share = PLACES.map((p) => {
    const source = SOURCES.find((s) => s.place === p.id)!;
    return { id: p.id, value: intent.inferred.sources[source.id] ?? 0 };
  })
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
  const searched = new Set(intent.sources.map((id) => sourceById(id).place));
  const rules = Object.entries(proofs.rules);
  const stamps = proofs.disagreements.length;

  return (
    <footer aria-label="Colophon" className="mt-9 grid gap-x-7 gap-y-5 border-t-[3px] border-double border-border pt-5 text-sm [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
      <div>
        <b className={head}>Where Laya looked</b>
        <div className="space-y-1">
          {share.map(({ id, value }) => (
            <div className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-2" key={id}>
              <span className={cn('truncate', searched.has(id) ? 'text-foreground' : 'text-muted-foreground')}>{placeLabel(id)}</span>
              <span aria-hidden className="relative h-1 overflow-hidden rounded-[2px] bg-seal-soft">
                <span
                  className={cn('absolute inset-y-0 left-0', searched.has(id) ? 'bg-seal' : 'bg-muted-foreground/40')}
                  style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
                />
              </span>
              <span className="readout text-right text-muted-foreground">{Math.round(value * 100)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <b className={head}>Set by</b>
        <p>
          Laya{intent.checkpoint ? <span className="readout">/{intent.checkpoint}</span> : null}, a non-autoregressive decision model.
        </p>
        <p className="readout mt-1 text-muted-foreground">
          read in {(intent.intentMs / 1000).toFixed(1)} s
          {state.totalMs !== null && ` · page in ${(state.totalMs / 1000).toFixed(1)} s`}
        </p>
        <p className="readout mt-1 break-words text-muted-foreground">sent: {intent.query}</p>
      </div>
      <div>
        <b className={head}>Your marks</b>
        <p>
          {stamps === 0 ? 'No disagreements yet.' : `${stamps} ${stamps === 1 ? 'disagreement' : 'disagreements'} kept in this browser.`}
        </p>
        {stamps > 0 && (
          <p className="mt-1 flex gap-3">
            <button className={small} onClick={() => download('omnilaya-disagreements.jsonl', toJsonl(proofs.disagreements))} type="button">
              export JSONL
            </button>
            <button className={small} onClick={() => onProofs((p) => ({ ...p, disagreements: [] }))} type="button">
              clear
            </button>
          </p>
        )}
        {rules.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {rules.map(([domain, rule]) => (
              <li className="readout text-muted-foreground" key={domain}>
                {rule} {domain}{' '}
                <button
                  className={small}
                  onClick={() =>
                    onProofs((p) => {
                      const next = { ...p.rules };
                      delete next[domain];
                      return { ...p, rules: next };
                    })
                  }
                  type="button"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {proofs.lenses.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {proofs.lenses.map((lens) => (
              <li className="readout text-muted-foreground" key={lens.name}>
                lens {lens.name}{' '}
                <button className={small} onClick={() => onProofs((p) => ({ ...p, lenses: p.lenses.filter((l) => l.name !== lens.name) }))} type="button">
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="hidden md:block">
        <b className={head}>Proofing keys</b>
        <button
          aria-pressed={proofs.keys}
          className={cn(small, 'mb-1 block')}
          onClick={() => onProofs((p) => ({ ...p, keys: !p.keys }))}
          type="button"
        >
          {proofs.keys ? 'keys on: turn off' : 'keys off: turn on'}
        </button>
        <p className={cn('readout leading-6 text-muted-foreground', !proofs.keys && 'opacity-50')}>
          <kbd>j</kbd> <kbd>k</kbd> move · <kbd>o</kbd> open · <kbd>x</kbd> fold
          <br />
          <kbd>d</kbd> disagree · <kbd>e</kbd> edit the sentence · <kbd>/</kbd> ask
        </p>
      </div>
    </footer>
  );
}
