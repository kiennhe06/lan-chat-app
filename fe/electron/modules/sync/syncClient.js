/**
 * Kích hoạt đồng bộ mỗi khi phiên được xác thực với server (login / reconnect).
 * Chống chạy song song: đang chạy mà có trigger mới → chạy lại 1 lần sau khi xong.
 */
'use strict';

const { LOG_CATEGORY } = require('../../../shared/constants');
const { IPC_EVENTS } = require('../../../ipc/channels');

/**
 * @param {{ session: import('events').EventEmitter & { isOnline: () => boolean },
 *   syncService: { run: () => Promise<object> }, emit: Function, logger: object }} deps
 */
function createSyncClient(deps) {
  const { session, syncService, emit, logger } = deps;
  let running = false;
  let rerun = false;

  async function trigger() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        if (!session.isOnline()) break;
        try {
          await syncService.run();
        } catch (err) {
          logger.warn(LOG_CATEGORY.CONNECTION, 'sync_failed', { code: err.code, message: err.message });
          if (session.isOnline()) emit(IPC_EVENTS.TOAST, { kind: 'warn', text: 'Đồng bộ chưa hoàn tất — sẽ thử lại khi kết nối ổn định.' });
        }
      } while (rerun);
    } finally {
      running = false;
    }
  }

  const onAuthenticated = () => {
    trigger().catch((err) => logger.error(LOG_CATEGORY.ERROR, 'sync_trigger_crashed', { message: err.message }));
  };
  session.on('authenticated', onAuthenticated);

  return {
    trigger,
    isRunning: () => running,
    dispose: () => session.removeListener('authenticated', onAuthenticated),
  };
}

module.exports = { createSyncClient };
