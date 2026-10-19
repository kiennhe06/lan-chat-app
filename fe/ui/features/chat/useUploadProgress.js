import { useState } from 'react';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { IPC_EVENTS } from '../../app/config/constants.js';

/**
 * Tiến trình upload file/ảnh đang gửi (evt:upload-progress), theo client_message_id.
 * @returns {Record<string, {percent:number, state:string, error?:string}>}
 */
export function useUploadProgress() {
  const [uploads, setUploads] = useState({});
  useApiEvent(IPC_EVENTS.UPLOAD_PROGRESS, (p) => {
    if (!p || !p.client_message_id) return;
    setUploads((prev) => {
      if (p.state === 'done' || p.state === 'cancelled') {
        const next = { ...prev };
        delete next[p.client_message_id];
        return next;
      }
      return { ...prev, [p.client_message_id]: { percent: Number(p.percent) || 0, state: p.state, error: p.error } };
    });
  });
  return uploads;
}
