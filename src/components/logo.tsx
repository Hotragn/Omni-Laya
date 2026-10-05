import { cn } from '@/lib/utils';

/**
 * The OmniLaya mark: an open ink ring with a drop inside. `wash` is the
 * watercolor rendering for large sizes; the flat one stays crisp small.
 * Both themes ship as separate files so the ink always contrasts with the
 * paper; CSS picks one.
 */
export function Logo({ className, wash = false }: { className?: string; wash?: boolean }) {
  const light = wash ? '/mark.svg' : '/mark-flat.svg';
  const dark = wash ? '/mark-night.svg' : '/mark-flat-night.svg';
  return (
    <span aria-hidden className={cn('relative inline-block shrink-0', className)}>
      <img alt="" className="size-full dark:hidden" height={100} src={light} width={100} />
      <img alt="" className="hidden size-full dark:block" height={100} src={dark} width={100} />
    </span>
  );
}

/** A small enso that draws itself while Laya or an engine is working. */
export function EnsoSpinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={cn('shrink-0', className)} viewBox="0 0 24 24">
      <circle
        className="enso-draw"
        cx="12"
        cy="12"
        fill="none"
        pathLength={100}
        r="8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.6"
        transform="rotate(-70 12 12)"
      />
    </svg>
  );
}
