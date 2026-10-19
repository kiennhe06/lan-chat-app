/** Khung xem trước ảnh vừa dán (Ctrl+V) với nút X đỏ — chưa gửi cho tới khi bấm Gửi. */
export default function PastePreview({ url, name, onRemove }) {
  return (
    <div className="px-3 pt-2">
      <div className="relative inline-block rounded-lg border border-border bg-surface-2 p-1">
        <img src={url} alt={name || 'Ảnh dán'} className="block max-h-32 max-w-[240px] rounded-md object-contain" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-danger text-xs font-bold text-white shadow hover:opacity-90"
          aria-label="Bỏ ảnh"
          title="Bỏ ảnh"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
