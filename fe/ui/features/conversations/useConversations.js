import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { getApi } from '../../app/api/apiClient.js';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { localDb } from '../../app/api/localDb.js';
import { IPC_EVENTS } from '../../app/config/constants.js';

const initialState = { conversations: {}, users: {}, loaded: false, error: '' };

/** Cập nhật con trỏ đã nhận/đã đọc của 1 member — chỉ tiến (MAX). */
function applyStatusCursor(conversation, payload) {
  const members = (conversation.members || []).map((m) => {
    if (Number(m.user_id) !== Number(payload.user_id)) return m;
    return {
      ...m,
      last_delivered_message_id: Math.max(
        m.last_delivered_message_id || 0,
        payload.last_delivered_message_id || 0,
        payload.last_read_message_id || 0,
      ),
      last_read_message_id: Math.max(m.last_read_message_id || 0, payload.last_read_message_id || 0),
    };
  });
  return { ...conversation, members };
}

function patchConversation(state, id, patch) {
  const current = state.conversations[id];
  if (!current) return state;
  return { ...state, conversations: { ...state.conversations, [id]: patch(current) } };
}

function reducer(state, action) {
  switch (action.type) {
    case 'loaded': {
      const conversations = {};
      action.conversations.forEach((c) => {
        conversations[String(c.id)] = c;
      });
      const users = {};
      action.users.forEach((u) => {
        users[u.id] = u;
      });
      return { conversations, users, loaded: true, error: '' };
    }
    case 'error':
      return { ...state, loaded: true, error: action.error };
    case 'reset':
      return initialState;
    case 'upsertConversation': {
      const id = String(action.conversation.id);
      const prev = state.conversations[id] || {};
      return { ...state, conversations: { ...state.conversations, [id]: { ...prev, ...action.conversation, id } } };
    }
    case 'removeConversation': {
      const next = { ...state.conversations };
      delete next[String(action.id)];
      return { ...state, conversations: next };
    }
    case 'renameConversationId': {
      const oldId = String(action.oldId);
      const newId = String(action.newId);
      const current = state.conversations[oldId];
      if (!current) return state;
      const next = { ...state.conversations };
      delete next[oldId];
      next[newId] = { ...current, ...(next[newId] || {}), id: newId };
      return { ...state, conversations: next };
    }
    case 'upsertUsers': {
      const users = { ...state.users };
      action.users.forEach((u) => {
        users[u.id] = { ...(users[u.id] || {}), ...u };
      });
      return { ...state, users };
    }
    case 'presence': {
      const user = state.users[action.userId];
      if (!user) return state;
      return { ...state, users: { ...state.users, [action.userId]: { ...user, online: action.online } } };
    }
    case 'status':
      return patchConversation(state, String(action.payload.conversation_id), (c) => applyStatusCursor(c, action.payload));
    case 'pinned':
      return patchConversation(state, String(action.conversationId), (c) => ({ ...c, pinned: action.pinned || [] }));
    case 'pending':
      return patchConversation(state, String(action.conversationId), (c) => ({ ...c, pending_count: action.count || 0 }));
    default:
      return state;
  }
}

/** Sắp conversation theo thời điểm tin cuối giảm dần. */
function sortByLastMessage(a, b) {
  const ta = a.last_message_at || (a.last_message && a.last_message.created_at) || a.updated_at || '';
  const tb = b.last_message_at || (b.last_message && b.last_message.created_at) || b.updated_at || '';
  return ta < tb ? 1 : ta > tb ? -1 : 0;
}

/**
 * Danh sách conversation + user (từ client.db) và cập nhật realtime từ push event.
 * @param {{enabled: boolean, onRemoved?: (id:string)=>void, onIdChanged?: (oldId:string, newId:string)=>void}} options
 */
export function useConversations({ enabled, onRemoved, onIdChanged }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const reload = useCallback(async () => {
    try {
      const [conversations, users] = await Promise.all([localDb.listConversations(), localDb.listUsers()]);
      dispatch({ type: 'loaded', conversations, users });
    } catch (err) {
      console.error('[useConversations] Lỗi tải dữ liệu local', err);
      dispatch({ type: 'error', error: (err && err.message) || 'Không tải được danh sách hội thoại' });
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
    else dispatch({ type: 'reset' });
  }, [enabled, reload]);

  useApiEvent(IPC_EVENTS.CONVERSATION, (p) => p && p.conversation && dispatch({ type: 'upsertConversation', conversation: p.conversation }), enabled);
  useApiEvent(
    IPC_EVENTS.CONVERSATION_REMOVED,
    (p) => {
      if (!p) return;
      dispatch({ type: 'removeConversation', id: p.conversation_id });
      if (onRemoved) onRemoved(String(p.conversation_id));
    },
    enabled,
  );
  useApiEvent(
    IPC_EVENTS.CONVERSATION_ID_CHANGED,
    (p) => {
      if (!p) return;
      dispatch({ type: 'renameConversationId', oldId: p.old_id, newId: p.new_id });
      if (onIdChanged) onIdChanged(String(p.old_id), String(p.new_id));
    },
    enabled,
  );
  useApiEvent(IPC_EVENTS.USERS, (p) => p && Array.isArray(p.users) && dispatch({ type: 'upsertUsers', users: p.users }), enabled);
  useApiEvent(IPC_EVENTS.PRESENCE, (p) => p && dispatch({ type: 'presence', userId: p.user_id, online: !!p.online }), enabled);
  useApiEvent(IPC_EVENTS.STATUS, (p) => p && dispatch({ type: 'status', payload: p }), enabled);
  useApiEvent(IPC_EVENTS.PINNED, (p) => p && dispatch({ type: 'pinned', conversationId: p.conversation_id, pinned: p.pinned }), enabled);
  useApiEvent(IPC_EVENTS.PENDING, (p) => p && dispatch({ type: 'pending', conversationId: p.conversation_id, count: p.pending_count }), enabled);

  const conversationList = useMemo(() => Object.values(state.conversations).sort(sortByLastMessage), [state.conversations]);

  /** Mở (find-or-create) chat 1-1 với userId. */
  const openDirect = useCallback(async (userId) => {
    const conversation = await getApi().chat.openDirect(userId);
    if (conversation) dispatch({ type: 'upsertConversation', conversation });
    return conversation;
  }, []);

  /** Tạo nhóm mới (offline → id tạm). */
  const createGroup = useCallback(async (name, memberIds) => {
    const conversation = await getApi().chat.createGroup(name, memberIds);
    if (conversation) dispatch({ type: 'upsertConversation', conversation });
    return conversation;
  }, []);

  /** Đánh dấu đã đọc hội thoại — lỗi chỉ log (không chặn UI). */
  const markRead = useCallback(async (conversationId) => {
    try {
      await getApi().chat.markRead(conversationId);
    } catch (err) {
      console.warn('[useConversations] markRead lỗi', err);
    }
  }, []);

  const upsertUsers = useCallback((users) => dispatch({ type: 'upsertUsers', users }), []);

  return {
    conversations: state.conversations,
    conversationList,
    users: state.users,
    loaded: state.loaded,
    error: state.error,
    reload,
    openDirect,
    createGroup,
    markRead,
    upsertUsers,
  };
}
