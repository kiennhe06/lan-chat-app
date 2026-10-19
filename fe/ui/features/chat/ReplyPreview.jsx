import { messagePreview } from './messageUtils.js';
import { IconClose } from '../../components/Icons.jsx';

/** Thanh "Đang trả lời…" / "Đang sửa…" phía trên ô nhập. */
export default function ReplyPreview({ mode, message, senderName, onCancel }) {
  const title = mode === 'edit' ? '✏️ Đang sửa tin nhắn' : `↩️ Trả lời ${senderName || ''}`;
  return (
    <div className="flex items-start gap-2 border-l-4 border-primary bg-surface-2 px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-primary">{title}</p>
        <p className="line-clamp-2 text-xs text-muted">{messagePreview(message, 200)}</p>
      </div>
      <button type="button" className="icon-btn h-7 w-7" onClick={onCancel} aria-label="Hủy" title="Hủy (Esc)">
        <IconClose size={14} />
      </button>
    </div>
  );
}
