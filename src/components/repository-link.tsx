import { SourceIcon } from '@/components/source-icon';

export function RepositoryLink() {
  return (
    <a
      aria-label="OmniLaya Search source code on GitHub (opens in a new tab)"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      href="https://github.com/Hotragn/Omni-Laya"
      rel="noreferrer"
      target="_blank"
      title="OmniLaya Search on GitHub"
    >
      <SourceIcon id="github" className="size-5" />
    </a>
  );
}
