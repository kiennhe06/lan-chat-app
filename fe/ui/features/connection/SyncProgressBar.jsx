const PHASE_LABEL = {
  pull: 'Tải dữ liệu mới',
  actions: 'Đồng bộ thao tác',
  files: 'Đồng bộ file',
  messages: 'Đồng bộ',
};

/**
 * Thanh tiến trình đồng bộ mảnh ở header — không chặn thao tác.
 * @param {{ progress: {phase:string, done:number, total:number} | null }} props
 */
export default function SyncProgressBar({ progress }) {
  if (!progress) return null;
  const { phase, done, total } = progress;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const unit = phase === 'files' ? 'file' : phase === 'actions' ? 'thao tác' : 'tin';
  const label = total > 0 ? `${PHASE_LABEL[phase] || 'Đồng bộ'} ${done}/${total} ${unit}...` : `${PHASE_LABEL[phase] || 'Đồng bộ'}...`;
  return (
    <div className="relative border-b border-border bg-surface" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-[3px] w-full overflow-hidden bg-primary/15">
        {percent === null ? (
          <div className="sync-bar-indeterminate h-full w-1/3 bg-primary" />
        ) : (
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        )}
      </div>
      <p className="px-3 py-0.5 text-right text-[11px] text-muted">{label}</p>
    </div>
  );
}
