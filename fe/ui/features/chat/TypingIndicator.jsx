/** "X đang soạn tin…" với 3 chấm động. */
export default function TypingIndicator({ typers }) {
  if (!typers.length) return <div className="h-5" />;
  const names = typers.map((t) => t.display_name || 'Ai đó');
  const label = names.length > 2 ? `${names.slice(0, 2).join(', ')} và ${names.length - 2} người khác` : names.join(', ');
  return (
    <div className="flex h-5 items-center gap-1.5 px-5 text-xs text-muted" aria-live="polite">
      <span>
        {label} đang soạn tin
      </span>
      <span aria-hidden="true">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
    </div>
  );
}
