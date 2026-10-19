/**
 * Hàm định dạng thuần cho UI (không gọi API).
 */

const TIME_FMT = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const DATE_FMT = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const toDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Thời điểm hiển thị của tin (server time, fallback giờ local khi pending/P2P). */
export const messageTime = (m) => (m && (m.created_at || m.created_at_local)) || null;

/** "14:05" */
export function formatTime(iso) {
  const d = toDate(iso);
  return d ? TIME_FMT.format(d) : '';
}

/** "18/10/2026 14:05:09" */
export function formatDateTime(iso) {
  const d = toDate(iso);
  return d ? DATETIME_FMT.format(d) : '';
}

/** Nhãn ngày cho divider: "Hôm nay" / "Hôm qua" / "dd/mm/yyyy" */
export function formatDayLabel(iso) {
  const d = toDate(iso);
  if (!d) return '';
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  return DATE_FMT.format(d);
}

/** Key ngày (yyyy-mm-dd theo giờ local) để chèn divider */
export function dayKey(iso) {
  const d = toDate(iso);
  return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '';
}

/** Thời gian ngắn cho danh sách hội thoại: hôm nay → giờ, khác → ngày */
export function formatListTime(iso) {
  const d = toDate(iso);
  if (!d) return '';
  return dayKey(iso) === dayKey(new Date().toISOString()) ? TIME_FMT.format(d) : DATE_FMT.format(d).slice(0, 5);
}

/** 1536 → "1,5 KB" */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** Chữ cái đầu cho avatar fallback */
export function initialOf(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?';
}

/** Bỏ dấu tiếng Việt + lowercase để tìm kiếm */
export function foldText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Icon emoji theo phần mở rộng file */
export function fileIcon(name, mimeType) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const mime = String(mimeType || '');
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📗';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['txt', 'log', 'md', 'json', 'xml'].includes(ext)) return '📄';
  return '📎';
}

/** Rút gọn text 1 dòng */
export function previewText(text, max = 80) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
