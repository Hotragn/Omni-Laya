import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowUpRightIcon } from 'lucide-react';
import { useState } from 'react';
import { EngineStrip, type EnginePreview } from '@/components/home-demos';
import { InkWash } from '@/components/ink-wash';
import { Logo } from '@/components/logo';
import { SearchBox } from '@/components/search-box';
import { HOME_CANONICAL, websiteJsonLd } from '@/lib/seo';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ property: 'og:url', content: HOME_CANONICAL }],
    links: [{ rel: 'canonical', href: HOME_CANONICAL }],
    scripts: [{ type: 'application/ld+json', children: websiteJsonLd() }],
  }),
  component: Home,
});

interface Example extends EnginePreview {
  q: string;
}

/**
 * Three requests that look nothing alike: a phrase with a source and a time,
 * a full question with only a source, and a bare topic with neither. Together
 * they say "write it any way you like" better than a template would. The
 * sources and windows are what Laya chose for them against a local laya-serve,
 * shown on hover so the engine strip below can demonstrate the choice without
 * an API call.
 */
const EXAMPLES: Example[] = [
  { q: 'Rust async runtimes on Hacker News this month', window: '30d', sources: ['hackernews'] },
  { q: 'What do Reddit users think of the Framework laptop?', window: 'any', sources: ['reddit'] },
  { q: 'New papers on speculative decoding', window: '7d', sources: ['google', 'duckduckgo', 'yandex', 'arxiv'] },
];

/* design-structure: search-engine home · centered column, the mark and name as the only voice, form as the CTA · one ink wash behind the form */

function Home() {
  const [preview, setPreview] = useState<EnginePreview | null>(null);

  return (
    <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 pb-12 pt-20 sm:py-20">
      <InkWash className="absolute left-1/2 top-[46%] -z-10 w-[min(1100px,160vw)] max-w-none -translate-x-1/2 -translate-y-1/2" />
      <Logo className="size-16 sm:size-20" wash />
      <h1 className="vt-wordmark display mt-4 text-center text-[clamp(2.6rem,6vw,3.9rem)] leading-none tracking-[-0.02em]">
        OmniLaya <span className="font-medium text-muted-foreground">Search</span>
      </h1>
      <p className="mt-3 max-w-md text-balance text-center text-[15px] text-muted-foreground sm:mt-4 sm:text-base">
        Laya picks where to search. Ranks what comes back.
      </p>
      <div className="mt-8 w-full sm:mt-9">
        <SearchBox autoFocus />
      </div>
      <ul aria-label="Example searches" className="mt-3 w-full divide-y divide-dashed divide-border text-[15px] sm:text-sm">
        {EXAMPLES.map((example) => (
          <li key={example.q}>
            <Link
              className="group flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-muted-foreground hover:text-foreground focus-visible:text-foreground sm:min-h-10 sm:py-2"
              onBlur={() => setPreview(null)}
              onFocus={() => setPreview(example)}
              onMouseEnter={() => setPreview(example)}
              onMouseLeave={() => setPreview(null)}
              search={{ q: example.q }}
              to="/search"
              viewTransition
            >
              <span className="group-hover:underline">{example.q}</span>
              <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70 sm:opacity-0" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-10 sm:mt-12">
        <EngineStrip preview={preview} />
      </div>
    </main>
  );
}
