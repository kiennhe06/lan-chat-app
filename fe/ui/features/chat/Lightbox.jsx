import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import C from '../../app/config/constants.js';
import { useBodyStyle } from '../../app/hooks/useBodyStyle.js';
import { useMediaUrls } from './useMediaUrls.js';

const clampZoom = (z) => Math.min(C.LIGHTBOX_ZOOM_MAX, Math.max(C.LIGHTBOX_ZOOM_MIN, z));

/**
 * Xem ảnh toàn màn hình: nền rgba(0,0,0,0.95), cuộn chuột zoom 0.5x–5x, kéo để pan,
 * toolbar cố định dưới cùng (−, %, +, Reset, Tải xuống, Đóng), Esc đóng.
 * @param {{ file: {sha256:string, name?:string}, onClose: () => void, onError?: (msg:string) => void }} props
 */
export default function Lightbox({ file, onClose, onError }) {
  const { imageUrl, saveImage } = useMediaUrls();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  useBodyStyle({ overflow: 'hidden' });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };
  const zoomBy = useCallback((delta) => setZoom((z) => clampZoom(Math.round((z + delta) * 100) / 100)), []);

  const onWheel = (e) => zoomBy(e.deltaY < 0 ? C.LIGHTBOX_ZOOM_STEP : -C.LIGHTBOX_ZOOM_STEP);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
    setDragging(true);
  };

  // Theo dõi chuột trên window để kéo mượt kể cả khi ra ngoài ảnh
  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      setOffset({ x: d.origin.x + e.clientX - d.startX, y: d.origin.y + e.clientY - d.startY });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const download = async () => {
    try {
      await saveImage(file.sha256, file.name || `anh-${file.sha256.slice(0, 8)}.png`);
    } catch (err) {
      if (onError) onError((err && err.message) || 'Không lưu được ảnh');
    }
  };

  const toolBtn = 'rounded-md px-3 py-1.5 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-40';

  return createPortal(
    <div className="fixed inset-0 z-50 select-none" style={{ background: 'rgba(0,0,0,0.95)' }} role="dialog" aria-modal="true" aria-label="Xem ảnh">
      <div
        className="absolute inset-0 bottom-16 flex items-center justify-center overflow-hidden"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onDoubleClick={reset}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <img
          src={imageUrl(file.sha256)}
          alt={file.name || 'Hình ảnh'}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transition: dragging ? 'none' : 'transform 0.12s ease-out',
          }}
        />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-[51] flex h-16 items-center justify-center gap-1 border-t border-white/10 bg-black/80 px-4">
        <button type="button" className={toolBtn} onClick={() => zoomBy(-C.LIGHTBOX_ZOOM_STEP)} disabled={zoom <= C.LIGHTBOX_ZOOM_MIN} aria-label="Thu nhỏ">
          −
        </button>
        <span className="w-14 text-center text-sm tabular-nums text-white/90">{Math.round(zoom * 100)}%</span>
        <button type="button" className={toolBtn} onClick={() => zoomBy(C.LIGHTBOX_ZOOM_STEP)} disabled={zoom >= C.LIGHTBOX_ZOOM_MAX} aria-label="Phóng to">
          +
        </button>
        <span className="mx-2 h-6 w-px bg-white/20" />
        <button type="button" className={toolBtn} onClick={reset}>
          Reset
        </button>
        <button type="button" className={toolBtn} onClick={download}>
          ⬇ Tải xuống
        </button>
        <button type="button" className={toolBtn} onClick={onClose}>
          ✕ Đóng
        </button>
      </div>
      {file.name && <p className="pointer-events-none fixed left-4 top-3 max-w-[60vw] truncate text-sm text-white/80">{file.name}</p>}
    </div>,
    document.body,
  );
}
