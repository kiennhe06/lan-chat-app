import { messagePreview } from './messageUtils.js';

/**
 * Trích dẫn tin được trả lời bên trong bong bóng: tối đa 2 dòng + "…", click → nhảy tới tin gốc.
 */
export default function ReplyQuote({ target, senderName, own, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 block w-full rounded-md border-l-[3px] px-2 py-1 text-left text-xs ${
        own ? 'border-white/70 bg-white/15 text-white/90' : 'border-primary bg-surface/60 text-text/80'
      }`}
      title="Xem tin nhắn gốc"
    >
      <span className="block font-semibold">{target ? senderName : 'Tin nhắn gốc'}</span>
      <span className="line-clamp-2 whitespace-pre-wrap break-words">{target ? messagePreview(target, 200) : 'Nhấn để xem tin nhắn gốc'}</span>
    </button>
  );
}
