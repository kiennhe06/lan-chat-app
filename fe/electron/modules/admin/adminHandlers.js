/**
 * IPC: quản trị chặn IP (manager, chỉ online).
 */
'use strict';

const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { ADMIN } = require('../../../shared/wsEvents');
const { BLOCK_REASON_MAX, USER_ROLE, ERROR_CODE } = require('../../../shared/constants');
const { validateIpv4 } = require('../../../shared/validators');
const { AppError, validationError, offlineError } = require('../../core/utils/errors');

/**
 * @param {{ session: object }} ctx
 */
function createAdminHandlers(ctx) {
  const { session } = ctx;

  function guard() {
    const user = session.getUser();
    if (!user || user.role !== USER_ROLE.MANAGER) throw new AppError(ERROR_CODE.FORBIDDEN, 'Chỉ quản lý (manager) mới dùng được chức năng này.');
    if (!session.isOnline()) throw offlineError('Cần server online để quản lý chặn IP.');
  }

  return {
    [I.ADMIN_LIST_BLOCKED]: async () => {
      guard();
      const res = await session.request(ADMIN.LIST_BLOCKED, {});
      return (res && res.blocked) || [];
    },
    [I.ADMIN_BLOCK_IP]: async (p) => {
      guard();
      const ip = validateIpv4(p.ip);
      if (!ip.ok) throw validationError(ip.error);
      const reason = String(p.reason || '').trim();
      if (reason.length > BLOCK_REASON_MAX) throw validationError(`Lý do tối đa ${BLOCK_REASON_MAX} ký tự.`);
      return session.request(ADMIN.BLOCK_IP, { ip: ip.value, reason });
    },
    [I.ADMIN_UNBLOCK_IP]: async (p) => {
      guard();
      const ip = validateIpv4(p.ip);
      if (!ip.ok) throw validationError(ip.error);
      return session.request(ADMIN.UNBLOCK_IP, { ip: ip.value });
    },
  };
}

module.exports = { createAdminHandlers };
