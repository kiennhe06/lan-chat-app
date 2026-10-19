import { useState } from 'react';
import { pinPreviewText } from './pinPreview.js';

/**
 * Banner 📌 vàng đầu khung chat: nội dung tin ghim + "Xem" + "Bỏ ghim" (nếu có quyền).
 * Nhiều tin ghim → nút "+N" mở danh sách.
 */
export default function PinnedBanner({ pinned, canUnpin, onView, onUnpin }) {
  const [expanded, setExpanded] = useState(false);
  if (!pinned || pinned.length === 0) return null;
  const list = expanded ? pinned : pinned.slice(0, 1);
  return (
    <div className="border-b border-yellow-300/60 bg-pin-yellow text-text">
      {list.map((pin) => (
        <div key={pin.client_message_id} className="flex items-center gap-2 px-4 py-1.5 text-sm">
          <span aria-hidden="true">📌</span>
          <span className="min-w-0 flex-1 truncate" title={pin.content_preview}>
            {pinPreviewText(pin)}
          </span>
          <button type="button" className="shrink-0 text-xs font-semibold text-primary hover:underline" onClick={() => onView(pin.client_message_id)}>
            Xem
          </button>
          {canUnpin && (
            <button type="button" className="shrink-0 text-xs font-semibold text-danger hover:underline" onClick={() => onUnpin(pin.client_message_id)}>
              Bỏ ghim
            </button>
          )}
        </div>
      ))}
      {pinned.length > 1 && (
        <button type="button" className="w-full pb-1 text-center text-[11px] text-muted hover:underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Thu gọn' : `+${pinned.length - 1} tin ghim khác`}
        </button>
      )}
    </div>
  );
}
