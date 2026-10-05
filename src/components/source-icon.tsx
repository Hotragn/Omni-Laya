import {
  siArxiv,
  siDuckduckgo,
  siGithub,
  siGoogle,
  siImdb,
  siReddit,
  siWechat,
  siWikipedia,
  siX,
  siYcombinator,
  siYoutube,
  type SimpleIcon,
} from 'simple-icons';
import type { SourceId } from '@/lib/sources';
import { cn } from '@/lib/utils';

const ICONS: Record<Exclude<SourceId, 'yandex'>, SimpleIcon> = {
  google: siGoogle,
  duckduckgo: siDuckduckgo,
  hackernews: siYcombinator,
  reddit: siReddit,
  github: siGithub,
  x: siX,
  arxiv: siArxiv,
  youtube: siYoutube,
  wikipedia: siWikipedia,
  imdb: siImdb,
  wechat: siWechat,
};

/** Brand colour for the source, as a CSS colour. Black-on-white brands get the text colour so they survive dark mode. */
export function sourceColor(id: SourceId): string {
  if (id === 'yandex') return '#FC3F1D';
  const hex = ICONS[id].hex;
  return hex === '000000' || hex === '181717' ? 'currentColor' : `#${hex}`;
}

/** Google's four-colour G. simple-icons only ships a single-colour glyph, which reads as a blue G. */
const GOOGLE_G: { d: string; fill: string }[] = [
  { fill: '#EA4335', d: 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z' },
  { fill: '#4285F4', d: 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z' },
  { fill: '#FBBC05', d: 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z' },
  { fill: '#34A853', d: 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z' },
];

/**
 * The source's logo as inline SVG. `on` shows the brand colour; `ink` shows the
 * glyph in the text colour at full strength (the quiet, monochrome state);
 * neither is the faded "not chosen" state.
 */
export function SourceIcon({ id, on = true, ink = false, className }: { id: SourceId; on?: boolean; ink?: boolean; className?: string }) {
  const faded = !on && !ink;
  const colour = on && !ink;
  if (id === 'google') {
    return (
      <svg
        aria-hidden
        className={cn('shrink-0 transition-colors duration-200', className ?? 'size-3.5')}
        style={faded ? { opacity: 0.4 } : undefined}
        viewBox="0 0 48 48"
      >
        {GOOGLE_G.map((p) => (
          <path d={p.d} fill={colour ? p.fill : 'currentColor'} key={p.fill} />
        ))}
      </svg>
    );
  }
  if (id === 'yandex') {
    // Official 2021 mark: white Я in a red circle (Yandex home-static SVG).
    return (
      <svg
        aria-hidden
        className={cn('shrink-0 transition-colors duration-200', className ?? 'size-3.5')}
        fill="none"
        style={faded ? { opacity: 0.4 } : undefined}
        viewBox="2.04 2.04 19.92 19.92"
      >
        <path
          d="M2.04 12c0-5.523 4.476-10 10-10 5.522 0 10 4.477 10 10s-4.478 10-10 10c-5.524 0-10-4.477-10-10z"
          fill={colour ? '#FC3F1D' : 'currentColor'}
        />
        <path
          d="M13.32 7.666h-.924c-1.694 0-2.585.858-2.585 2.123 0 1.43.616 2.1 1.881 2.959l1.045.704-3.003 4.487H7.49l2.695-4.014c-1.55-1.111-2.42-2.19-2.42-4.015 0-2.288 1.595-3.85 4.62-3.85h3.003v11.868H13.32V7.666z"
          fill={colour ? '#fff' : 'var(--background)'}
        />
      </svg>
    );
  }
  const icon = ICONS[id];
  return (
    <svg
      aria-hidden
      className={cn('shrink-0 transition-colors duration-200', className ?? 'size-3.5')}
      fill={colour ? sourceColor(id) : 'currentColor'}
      style={faded ? { opacity: 0.4 } : undefined}
      viewBox="0 0 24 24"
    >
      <path d={icon.path} />
    </svg>
  );
}
