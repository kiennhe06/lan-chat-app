import { useEffect, useRef } from 'react';
import { EMOJI_LIST } from '../../app/config/app.config.js';

/** Bảng emoji tích hợp (offline). Click ngoài / Esc → đóng. */
export default function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="shadow-pop absolute bottom-full left-0 z-20 mb-2 grid w-72 grid-cols-8 gap-0.5 rounded-xl border border-border bg-surface p-2" role="dialog" aria-label="Chọn emoji">
      {EMOJI_LIST.map((emoji) => (
        <button key={emoji} type="button" className="rounded-md p-1 text-xl hover:bg-surface-2" onClick={() => onPick(emoji)} aria-label={emoji}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
