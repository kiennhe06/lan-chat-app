import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CONVERSATION_TYPE, IPC_EVENTS } from '../config/constants.js';
import { useApiEvent } from '../hooks/useApiEvent.js';
import { useConversations } from '../../features/conversations/useConversations.js';
import { useOfflineQueue } from '../../features/connection/useOfflineQueue.js';
import { useP2P } from '../../features/connection/useP2P.js';
import { useSocket } from '../../features/connection/useSocket.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const ChatContext = createContext(null);

/**
 * Trạng thái chat toàn cục: kết nối, conversation, user/presence, peer P2P, đồng bộ, conversation đang mở.
 */
export function ChatProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const enabled = Boolean(user);
  const [activeId, setActiveId] = useState(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const connection = useSocket(enabled);
  const { peers } = useP2P(enabled);

  const handleRemoved = useCallback(
    (conversationId) => {
      if (activeIdRef.current === conversationId) {
        setActiveId(null);
        toast.info('Cuộc trò chuyện không còn khả dụng (đã bị xóa hoặc bạn đã bị mời ra).');
      }
    },
    [toast],
  );

  const handleIdChanged = useCallback((oldId, newId) => {
    if (activeIdRef.current === oldId) setActiveId(newId);
  }, []);

  const convState = useConversations({ enabled, onRemoved: handleRemoved, onIdChanged: handleIdChanged });

  const { progress: syncProgress } = useOfflineQueue({
    enabled,
    onDone: (summary) => {
      const messages = Number(summary.messages) || 0;
      const files = Number(summary.files) || 0;
      if (messages || files) toast.success(`Đã đồng bộ ${messages} tin, ${files} file`);
      if (summary.conflicts) toast.warn(`Có ${summary.conflicts} xung đột — đã giữ bản trên server`);
    },
  });

  // Click thông báo hệ thống → mở đúng conversation
  useApiEvent(IPC_EVENTS.NOTIFICATION_CLICK, (p) => p && p.conversation_id && setActiveId(String(p.conversation_id)), enabled);

  const { conversations, users } = convState;
  const activeConversation = activeId ? conversations[activeId] || null : null;

  /** Tên hiển thị của conversation (1-1 → tên người kia). */
  const getConversationTitle = useCallback(
    (conversation) => {
      if (!conversation) return '';
      if (conversation.type === CONVERSATION_TYPE.GROUP) return conversation.name || 'Nhóm không tên';
      const other = (conversation.members || []).find((m) => Number(m.user_id) !== Number(user && user.id));
      const otherUser = other ? users[other.user_id] : null;
      return (otherUser && otherUser.display_name) || conversation.name || 'Cuộc trò chuyện';
    },
    [users, user],
  );

  /** User còn lại trong chat 1-1 (null nếu là nhóm). */
  const getDirectPeer = useCallback(
    (conversation) => {
      if (!conversation || conversation.type !== CONVERSATION_TYPE.DIRECT) return null;
      const other = (conversation.members || []).find((m) => Number(m.user_id) !== Number(user && user.id));
      return other ? users[other.user_id] || { id: other.user_id, display_name: '?' } : null;
    },
    [users, user],
  );

  const value = useMemo(
    () => ({
      me: user,
      connection,
      peers,
      syncProgress,
      ...convState,
      activeId,
      activeConversation,
      setActiveId,
      getConversationTitle,
      getDirectPeer,
    }),
    [user, connection, peers, syncProgress, convState, activeId, activeConversation, getConversationTitle, getDirectPeer],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat phải nằm trong ChatProvider');
  return ctx;
}
