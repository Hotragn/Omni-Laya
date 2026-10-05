import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Mark } from './ui/mark';

/**
 * The about page: what runs where, who sees what, what stays on the device,
 * and who made the parts. Set as a printed page, like the results.
 */

const REPO = 'https://github.com/Hotragn/Omni-Laya';

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-link underline underline-offset-[3px] visited:text-visited" href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-dashed border-border pt-8">
      <h2 className="display text-[1.6rem] leading-tight tracking-[-0.01em]" id={id}>
        {title}
      </h2>
      <div className="print mt-3 space-y-3 text-[16px] leading-7 text-foreground/85">{children}</div>
    </section>
  );
}

function Pairs({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map(([term, detail]) => (
        <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4" key={term}>
          <dt className="font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:pt-1.5">{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

const WHO_SEES = [
  [
    'Places you search',
    'The keywords and your IP address, sent by your browser straight to each one: Mwmbl (the open web index), Wikipedia, the Hacker News search by Algolia, GitHub, Stack Exchange, OpenAlex, Open Library and npm. Each has its own privacy policy.',
  ],
  ['Hugging Face', 'Your IP address, once, when your browser downloads Laya.'],
  ['jsDelivr', 'Your IP address, when your browser fetches the ONNX Runtime engine that runs Laya.'],
  ['Cloudflare Pages', 'Your IP address and the page address you open, which holds the search when you open a search link. Cloudflare hosts these files.'],
  ['Google Fonts', 'Your IP address, when your browser fetches the four typefaces.'],
  ['OmniLaya', 'Nothing. There is no OmniLaya server, no analytics, no cookies and no account.'],
] as const;

const STORED = [
  ['Laya', 'About 614 MB with a GPU, or 1.3 GB on the CPU, in the browser cache for this site. It lets later visits start without a download.'],
  ['Your marks', 'The cutting floor, lens rules, saved lenses, disagreements and the keys setting, in local storage under omnilaya-proofs.'],
  ['Small settings', 'The theme (omnilaya-theme) and a flag that loads Laya on your next visit (omnilaya-laya-on-device).'],
] as const;

const CREDITS = [
  ['Laya', 'the decision model, by Convai Innovations (Apache-2.0)', 'https://huggingface.co/convaiinnovations/laya'],
  ['laya-multilingual-ONNX', 'the browser conversion, by onnx-community (Apache-2.0)', 'https://huggingface.co/onnx-community/laya-multilingual-ONNX'],
  ['open-jev', 'the browser runtime this app adapts, by Nico Martin and contributors (MIT)', 'https://github.com/shreyaskarnik/open-jev'],
  ['Jev Search', 'the app OmniLaya started from, by superagents-lab (MIT)', 'https://github.com/superagents-lab/jev-search'],
  ['Transformers.js', 'runs the model in the page, by Hugging Face (Apache-2.0)', 'https://github.com/huggingface/transformers.js'],
] as const;

export function About() {
  return (
    <>
      <header className="border-b border-dashed">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-5">
          <a aria-label="OmniLaya Search home" className="inline-flex min-h-11 items-center gap-2" href="./">
            <Mark className="size-7" />
            <span className="display text-[1.35rem] leading-tight tracking-[-0.015em]">OmniLaya</span>
          </a>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-10 px-4 pb-16 pt-10 sm:px-5">
        <div>
          <h1 className="display text-[clamp(2.4rem,6vw,3.4rem)] leading-none tracking-[-0.02em]">About OmniLaya</h1>
          <p className="print mt-4 text-[17px] leading-7 text-foreground/85">
            OmniLaya Search is an open-source web search where Laya, a small decision model, runs in your browser. It reads your
            request, picks where to look, and scores every result on your own device. It never writes an answer for you: you get the
            results, with each score shown in the margin.
          </p>
        </div>

        <Section id="how" title="What happens when you search">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Laya reads your request in this tab and picks the places and the time window. If Laya is not on your device yet, simple rules do this instead.</li>
            <li>Your browser asks those places directly. No server sits in between.</li>
            <li>Laya scores how well each result fits your request, on your GPU, or on the CPU if the browser has no WebGPU.</li>
            <li>If you ask Laya a yes or no question about the results, it answers that on your device too.</li>
          </ol>
        </Section>

        <Section id="privacy" title="Who sees what">
          <Pairs rows={WHO_SEES} />
        </Section>

        <Section id="stored" title="What stays on this device">
          <Pairs rows={STORED} />
          <p>
            Closing the tab keeps all of it. To remove Laya, use <b>remove Laya</b> on the home page or under any results. To remove
            everything, clear this site&apos;s data in your browser settings. Private windows keep nothing after they close.
          </p>
        </Section>

        <Section id="limits" title="What it does not do well yet">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Laya is used without extra training for search, so its scores are useful but not sharp. Mark it wrong with the disagree
              stamp, and export your marks if you want to help train it.
            </li>
            <li>The open web index (Mwmbl) is small and run by volunteers, so general searches find less than a large engine would.</li>
            <li>Some places, such as Reddit and arXiv, do not let browsers search them directly, so they are not here.</li>
            <li>Without WebGPU, Laya runs on the CPU: a larger download and slower scores. Devices with little memory may close the tab while it loads.</li>
          </ul>
        </Section>

        <Section id="credits" title="Credits">
          <ul className="space-y-2">
            {CREDITS.map(([name, what, href]) => (
              <li key={name}>
                <A href={href}>{name}</A>: {what}.
              </li>
            ))}
          </ul>
          <p>
            Results come from the places listed above, each under its own terms. OmniLaya is an independent project, not an official
            Convai Innovations, Hugging Face or Search1API product.
          </p>
        </Section>

        <footer className="border-t-[3px] border-double border-border pt-5">
          <p className="readout text-muted-foreground">
            Source code: <A href={REPO}>github.com/Hotragn/Omni-Laya</A> · MIT license ·{' '}
            <a className="underline underline-offset-2 hover:text-foreground" href="./">
              back to search
            </a>
          </p>
        </footer>
      </main>
    </>
  );
}
