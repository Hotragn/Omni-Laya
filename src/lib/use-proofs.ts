import { useCallback, useEffect, useState } from 'react';
import { EMPTY_PROOFS, loadProofs, saveProofs, type Proofs } from './proof';

/**
 * The reader's marks, read from local storage after the first render so the
 * server and the first client frame agree, and written back on every change.
 */
export function useProofs(): [Proofs, (change: (p: Proofs) => Proofs) => void] {
  const [proofs, setProofs] = useState<Proofs>(EMPTY_PROOFS);
  useEffect(() => setProofs(loadProofs()), []);
  const update = useCallback((change: (p: Proofs) => Proofs) => {
    setProofs((prev) => {
      const next = change(prev);
      saveProofs(next);
      return next;
    });
  }, []);
  return [proofs, update];
}
