import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IPC_EVENTS } from '../config/constants.js';
import { TOAST_DURATION } from '../config/app.config.js';
import { useApiEvent } from '../hooks/useApiEvent.js';
import ToastContainer from '../../components/ToastContainer.jsx';

const ToastContext = createContext(null);

let toastSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  /**
   * Hiện toast.
   * @param {'info'|'success'|'warn'|'error'} kind
   * @param {string} text
   */
  const showToast = useCallback(
    (kind, text) => {
      if (!text) return;
      toastSeq += 1;
      const id = toastSeq;
      setToasts((list) => [...list.slice(-4), { id, kind, text }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION[kind] || TOAST_DURATION.info),
      );
    },
    [dismiss],
  );

  useApiEvent(IPC_EVENTS.TOAST, (p) => p && showToast(p.kind || 'info', p.text));

  const value = useMemo(
    () => ({
      showToast,
      success: (text) => showToast('success', text),
      error: (text) => showToast('error', text),
      info: (text) => showToast('info', text),
      warn: (text) => showToast('warn', text),
    }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast phải nằm trong ToastProvider');
  return ctx;
}
