import { useEffect, useRef, useState } from 'react';
import C from '../../app/config/constants.js';
import { formatDateTime, messageTime } from '../../utils/format.js';
import { messagePreview } from './messageUtils.js';
import { IconClose, IconSearch } from '../../components/Icons.jsx';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Panel tìm kiếm trong conversation (client.db). Click kết quả → cuộn tới tin.
 * @param {{ onSearch: (keyword:string) => Promise<object[]>, getSenderName: (id:number) => string,
 *   onPick: (clientMessageId:string) => void, onClose: () => void }} props
 */
export default function SearchPanel({ onSearch, getSenderName, onPick, onClose }) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) {
      setResults([]);
      setError('');
      return undefined;
    }
    let cancelled = false;
    // Đánh dấu đang tìm ngay (trong lúc debounce) để không hiện "0 kết quả" sai
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const list = await onSearch(q);
        if (!cancelled) {
          setResults(list.slice(0, C.SEARCH_RESULT_LIMIT));
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError((err && err.message) || 'Tìm kiếm thất bại');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [keyword, onSearch]);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-semibold">Tìm trong cuộc trò chuyện</h3>
        <button type="button" className="icon-btn h-8 w-8" onClick={onClose} aria-label="Đóng tìm kiếm">
          <IconClose />
        </button>
      </div>
      <div className="p-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
            <IconSearch size={16} />
          </span>
          <input ref={inputRef} className="input pl-8" placeholder="Nhập từ khóa…" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Từ khóa tìm kiếm" />
        </div>
        {keyword.trim() && !searching && !error && <p className="mt-2 text-xs text-muted">{results.length} kết quả</p>}
        {searching && <p className="mt-2 text-xs text-muted">Đang tìm…</p>}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {results.map((m) => (
          <li key={m.client_message_id}>
            <button type="button" className="w-full rounded-lg px-2 py-2 text-left hover:bg-surface-2" onClick={() => onPick(m.client_message_id)}>
              <span className="flex justify-between gap-2 text-xs">
                <span className="truncate font-semibold">{getSenderName(m.sender_id)}</span>
                <span className="shrink-0 text-muted">{formatDateTime(messageTime(m))}</span>
              </span>
              <span className="line-clamp-2 text-sm text-text/90">{messagePreview(m, 160)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
