import { siHuggingface } from 'simple-icons';

/** The Laya model card: the judge behind every choice on the page. */
export function ModelLink() {
  return (
    <a
      aria-label="Laya model on Hugging Face (opens in a new tab)"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      href="https://huggingface.co/convaiinnovations/laya"
      rel="noreferrer"
      target="_blank"
      title="Laya on Hugging Face"
    >
      <svg aria-hidden className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d={siHuggingface.path} />
      </svg>
    </a>
  );
}
