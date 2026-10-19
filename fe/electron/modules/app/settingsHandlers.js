/**
 * IPC: hồ sơ cá nhân + theme.
 */
'use strict';

const fs = require('fs');
const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { THEME, LOG_CATEGORY, ERROR_CODE } = require('../../../shared/constants');
const { USER } = require('../../../shared/wsEvents');
const validators = require('../../../shared/validators');
const { AppError, validationError, offlineError } = require('../../core/utils/errors');
const { mimeFromName, sniffImageMime, sniffFileMime } = require('../../core/utils/files');
const { SETTINGS_KEYS } = require('../auth/sessionService');
const { toLocalUser } = require('../chat/mappers');

/**
 * @param {{ session: object, repos: object, files: object, emit: Function, logger: object }} ctx
 */
function createSettingsHandlers(ctx) {
  const { session, repos, files, logger } = ctx;

  /** Lưu user mới (cache + phiên) và trả LocalUser */
  function applyUser(user) {
    const row = repos.users.upsert(user);
    session.updateUser(user);
    return toLocalUser(row);
  }

  return {
    [I.PROFILE_UPDATE]: async (p) => {
      const name = validators.normalizeDisplayName(p.display_name);
      if (!name.ok) throw validationError(name.error);
      if (!session.isOnline()) throw offlineError('Chỉ đổi được tên hiển thị khi server online.');
      const res = await session.request(USER.UPDATE_PROFILE, { display_name: name.value });
      if (!res || !res.user) throw new AppError(ERROR_CODE.INTERNAL, 'Server không trả thông tin người dùng');
      logger.info(LOG_CATEGORY.SETTINGS, 'profile_updated', {});
      return applyUser(res.user);
    },
    [I.PROFILE_UPLOAD_AVATAR]: async (p) => {
      let src;
      if (p.path) {
        let stat;
        try {
          stat = fs.statSync(String(p.path));
        } catch (_err) {
          throw new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy ảnh đã chọn.');
        }
        const mime = p.mime_type || sniffFileMime(String(p.path)) || mimeFromName(String(p.path));
        src = { filePath: String(p.path), size: stat.size, mimeType: mime };
      } else if (p.data) {
        const buf = Buffer.from(p.data);
        src = { buffer: buf, size: buf.length, mimeType: p.mime_type || sniffImageMime(buf) || 'application/octet-stream' };
      } else {
        throw validationError('Thiếu ảnh đại diện.');
      }
      if (!String(src.mimeType).startsWith('image/')) throw validationError('Ảnh đại diện phải là file ảnh.');
      const res = await files.uploadAvatar(src);
      logger.info(LOG_CATEGORY.SETTINGS, 'avatar_updated', {});
      return applyUser(res.user);
    },
    [I.PROFILE_SET_THEME]: async (p) => {
      if (!Object.values(THEME).includes(p.theme)) throw validationError('Giao diện không hợp lệ.');
      repos.settings.set(SETTINGS_KEYS.THEME, p.theme);
      if (session.isLoggedIn()) session.setUserSetting('theme', p.theme);
      if (session.isOnline()) {
        try {
          await session.request(USER.UPDATE_SETTINGS, { theme: p.theme });
        } catch (err) {
          // Theme đã lưu local; server lỗi không chặn người dùng
          logger.warn(LOG_CATEGORY.SETTINGS, 'theme_sync_failed', { code: err.code });
        }
      }
      return { theme: p.theme };
    },
  };
}

module.exports = { createSettingsHandlers };
