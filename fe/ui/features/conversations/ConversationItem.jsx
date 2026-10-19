import { memo } from 'react';
import Avatar from '../../components/Avatar.jsx';
import { formatListTime } from '../../utils/format.js';
import { messagePreview } from '../chat/messageUtils.js';

/**
 * 1 dòng trong danh sách hội thoại.
 */
function ConversationItem({ conversation, title, peer, isGroup, active, senderLabel, onSelect }) {
  const last = conversation.last_message;
  const unread = Number(conversation.unread_count) || 0;
  const preview = last ? `${senderLabel ? `${senderLabel}: ` : ''}${messagePreview(last, 60)}` : 'Chưa có tin nhắn';
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
        active ? 'bg-primary/10' : 'hover:bg-surface-2'
      }`}
    >
      {isGroup ? (
        <Avatar name={title} label="#" size={44} />
      ) : (
        <Avatar user={peer} name={title} size={44} online={peer ? Boolean(peer.online) : null} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate ${unread ? 'font-bold' : 'font-medium'}`}>{title}</span>
          <span className="shrink-0 text-[11px] text-muted">{formatListTime(conversation.last_message_at || (last && last.created_at))}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-xs ${unread ? 'font-semibold text-text' : 'text-muted'}`}>{preview}</span>
          {unread > 0 && (
            <span className="badge shrink-0 bg-danger text-white" aria-label={`${unread} tin chưa đọc`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export default memo(ConversationItem);
