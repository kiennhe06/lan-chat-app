import { useMemo, useState } from 'react';
import { foldText } from '../../utils/format.js';
import Avatar from '../../components/Avatar.jsx';

/**
 * Danh sách user có ô tìm (tên / username / mã nhân viên), chọn 1 hoặc nhiều.
 * @param {{ users: object[], selected: number[], onToggle: (id:number) => void, multiple?: boolean }} props
 */
export default function UserPicker({ users, selected, onToggle, multiple = true }) {
  const [query, setQuery] = useState('');
  const folded = foldText(query.trim());
  const filtered = useMemo(
    () =>
      users
        .filter((u) => !folded || [u.display_name, u.username, u.employee_id].some((v) => foldText(v).includes(folded)))
        .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'vi')),
    [users, folded],
  );

  return (
    <div>
      <input
        className="input mb-2"
        placeholder="Tìm theo tên, tên đăng nhập, mã nhân viên…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Tìm người dùng"
      />
      <ul className="max-h-72 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 && <li className="py-4 text-center text-sm text-muted">Không có người dùng phù hợp</li>}
        {filtered.map((u) => {
          const checked = selected.includes(Number(u.id));
          return (
            <li key={u.id}>
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${checked ? 'bg-primary/10' : 'hover:bg-surface-2'}`}>
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name="user-picker"
                  className="h-4 w-4 accent-[rgb(var(--c-primary))]"
                  checked={checked}
                  onChange={() => onToggle(Number(u.id))}
                />
                <Avatar user={u} size={32} online={Boolean(u.online)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{u.display_name}</span>
                  <span className="block truncate text-xs text-muted">
                    @{u.username} · {u.employee_id}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
