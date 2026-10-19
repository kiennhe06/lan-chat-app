import { useState } from 'react';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { IPC_EVENTS } from '../../app/config/constants.js';

/**
 * Danh sách peer LAN đang thấy qua UDP (evt:peers).
 * @returns {{ peers: Array<{user_id, display_name, ip, port, server_online, last_seen}>, peerIds: Set<number> }}
 */
export function useP2P(enabled = true) {
  const [peers, setPeers] = useState([]);
  useApiEvent(IPC_EVENTS.PEERS, (list) => setPeers(Array.isArray(list) ? list : []), enabled);
  return { peers, peerIds: new Set(peers.map((p) => Number(p.user_id))) };
}
