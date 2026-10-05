import { SOURCES, sourceById, windowById, type SourceId, type WindowId } from '@/lib/sources';
import { SourceIcon } from './source-icon';

function list(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What Laya would choose for a request: the strip lights those engines. */
export interface EnginePreview {
  window: WindowId;
  sources: SourceId[];
}

/**
 * The engines as a quiet row of ink glyphs; no count, the list changes. With
 * a preview (an example being hovered) the chosen engines take their own
 * colours, the rest fade, and the caption says what Laya chose: the results
 * page's decision in miniature. Phones have no hover, so they only get the row.
 */
export function EngineStrip({ preview }: { preview?: EnginePreview | null }) {
  const chosen = preview ? new Set(preview.sources) : null;
  const caption = preview
    ? `Laya would look in ${list(preview.sources.map((id) => sourceById(id).label))} · ${windowById(preview.window).label.toLowerCase()}`
    : 'Laya picks the engines your question needs.';

  return (
    <div className="flex flex-col items-center gap-3">
      <ul
        aria-label="Search engines"
        className="grid grid-cols-6 gap-x-[22px] gap-y-4 text-foreground/70 sm:flex sm:items-center sm:gap-x-3.5"
      >
        {SOURCES.map((s) => (
          <li className="inline-flex items-center" key={s.id} title={s.label}>
            <SourceIcon
              className="size-4 transition-opacity duration-200"
              id={s.id}
              ink={!chosen}
              on={chosen?.has(s.id) ?? false}
            />
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="readout hidden h-[18px] text-muted-foreground sm:block">
        {caption}
      </p>
    </div>
  );
}
