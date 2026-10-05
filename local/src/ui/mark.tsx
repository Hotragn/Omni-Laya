import { cn } from '@/lib/utils';
import markUrl from '../../../public/mark.svg?url';
import markNightUrl from '../../../public/mark-night.svg?url';

/** The ink enso, with its night version. Decorative: the wordmark beside it names the site. */
export function Mark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-block shrink-0', className)}>
      <img alt="" className="size-full dark:hidden" src={markUrl} />
      <img alt="" className="hidden size-full dark:block" src={markNightUrl} />
    </span>
  );
}
