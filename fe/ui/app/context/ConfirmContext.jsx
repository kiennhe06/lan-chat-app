import { createContext, useCallback, useContext, useRef, useState } from 'react';
import ConfirmModal from '../../components/ConfirmModal.jsx';

const ConfirmContext = createContext(null);

/**
 * Hộp xác nhận tùy biến (thay cho window.confirm — tránh focus trap / kẹt input).
 * Dùng: const confirm = useConfirm(); if (await confirm({ title, message, danger: true })) ...
 */
export function ConfirmProvider({ children }) {
  const [options, setOptions] = useState(null);
  const resolverRef = useRef(null);

  /**
   * @param {{title?:string, message:string, confirmText?:string, cancelText?:string, danger?:boolean}} opts
   * @returns {Promise<boolean>}
   */
  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        // Nếu đang mở hộp khác → coi như hủy hộp cũ
        if (resolverRef.current) resolverRef.current(false);
        resolverRef.current = resolve;
        setOptions(opts);
      }),
    [],
  );

  const close = useCallback((result) => {
    if (resolverRef.current) resolverRef.current(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && <ConfirmModal {...options} onConfirm={() => close(true)} onCancel={() => close(false)} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm phải nằm trong ConfirmProvider');
  return ctx;
}
