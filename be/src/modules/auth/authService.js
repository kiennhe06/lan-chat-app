/**
 * Xác thực + hồ sơ người dùng.
 *
 * - Đăng ký: validate lại toàn bộ input (không tin client), bcrypt rounds 10 (API async), user đầu tiên = manager.
 * - Đăng nhập: identifier = username HOẶC employee_id (không phân biệt hoa thường). Mọi thất bại
 *   → đúng 1 thông điệp "Sai tên đăng nhập hoặc mật khẩu".
 * - Session token Ed25519 + bảng sessions (jti) để thu hồi.
 * Không chứa SQL (qua repositories) và không biết transport (nhận/trả plain object).
 */
'use strict';

const bcrypt = require('bcrypt');
const C = require('../../shared/constants');
const V = require('../../shared/validators');
const { toWireUser } = require('../../shared/serializer');
const { errors } = require('../../core/errors');
const W = require('../../shared/wsEvents');

const LOG = C.LOG_LEVEL;
const CAT = C.LOG_CATEGORY;

const isUniqueViolation = (err) => err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * @param {{ repos: object, tokenService: object, logger: object, hub: object, config: object }} deps
 */
function createAuthService(deps) {
  const { repos, tokenService, logger, hub, config } = deps;
  const rounds = config.auth.bcryptRounds;
  // Hash giả để so sánh khi không tìm thấy user → thời gian phản hồi tương đương (chống dò username)
  const dummyHashPromise = bcrypt.hash('lanchat-dummy-password', rounds);

  const nowIso = () => new Date().toISOString();

  /** Tạo session mới cho user và trả về LoginPayload. */
  function createSession(user, ip) {
    const issued = tokenService.issue(user);
    repos.sessions.insert({
      jti: issued.payload.jti,
      user_id: user.id,
      issued_at: new Date(issued.payload.iat).toISOString(),
      expires_at: issued.expiresAt,
      ip: ip || null,
    });
    return issued;
  }

  /**
   * Dựng LoginPayload (PROTOCOL §1.2).
   * @param {object} userRow
   * @param {{ token: string, expiresAt: string, payload: object }} session
   */
  function buildLoginPayload(userRow, session) {
    return {
      user: toWireUser({ ...userRow, online: true }),
      session_token: session.token,
      expires_at: session.expiresAt,
      server_public_key: tokenService.publicKeyPem,
      server_time: nowIso(),
      settings: { theme: userRow.theme || C.THEME.LIGHT },
    };
  }

  const requireValid = (result) => {
    if (!result.ok) throw errors.validation(result.error);
    return result.value;
  };

  /**
   * Đăng ký tài khoản mới.
   * @returns {Promise<{ payload: object, user: object, session: object }>}
   */
  async function register(input, ip) {
    const data = requireValid(V.normalizeRegisterInput(input));
    if (repos.users.findByUsername(data.username)) throw errors.duplicate('Tên đăng nhập đã tồn tại');
    if (repos.users.findByEmployeeId(data.employee_id)) throw errors.duplicate('Mã nhân viên đã tồn tại');
    const passwordHash = await bcrypt.hash(data.password, rounds);
    let userId;
    try {
      userId = repos.users.insert({
        username: data.username,
        employee_id: data.employee_id,
        display_name: data.display_name,
        password_hash: passwordHash,
        theme: C.THEME.LIGHT,
        now: nowIso(),
      });
    } catch (err) {
      // Race: 2 request cùng username giữa lúc check và insert
      if (isUniqueViolation(err)) {
        const field = /employee_id/.test(err.message) ? 'Mã nhân viên' : 'Tên đăng nhập';
        throw errors.duplicate(`${field} đã tồn tại`);
      }
      throw err;
    }
    const user = repos.users.findById(userId);
    const session = createSession(user, ip);
    logger.logAudit(LOG.AUDIT, CAT.AUTH, 'register', user.id, { username: user.username, role: user.role }, ip);
    recordLogin(user.id, ip);
    hub.toAll(W.USER.CREATED, { user: toWireUser({ ...user, online: false }) });
    return { payload: buildLoginPayload(user, session), user, session: session.payload };
  }

  /** Ghi lần đăng nhập gần nhất + IP cho trang Quản lý thành viên (lỗi ghi không chặn đăng nhập). */
  function recordLogin(userId, ip) {
    try {
      repos.users.touchLogin(userId, new Date().toISOString(), ip);
    } catch (err) {
      logger.warn(CAT.AUTH, 'record_login_failed', { error: err.message }, { userId, ip });
    }
  }

  /** Tìm user theo username trước, rồi employee_id (2 user khác nhau có thể trùng chuỗi ở 2 cột). */
  function findLoginCandidates(identifier) {
    const candidates = [];
    const byUsername = repos.users.findByUsername(identifier);
    if (byUsername) candidates.push(byUsername);
    const byEmployee = repos.users.findByEmployeeId(identifier);
    if (byEmployee && !candidates.some((u) => u.id === byEmployee.id)) candidates.push(byEmployee);
    return candidates;
  }

  /**
   * Đăng nhập bằng username/employee_id + password.
   */
  async function login(input, ip) {
    const normalized = V.normalizeLoginInput(input);
    if (!normalized.ok) {
      logger.logAudit(LOG.AUDIT, CAT.AUTH, 'login_failed', null, { reason: 'invalid_input' }, ip);
      throw errors.invalidCredentials();
    }
    const { identifier, password } = normalized.value;
    const candidates = findLoginCandidates(identifier);
    if (!candidates.length) {
      await bcrypt.compare(password, await dummyHashPromise);
    }
    for (const user of candidates) {
      if (await bcrypt.compare(password, user.password_hash)) {
        const session = createSession(user, ip);
        logger.logAudit(LOG.AUDIT, CAT.AUTH, 'login_success', user.id, { username: user.username }, ip);
        recordLogin(user.id, ip);
        return { payload: buildLoginPayload(user, session), user, session: session.payload };
      }
    }
    logger.logAudit(LOG.AUDIT, CAT.AUTH, 'login_failed', null, { identifier, reason: 'bad_credentials' }, ip);
    throw errors.invalidCredentials();
  }

  /**
   * Xác thực token (dùng cho reconnect + HTTP). Kiểm tra chữ ký, hạn, thu hồi, user còn tồn tại.
   * @returns {{ user: object, session: object }}
   */
  function authenticateToken(token) {
    const payload = tokenService.verify(token);
    const record = repos.sessions.findByJti(payload.jti);
    if (!record || record.revoked) throw errors.unauthorized('Phiên đăng nhập đã bị thu hồi');
    const user = repos.users.findById(payload.uid);
    if (!user) throw errors.unauthorized('Tài khoản không tồn tại');
    return { user, session: payload };
  }

  /**
   * Kết nối lại bằng session_token. Token còn > ngưỡng → giữ nguyên, ngược lại cấp mới.
   */
  function reconnect(input, ip) {
    const token = input && input.session_token;
    let auth;
    try {
      auth = authenticateToken(token);
    } catch (err) {
      logger.logAudit(LOG.AUDIT, CAT.AUTH, 'reconnect_failed', null, { code: err.code }, ip);
      throw err;
    }
    const remaining = auth.session.exp - Date.now();
    let session = { token, payload: auth.session, expiresAt: new Date(auth.session.exp).toISOString() };
    if (remaining < config.auth.tokenRenewThresholdMs) session = createSession(auth.user, ip);
    logger.logAudit(LOG.AUDIT, CAT.AUTH, 'reconnect', auth.user.id, { renewed: session.token !== token }, ip);
    recordLogin(auth.user.id, ip);
    return { payload: buildLoginPayload(auth.user, session), user: auth.user, session: session.payload };
  }

  /** Đăng xuất: thu hồi jti hiện tại. */
  function logout(userId, jti, ip) {
    if (jti) repos.sessions.revoke(jti);
    logger.logAudit(LOG.AUDIT, CAT.AUTH, 'logout', userId, {}, ip);
    return { ok: true };
  }

  /**
   * Đổi mật khẩu: kiểm tra mật khẩu cũ, cấp session mới, thu hồi mọi session khác.
   */
  async function changePassword(userId, input, ip) {
    const src = input || {};
    const oldPassword = typeof src.old_password === 'string' ? src.old_password : '';
    const newPassword = requireValid(V.validatePassword(src.new_password));
    const user = repos.users.findById(userId);
    if (!user) throw errors.unauthorized();
    if (!oldPassword || !(await bcrypt.compare(oldPassword, user.password_hash))) {
      logger.logAudit(LOG.AUDIT, CAT.AUTH, 'password_change_failed', userId, { reason: 'wrong_old_password' }, ip);
      throw errors.validation('Mật khẩu hiện tại không đúng');
    }
    if (oldPassword === newPassword) throw errors.validation('Mật khẩu mới phải khác mật khẩu hiện tại');
    const hash = await bcrypt.hash(newPassword, rounds);
    repos.users.updatePassword(userId, hash, nowIso());
    const session = createSession(user, ip);
    const revoked = repos.sessions.revokeOthers(userId, session.payload.jti);
    logger.logAudit(LOG.AUDIT, CAT.AUTH, 'password_changed', userId, { revoked_sessions: revoked }, ip);
    return { ok: true, session_token: session.token, expires_at: session.expiresAt, jti: session.payload.jti };
  }

  /** Đổi tên hiển thị + broadcast user:updated. */
  function updateProfile(userId, input, ip) {
    const displayName = requireValid(V.normalizeDisplayName(input && input.display_name));
    repos.users.updateDisplayName(userId, displayName, nowIso());
    const user = getWireUser(userId);
    logger.logAudit(LOG.AUDIT, CAT.SETTINGS, 'profile_updated', userId, { display_name: displayName }, ip);
    hub.toAll(W.USER.UPDATED, { user });
    return { user };
  }

  /** Lưu cài đặt cá nhân (theme). */
  function updateSettings(userId, input) {
    const theme = input && input.theme;
    if (!Object.values(C.THEME).includes(theme)) throw errors.validation('Giao diện không hợp lệ');
    repos.users.updateTheme(userId, theme, nowIso());
    logger.info(CAT.SETTINGS, 'settings_updated', { theme }, { userId });
    return { settings: { theme } };
  }

  /** Gán avatar mới (tên file trong data/avatars) + broadcast. Trả về tên avatar cũ để caller dọn file. */
  function setAvatar(userId, avatarName, ip) {
    const before = repos.users.findById(userId);
    if (!before) throw errors.unauthorized();
    repos.users.updateAvatar(userId, avatarName, nowIso());
    const user = getWireUser(userId);
    logger.logAudit(LOG.AUDIT, CAT.SETTINGS, 'avatar_updated', userId, { avatar: avatarName }, ip);
    hub.toAll(W.USER.UPDATED, { user });
    return { user, previousAvatar: before.avatar || null };
  }

  /** WireUser kèm online. */
  function getWireUser(userId) {
    const row = repos.users.findById(userId);
    return row ? toWireUser({ ...row, online: hub.isOnline(row.id) }) : null;
  }

  /** Danh sách mọi user kèm trạng thái online. */
  function listUsers() {
    return repos.users.listAll().map((u) => toWireUser({ ...u, online: hub.isOnline(u.id) }));
  }

  return {
    register,
    login,
    reconnect,
    logout,
    authenticateToken,
    changePassword,
    updateProfile,
    updateSettings,
    setAvatar,
    getWireUser,
    getUserRow: (id) => repos.users.findById(id),
    listUsers,
  };
}

module.exports = { createAuthService };
