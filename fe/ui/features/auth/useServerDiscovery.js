import { useCallback, useEffect, useState } from 'react';
import { getApi, errorMessage } from '../../app/api/apiClient.js';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { localDb } from '../../app/api/localDb.js';
import { IPC_EVENTS } from '../../app/config/constants.js';
import { SETTING_KEYS } from '../../app/config/app.config.js';

/**
 * Danh sách server tìm thấy qua UDP discovery + server dùng lần trước (client.db settings).
 * @returns {{servers: Array<{host,port,server_name,version,last_seen}>, scanning: boolean, error: string,
 *   lastServer: {host:string, port:number}|null, probe: () => Promise<void>,
 *   rememberServer: (server:{host:string, port:number}) => Promise<void>}}
 */
export function useServerDiscovery() {
  const [servers, setServers] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [lastServer, setLastServer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const api = getApi();
    api.discovery
      .getServers()
      .then((list) => !cancelled && setServers(Array.isArray(list) ? list : []))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    localDb
      .getSetting(SETTING_KEYS.LAST_SERVER)
      .then((value) => {
        if (cancelled || !value) return;
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (parsed && parsed.host) setLastServer(parsed);
      })
      .catch((err) => console.warn('[useServerDiscovery] Không đọc được server lần trước', err));
    return () => {
      cancelled = true;
    };
  }, []);

  useApiEvent(IPC_EVENTS.SERVERS, (list) => setServers(Array.isArray(list) ? list : []));

  const probe = useCallback(async () => {
    setScanning(true);
    setError('');
    try {
      await getApi().discovery.probe();
      const list = await getApi().discovery.getServers();
      setServers(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(errorMessage(err, 'Không quét được server'));
    } finally {
      setScanning(false);
    }
  }, []);

  const rememberServer = useCallback(async (server) => {
    try {
      await localDb.setSetting(SETTING_KEYS.LAST_SERVER, JSON.stringify({ host: server.host, port: server.port }));
      setLastServer(server);
    } catch (err) {
      console.warn('[useServerDiscovery] Không lưu được server', err);
    }
  }, []);

  return { servers, scanning, error, lastServer, probe, rememberServer };
}
