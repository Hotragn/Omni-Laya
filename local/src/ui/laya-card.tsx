import { useEffect, useState } from 'react';
import type { LayaStatus } from '../laya/client';
import { keepStored, stored, type Stored } from '../laya/storage';
import { cn } from '@/lib/utils';

const MB = 1024 * 1024;

/**
 * Where Laya lives. Until the reader brings it here, searches still work by
 * rule; after, Laya reads every request and scores every result on this
 * device. The download is the only cost, so it is stated up front.
 */
export function LayaCard({
  status,
  fastGpu,
  onLoad,
  onRemove,
  compact = false,
}: {
  status: LayaStatus;
  /** WebGPU with fp16: 614 MB and fast. Without it: 1.3 GB on the CPU, slow. */
  fastGpu: boolean | null;
  onLoad: () => void;
  /** Deletes the cached weights; the next search runs by rule. */
  onRemove: () => Promise<void>;
  compact?: boolean;
}) {
  const size = fastGpu === false ? '1.3 GB' : '614 MB';

  if (status.phase === 'ready') {
    return (
      <div className={cn('readout text-muted-foreground', compact ? '' : 'text-center')}>
        <p>
          <span className="text-seal">Laya is on this device</span> · {status.device === 'webgpu' ? 'GPU' : 'CPU'}, {status.dtype} · ready in{' '}
          {(status.ms / 1000).toFixed(1)} s
        </p>
        <StoredLine onRemove={onRemove} />
      </div>
    );
  }

  if (status.phase === 'loading') {
    const pct = status.total > 0 ? Math.min(100, Math.round((status.loaded / status.total) * 100)) : 0;
    return (
      <div className={cn('w-full max-w-md', compact ? '' : 'mx-auto')} aria-live="polite">
        <p className="readout text-muted-foreground">
          Bringing Laya to this device: {Math.round(status.loaded / MB)} of {status.total ? Math.round(status.total / MB) : '…'} MB
        </p>
        <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-[2px] bg-seal-soft">
          <span className="block h-full bg-seal transition-[width]" style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <p className="readout mt-1 text-muted-foreground">Once only. Searches keep working while it loads.</p>
      </div>
    );
  }

  return (
    <div className={cn('max-w-md text-sm', compact ? '' : 'mx-auto text-center')}>
      {status.phase === 'failed' && <p className="readout mb-2 text-destructive">Laya could not load: {status.message}</p>}
      <p className="text-muted-foreground">
        Searching by rule for now. Bring Laya here and it reads your request and scores every result on your own device, with
        nothing sent to any OmniLaya server.
      </p>
      <button
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:opacity-85 sm:min-h-10"
        onClick={onLoad}
        type="button"
      >
        Bring Laya to this device ({size}, once)
      </button>
      {fastGpu === false && (
        <p className="readout mt-2 text-muted-foreground">This browser has no WebGPU with fp16, so Laya would run on the CPU: larger and slower.</p>
      )}
    </div>
  );
}

/**
 * How much disk Laya uses and whether the browser will keep it, with a way to
 * take it off. Removing asks once more, since bringing it back is a download.
 */
export function StoredLine({ onRemove }: { onRemove: () => Promise<void> }) {
  const [info, setInfo] = useState<Stored | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    // Asking to persist first means the line reports the browser's answer, not the state before it.
    void keepStored()
      .then(stored)
      .then((s) => live && setInfo(s));
    return () => {
      live = false;
    };
  }, []);

  const size = info?.bytes ? `${Math.round(info.bytes / MB)} MB` : null;
  const link = 'underline underline-offset-2 hover:text-foreground disabled:opacity-50';
  return (
    <p className="mt-1">
      {size ? `Stored in this browser (${size})` : 'Stored in this browser'}
      {info && (info.persisted ? ', kept until you remove it' : ', may be cleared if the disk runs low')} ·{' '}
      {asking ? (
        <>
          remove {size ?? 'it'}? It downloads again next time.{' '}
          <button
            className={cn(link, 'text-destructive')}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onRemove().finally(() => setBusy(false));
            }}
            type="button"
          >
            {busy ? 'removing…' : 'yes, remove'}
          </button>{' '}
          <button className={link} disabled={busy} onClick={() => setAsking(false)} type="button">
            keep
          </button>
        </>
      ) : (
        <button className={link} onClick={() => setAsking(true)} type="button">
          remove Laya
        </button>
      )}
    </p>
  );
}
