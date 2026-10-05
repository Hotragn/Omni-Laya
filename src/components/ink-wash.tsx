import { cn } from '@/lib/utils';

/**
 * One watercolor bloom behind the home search area. The wash is painted once
 * by brand/make_logo.py and shipped as a transparent image, which costs less
 * to paint than a live SVG filter and renders the same in every browser. It
 * is ink on paper and inverted to paper on the night theme. Decorative only.
 */
export function InkWash({ className }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden
      className={cn('pointer-events-none select-none opacity-[0.09] dark:opacity-[0.07] dark:invert', className)}
      decoding="async"
      height={800}
      src="/wash.webp"
      width={1600}
    />
  );
}
