import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApi, errorMessage } from '../../app/api/apiClient.js';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { useVectorClock } from './useVectorClock.js';
import { localDb } from '../../app/api/localDb.js';
import { IPC_EVENTS, MESSAGE_STATUS, MESSAGE_STATUS_RANK } from '../../app/config/constants.js';

const EMPTY_STATE = Object.freeze({
  messages: [],
  hasMoreLocal: false,
  serverHasMore: true,
  oldestKey: null,
  loading: true,
  loadingOlder: false,
  detached: false,
  error: '',
});

/**
 * Gộp bản cập nhật vào tin cũ. Trạng thái chỉ được TIẾN (sent → delivered → read),
 * ngoại lệ: `failed` luôn được áp dụng để hiển thị nút gửi lại.
 */
function mergeMessage(prev, next) {
  if (!prev) return next;
  const merged = { ...prev, ...next };
  const prevRank = MESSAGE_STATUS_RANK[prev.status] ?? 0;
  const nextRank = MESSAGE_STATUS_RANK[next.status] ?? 0;
  if (next.status !== MESSAGE_STATUS.FAILED && nextRank < prevRank) merged.status = prev.status;
  return merged;
}

/** Hợp nhất 2 danh sách theo client_message_id. */
function unionMessages(base, incoming) {
  const map = new Map(base.map((m) => [m.client_message_id, m]));
  incoming.forEach((m) => map.set(m.client_message_id, mergeMessage(map.get(m.client_message_id), m)));
  return Array.from(map.values());
}

/**
 * Lịch sử tin nhắn của 1 conversation (client.db), phân trang PAGE_SIZE.
 * - Cuộn lên → loadOlder(): hết local mà đang online → chat.loadOlderFromServer.
 * - loadAround(): nhảy tới tin chưa load (reply/search/pin) — cửa sổ "tách rời" khỏi tin mới nhất.
 * - Upsert realtime từ evt:message, xóa từ evt:message-removed.
 * @param {string|null} conversationId
 * @param {{ isOnline: boolean, onIncoming?: (message:object, info:{isNew:boolean, appended:boolean}) => void }} options
 */
