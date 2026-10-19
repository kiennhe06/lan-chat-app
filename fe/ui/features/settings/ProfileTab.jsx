import { useEffect, useState } from 'react';
import { MESSAGES_VI } from '../../app/config/constants.js';
import { useAuth } from '../../app/context/AuthContext.jsx';
import { useConfirm } from '../../app/context/ConfirmContext.jsx';
import { useTheme } from '../../app/context/ThemeContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useProfile } from './useProfile.js';
import { useValidators } from '../../app/hooks/useValidators.js';
import Avatar from '../../components/Avatar.jsx';
import FormField from '../../components/FormField.jsx';
import PasswordStrengthMeter from '../auth/PasswordStrengthMeter.jsx';

function Section({ title, children }) {
  return (
    <section className="border-b border-border px-5 py-4 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function DisplayNameEditor() {
  const { user, updateUser } = useAuth();
  const profile = useProfile();
  const validators = useValidators();
  const toast = useToast();
  const [value, setValue] = useState(user.display_name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const result = validators.normalizeDisplayName(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await profile.updateDisplayName(result.value);
      updateUser(updated && updated.display_name ? updated : { display_name: result.value });
      setValue(result.value);
      toast.success('Đã cập nhật tên hiển thị');
    } catch (err) {
      setError((err && err.message) || 'Không cập nhật được tên');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      <label htmlFor="profile-display" className="label">
        Tên hiển thị
      </label>
      <div className="flex gap-2">
        <input id="profile-display" className="input" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
        <button type="button" className="btn-primary shrink-0" onClick={save} disabled={busy || value === user.display_name}>
          Lưu
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

const EMPTY_PW = { old: '', next: '', confirm: '' };

function ChangePasswordForm() {
  const { changePassword } = useAuth();
  const validators = useValidators();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_PW);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.old) next.old = 'Vui lòng nhập mật khẩu hiện tại';
    const pw = validators.validatePassword(form.next);
    if (!pw.ok) next.next = pw.error;
    if (form.confirm !== form.next) next.confirm = 'Mật khẩu nhập lại không khớp';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await changePassword({ old_password: form.old, new_password: form.next });
      setForm(EMPTY_PW);
      toast.success('Đã đổi mật khẩu');
    } catch (err) {
      setErrors({ submit: (err && err.message) || 'Không đổi được mật khẩu' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FormField id="pw-old" label="Mật khẩu hiện tại" type="password" autoComplete="current-password" value={form.old} onChange={setField('old')} error={errors.old} disabled={busy} />
      <FormField id="pw-new" label="Mật khẩu mới" hint={MESSAGES_VI.PASSWORD_HINT} error={errors.next}>
        <input id="pw-new" type="password" autoComplete="new-password" className={`input ${errors.next ? 'border-danger' : ''}`} value={form.next} onChange={setField('next')} disabled={busy} />
        <PasswordStrengthMeter password={form.next} />
      </FormField>
      <FormField id="pw-confirm" label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password" value={form.confirm} onChange={setField('confirm')} error={errors.confirm} disabled={busy} />
      {errors.submit && <p className="mb-2 text-sm text-danger">{errors.submit}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        Đổi mật khẩu
      </button>
    </form>
  );
}

/**
 * Tab "Cá nhân": avatar, tên hiển thị, thông tin tài khoản, theme, đổi mật khẩu, khởi động cùng Windows, đăng xuất.
 */
export default function ProfileTab() {
  const { user, updateUser, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const profile = useProfile();
  const toast = useToast();
  const confirm = useConfirm();
  const [appInfo, setAppInfo] = useState(null);
  const [autoStart, setAutoStart] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    profile.getAppInfo().then((info) => !cancelled && setAppInfo(info)).catch((err) => console.warn('[ProfileTab] getInfo lỗi', err));
    profile.getAutoStart().then((v) => !cancelled && setAutoStart(v)).catch((err) => console.warn('[ProfileTab] getAutoStart lỗi', err));
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const changeAvatar = async () => {
    setAvatarBusy(true);
    try {
      const updated = await profile.pickAndUploadAvatar();
      if (updated) {
        updateUser(updated);
        toast.success('Đã cập nhật ảnh đại diện');
      }
    } catch (err) {
      toast.error((err && err.message) || 'Không đổi được ảnh đại diện');
    } finally {
      setAvatarBusy(false);
    }
  };

  const toggleAutoStart = async () => {
    const next = !autoStart;
    try {
      await profile.setAutoStart(next);
      setAutoStart(next);
    } catch (err) {
      toast.error((err && err.message) || 'Không đổi được cài đặt khởi động');
    }
  };

  const doLogout = async () => {
    if (await confirm({ title: 'Đăng xuất', message: 'Bạn muốn đăng xuất khỏi LAN Chat?', confirmText: 'Đăng xuất', danger: true })) {
      await logout();
    }
  };

  return (
    <div>
      <Section title="Hồ sơ">
        <div className="mb-4 flex items-center gap-4">
          <Avatar user={user} size={72} />
          <div>
            <button type="button" className="btn-secondary" onClick={changeAvatar} disabled={avatarBusy}>
              {avatarBusy ? 'Đang tải lên…' : '📷 Đổi ảnh đại diện'}
            </button>
            <p className="mt-1 text-xs text-muted">Ảnh sẽ được cắt vuông 256×256.</p>
          </div>
        </div>
        <DisplayNameEditor />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="label">Tên đăng nhập</p>
            <p className="input cursor-not-allowed bg-surface-2 text-muted">{user.username}</p>
          </div>
          <div>
            <p className="label">Mã nhân viên</p>
            <p className="input cursor-not-allowed bg-surface-2 text-muted">{user.employee_id}</p>
          </div>
        </div>
      </Section>

      <Section title="Giao diện & hệ thống">
        <div className="mb-3 flex items-center justify-between">
          <span>Chế độ hiển thị</span>
          <button type="button" className="btn-secondary" onClick={toggleTheme}>
            {isDark ? '🌙 Tối' : '☀️ Sáng'}
          </button>
        </div>
        <label className="flex cursor-pointer items-center justify-between">
          <span>Khởi động cùng Windows</span>
          <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-primary))]" checked={autoStart} onChange={toggleAutoStart} />
        </label>
      </Section>

      <Section title="Đổi mật khẩu">
        <ChangePasswordForm />
      </Section>

      <Section title="Ứng dụng">
        {appInfo ? (
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Phiên bản</dt>
            <dd>{appInfo.version}</dd>
            <dt className="text-muted">Thư mục dữ liệu</dt>
            <dd className="break-all">{appInfo.dataDir}</dd>
            <dt className="text-muted">Thư mục tải về</dt>
            <dd className="break-all">{appInfo.downloadsDir}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted">Đang tải thông tin…</p>
        )}
        <div className="mt-4 text-right">
          <button type="button" className="btn-link-danger" onClick={doLogout}>
            ⎋ Đăng xuất
          </button>
        </div>
      </Section>
    </div>
  );
}
