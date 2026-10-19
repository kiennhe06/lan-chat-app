/**
 * IPC: app / window / discovery / dialog / call.
 */
'use strict';

const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { CALL } = require('../../../shared/wsEvents');
const { validationError, offlineError } = require('../../core/utils/errors');

const CALL_TYPES = new Set(Object.values(CALL));

/**
 * @param {{ platform: object, discovery: object, session: object }} ctx
 */
function createAppHandlers(ctx) {
  const { platform, discovery, session } = ctx;
  return {
    [I.APP_GET_INFO]: () => platform.appInfo(),
    [I.APP_QUIT]: () => {
      setTimeout(() => platform.quit(), 0); // trả lời IPC trước khi thoát
      return { ok: true };
    },
    [I.APP_GET_AUTOSTART]: () => platform.getAutoStart(),
    [I.APP_SET_AUTOSTART]: (p) => platform.setAutoStart(!!p.enabled),
    [I.WINDOW_FOCUS]: () => {
      platform.focusWindow();
      return { ok: true };
    },
    [I.DISCOVERY_GET_SERVERS]: () => discovery.list(),
    [I.DISCOVERY_PROBE]: () => {
      discovery.probe();
      return discovery.list();
    },
    [I.DIALOG_CONFIRM]: (p) => platform.confirm(p || {}),
    [I.DIALOG_ALERT]: async (p) => {
      await platform.alert(p || {});
      return null;
    },
    [I.CALL_SIGNAL]: (p) => {
      if (!CALL_TYPES.has(p.type)) throw validationError('Tín hiệu cuộc gọi không hợp lệ.');
      if (!session.isOnline()) throw offlineError('Cuộc gọi cần server online.');
      return { sent: session.send(p.type, p.data || {}) };
    },
  };
}

module.exports = { createAppHandlers };
