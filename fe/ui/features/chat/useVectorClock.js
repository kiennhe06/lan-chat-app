import { useCallback } from 'react';
import { getApi } from '../../app/api/apiClient.js';

/** Comparator dự phòng khi không có preload: server_id → created_at_local → client_message_id. */
function fallbackCompare(a, b) {
  if (a.server_id != null && b.server_id != null) return a.server_id - b.server_id;
  const ta = a.created_at_local || a.created_at || '';
  const tb = b.created_at_local || b.created_at || '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a.client_message_id).localeCompare(String(b.client_message_id));
}

/**
 * Sắp xếp tin theo vector clock (server_id → nhân quả → tie-breaker) bằng `window.api.sortMessages`.
 * @returns {{ sortMessages: (messages: object[]) => object[] }} luôn trả mảng MỚI
 */
export function useVectorClock() {
  const sortMessages = useCallback((messages) => {
    try {
      return getApi().sortMessages(messages);
    } catch (err) {
      console.warn('[useVectorClock] sortMessages lỗi, dùng sắp xếp dự phòng', err);
      return [...(messages || [])].sort(fallbackCompare);
    }
  }, []);
  return { sortMessages };
}
