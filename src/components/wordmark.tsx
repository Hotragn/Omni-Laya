import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

export function Wordmark({ size }: { size: 'sm' | 'lg' }) {
  return (
    <Link
      aria-label="OmniLaya Search home"
      className={cn(
        'vt-wordmark inline-flex min-h-11 shrink-0 items-center select-none',
        size === 'lg' ? 'gap-3 text-5xl' : 'gap-2 text-[1.35rem]'
      )}
      to="/"
      viewTransition
    >
      <Logo className={size === 'lg' ? 'size-12' : 'size-7'} wash={size === 'lg'} />
      <span className="display whitespace-nowrap leading-tight tracking-[-0.015em]">
        OmniLaya<span className="hidden font-medium text-muted-foreground sm:inline"> Search</span>
      </span>
    </Link>
  );
}
