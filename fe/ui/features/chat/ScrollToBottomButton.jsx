import { IconArrowDown } from '../../components/Icons.jsx';

/** Nút tròn ↓ khi đang cuộn lên (kèm số tin mới chưa xem). */
export default function ScrollToBottomButton({ count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shadow-pop absolute bottom-3 right-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-text hover:bg-surface-2"
      aria-label={count ? `${count} tin nhắn mới — cuộn xuống` : 'Cuộn xuống cuối'}
      title="Cuộn xuống tin mới nhất"
    >
      <IconArrowDown />
      {count > 0 && (
        <span className="badge absolute -right-1 -top-1 bg-danger px-1.5 text-[10px] text-white">{count > 99 ? '99+' : count}</span>
      )}
    </button>
  );
}
