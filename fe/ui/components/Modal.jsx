import { useEffect, useRef } from 'react';
import { IconClose } from './Icons.jsx';

// Ngăn xếp modal đang mở: Esc chỉ đóng modal trên cùng
const modalStack = [];
let modalSeq = 0;

/**
 * Modal chung: click backdrop đóng, Esc đóng, có tiêu đề + nút X.
 * @param {{ title?: string, onClose: () => void, children: any, width?: number, footer?: any, closeOnBackdrop?: boolean }} props
 */
export default function Modal({ title, onClose, children, width = 480, footer, closeOnBackdrop = true }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    modalSeq += 1;
    const id = modalSeq;
    modalStack.push(id);
    const onKey = (e) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const idx = modalStack.indexOf(id);
      if (idx >= 0) modalStack.splice(idx, 1);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="shadow-pop flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" className="icon-btn h-8 w-8" onClick={onClose} aria-label="Đóng">
              <IconClose />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
