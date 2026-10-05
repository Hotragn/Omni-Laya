/**
 * Where Laya's weights live between visits. transformers.js keeps every file it
 * downloads in one Cache Storage bucket for this site, so closing the tab
 * keeps them and a later visit loads from disk. These helpers report that
 * copy, ask the browser not to evict it, and remove it on request.
 */

/** The Cache Storage bucket transformers.js writes to (its `cacheKey` default). */
export const MODEL_CACHE = 'transformers-cache';
/** Set once Laya has loaded here, so later visits load it from the browser cache without asking. */
export const CACHED_FLAG = 'omnilaya-laya-on-device';

export interface Stored {
  /** Bytes held for Laya on this device, or null when the browser will not say. */
  bytes: number | null;
  /** True when the browser promised not to clear this site's storage on its own. */
  persisted: boolean;
}

/** Asks the browser to keep this site's storage until the reader clears it. */
export async function keepStored(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function stored(): Promise<Stored> {
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* not supported */
  }
  try {
    if (!('caches' in globalThis) || !(await caches.has(MODEL_CACHE))) return { bytes: 0, persisted };
    const cache = await caches.open(MODEL_CACHE);
    let bytes = 0;
    for (const request of await cache.keys()) {
      const length = Number((await cache.match(request))?.headers.get('content-length'));
      if (!Number.isFinite(length) || length <= 0) {
        // Some entries carry no length; the site's total usage is the next best figure.
        const usage = (await navigator.storage?.estimate?.())?.usage;
        return { bytes: usage ?? null, persisted };
      }
      bytes += length;
    }
    return { bytes, persisted };
  } catch {
    return { bytes: null, persisted };
  }
}

/** Deletes the weights and the auto-load flag. Stop the worker first so nothing writes back. */
export async function removeStored(): Promise<void> {
  try {
    localStorage.removeItem(CACHED_FLAG);
  } catch {
    /* storage blocked */
  }
  if ('caches' in globalThis) await caches.delete(MODEL_CACHE);
}
