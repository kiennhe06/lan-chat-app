import { useMemo } from 'react';
import { getApi } from '../api/apiClient.js';
import { localDb } from '../api/localDb.js';
import { SETTING_KEYS } from '../config/app.config.js';

/**
 * Đọc/lưu theme. Đã đăng nhập → profile.setTheme (client.db + server nếu online);
 * chưa đăng nhập → chỉ client.db settings.
 */
export function useThemeStorage() {
  return useMemo(
    () => ({
      /** @returns {Promise<string|null>} */
      load: async () => {
        try {
          return (await localDb.getSetting(SETTING_KEYS.THEME)) || null;
        } catch (err) {
          console.warn('[useThemeStorage] Không đọc được theme', err);
          return null;
        }
      },
      save: async (theme, loggedIn) => {
        try {
          if (loggedIn) await getApi().profile.setTheme(theme);
          else await localDb.setSetting(SETTING_KEYS.THEME, theme);
        } catch (err) {
          console.warn('[useThemeStorage] Không lưu được theme', err);
        }
      },
    }),
    [],
  );
}
