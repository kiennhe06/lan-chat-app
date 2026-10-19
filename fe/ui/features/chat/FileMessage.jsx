import { memo } from 'react';
import { useFileDownload } from './useFileDownload.js';
import { fileIcon, formatFileSize } from '../../utils/format.js';

function ProgressBar({ percent, own }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full ${own ? 'bg-white/25' : 'bg-border'}`}>
      <div className={`h-full transition-all ${own ? 'bg-white' : 'bg-primary'}`} style={{ width: `${Math.max(2, percent)}%` }} />
    </div>
  );
}

/**
 * Tin file: tên, dung lượng, icon + Tải xuống / X% + Hủy / Mở file + Mở thư mục.
 */
function FileMessage({ message, own, upload, onCancelUpload }) {
  const { localPath, percent, downloading, error, download, cancel, open, showInFolder } = useFileDownload(message);
  const file = message.file || {};
  const name = file.name || message.content || 'Tệp đính kèm';
  const linkBtn = `rounded px-2 py-0.5 text-xs font-medium ${own ? 'bg-white/20 hover:bg-white/30' : 'bg-primary/10 text-primary hover:bg-primary/20'}`;

  let actions;
  if (upload && upload.state === 'uploading') {
    actions = (
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar percent={upload.percent} own={own} />
        </div>
        <span className="w-9 text-right text-xs">{upload.percent}%</span>
        <button type="button" className={linkBtn} onClick={onCancelUpload}>
          Hủy
        </button>
      </div>
    );
  } else if (downloading) {
    actions = (
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar percent={percent} own={own} />
        </div>
        <span className="w-9 text-right text-xs">{percent}%</span>
        <button type="button" className={linkBtn} onClick={cancel}>
          Hủy
        </button>
      </div>
    );
  } else if (localPath) {
    actions = (
      <div className="flex gap-2">
        <button type="button" className={linkBtn} onClick={open}>
          Mở file
        </button>
        <button type="button" className={linkBtn} onClick={showInFolder}>
          Mở thư mục
        </button>
      </div>
    );
  } else if (file.id || file.sha256) {
    actions = (
      <button type="button" className={linkBtn} onClick={download}>
        ⬇ Tải xuống
      </button>
    );
  }

  return (
    <div className="w-64 max-w-full">
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none" aria-hidden="true">
          {fileIcon(name, file.mime_type)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={name}>
            {name}
          </p>
          <p className={`text-xs ${own ? 'text-white/75' : 'text-muted'}`}>{file.size ? formatFileSize(file.size) : ''}</p>
        </div>
      </div>
      {actions && <div className="mt-2">{actions}</div>}
      {upload && upload.state === 'error' && <p className="mt-1 text-xs text-danger">{upload.error || 'Gửi file thất bại'}</p>}
      {error && <p className={`mt-1 text-xs ${own ? 'text-white' : 'text-danger'}`}>{error}</p>}
    </div>
  );
}

export default memo(FileMessage);
