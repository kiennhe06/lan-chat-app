import { useEffect, useRef, useState } from 'react';
import { IconDots } from '../../components/Icons.jsx';

/**
 * Nút 3 chấm (chỉ hiện khi hover dòng tin) + menu thao tác.
 * @param {{ items: Array<{key:string, label:string, danger?:boolean}>, onSelect: (key:string) => void, alignRight: boolean }} props
 */
export default function MessageMenu({ items, onSelect, alignRight }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return <span className="w-7 shrink-0" />;

  const toggle = () => {
    if (!open && rootRef.current) {
      // Gần đáy màn hình → mở menu lên trên để không bị che
      const rect = rootRef.current.getBoundingClientRect();
      setOpenUp(rect.bottom > window.innerHeight * 0.6);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="msg-menu-trigger flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Thao tác tin nhắn"
      >
        <IconDots size={16} />
      </button>
      {open && (
        <ul
          role="menu"
          className={`shadow-pop absolute z-20 min-w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm ${
            alignRight ? 'right-0' : 'left-0'
          } ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                role="menuitem"
                className={`block w-full px-3 py-1.5 text-left hover:bg-surface-2 ${item.danger ? 'text-danger' : 'text-text'}`}
                onClick={() => {
                  setOpen(false);
                  onSelect(item.key);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
