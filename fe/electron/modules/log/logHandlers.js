/**
 * IPC: ghi log từ renderer vào log local (tự ship lên server).
 * Xem log tập trung chỉ có trên máy chủ: http://localhost:5001/admin (be/src/modules/log/adminLogRoutes.js).
 */
'use strict';

const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { LOG_LEVEL_RANK, LOG_CATEGORY } = require('../../../shared/constants');
const { validationError } = require('../../core/utils/errors');

const ACTION_MAX = 100;
const CATEGORIES = new Set(Object.values(LOG_CATEGORY));

/**
 * @param {{ logger: object }} ctx
 */
function createLogHandlers(ctx) {
  const { logger } = ctx;

  return {
    [I.LOG_WRITE]: (p) => {
      if (LOG_LEVEL_RANK[p.level] === undefined) throw validationError('Mức log không hợp lệ.');
      const category = CATEGORIES.has(p.category) ? p.category : LOG_CATEGORY.APP;
      const action = String(p.action || '').slice(0, ACTION_MAX);
      if (!action) throw validationError('Thiếu action.');
      logger.log(p.level, category, `renderer:${action}`, p.meta);
      return { ok: true };
    },
  };
}

module.exports = { createLogHandlers };
