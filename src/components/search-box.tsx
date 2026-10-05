import { useNavigate } from '@tanstack/react-router';
import { ArrowRightIcon, SearchIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Newlines never reach the URL: a pasted or wrapped request is one line of words. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const supportsFieldSizing = () => typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * A sheet of paper that opens. At rest it is one line, like any search box,
 * with a fade where a long request runs past the edge. Focused, the request
 * wraps and the box grows so the whole question can be read and edited; it
 * folds back on blur. Enter or the ink button submits.
 */
export function SearchBox({
  initial = '',
  compact = false,
  autoFocus = false,
}: {
  initial?: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    // Browsers without `field-sizing: content` get the same growth from JS.
    if (!supportsFieldSizing()) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
    if (!expanded) el.scrollLeft = 0;
  }, [value, expanded]);

  const submit = (form: HTMLFormElement | null) => {
    const q = oneLine(value);
    if (!q) return;
    form?.querySelector('textarea')?.blur();
    // A new request resets explicit filters so the judge decides again.
    navigate({ to: '/search', search: { q }, viewTransition: true });
  };

  return (
    <form
      className="vt-searchbox relative"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      role="search"
    >
      {/* The box is this wrapper, so the text fade below never touches the border. */}
      <div className="rounded-[var(--radius)] border border-input bg-card shadow-[0_1px_0_color-mix(in_oklch,var(--foreground)_6%,transparent)] transition-[border-color,box-shadow] hover:border-foreground/40 has-focus-visible:border-foreground has-focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--foreground)_10%,transparent)]">
        <SearchIcon
          aria-hidden
          className={cn('pointer-events-none absolute left-4 text-muted-foreground', compact ? 'top-3 size-4' : 'top-4 size-5')}
        />
        <textarea
          aria-label="Search"
          autoComplete="off"
          autoFocus={autoFocus}
          className={cn(
            'block w-full min-w-0 resize-none overflow-hidden bg-transparent pl-11 leading-6 outline-none placeholder:text-muted-foreground',
            compact ? 'py-2 pr-11 text-base md:text-sm' : 'py-3.5 pr-14 text-base',
            // Folded, the line fades out before the submit button, so clipped words never show
            // beside it. Always on, not measured: short text never reaches the fade, and the
            // first paint before hydration is already right.
            !expanded && (compact
              ? '[mask-image:linear-gradient(to_right,black_calc(100%-5rem),transparent_calc(100%-2.75rem))]'
              : '[mask-image:linear-gradient(to_right,black_calc(100%-6rem),transparent_calc(100%-3.5rem))]')
          )}
          enterKeyHint="search"
          maxLength={300}
          name="q"
          onBlur={() => setExpanded(false)}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit(event.currentTarget.form);
            }
          }}
          placeholder="Ask the web any way you like"
          ref={field}
          rows={1}
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          value={value}
          wrap={expanded ? 'soft' : 'off'}
        />
        <button
          aria-label="Search"
          className={cn(
            'absolute right-2 inline-flex items-center justify-center rounded-[calc(var(--radius)-4px)] bg-primary text-primary-foreground transition-opacity after:absolute after:-inset-2 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-25',
            compact ? 'top-1.5 size-7' : 'top-2 size-9'
          )}
          disabled={!oneLine(value)}
          type="submit"
        >
          <ArrowRightIcon aria-hidden className={compact ? 'size-3.5' : 'size-4'} />
        </button>
      </div>
    </form>
  );
}
