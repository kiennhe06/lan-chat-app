import { memo, useState } from 'react';
import { useMediaUrls } from './useMediaUrls.js';
import RichText from './RichText.jsx';

const MAX_W = 280;
const MAX_H = 320;

/** Kích thước hiển thị giữ tỉ lệ ảnh gốc (tránh nhảy layout khi ảnh tải xong). */
function fitSize(file) {
  const w = Number(file && file.width) || 0;
  const h = Number(file && file.height) || 0;
  if (!w || !h) return { width: MAX_W, height: 200 };
  const scale = Math.min(MAX_W / w, MAX_H / h, 1);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * Tin ảnh: ảnh ở trên, divider, text kèm theo ở dưới.
 */
function ImageMessage({ message, own, upload, mentionNames, onOpen, onCancelUpload }) {
  const { thumbUrl, imageUrl } = useMediaUrls();
  const [failed, setFailed] = useState(false);
  const file = message.file;
  const size = fitSize(file);
  const src = file && file.sha256 ? (file.has_thumb ? thumbUrl(file.sha256) : imageUrl(file.sha256)) : '';

  return (
    <div className="overflow-hidden">
      <div className="relative" style={{ width: size.width, maxWidth: '100%' }}>
        {src && !failed ? (
          <button type="button" className="block w-full" onClick={() => onOpen(file)} title="Xem ảnh">
            <img
              src={src}
              alt={file.name || 'Hình ảnh'}
              className="block h-auto w-full rounded-lg bg-black/5 object-cover"
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
              draggable={false}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          </button>
        ) : (
          <div
            className={`flex w-full items-center justify-center rounded-lg text-xs ${own ? 'bg-white/15 text-white/80' : 'bg-surface text-muted'}`}
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
          >
            {failed ? '🖼️ Không tải được ảnh (chưa có trong cache offline)' : '🖼️ Đang chuẩn bị ảnh…'}
          </div>
        )}
        {upload && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/50 text-white">
            <span className="text-sm font-semibold">{upload.state === 'error' ? 'Gửi lỗi' : `${upload.percent}%`}</span>
            {upload.state === 'uploading' && (
              <button type="button" className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30" onClick={onCancelUpload}>
                Hủy
              </button>
            )}
          </div>
        )}
      </div>
      {message.content && (
        <>
          <div className={`my-1.5 border-t ${own ? 'border-white/30' : 'border-border'}`} />
          <div className="msg-text px-0.5">
            <RichText text={message.content} mentionNames={mentionNames} own={own} />
          </div>
        </>
      )}
    </div>
  );
}

export default memo(ImageMessage);
