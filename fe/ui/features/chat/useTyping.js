import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from '../../app/api/apiClient.js';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import C, { IPC_EVENTS } from '../../app/config/constants.js';

/**
 * Typing indicator cho 1 conversation.
 * - Gửi: throttle TYPING_THROTTLE_MS (1.5s).
 * - Nhận: hiển thị "X đang soạn tin…", tự ẩn sau TYPING_HIDE_MS (3s) nếu không nhận thêm.
 * @param {string|null} conversationId
 * @param {number|null} myUserId
 * @returns {{ typers: Array<{user_id:number, display_name:string}>, notifyTyping: () => void,
 *   clearTyper: (userId:number) => void }}
 */
export function useTyping(conversationId, myUserId) {
  const [typers, setTypers] = useState([]);
  const lastSentRef = useRef(0);
  const timersRef = useRef(new Map());

  const clearTyper = useCallback((userId) => {
    clearTimeout(timersRef.current.get(userId));
    timersRef.current.delete(userId);
    setTypers((list) => list.filter((t) => t.user_id !== userId));
  }, []);

  // Đổi conversation → xóa toàn bộ typer cũ
  useEffect(() => {
    const timers = timersRef.current;
    setTypers([]);
    lastSentRef.current = 0;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [conversationId]);

  useApiEvent(IPC_EVENTS.TYPING, (p) => {
    if (!p || String(p.conversation_id) !== String(conversationId)) return;
    const userId = Number(p.user_id);
    if (userId === Number(myUserId)) return;
    setTypers((list) =>
      list.some((t) => t.user_id === userId) ? list : [...list, { user_id: userId, display_name: p.display_name || '' }],
    );
    clearTimeout(timersRef.current.get(userId));
    timersRef.current.set(
      userId,
      setTimeout(() => clearTyper(userId), C.TYPING_HIDE_MS),
    );
  });

  const notifyTyping = useCallback(() => {
    if (!conversationId) return;
    const now = Date.now();
    if (now - lastSentRef.current < C.TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    getApi()
      .chat.typing(conversationId)
      .catch((err) => console.warn('[useTyping] gửi typing lỗi', err));
  }, [conversationId]);

  return { typers, notifyTyping, clearTyper };
}
