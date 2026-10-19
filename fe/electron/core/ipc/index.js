/**
 * Gom toàn bộ bảng IPC handler. `buildHandlers` thuần (test được không cần Electron);
 * `registerAll` gắn vào ipcMain.
 */
'use strict';

const { createAppHandlers } = require('../../modules/app/appHandlers');
const { createAuthHandlers } = require('../../modules/auth/authHandlers');
const { createDbHandlers } = require('../../modules/chat/dbHandlers');
const { createChatHandlers } = require('../../modules/chat/chatHandlers');
const { createSettingsHandlers } = require('../../modules/app/settingsHandlers');
const { createFileHandlers } = require('../../modules/file/fileHandlers');
const { createLogHandlers } = require('../../modules/log/logHandlers');
const { createAdminHandlers } = require('../../modules/admin/adminHandlers');
const { registerHandlers } = require('./register');

const FACTORIES = [
  createAppHandlers,
  createAuthHandlers,
  createDbHandlers,
  createChatHandlers,
  createSettingsHandlers,
  createFileHandlers,
  createLogHandlers,
  createAdminHandlers,
];

/**
 * @param {object} ctx toàn bộ dependency (services, repos, platform, paths, logger)
 * @returns {Object<string, Function>}
 */
function buildHandlers(ctx) {
  const all = {};
  for (const factory of FACTORIES) {
    for (const [channel, fn] of Object.entries(factory(ctx))) {
      if (all[channel]) throw new Error(`Kênh IPC bị đăng ký trùng: ${channel}`);
      all[channel] = fn;
    }
  }
  return all;
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} ctx
 * @returns {string[]}
 */
function registerAll(ipcMain, ctx) {
  return registerHandlers(ipcMain, buildHandlers(ctx), ctx.logger);
}

module.exports = { buildHandlers, registerAll };
