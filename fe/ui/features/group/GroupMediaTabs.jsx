import { useEffect, useState } from 'react';
import { useGroupActions } from './useGroupActions.js';
import { useMediaUrls } from '../chat/useMediaUrls.js';
import { useValidators } from '../../app/hooks/useValidators.js';
import { fileIcon, formatDateTime, formatFileSize, messageTime } from '../../utils/format.js';

const TABS = [
  { key: 'images', label: 'Ảnh' },
  { key: 'files', label: 'Tệp' },
  { key: 'links', label: 'Link' },
];

/**
 * Tabs Ảnh | Tệp | Link trong panel nhóm (db.getMedia). Click → cuộn tới tin gốc.
 */
export default function GroupMediaTabs({ conversationId, refreshKey, onJump }) {
  const actions = useGroupActions(conversationId);
  const validators = useValidators();
  const { thumbUrl, imageUrl } = useMediaUrls();
  const [tab, setTab] = useState('images');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    actions
      .getMedia(tab)
      .then((list) => !cancelled && setItems(list))
      .catch((err) => !cancelled && setError((err && err.message) || 'Không tải được dữ liệu'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [actions, tab, refreshKey]);

  // Link: mỗi item có thể là {url} hoặc một tin nhắn chứa link
  const links = tab === 'links'
    ? items.flatMap((item) => (item.url ? [{ url: item.url, item }] : validators.extractLinks(item.content || '').map((url) => ({ url, item }))))
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-4 grid grid-cols-3 rounded-lg bg-surface-2 p-1 text-sm font-medium" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded-md py-1 ${tab === t.key ? 'bg-surface text-primary shadow' : 'text-muted hover:text-text'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && <p className="text-center text-xs text-muted">Đang tải…</p>}
        {error && <p className="text-center text-xs text-danger">{error}</p>}
        {!loading && !error && items.length === 0 && <p className="py-4 text-center text-xs text-muted">Chưa có nội dung</p>}
        {tab === 'images' && (
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((item) => {
              const file = item.file || item;
              const src = file.has_thumb ? thumbUrl(file.sha256) : imageUrl(file.sha256);
              return (
                <button key={item.client_message_id || file.sha256} type="button" className="aspect-square overflow-hidden rounded-md bg-surface-2" onClick={() => onJump(item.client_message_id)} title={file.name}>
                  <img src={src} alt={file.name || 'Ảnh'} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                </button>
              );
            })}
          </div>
        )}
        {tab === 'files' && (
          <ul className="space-y-1">
            {items.map((item) => {
              const file = item.file || item;
              return (
                <li key={item.client_message_id || file.sha256}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => onJump(item.client_message_id)}>
                    <span className="text-2xl">{fileIcon(file.name, file.mime_type)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{file.name}</span>
                      <span className="block text-xs text-muted">
                        {formatFileSize(file.size)} · {formatDateTime(messageTime(item))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'links' && (
          <ul className="space-y-1">
            {links.map(({ url, item }, i) => (
              <li key={`${item.client_message_id}-${i}`}>
                <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => onJump(item.client_message_id)} title={url}>
                  <span className="block truncate text-sm text-primary">🔗 {url}</span>
                  <span className="block text-xs text-muted">{formatDateTime(messageTime(item))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
