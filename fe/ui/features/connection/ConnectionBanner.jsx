import { MESSAGES_VI } from '../../app/config/constants.js';
import { CONNECTION_STATE } from './useSocket.js';

/**
 * Banner trạng thái kết nối: vàng khi offline P2P, xám khi đang kết nối lại.
 * @param {{ state: string, peerCount?: number }} props
 */
export default function ConnectionBanner({ state, peerCount = 0 }) {
  if (state === CONNECTION_STATE.OFFLINE_P2P) {
    return (
      <div className="flex items-center justify-center gap-2 bg-yellow-300 px-3 py-1.5 text-center text-sm font-medium text-yellow-950" role="status">
        <span>{MESSAGES_VI.OFFLINE_BANNER}</span>
        <span className="rounded-full bg-yellow-950/10 px-2 text-xs">{peerCount} máy trong LAN</span>
      </div>
    );
  }
  if (state === CONNECTION_STATE.CONNECTING || state === CONNECTION_STATE.DISCONNECTED) {
    return (
      <div className="bg-surface-2 px-3 py-1 text-center text-xs text-muted" role="status">
        {state === CONNECTION_STATE.CONNECTING ? '🔄 Đang kết nối tới máy chủ…' : '⛔ Mất kết nối máy chủ — đang thử lại…'}
      </div>
    );
  }
  return null;
}
