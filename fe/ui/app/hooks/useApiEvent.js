import { useEffect, useRef } from 'react';
import { onApiEvent } from '../api/apiClient.js';

/**
 * Đăng ký push event từ main; handler luôn là bản mới nhất (không cần đưa vào deps).
 * @param {string} channel
 * @param {(payload:any)=>void} handler
 * @param {boolean} [enabled=true]
 */
export function useApiEvent(channel, handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || !channel) return undefined;
    return onApiEvent(channel, (payload) => handlerRef.current(payload));
  }, [channel, enabled]);
}
