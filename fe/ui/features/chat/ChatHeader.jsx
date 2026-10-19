import Avatar from '../../components/Avatar.jsx';

/**
 * Header khung chat: avatar, tên, trạng thái + các nút thao tác (truyền qua children).
 */
export default function ChatHeader({ title, subtitle, isGroup, peer, children }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
      {isGroup ? <Avatar name={title} label="#" size={40} /> : <Avatar user={peer} name={title} size={40} online={peer ? Boolean(peer.online) : null} />}
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-semibold">{title}</h2>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </header>
  );
}
