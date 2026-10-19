import { useMemo } from 'react';
import { getApi } from '../../app/api/apiClient.js';

/**
 * Các thao tác xác thực qua preload (login/register/restore/logout/đổi mật khẩu).
 * Lỗi reject dạng {code, message} — message tiếng Việt hiển thị trực tiếp.
 */
export function useAuthApi() {
  return useMemo(
    () => ({
      /** @param {{host, port, identifier, password, remember}} input */
      login: (input) => getApi().auth.login(input),
      /** @param {{host, port, username, employee_id, display_name, password, remember}} input */
      register: (input) => getApi().auth.register(input),
      /** @returns {Promise<{user, settings, server}|null>} */
      restore: () => getApi().auth.restore(),
      logout: () => getApi().auth.logout(),
      /** @param {{old_password, new_password}} input */
      changePassword: (input) => getApi().auth.changePassword(input),
    }),
    [],
  );
}
