import { useMemo, useState } from 'react';
import { useAuth } from '../../app/context/AuthContext.jsx';
import { useChat } from '../../app/context/ChatContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { CONNECTION_STATE } from '../connection/useSocket.js';
import { foldText } from '../../utils/format.js';
import { isGroupConversation } from '../chat/messageUtils.js';
import Avatar from '../../components/Avatar.jsx';
import ConversationItem from './ConversationItem.jsx';
import { IconSearch, IconSettings } from '../../components/Icons.jsx';

const CONNECTION_LABEL = {
  [CONNECTION_STATE.ONLINE]: { text: 'Trực tuyến', dot: 'bg-success' },
  [CONNECTION_STATE.OFFLINE_P2P]: { text: 'Offline · P2P', dot: 'bg-warning' },
  [CONNECTION_STATE.CONNECTING]: { text: 'Đang kết nối…', dot: 'bg-muted' },
  [CONNECTION_STATE.DISCONNECTED]: { text: 'Mất kết nối', dot: 'bg-danger' },
};

/**
 * Cột trái: người dùng hiện tại, tìm kiếm, danh sách hội thoại, nút tạo mới.
 */
export default function Sidebar({ onOpenSettings, onCreate }) {
  const { user } = useAuth();
  const toast = useToast();
  const { conversationList, users, activeId, setActiveId, getConversationTitle, getDirectPeer, connection, openDirect, loaded } = useChat();
  const [query, setQuery] = useState('');

  const folded = foldText(query.trim());

  const filteredConversations = useMemo(() => {
    if (!folded) return conversationList;
    return conversationList.filter((c) => foldText(getConversationTitle(c)).includes(folded));
  }, [conversationList, folded, getConversationTitle]);

  // Khi tìm kiếm: hiện thêm người dùng chưa có chat 1-1 trong kết quả
  const matchedUsers = useMemo(() => {
    if (!folded) return [];
    return Object.values(users)
      .filter((u) => Number(u.id) !== Number(user.id))
      .filter((u) => [u.display_name, u.username, u.employee_id].some((v) => foldText(v).includes(folded)))
      .slice(0, 20);
  }, [users, folded, user.id]);

  const startDirect = async (targetUser) => {
    try {
      const conversation = await openDirect(targetUser.id);
      if (conversation) setActiveId(String(conversation.id));
      setQuery('');
    } catch (err) {
      toast.error((err && err.message) || 'Không mở được cuộc trò chuyện');
    }
  };

  const conn = CONNECTION_LABEL[connection.state] || CONNECTION_LABEL[CONNECTION_STATE.CONNECTING];

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        <Avatar user={user} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{user.display_name}</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            <span className={`inline-block h-2 w-2 rounded-full ${conn.dot}`} />
            {conn.text}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onOpenSettings} title="Cài đặt" aria-label="Cài đặt">
          <IconSettings />
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
            <IconSearch size={16} />
          </span>
          <input
            className="input py-1.5 pl-8"
            placeholder="Tìm người, nhóm…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Tìm người dùng hoặc cuộc trò chuyện"
          />
        </div>
        <button type="button" className="btn-primary px-3 py-1.5" onClick={onCreate} title="Tạo cuộc trò chuyện mới">
          + Tạo
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!loaded && <p className="px-2 py-4 text-center text-sm text-muted">Đang tải…</p>}
        {loaded && filteredConversations.length === 0 && !matchedUsers.length && (
          <p className="px-2 py-6 text-center text-sm text-muted">{query ? 'Không tìm thấy kết quả' : 'Chưa có cuộc trò chuyện nào. Nhấn "+ Tạo" để bắt đầu.'}</p>
        )}
        {filteredConversations.map((c) => {
          const isGroup = isGroupConversation(c);
          const lastSender = c.last_message && users[c.last_message.sender_id];
          let senderLabel = '';
          if (c.last_message && Number(c.last_message.sender_id) === Number(user.id)) senderLabel = 'Bạn';
          else if (isGroup && lastSender) senderLabel = lastSender.display_name;
          return (
            <ConversationItem
              key={c.id}
              conversation={c}
              title={getConversationTitle(c)}
              peer={getDirectPeer(c)}
              isGroup={isGroup}
              active={String(c.id) === String(activeId)}
              senderLabel={senderLabel}
              onSelect={setActiveId}
            />
          );
        })}
        {matchedUsers.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase text-muted">Người dùng</p>
            {matchedUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                onClick={() => startDirect(u)}
              >
                <Avatar user={u} size={36} online={Boolean(u.online)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{u.display_name}</span>
                  <span className="block truncate text-xs text-muted">
                    @{u.username} · {u.employee_id}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
