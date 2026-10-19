import { useEffect, useRef, useState } from 'react';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { IPC_EVENTS } from '../../app/config/constants.js';

const PROGRESS_HIDE_DELAY_MS = 1500;

/**
 * Tiến trình đồng bộ offline → server (evt:sync-progress / evt:sync-done).
 * @param {{ enabled: boolean, onDone?: (summary:{messages:number, files:number, conflicts:number}) => void }} options
 * @returns {{ progress: {phase:string, done:number, total:number}|null }}
 */
export function useOfflineQueue({ enabled, onDone }) {
  const [progress, setProgress] = useState(null);
  const hideTimer = useRef(null);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useApiEvent(
    IPC_EVENTS.SYNC_PROGRESS,
    (p) => {
      if (!p) return;
      clearTimeout(hideTimer.current);
      setProgress({ phase: p.phase, done: Number(p.done) || 0, total: Number(p.total) || 0 });
    },
    enabled,
  );

  useApiEvent(
    IPC_EVENTS.SYNC_DONE,
    (summary) => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setProgress(null), PROGRESS_HIDE_DELAY_MS);
      if (onDone && summary) onDone(summary);
    },
    enabled,
  );

  return { progress };
}
