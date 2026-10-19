import { memo, useState } from 'react';
import { useMediaUrls } from '../features/chat/useMediaUrls.js';
import { initialOf } from '../utils/format.js';

/** Màu nền fallback ổn định theo tên */
const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#b45309'];
function colorFor(seed) {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/**
 * Avatar tròn: ảnh (lcfile://avatar) hoặc chữ cái đầu. Tùy chọn chấm online.
 * @param {{ user?: {display_name?:string, avatar?:string|null, id?:number}, name?: string, size?: number,
 *   online?: boolean|null, label?: string, className?: string }} props
 */
function Avatar({ user, name, size = 36, online = null, label, className = '' }) {
  const { avatarUrl } = useMediaUrls();
  const [failed, setFailed] = useState(false);
  const displayName = name || (user && user.display_name) || '';
  const src = user && user.avatar && !failed ? avatarUrl(user.avatar) : '';
  const dot = Math.max(8, Math.round(size / 4));

  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} title={displayName}>
      {src ? (
        <img
          src={src}
          alt={displayName}
          className="h-full w-full rounded-full object-cover"
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        <span
          className="flex h-full w-full select-none items-center justify-center rounded-full font-semibold text-white"
          style={{ background: colorFor(displayName || (user && user.id)), fontSize: Math.max(9, size * 0.42) }}
        >
          {label || initialOf(displayName)}
        </span>
      )}
      {online !== null && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-2 border-surface ${online ? 'bg-success' : 'bg-muted'}`}
          style={{ width: dot, height: dot }}
          aria-label={online ? 'Đang hoạt động' : 'Ngoại tuyến'}
        />
      )}
    </span>
  );
}

export default memo(Avatar);
