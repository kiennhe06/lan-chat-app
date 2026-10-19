import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { THEME } from '../config/constants.js';
import { useThemeStorage } from '../hooks/useThemeStorage.js';

const ThemeContext = createContext(null);

/** Áp class `dark` lên <html> (CSS variables đổi theo). */
function applyThemeClass(theme) {
  document.documentElement.classList.toggle('dark', theme === THEME.DARK);
}

export function ThemeProvider({ children }) {
  const storage = useThemeStorage();
  const [theme, setThemeState] = useState(THEME.LIGHT);
  const loggedInRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    storage.load().then((saved) => {
      if (!cancelled && (saved === THEME.DARK || saved === THEME.LIGHT)) setThemeState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  useEffect(() => applyThemeClass(theme), [theme]);

  /** Đổi theme và lưu lại. */
  const setTheme = useCallback(
    (next) => {
      setThemeState(next);
      storage.save(next, loggedInRef.current);
    },
    [storage],
  );

  /** Áp theme từ server (sau đăng nhập) mà không ghi ngược lại. */
  const applyRemoteTheme = useCallback((next) => {
    if (next === THEME.DARK || next === THEME.LIGHT) setThemeState(next);
  }, []);

  const setLoggedIn = useCallback((value) => {
    loggedInRef.current = value;
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === THEME.DARK,
      setTheme,
      toggleTheme: () => setTheme(theme === THEME.DARK ? THEME.LIGHT : THEME.DARK),
      applyRemoteTheme,
      setLoggedIn,
    }),
    [theme, setTheme, applyRemoteTheme, setLoggedIn],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme phải nằm trong ThemeProvider');
  return ctx;
}
