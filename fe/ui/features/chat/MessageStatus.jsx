import { memo } from 'react';
import { MAX_GROUP_READER_AVATARS, MESSAGE_STATUS, STATUS_ICON_SIZE, SYNC_STATE } from '../../app/config/constants.js';
import Avatar from '../../components/Avatar.jsx';
import { IconTick } from '../../components/Icons.jsx';

const SIZE = STATUS_ICON_SIZE;
const TICK = Math.round(SIZE * 0.65);

const OFFLINE_SYNC_STATES = [SYNC_STATE.PENDING_SERVER, SYNC_STATE.PENDING_PEER, SYNC_STATE.PARTIAL_PEER];

const STATUS_TITLE = {
  [MESSAGE_STATUS.PENDING]: 'Đang gửi',
  [MESSAGE_STATUS.SENT]: 'Đã gửi',
  [MESSAGE_STATUS.DELIVERED]: 'Đã nhận',
  [MESSAGE_STATUS.READ]: 'Đã đọc',
  [MESSAGE_STATUS.FAILED]: 'Gửi lỗi — bấm để gửi lại',
};

/** Icon trạng thái đồng bộ offline (Mức 3) */
function SyncStateIcon({ syncState }) {
  if (syncState === SYNC_STATE.PENDING_PEER) {
    return (
      <span title="Chờ người nhận online (P2P)" style={{ fontSize: SIZE - 3, lineHeight: `${SIZE}px` }} aria-label="Chờ người nhận">
        ⏳
      </span>
    );
  }
  if (syncState === SYNC_STATE.PARTIAL_PEER) {
    return (
      <span className="relative inline-flex" title="Mới gửi tới một phần thành viên — chờ đồng bộ" aria-label="Gửi một phần">
        <span style={{ fontSize: SIZE - 3, lineHeight: `${SIZE}px` }}>📤</span>
        <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-warning text-[7px] font-bold text-black">!</span>
      </span>
    );
  }
  // pending_server (và mặc định): 📤 mờ — peer đã nhận, chờ server
  return (
    <span className="opacity-50" title="Chờ đồng bộ lên server" style={{ fontSize: SIZE - 3, lineHeight: `${SIZE}px` }} aria-label="Chờ đồng bộ server">
      📤
    </span>
  );
}

/**
 * Trạng thái tin nhắn của mình, đặt NGOÀI bong bóng.
 * @param {{ status: string, syncState?: string|null, readerId?: number|null, readers?: object[],
 *   totalMembers?: number, isGroup?: boolean, onRetry?: () => void }} props
 *   readers: user đã đọc (object có id, display_name, avatar)
 */
function MessageStatus({ status, syncState = null, readerId = null, readers = [], totalMembers = 0, isGroup = false, onRetry }) {
  const box = { width: SIZE, height: SIZE };

  if (status === MESSAGE_STATUS.FAILED) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white"
        style={box}
        title={STATUS_TITLE.failed}
        aria-label={STATUS_TITLE.failed}
      >
        !
      </button>
    );
  }

  // Chưa có server_id mà đang chờ đồng bộ (Mức 3 offline): icon theo sync_state thay cho tick
  const awaitingSync = OFFLINE_SYNC_STATES.includes(syncState);
  if (awaitingSync && (status === MESSAGE_STATUS.PENDING || status === MESSAGE_STATUS.SENT)) {
    return <SyncStateIcon syncState={syncState} />;
  }

  if (status === MESSAGE_STATUS.PENDING) {
    return <span className="rounded-full border-2 border-muted/50" style={box} title={STATUS_TITLE.pending} aria-label={STATUS_TITLE.pending} />;
  }

  if (status === MESSAGE_STATUS.SENT) {
    return (
      <span className="flex items-center justify-center rounded-full border-[1.5px] border-muted text-muted" style={box} title={STATUS_TITLE.sent} aria-label={STATUS_TITLE.sent}>
        <IconTick size={TICK} />
      </span>
    );
  }

  if (status === MESSAGE_STATUS.DELIVERED || (status === MESSAGE_STATUS.READ && readers.length === 0)) {
    return (
      <span className="flex items-center justify-center rounded-full bg-primary" style={box} title={STATUS_TITLE.delivered} aria-label={STATUS_TITLE.delivered}>
        <IconTick size={TICK} color="#fff" />
      </span>
    );
  }

  // READ
  if (!isGroup) {
    const reader = readers.find((r) => Number(r.id) === Number(readerId)) || readers[0];
    return (
      <span title={`${reader.display_name} đã xem`} aria-label="Đã đọc">
        <Avatar user={reader} size={SIZE} />
      </span>
    );
  }

  const shown = readers.slice(0, MAX_GROUP_READER_AVATARS);
  const extra = readers.length - shown.length;
  return (
    <span className="flex items-center gap-1" title={readers.map((r) => r.display_name).join(', ')} aria-label={`Đã đọc ${readers.length}/${totalMembers}`}>
      <span className="flex items-center">
        {shown.map((r, i) => (
          <span key={r.id} className="rounded-full ring-2 ring-bg" style={{ marginLeft: i === 0 ? 0 : -SIZE / 3 }}>
            <Avatar user={r} size={SIZE} />
          </span>
        ))}
        {extra > 0 && (
          <span className="ml-0.5 flex items-center justify-center rounded-full bg-surface-2 px-1 text-[9px] font-semibold text-muted" style={{ height: SIZE }}>
            +{extra}
          </span>
        )}
      </span>
      <span className="whitespace-nowrap text-[11px] text-muted">
        Đã đọc {readers.length}/{totalMembers}
      </span>
    </span>
  );
}

export default memo(MessageStatus);
