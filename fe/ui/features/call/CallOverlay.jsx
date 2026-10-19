import { useEffect, useRef, useState } from 'react';
import { CALL_STATUS } from './useWebRTC.js';
import Avatar from '../../components/Avatar.jsx';

/**
 * ⚠️ TÍNH NĂNG GỌI THOẠI ĐANG TẮT — component hoàn chỉnh, ChatWindow comment phần render
 * (xem "[CALL-DISABLED 6/6]").
 * Overlay cuộc gọi thoại: tên người gọi, trạng thái, thời lượng, tắt mic, kết thúc.
 */
const STATUS_TEXT = {
  [CALL_STATUS.CALLING]: 'Đang gọi…',
  [CALL_STATUS.CONNECTING]: 'Đang kết nối…',
  [CALL_STATUS.IN_CALL]: 'Đang trong cuộc gọi',
};

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function CallOverlay({ call, remoteStream, peerUser, onHangup, onToggleMute }) {
  const audioRef = useRef(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = remoteStream || null;
  }, [remoteStream]);

  useEffect(() => {
    if (call.status !== CALL_STATUS.IN_CALL) {
      setSeconds(0);
      return undefined;
    }
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [call.status]);

  if (call.status === CALL_STATUS.IDLE) return null;

  return (
    <div className="shadow-pop fixed bottom-6 right-6 z-50 w-72 rounded-2xl border border-border bg-surface p-4 text-center" role="dialog" aria-label="Cuộc gọi thoại">
      <audio ref={audioRef} autoPlay />
      <div className="flex justify-center">
        <Avatar user={peerUser} name={call.peerName} size={64} />
      </div>
      <p className="mt-2 font-semibold">{call.peerName || (peerUser && peerUser.display_name)}</p>
      <p className="text-sm text-muted">{call.status === CALL_STATUS.IN_CALL ? formatDuration(seconds) : STATUS_TEXT[call.status]}</p>
      <div className="mt-4 flex justify-center gap-3">
        <button type="button" className="btn-secondary rounded-full px-4" onClick={onToggleMute}>
          {call.muted ? '🔇 Bật mic' : '🎙️ Tắt mic'}
        </button>
        <button type="button" className="btn-danger rounded-full px-4" onClick={() => onHangup()}>
          📞 Kết thúc
        </button>
      </div>
    </div>
  );
}
