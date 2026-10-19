const KIND_STYLE = {
  info: 'border-primary/40',
  success: 'border-success/60',
  warn: 'border-warning/60',
  error: 'border-danger/60',
};
const KIND_ICON = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '⛔' };

/** Danh sách toast góc dưới phải. */
export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`shadow-pop pointer-events-auto flex items-start gap-2 rounded-lg border-l-4 bg-surface px-3 py-2 text-sm text-text ${KIND_STYLE[t.kind] || KIND_STYLE.info}`}
          role="status"
        >
          <span aria-hidden="true">{KIND_ICON[t.kind] || KIND_ICON.info}</span>
          <span className="flex-1 break-words">{t.text}</span>
          <button type="button" className="text-muted hover:text-text" onClick={() => onDismiss(t.id)} aria-label="Đóng thông báo">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
