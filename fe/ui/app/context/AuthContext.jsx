import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IPC_EVENTS, MESSAGES_VI } from '../config/constants.js';
import { useApiEvent } from '../hooks/useApiEvent.js';
import { useAuthApi } from '../../features/auth/useAuthApi.js';
import { useTheme } from './ThemeContext.jsx';

const AuthContext = createContext(null);

export const AUTH_STATUS = Object.freeze({
  RESTORING: 'restoring',
  LOGGED_OUT: 'logged_out',
  LOGGED_IN: 'logged_in',
});

const AUTH_EVENT = Object.freeze({
  LOGGED_IN: 'logged_in',
  LOGGED_OUT: 'logged_out',
  KICKED: 'kicked',
  SESSION_EXPIRED: 'session_expired',
});

export function AuthProvider({ children }) {
  const authApi = useAuthApi();
  const { applyRemoteTheme, setLoggedIn } = useTheme();
  const [status, setStatus] = useState(AUTH_STATUS.RESTORING);
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState('');

  const enterSession = useCallback(
    (result) => {
      if (!result || !result.user) return;
      setUser(result.user);
      setNotice('');
      setLoggedIn(true);
      if (result.settings && result.settings.theme) applyRemoteTheme(result.settings.theme);
      setStatus(AUTH_STATUS.LOGGED_IN);
    },
    [applyRemoteTheme, setLoggedIn],
  );

  const leaveSession = useCallback(
    (message) => {
      setUser(null);
      setLoggedIn(false);
      setNotice(message || '');
      setStatus(AUTH_STATUS.LOGGED_OUT);
    },
    [setLoggedIn],
  );

  // Khôi phục phiên "Ghi nhớ đăng nhập" khi khởi động
  useEffect(() => {
    let cancelled = false;
    authApi
      .restore()
      .then((result) => {
        if (cancelled) return;
        if (result && result.user) enterSession(result);
        else leaveSession('');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[AuthContext] restore lỗi', err);
        leaveSession(err && err.message ? err.message : '');
      });
    return () => {
      cancelled = true;
    };
  }, [authApi, enterSession, leaveSession]);

  useApiEvent(IPC_EVENTS.AUTH, (p) => {
    if (!p) return;
    if (p.state === AUTH_EVENT.LOGGED_IN && p.user) {
      setUser(p.user);
      return;
    }
    if (p.state === AUTH_EVENT.KICKED) leaveSession(p.reason || MESSAGES_VI.BLOCKED);
    else if (p.state === AUTH_EVENT.SESSION_EXPIRED) leaveSession(p.reason || MESSAGES_VI.SESSION_EXPIRED);
    else if (p.state === AUTH_EVENT.LOGGED_OUT) leaveSession(p.reason || '');
  });

  // Hồ sơ của chính mình thay đổi (avatar/tên) từ thiết bị khác
  useApiEvent(
    IPC_EVENTS.USERS,
    (p) => {
      if (!p || !Array.isArray(p.users) || !user) return;
      const me = p.users.find((u) => Number(u.id) === Number(user.id));
      if (me) setUser((prev) => ({ ...prev, ...me }));
    },
    status === AUTH_STATUS.LOGGED_IN,
  );

  const login = useCallback(async (input) => enterSession(await authApi.login(input)), [authApi, enterSession]);
  const register = useCallback(async (input) => enterSession(await authApi.register(input)), [authApi, enterSession]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.warn('[AuthContext] logout lỗi — vẫn thoát phiên local', err);
    }
    leaveSession('');
  }, [authApi, leaveSession]);

  const updateUser = useCallback((patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev)), []);

  const value = useMemo(
    () => ({ status, user, notice, login, register, logout, updateUser, changePassword: authApi.changePassword }),
    [status, user, notice, login, register, logout, updateUser, authApi],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong AuthProvider');
  return ctx;
}
