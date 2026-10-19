import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi, onApiEvent, errorMessage } from '../../app/api/apiClient.js';
import { IPC_EVENTS } from '../../app/config/constants.js';
import { CALL_EVENTS } from '../../app/config/wsEvents.js';

/**
 * ⚠️ TÍNH NĂNG GỌI THOẠI ĐANG TẮT — hook đã hoàn chỉnh nhưng ChatWindow comment phần sử dụng
 * (tìm "[CALL-DISABLED" trong ChatWindow.jsx, 6 chỗ).
 *
 * - LAN-only: RTCPeerConnection({ iceServers: [] }) → chỉ host candidate, không STUN/TURN.
 * - Cuộc gọi đến: hỏi bằng window.api.dialog.confirm (native, tránh focus trap của modal web).
 * - Mọi bước có try/catch; cleanup() luôn dừng micro + đóng peer connection.
 */

export const CALL_STATUS = Object.freeze({
  IDLE: 'idle',
  CALLING: 'calling', // mình gọi, chờ bên kia trả lời
  CONNECTING: 'connecting', // đã chấp nhận, đang thương lượng
  IN_CALL: 'in_call',
});

const RTC_CONFIG = Object.freeze({ iceServers: [] });

/**
 * @param {{ myUser: {id:number, display_name:string}|null, onError?: (message:string) => void }} options
 */
export function useWebRTC({ myUser, onError }) {
  const [call, setCall] = useState({ status: CALL_STATUS.IDLE, peerUserId: null, peerName: '', muted: false });
  const [remoteStream, setRemoteStream] = useState(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerUserIdRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const reportError = useCallback((err, fallback) => {
    const message = errorMessage(err, fallback);
    console.error('[useWebRTC]', message, err);
    if (onErrorRef.current) onErrorRef.current(message);
  }, []);

  const signal = useCallback(async (type, data) => {
    try {
      await getApi().call.signal(type, data);
    } catch (err) {
      reportError(err, 'Không gửi được tín hiệu cuộc gọi');
    }
  }, [reportError]);

  /** Dừng micro, đóng kết nối, reset state. */
  const cleanup = useCallback(() => {
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.warn('[useWebRTC] Dừng micro lỗi', err);
    }
    try {
      if (pcRef.current) pcRef.current.close();
    } catch (err) {
      console.warn('[useWebRTC] Đóng peer connection lỗi', err);
    }
    localStreamRef.current = null;
    pcRef.current = null;
    peerUserIdRef.current = null;
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
    setCall({ status: CALL_STATUS.IDLE, peerUserId: null, peerName: '', muted: false });
  }, []);

  // Unmount (đăng xuất, đóng cửa sổ) → luôn giải phóng micro
  useEffect(() => cleanup, [cleanup]);

  /** Tạo RTCPeerConnection + gắn micro local. */
  const createPeer = useCallback(
    async (peerUserId) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) signal(CALL_EVENTS.ICE_CANDIDATE, { to_user_id: peerUserId, candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => setRemoteStream(e.streams[0] || null);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setCall((c) => ({ ...c, status: CALL_STATUS.IN_CALL }));
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanup();
      };
      pcRef.current = pc;
      peerUserIdRef.current = peerUserId;
      return pc;
    },
    [signal, cleanup],
  );

  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[useWebRTC] addIceCandidate lỗi', err);
      }
    }
  }, []);

  /** Gọi tới userId. */
  const startCall = useCallback(
    async (peerUserId, peerName) => {
      if (pcRef.current) return;
      try {
        setCall({ status: CALL_STATUS.CALLING, peerUserId, peerName: peerName || '', muted: false });
        const pc = await createPeer(peerUserId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signal(CALL_EVENTS.OFFER, { to_user_id: peerUserId, sdp: pc.localDescription.toJSON() });
      } catch (err) {
        reportError(err, 'Không bắt đầu được cuộc gọi (kiểm tra micro)');
        cleanup();
      }
    },
    [createPeer, signal, reportError, cleanup],
  );

  /** Kết thúc cuộc gọi (báo bên kia nếu notify). */
  const hangup = useCallback(
    async (notify = true) => {
      const peerUserId = peerUserIdRef.current;
      if (notify && peerUserId) await signal(CALL_EVENTS.END, { to_user_id: peerUserId });
      cleanup();
    },
    [signal, cleanup],
  );

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const muted = !call.muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    setCall((c) => ({ ...c, muted }));
  }, [call.muted]);

  /** Xử lý tín hiệu đến (evt:call → {type, data}). */
  const handleCallEvent = useCallback(
    async (event) => {
      if (!event) return;
      const { type, data = {} } = event;
      try {
        if (type === CALL_EVENTS.OFFER) {
          if (pcRef.current) {
            await signal(CALL_EVENTS.END, { to_user_id: data.from_user_id, reason: 'busy' });
            return;
          }
          const callerName = data.from_name || 'Người dùng';
          const accepted = await getApi().dialog.confirm({
            title: 'Cuộc gọi đến',
            message: `${callerName} đang gọi cho bạn. Nghe máy?`,
            confirmText: 'Nghe',
            cancelText: 'Từ chối',
          });
          if (!accepted) {
            await signal(CALL_EVENTS.END, { to_user_id: data.from_user_id, reason: 'rejected' });
            return;
          }
          setCall({ status: CALL_STATUS.CONNECTING, peerUserId: data.from_user_id, peerName: callerName, muted: false });
          const pc = await createPeer(data.from_user_id);
          await pc.setRemoteDescription(data.sdp);
          await flushCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await signal(CALL_EVENTS.ANSWER, { to_user_id: data.from_user_id, sdp: pc.localDescription.toJSON() });
        } else if (type === CALL_EVENTS.ANSWER) {
          if (!pcRef.current) return;
          await pcRef.current.setRemoteDescription(data.sdp);
          setCall((c) => ({ ...c, status: CALL_STATUS.CONNECTING }));
          await flushCandidates();
        } else if (type === CALL_EVENTS.ICE_CANDIDATE) {
          if (!data.candidate) return;
          const pc = pcRef.current;
          if (pc && pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else pendingCandidatesRef.current.push(data.candidate);
        } else if (type === CALL_EVENTS.END) {
          cleanup();
        }
      } catch (err) {
        reportError(err, 'Lỗi cuộc gọi');
        await hangup(true);
      }
    },
    [createPeer, signal, flushCandidates, cleanup, hangup, reportError],
  );

  /** Đăng ký nhận tín hiệu cuộc gọi. @returns {() => void} hủy đăng ký */
  const subscribeCallEvents = useCallback((handler) => onApiEvent(IPC_EVENTS.CALL, handler), []);

  return {
    call,
    remoteStream,
    myUserId: myUser ? myUser.id : null,
    startCall,
    hangup,
    toggleMute,
    handleCallEvent,
    subscribeCallEvents,
  };
}