export function useChatHistory(conversationId, { isOnline, onIncoming }) {
  const { sortMessages } = useVectorClock();
  const [state, setState] = useState(EMPTY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Token chống race: kết quả của conversation cũ bị bỏ qua
  const generationRef = useRef(0);

  const loadLatest = useCallback(async () => {
    if (!conversationId) return;
    const generation = ++generationRef.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const page = await localDb.getMessages(conversationId, null);
      if (generation !== generationRef.current) return;
      setState((s) => ({
        ...EMPTY_STATE,
        // Giữ các tin realtime vừa đến trong lúc đang tải
        messages: sortMessages(unionMessages(s.detached ? [] : s.messages, page.messages)),
        hasMoreLocal: page.has_more,
        oldestKey: page.oldest_key,
        loading: false,
      }));
    } catch (err) {
      if (generation !== generationRef.current) return;
      setState((s) => ({ ...s, loading: false, error: errorMessage(err, 'Không tải được lịch sử') }));
    }
  }, [conversationId, sortMessages]);

  useEffect(() => {
    setState(EMPTY_STATE);
    loadLatest();
  }, [loadLatest]);

  /** Tải thêm 50 tin cũ hơn. @returns {Promise<number>} số tin mới được thêm */
  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (!conversationId || current.loading || current.loadingOlder) return 0;
    const canFetchServer = !current.hasMoreLocal && current.serverHasMore && isOnline;
    if (!current.hasMoreLocal && !canFetchServer) return 0;
    const generation = generationRef.current;
    setState((s) => ({ ...s, loadingOlder: true }));
    try {
      let serverHasMore = current.serverHasMore;
      if (!current.hasMoreLocal) {
        // Local hết → kéo thêm từ server vào client.db rồi đọc lại local
        const res = await getApi().chat.loadOlderFromServer(conversationId);
        serverHasMore = Boolean(res && res.has_more);
        if (!res || !res.count) {
          if (generation === generationRef.current) {
            setState((s) => ({ ...s, loadingOlder: false, serverHasMore }));
          }
          return 0;
        }
      }
      const page = await localDb.getMessages(conversationId, current.oldestKey);
      if (generation !== generationRef.current) return 0;
      setState((s) => ({
        ...s,
        messages: sortMessages(unionMessages(s.messages, page.messages)),
        hasMoreLocal: page.has_more,
        oldestKey: page.oldest_key || s.oldestKey,
        serverHasMore,
        loadingOlder: false,
      }));
      return page.messages.length;
    } catch (err) {
      if (generation === generationRef.current) {
        setState((s) => ({ ...s, loadingOlder: false, error: errorMessage(err, 'Không tải được tin cũ') }));
      }
      return 0;
    }
  }, [conversationId, isOnline, sortMessages]);

  /**
   * Đảm bảo tin `clientMessageId` có trong danh sách (tải cửa sổ quanh nó nếu cần).
   * @returns {Promise<boolean>} true nếu tìm thấy
   */
  const loadAround = useCallback(
    async (clientMessageId) => {
      if (!conversationId || !clientMessageId) return false;
      if (stateRef.current.messages.some((m) => m.client_message_id === clientMessageId)) return true;
      const generation = ++generationRef.current;
      try {
        const page = await localDb.getMessagesAround(conversationId, clientMessageId);
        if (generation !== generationRef.current) return false;
        const found = page.messages.some((m) => m.client_message_id === clientMessageId);
        if (!found) return false;
        setState({
          ...EMPTY_STATE,
          messages: sortMessages(page.messages),
          hasMoreLocal: page.has_more,
          oldestKey: page.oldest_key,
          loading: false,
          detached: true,
        });
        return true;
      } catch (err) {
        console.warn('[useChatHistory] loadAround lỗi', err);
        return false;
      }
    },
    [conversationId, sortMessages],
  );

  /** Quay về trang mới nhất (sau khi nhảy tới tin cũ). */
  const jumpToLatest = useCallback(() => loadLatest(), [loadLatest]);

  /**
   * Chèn/cập nhật 1 tin vào danh sách đang hiển thị.
   * @returns {{isNew:boolean, appended:boolean}}
   */
  const upsertMessage = useCallback(
    (message) => {
      const current = stateRef.current;
      const exists = current.messages.some((m) => m.client_message_id === message.client_message_id);
      // Cửa sổ tách rời: không chèn tin mới (tránh khoảng trống), chỉ báo cho UI hiện nút ↓
      const appended = exists || !current.detached;
      if (appended) {
        setState((s) => {
          const idx = s.messages.findIndex((m) => m.client_message_id === message.client_message_id);
          if (idx >= 0) {
            const next = s.messages.slice();
            next[idx] = mergeMessage(next[idx], message);
            // server_id mới có thể đổi thứ tự → sắp lại
            return { ...s, messages: next[idx].server_id !== s.messages[idx].server_id ? sortMessages(next) : next };
          }
          return { ...s, messages: sortMessages([...s.messages, message]) };
        });
      }
      return { isNew: !exists, appended };
    },
    [sortMessages],
  );

  useApiEvent(IPC_EVENTS.MESSAGE, (payload) => {
    const message = payload && payload.message;
    if (!message || String(message.conversation_id) !== String(conversationId)) return;
    const info = upsertMessage(message);
    if (onIncoming) onIncoming(message, info);
  });

  useApiEvent(IPC_EVENTS.MESSAGE_REMOVED, (p) => {
    if (!p || String(p.conversation_id) !== String(conversationId)) return;
    setState((s) => ({ ...s, messages: s.messages.filter((m) => m.client_message_id !== p.client_message_id) }));
  });

  const messagesById = useMemo(() => {
    const map = new Map();
    state.messages.forEach((m) => map.set(m.client_message_id, m));
    return map;
  }, [state.messages]);

  return {
    messages: state.messages,
    messagesById,
    loading: state.loading,
    loadingOlder: state.loadingOlder,
    hasOlder: state.hasMoreLocal || (state.serverHasMore && isOnline),
    detached: state.detached,
    error: state.error,
    loadOlder,
    loadAround,
    jumpToLatest,
    upsertMessage,
  };
}
