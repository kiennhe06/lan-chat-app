import Avatar from '../../components/Avatar.jsx';

/**
 * Gợi ý thành viên khi gõ @ trong nhóm (điều khiển bằng phím ở Composer).
 */
export default function MentionDropdown({ items, activeIndex, onPick, onHover }) {
  if (!items.length) return null;
  return (
    <ul className="shadow-pop absolute bottom-full left-12 z-20 mb-2 max-h-64 w-72 overflow-y-auto rounded-xl border border-border bg-surface py-1" role="listbox" aria-label="Gợi ý nhắc tên">
      {items.map((u, i) => (
        <li key={u.id} role="option" aria-selected={i === activeIndex}>
          <button
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === activeIndex ? 'bg-primary/10' : 'hover:bg-surface-2'}`}
            onMouseDown={(e) => {
              e.preventDefault(); // giữ focus textarea
              onPick(u);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <Avatar user={u} size={24} />
            <span className="truncate font-medium">{u.display_name}</span>
            <span className="truncate text-xs text-muted">@{u.username}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
