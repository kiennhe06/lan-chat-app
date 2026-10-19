import { useMemo } from 'react';
import { getApi } from '../../app/api/apiClient.js';

/**
 * Chức năng quản trị (chỉ manager): chặn/bỏ chặn IP.
 * Nhật ký hoạt động chỉ xem trên máy chủ: http://localhost:5001/admin
 */
export function useAdmin() {
  return useMemo(
    () => ({
      /** @returns {Promise<Array<{ip, reason, blocked_by, created_at}>>} */
      listBlocked: async () => {
        const res = await getApi().admin.listBlocked();
        if (Array.isArray(res)) return res;
        return (res && res.blocked) || [];
      },
      /** @returns {Promise<{blocked, kicked_count}>} */
      blockIp: (ip, reason) => getApi().admin.blockIp(ip, reason),
      unblockIp: (ip) => getApi().admin.unblockIp(ip),
    }),
    [],
  );
}
