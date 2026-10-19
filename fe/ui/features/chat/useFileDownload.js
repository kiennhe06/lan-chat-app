import { useCallback, useEffect, useState } from 'react';
import { getApi, errorMessage } from '../../app/api/apiClient.js';
import { useApiEvent } from '../../app/hooks/useApiEvent.js';
import { IPC_EVENTS } from '../../app/config/constants.js';

/**
 * Trạng thái tải/mở file của 1 tin nhắn file.
 * - Mount: kiểm tra `local_path` còn tồn tại → "Mở file", không → "Tải xuống".
 * - download(): dialog chọn chỗ lưu → tải có progress (evt:download-progress) → Hủy được.
 * @param {object} message LocalMessage (type file)
 * @returns {{ localPath: string|null, percent: number, downloading: boolean, error: string,
 *   download: () => Promise<void>, cancel: () => Promise<void>, open: () => Promise<void>,
 *   showInFolder: () => Promise<void> }}
 */
export function useFileDownload(message) {
  const [localPath, setLocalPath] = useState(null);
  const [downloadId, setDownloadId] = useState(null);
  const [percent, setPercent] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const messagePath = message && message.local_path;
  const clientMessageId = message && message.client_message_id;

  useEffect(() => {
    let cancelled = false;
    if (!messagePath) {
      setLocalPath(null);
      return undefined;
    }
    getApi()
      .file.exists(messagePath)
      .then((exists) => !cancelled && setLocalPath(exists ? messagePath : null))
      .catch((err) => {
        console.warn('[useFileDownload] exists lỗi', err);
        if (!cancelled) setLocalPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [messagePath]);

  useApiEvent(IPC_EVENTS.DOWNLOAD_PROGRESS, (p) => {
    if (!p || p.client_message_id !== clientMessageId) return;
    if (p.download_id) setDownloadId(p.download_id);
    if (p.state === 'downloading') {
      setDownloading(true);
      setPercent(Number(p.percent) || 0);
    } else if (p.state === 'done') {
      setDownloading(false);
      setPercent(100);
      if (p.local_path) setLocalPath(p.local_path);
    } else if (p.state === 'error') {
      setDownloading(false);
      setError(p.error || 'Tải file thất bại');
    } else if (p.state === 'cancelled') {
      setDownloading(false);
      setPercent(0);
    }
  });

  const download = useCallback(async () => {
    setError('');
    try {
      const res = await getApi().file.download({ client_message_id: clientMessageId, file: message.file });
      if (!res) return; // người dùng hủy dialog lưu
      setDownloadId(res.download_id);
      setDownloading(true);
      setPercent(0);
    } catch (err) {
      setDownloading(false);
      setError(errorMessage(err, 'Không tải được file'));
    }
  }, [clientMessageId, message]);

  const cancel = useCallback(async () => {
    if (!downloadId) return;
    try {
      await getApi().file.cancelDownload(downloadId);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [downloadId]);

  const open = useCallback(async () => {
    if (!localPath) return;
    try {
      await getApi().file.open(localPath);
    } catch (err) {
      setError(errorMessage(err, 'Không mở được file'));
      setLocalPath(null);
    }
  }, [localPath]);

  const showInFolder = useCallback(async () => {
    if (!localPath) return;
    try {
      await getApi().file.showInFolder(localPath);
    } catch (err) {
      setError(errorMessage(err, 'Không mở được thư mục'));
    }
  }, [localPath]);

  return { localPath, percent, downloading, error, download, cancel, open, showInFolder };
}
