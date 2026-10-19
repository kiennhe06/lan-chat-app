import { useValidators } from '../../app/hooks/useValidators.js';

const BAR_COLORS = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];

/** Thanh đánh giá độ mạnh mật khẩu (validators.passwordStrength). */
export default function PasswordStrengthMeter({ password }) {
  const validators = useValidators();
  if (!password) return null;
  const { score, label } = validators.passwordStrength(password);
  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < Math.max(score, 1) ? BAR_COLORS[score] : 'bg-border'}`} />
        ))}
      </div>
      <p className="mt-0.5 text-xs text-muted">Độ mạnh: {label}</p>
    </div>
  );
}
