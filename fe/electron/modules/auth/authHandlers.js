/**
 * IPC: auth + socket thô tới server.
 */
'use strict';

const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { AUTH } = require('../../../shared/wsEvents');
const { validationError } = require('../../core/utils/errors');

/** Renderer không được tự gửi frame auth:* (main quản lý phiên) */
function assertSocketType(type) {
  if (typeof type !== 'string' || !type || type.length > 64) throw validationError('Loại sự kiện không hợp lệ.');
  if (Object.values(AUTH).includes(type)) throw validationError('Không được gửi sự kiện xác thực trực tiếp.');
}

/**
 * @param {{ session: object }} ctx
 */
function createAuthHandlers(ctx) {
  const { session } = ctx;
  return {
    [I.AUTH_LOGIN]: (p) => session.login(p),
    [I.AUTH_REGISTER]: (p) => session.register(p),
    [I.AUTH_LOGOUT]: async () => {
      await session.logout();
      return { ok: true };
    },
    [I.AUTH_RESTORE]: () => session.restore(),
    [I.AUTH_GET_STATE]: () => session.getState(),
    [I.AUTH_CHANGE_PASSWORD]: (p) => session.changePassword(p),
    [I.SOCKET_REQUEST]: (p) => {
      assertSocketType(p.type);
      return session.request(p.type, p.data || {});
    },
    [I.SOCKET_SEND]: (p) => {
      assertSocketType(p.type);
      return { sent: session.send(p.type, p.data || {}) };
    },
    [I.SOCKET_GET_STATUS]: () => session.getConnectionStatus(),
  };
}

module.exports = { createAuthHandlers };
