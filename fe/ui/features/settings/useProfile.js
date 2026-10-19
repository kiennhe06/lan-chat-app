import { useMemo } from 'react';
import { getApi } from '../../app/api/apiClient.js';

/** Lấy user từ kết quả trả về (có thể là user hoặc {user}). */
const pickUser = (res) => (res && res.user ? res.user : res);

/**
 * Hồ sơ cá nhân + cài đặt ứng dụng (avatar, tên hiển thị, theme, auto-start, info).
 */
export function useProfile() {
  return useMemo(
    () => ({
      /** @returns {Promise<object>} user mới */
      updateDisplayName: async (displayName) => pickUser(await getApi().profile.update(displayName)),
      /** Chọn ảnh rồi upload avatar. @returns {Promise<object|null>} user mới, null nếu hủy */
      pickAndUploadAvatar: async () => {
        const picked = await getApi().file.pickImage();
        const file = Array.isArray(picked) ? picked[0] : picked;
        if (!file || !file.path) return null;
        return pickUser(await getApi().profile.uploadAvatar({ path: file.path, mime_type: file.mime_type }));
      },
      setTheme: (theme) => getApi().profile.setTheme(theme),
      getAppInfo: () => getApi().app.getInfo(),
      getAutoStart: async () => {
        const res = await getApi().app.getAutoStart();
        return typeof res === 'object' && res !== null ? Boolean(res.enabled) : Boolean(res);
      },
      setAutoStart: (enabled) => getApi().app.setAutoStart(enabled),
    }),
    [],
  );
}
