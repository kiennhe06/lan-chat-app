import { useEffect, useRef } from 'react';
import Modal from './Modal.jsx';

/**
 * Hộp xác nhận tùy biến (thay window.confirm). Enter = đồng ý, Esc / backdrop = hủy.
 */
export default function ConfirmModal({
  title = 'Xác nhận',
  message,
  confirmText = 'Đồng ý',
  cancelText = 'Hủy',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={400}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button ref={confirmRef} type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      }
    >
      <p className="whitespace-pre-line px-4 py-4 text-sm text-text">{message}</p>
    </Modal>
  );
}
