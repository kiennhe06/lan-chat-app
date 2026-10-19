/**
 * Ô nhập có label phía trên + lỗi phía dưới.
 */
export default function FormField({ id, label, error, hint, children, ...inputProps }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children || <input id={id} className={`input ${error ? 'border-danger' : ''}`} {...inputProps} />}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
