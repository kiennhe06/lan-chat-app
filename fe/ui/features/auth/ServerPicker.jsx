import { useEffect, useState } from 'react';
import C from '../../app/config/constants.js';
import { useServerDiscovery } from './useServerDiscovery.js';
import { useValidators } from '../../app/hooks/useValidators.js';

const DEFAULT_PORT = (C.NETWORK && C.NETWORK.SERVER_PORT) || 5001;
const MAX_PORT = 65535;

/**
 * Chọn server: danh sách tìm thấy qua UDP + nhập IP/port thủ công.
 * Gọi onChange({host, port, error}) mỗi khi lựa chọn thay đổi.
 */
export default function ServerPicker({ onChange, disabled }) {
  const { servers, scanning, error, lastServer, probe } = useServerDiscovery();
  const validators = useValidators();
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [touched, setTouched] = useState(false);

  // Điền sẵn server lần trước, nếu không có thì server đầu tiên tìm thấy
  useEffect(() => {
    if (touched) return;
    const initial = lastServer || servers[0];
    if (initial) {
      setHost(initial.host);
      setPort(String(initial.port || DEFAULT_PORT));
    }
  }, [lastServer, servers, touched]);

  useEffect(() => {
    const ipCheck = validators.validateIpv4(host);
    const portNum = Number(port);
    let fieldError = '';
    if (!host.trim()) fieldError = 'Vui lòng chọn hoặc nhập địa chỉ máy chủ';
    else if (!ipCheck.ok) fieldError = ipCheck.error;
    else if (!Number.isInteger(portNum) || portNum < 1 || portNum > MAX_PORT) fieldError = 'Cổng không hợp lệ (1–65535)';
    onChange({ host: ipCheck.ok ? ipCheck.value : host.trim(), port: portNum, error: fieldError });
  }, [host, port, validators, onChange]);

  const selectServer = (s) => {
    setTouched(true);
    setHost(s.host);
    setPort(String(s.port || DEFAULT_PORT));
  };

  return (
    <fieldset className="mb-4 rounded-lg border border-border p-3" disabled={disabled}>
      <div className="mb-2 flex items-center justify-between">
        <legend className="text-sm font-semibold">Máy chủ</legend>
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={probe} disabled={scanning}>
          {scanning ? 'Đang quét…' : '🔄 Quét lại'}
        </button>
      </div>
      {servers.length > 0 ? (
        <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto">
          {servers.map((s) => {
            const selected = s.host === host && String(s.port) === String(port);
            return (
              <li key={`${s.host}:${s.port}`}>
                <button
                  type="button"
                  onClick={() => selectServer(s)}
                  className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm ${
                    selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2'
                  }`}
                >
                  <span className="truncate">
                    🖥️ {s.server_name || 'LAN Chat Server'} <span className="text-muted">({s.host}:{s.port})</span>
                  </span>
                  {selected && <span className="text-primary">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-muted">{scanning ? 'Đang tìm máy chủ trong mạng LAN…' : 'Chưa tìm thấy máy chủ — nhập IP thủ công.'}</p>
      )}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="server-host" className="label text-xs">
            Địa chỉ IP
          </label>
          <input
            id="server-host"
            className="input"
            placeholder="192.168.1.10"
            value={host}
            onChange={(e) => {
              setTouched(true);
              setHost(e.target.value);
            }}
          />
        </div>
        <div className="w-24">
          <label htmlFor="server-port" className="label text-xs">
            Cổng
          </label>
          <input
            id="server-port"
            className="input"
            inputMode="numeric"
            value={port}
            onChange={(e) => {
              setTouched(true);
              setPort(e.target.value.replace(/\D/g, ''));
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}
