/**
 * Tên event WebSocket dùng chung (re-export `window.api.wsEvents` — nguồn: shared/wsEvents.js).
 * Không gõ chuỗi event trực tiếp trong renderer.
 */
import { FALLBACK_WS_EVENTS } from './fallbackConstants.js';

const bridge = typeof window !== 'undefined' ? window.api : undefined;

const WS_EVENTS = Object.freeze((bridge && bridge.wsEvents) || FALLBACK_WS_EVENTS);

export default WS_EVENTS;
export const CALL_EVENTS = WS_EVENTS.CALL;
