import { useCallback, useEffect, useState } from 'react';
import C from '../../app/config/constants.js';
import { useConfirm } from '../../app/context/ConfirmContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useAdmin } from './useAdmin.js';
import { useValidators } from '../../app/hooks/useValidators.js';
import { formatDateTime } from '../../utils/format.js';

/**
 * Tab Chặn IP (manager): form IP + lý do + Chặn; bảng IP đã chặn + Bỏ chặn (ConfirmModal).
 */
export default function AdminIpManager() {
  const admin = useAdmin();
  const validators = useValidators();
  const toast = useToast();
  const confirm = useConfirm();
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  const [blocked, setBlocked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBlocked(await admin.listBlocked());
    } catch (err) {
      setError((err && err.message) || 'Không tải được danh sách IP bị chặn');
    }
  }, [admin]);

  useEffect(() => {
    load();
  }, [load]);

  const block = async (e) => {
    e.preventDefault();
    const check = validators.validateIpv4(ip);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await admin.blockIp(check.value, reason.trim());
      const kicked = res && res.kicked_count ? ` — đã ngắt ${res.kicked_count} kết nối` : '';
      toast.success(`Đã chặn ${check.value}${kicked}`);
      setIp('');
      setReason('');
      await load();
    } catch (err) {
      setError((err && err.message) || 'Không chặn được IP');
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (targetIp) => {
    const ok = await confirm({ title: 'Bỏ chặn IP', message: `Bỏ chặn địa chỉ ${targetIp}?`, confirmText: 'Bỏ chặn' });
    if (!ok) return;
    try {
      await admin.unblockIp(targetIp);
      toast.success(`Đã bỏ chặn ${targetIp}`);
      await load();
    } catch (err) {
      toast.error((err && err.message) || 'Không bỏ chặn được IP');
    }
  };

  return (
    <div className="p-4">
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={block}>
        <div className="w-44">
          <label htmlFor="block-ip" className="label text-xs">
            Địa chỉ IP
          </label>
          <input id="block-ip" className="input" placeholder="192.168.1.50" value={ip} onChange={(e) => setIp(e.target.value)} disabled={busy} />
        </div>
        <div className="min-w-[180px] flex-1">
          <label htmlFor="block-reason" className="label text-xs">
            Lý do
          </label>
          <input id="block-reason" className="input" maxLength={C.BLOCK_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        </div>
        <button type="submit" className="btn-danger" disabled={busy}>
          ⛔ Chặn
        </button>
      </form>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">IP</th>
              <th className="px-3 py-2 font-semibold">Lý do</th>
              <th className="px-3 py-2 font-semibold">Ngày chặn</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {blocked.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted">
                  Chưa chặn IP nào
                </td>
              </tr>
            )}
            {blocked.map((b) => (
              <tr key={b.ip} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{b.ip}</td>
                <td className="px-3 py-2">{b.reason || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(b.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => unblock(b.ip)}>
                    Bỏ chặn
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
