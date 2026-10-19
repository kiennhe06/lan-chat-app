import { useCallback, useState } from 'react';
import { MESSAGES_VI } from '../../app/config/constants.js';
import { useAuth } from '../../app/context/AuthContext.jsx';
import { useTheme } from '../../app/context/ThemeContext.jsx';
import { useServerDiscovery } from './useServerDiscovery.js';
import { useValidators } from '../../app/hooks/useValidators.js';
import FormField from '../../components/FormField.jsx';
import PasswordStrengthMeter from './PasswordStrengthMeter.jsx';
import ServerPicker from './ServerPicker.jsx';

const MODE = Object.freeze({ LOGIN: 'login', REGISTER: 'register' });

/**
 * Màn hình Đăng nhập / Đăng ký. Mỗi chế độ là một form riêng (key khác nhau) →
 * chuyển chế độ thì form reset hoàn toàn, không mang mật khẩu sang.
 */
export default function LoginPage() {
  const { notice } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [mode, setMode] = useState(MODE.LOGIN);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-4">
      <button
        type="button"
        className="icon-btn fixed right-4 top-4"
        onClick={toggleTheme}
        title={isDark ? 'Chế độ sáng' : 'Chế độ tối'}
        aria-label="Đổi giao diện sáng/tối"
      >
        {isDark ? '☀️' : '🌙'}
      </button>
      <div className="shadow-pop my-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6">
        <div className="mb-5 text-center">
          <div className="mb-1 text-3xl" aria-hidden="true">
            💬
          </div>
          <h1 className="text-xl font-bold">LAN Chat</h1>
          <p className="text-sm text-muted">Nhắn tin nội bộ trong mạng LAN</p>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-lg bg-surface-2 p-1 text-sm font-medium">
          {[
            [MODE.LOGIN, 'Đăng nhập'],
            [MODE.REGISTER, 'Đăng ký'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md py-1.5 transition ${mode === value ? 'bg-surface text-primary shadow' : 'text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {notice && <p className="mb-3 rounded-md bg-warning/15 px-3 py-2 text-sm text-text">{notice}</p>}
        {mode === MODE.LOGIN ? <LoginForm key="login" /> : <RegisterForm key="register" />}
      </div>
    </div>
  );
}

/** Hook nội bộ: trạng thái server được chọn + lưu server khi đăng nhập thành công. */
function useServerSelection() {
  const [server, setServer] = useState({ host: '', port: 0, error: '' });
  const { rememberServer } = useServerDiscovery();
  const onChange = useCallback((value) => setServer(value), []);
  return { server, onChange, rememberServer };
}

function SubmitError({ message }) {
  if (!message) return null;
  return (
    <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
      {message}
    </p>
  );
}

function RememberCheckbox({ checked, onChange }) {
  return (
    <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Ghi nhớ đăng nhập lần sau
    </label>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const validators = useValidators();
  const { server, onChange, rememberServer } = useServerSelection();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    const nextErrors = {};
    if (!identifier.trim()) nextErrors.identifier = 'Vui lòng nhập tên đăng nhập hoặc mã nhân viên';
    if (!password) nextErrors.password = 'Vui lòng nhập mật khẩu';
    setErrors(nextErrors);
    if (server.error) {
      setSubmitError(server.error);
      return;
    }
    if (Object.keys(nextErrors).length) return;
    const normalized = validators.normalizeLoginInput({ identifier, password });
    if (!normalized.ok) {
      setSubmitError(normalized.error || MESSAGES_VI.INVALID_CREDENTIALS);
      return;
    }
    setBusy(true);
    try {
      await rememberServer({ host: server.host, port: server.port });
      await login({ host: server.host, port: server.port, ...normalized.value, remember });
    } catch (err) {
      setSubmitError((err && err.message) || MESSAGES_VI.INVALID_CREDENTIALS);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <ServerPicker onChange={onChange} disabled={busy} />
      <FormField
        id="login-identifier"
        label="Tên đăng nhập hoặc mã nhân viên"
        autoComplete="username"
        autoFocus
        value={identifier}
        error={errors.identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        disabled={busy}
      />
      <FormField
        id="login-password"
        label="Mật khẩu"
        type="password"
        autoComplete="current-password"
        value={password}
        error={errors.password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
      />
      <RememberCheckbox checked={remember} onChange={setRemember} />
      <SubmitError message={submitError} />
      <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}

const EMPTY_REGISTER = { username: '', employee_id: '', display_name: '', password: '', confirm: '' };

function RegisterForm() {
  const { register } = useAuth();
  const validators = useValidators();
  const { server, onChange, rememberServer } = useServerSelection();
  const [form, setForm] = useState(EMPTY_REGISTER);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /** Validate từng ô để hiện lỗi đúng chỗ. */
  const validate = () => {
    const next = {};
    const username = validators.normalizeUsername(form.username);
    if (!username.ok) next.username = username.error;
    const employeeId = validators.normalizeEmployeeId(form.employee_id);
    if (!employeeId.ok) next.employee_id = employeeId.error;
    const displayName = validators.normalizeDisplayName(form.display_name);
    if (!displayName.ok) next.display_name = displayName.error;
    const password = validators.validatePassword(form.password);
    if (!password.ok) next.password = password.error;
    if (!form.confirm) next.confirm = 'Vui lòng nhập lại mật khẩu';
    else if (form.confirm !== form.password) next.confirm = 'Mật khẩu nhập lại không khớp';
    return next;
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    const nextErrors = validate();
    setErrors(nextErrors);
    if (server.error) {
      setSubmitError(server.error);
      return;
    }
    if (Object.keys(nextErrors).length) return;
    const normalized = validators.normalizeRegisterInput(form);
    if (!normalized.ok) {
      setSubmitError(normalized.error);
      return;
    }
    setBusy(true);
    try {
      await rememberServer({ host: server.host, port: server.port });
      await register({ host: server.host, port: server.port, ...normalized.value, remember });
    } catch (err) {
      setSubmitError((err && err.message) || 'Đăng ký thất bại');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <ServerPicker onChange={onChange} disabled={busy} />
      <FormField id="reg-username" label="Tên đăng nhập" autoComplete="username" autoFocus value={form.username} error={errors.username} onChange={setField('username')} disabled={busy} hint="3–30 ký tự: chữ không dấu, số, _ . -" />
      <FormField id="reg-employee" label="Mã nhân viên" value={form.employee_id} error={errors.employee_id} onChange={setField('employee_id')} disabled={busy} />
      <FormField id="reg-display" label="Tên hiển thị" value={form.display_name} error={errors.display_name} onChange={setField('display_name')} disabled={busy} />
      <FormField
        id="reg-password"
        label="Mật khẩu"
        hint={MESSAGES_VI.PASSWORD_HINT}
        error={errors.password}
      >
        <input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          className={`input ${errors.password ? 'border-danger' : ''}`}
          value={form.password}
          onChange={setField('password')}
          disabled={busy}
        />
        <PasswordStrengthMeter password={form.password} />
      </FormField>
      <FormField id="reg-confirm" label="Nhập lại mật khẩu" type="password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={setField('confirm')} disabled={busy} />
      <RememberCheckbox checked={remember} onChange={setRemember} />
      <SubmitError message={submitError} />
      <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
        {busy ? 'Đang đăng ký…' : 'Đăng ký'}
      </button>
    </form>
  );
}
