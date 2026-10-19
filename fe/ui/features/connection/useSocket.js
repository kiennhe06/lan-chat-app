import { useCallback, useEffect, useState } from 'react';
import { getApi } from '../../app/api/apiClient.js';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { IPC_EVENTS } from '../../app/config/constants.js';

export const CONNECTION_STATE = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  ONLINE: 'online',
  OFFLINE_P2P: 'offline_p2p',
});

/**
 * Trạng thái kết nối tới server + wrapper request/send qua socket của main.
 * @param {boolean} [enabled=true] chỉ theo dõi khi đã đăng nhập
 * @returns {{state:string, server:{host,port}|null, serverOnline:boolean, isOnline:boolean,
 *   isOfflineP2P:boolean, error?:string, request:(type:string,data?:object)=>Promise<any>,
 *   send:(type:string,data?:object)=>Promise<any>}}
 */
export function useSocket(enabled = true) {
  const [status, setStatus] = useState({ state: CONNECTION_STATE.CONNECTING, server: null, serverOnline: false });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getApi()
      .socket.getStatus()
      .then((s) => {
        if (!cancelled && s) setStatus((prev) => ({ ...prev, ...s }));
      })
      .catch((err) => console.warn('[useSocket] getStatus lỗi', err));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useApiEvent(
    IPC_EVENTS.CONNECTION,
    (payload) => {
      if (payload) setStatus((prev) => ({ ...prev, ...payload }));
    },
    enabled,
  );

  const request = useCallback((type, data) => getApi().socket.request(type, data), []);
  const send = useCallback((type, data) => getApi().socket.send(type, data), []);

  return {
    ...status,
    isOnline: status.state === CONNECTION_STATE.ONLINE,
    isOfflineP2P: status.state === CONNECTION_STATE.OFFLINE_P2P,
    request,
    send,
  };
}
