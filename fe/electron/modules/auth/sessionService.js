/**
 * Phiên đăng nhập + trạng thái kết nối tổng hợp.
 *
 * - login/register: kết nối server → auth → lưu payload (token, server_public_key, user).
 * - "Ghi nhớ đăng nhập": lưu token vào client.db settings; không tick → token chỉ trong RAM.
 *   server_public_key + cache user luôn lưu (để verify peer khi offline).
 * - Mất server khi đã đăng nhập → trạng thái 'offline_p2p'; tự reconnect + auth:reconnect bằng token cache.
 * - auth:kicked → đăng xuất, báo renderer 'kicked'; token bị từ chối → 'session_expired'.
 *
 * Sự kiện nội bộ: 'authenticated' (payload), 'server-lost', 'logged_in' (user), 'logged_out'.
 * Không import Electron.
 */
'use strict';

const { EventEmitter } = require('events');
const { NETWORK, ERROR_CODE, LOG_CATEGORY, MESSAGES_VI } = require('../../../shared/constants');
const { AUTH, USER } = require('../../../shared/wsEvents');
const validators = require('../../../shared/validators');
const { IPC_EVENTS } = require('../../../ipc/channels');
const { AppError, validationError, offlineError } = require('../../core/utils/errors');
const { CONN_STATE } = require('../connection/serverConnection');
const { isTokenUnexpired } = require('./tokenVerifier');

/** Key settings dành riêng cho main — renderer KHÔNG được đọc/ghi (xem dbHandlers) */
const SETTINGS_KEYS = Object.freeze({
  SESSION: 'auth.session',
  SERVER_PUBLIC_KEY: 'auth.server_public_key',
  LAST_SERVER: 'auth.last_server',
  DB_OWNER: 'auth.db_owner_user_id',
  INSTANCE_ID: 'app.instance_id',
  USER_SETTINGS: 'user.settings',
  THEME: 'theme',
});
const RESERVED_SETTING_PREFIXES = Object.freeze(['auth.', 'app.']);

const AUTH_STATE = Object.freeze({ LOGGED_IN: 'logged_in', LOGGED_OUT: 'logged_out', KICKED: 'kicked', SESSION_EXPIRED: 'session_expired' });
const CONNECTION_STATE = Object.freeze({ DISCONNECTED: 'disconnected', CONNECTING: 'connecting', ONLINE: 'online', OFFLINE_P2P: 'offline_p2p' });

const HOSTNAME_REGEX = /^[a-zA-Z0-9.-]{1,253}$/;

/**
 * Chuẩn hóa địa chỉ server từ input renderer.
 * @returns {{host: string, port: number}}
 */
function normalizeServer(input, defaultPort) {
  const host = String((input && input.host) || '').trim();
  if (!host) throw validationError('Vui lòng chọn hoặc nhập địa chỉ server');
  if (!HOSTNAME_REGEX.test(host)) throw validationError('Địa chỉ server không hợp lệ (ví dụ: 192.168.1.10)');
  const port = input && input.port != null && input.port !== '' ? Number(input.port) : defaultPort || NETWORK.SERVER_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw validationError('Cổng server không hợp lệ');
  return { host, port };
}

class SessionService extends EventEmitter {
  /**
   * @param {{ connection: import('../connection/serverConnection').ServerConnection, repos: object, emit: Function,
   *   logger: object, defaultPort?: number, onUserChanged?: (prevOwnerId: number, newUserId: number) => void }} deps
   */
  constructor(deps) {
    super();
    this.connection = deps.connection;
    this.repos = deps.repos;
    this.emitEvt = deps.emit;
    this.log = deps.logger;
    this.defaultPort = deps.defaultPort || NETWORK.SERVER_PORT;
    this.onUserChanged = deps.onUserChanged;
    this._reset();

    this.connection.on('state', () => this.emitConnection());
    this.connection.on('open', (info) => this._onOpen(info));
    this.connection.on('close', (info) => this._onClose(info));
    this.connection.on('frame', (frame) => this._onPushFrame(frame));
  }

  _reset() {
    this.authState = AUTH_STATE.LOGGED_OUT;
    this.user = null;
    this.token = null;
    this.expiresAt = null;
    this.remember = false;
    this.server = null;
    this.userSettings = {};
    this.authenticated = false;
    this.lastError = null;
  }

  // ---------- getters ----------
  isLoggedIn() {
    return this.authState === AUTH_STATE.LOGGED_IN && !!this.user;
  }
  /** Đã auth với server và socket đang mở */
  isOnline() {
    return this.isLoggedIn() && this.authenticated && this.connection.isConnected();
  }
  getUser() {
    return this.user;
  }
  getUserId() {
    return this.user ? this.user.id : null;
  }
  getToken() {
    return this.token;
  }
  getServer() {
    return this.server;
  }
  getServerPublicKey() {
    return this.repos.settings.get(SETTINGS_KEYS.SERVER_PUBLIC_KEY, null);
  }
  getUserSettings() {
    return this.userSettings || {};
  }

  /** Trạng thái kết nối tổng hợp cho evt:connection */
  connectionState() {
    if (this.isOnline()) return CONNECTION_STATE.ONLINE;
    if (this.connection.state === CONN_STATE.CONNECTING || (this.connection.isConnected() && this.isLoggedIn())) {
      return CONNECTION_STATE.CONNECTING;
    }
    return this.isLoggedIn() ? CONNECTION_STATE.OFFLINE_P2P : CONNECTION_STATE.DISCONNECTED;
  }

  getConnectionStatus() {
    return { state: this.connectionState(), server: this.server, serverOnline: this.isOnline() };
  }

  getState() {
    return { state: this.authState, user: this.user, server: this.server, serverOnline: this.isOnline() };
  }

  emitConnection(error) {
    this.emitEvt(IPC_EVENTS.CONNECTION, { ...this.getConnectionStatus(), ...(error ? { error } : {}) });
  }

  /**
   * Request tới server — chỉ khi đã auth (không thì SERVER_OFFLINE).
   * @param {string} type
   * @param {object} [data]
   * @param {object} [opts]
   */
  request(type, data, opts) {
    if (!this.isOnline()) return Promise.reject(offlineError());
    return this.connection.request(type, data, opts);
  }

  send(type, data) {
    if (!this.isOnline()) return false;
    return this.connection.send(type, data);
  }

  // ---------- login / register ----------

  /**
   * @param {{host, port?, identifier, password, remember}} input
   * @returns {Promise<{user, settings}>}
   */
  async login(input) {
    const server = normalizeServer(input, this.defaultPort);
    const creds = validators.normalizeLoginInput(input || {});
    if (!creds.ok) throw validationError(creds.error);
    return this._authenticateFresh(server, AUTH.LOGIN, creds.value, !!(input && input.remember));
  }

  /**
   * @param {{host, port?, username, employee_id, display_name, password, remember}} input
   * @returns {Promise<{user, settings}>}
   */
  async register(input) {
    const server = normalizeServer(input, this.defaultPort);
    const form = validators.normalizeRegisterInput(input || {});
    if (!form.ok) throw validationError(form.error);
    return this._authenticateFresh(server, AUTH.REGISTER, form.value, !!(input && input.remember));
  }

  async _authenticateFresh(server, type, data, remember) {
    if (this.isLoggedIn()) await this.logout({ silent: true });
    this.connection.setAutoReconnect(false);
    try {
      await this.connection.connect(server);
    } catch (err) {
      this.log.warn(LOG_CATEGORY.CONNECTION, 'connect_failed', { server, message: err.message });
      throw new AppError(ERROR_CODE.SERVER_OFFLINE, `Không kết nối được server ${server.host}:${server.port}. Kiểm tra địa chỉ và mạng LAN.`);
    }
    let payload;
    try {
      payload = await this.connection.request(type, data);
    } catch (err) {
      this.connection.close();
      this.log.warn(LOG_CATEGORY.AUTH, type === AUTH.LOGIN ? 'login_failed' : 'register_failed', { code: err.code });
      if (type === AUTH.LOGIN && err.code === ERROR_CODE.INVALID_CREDENTIALS) {
        throw new AppError(ERROR_CODE.INVALID_CREDENTIALS, MESSAGES_VI.INVALID_CREDENTIALS);
      }
      throw err;
    }
    this._applyLoginPayload(payload, { remember, server });
    this.log.audit(LOG_CATEGORY.AUTH, type === AUTH.LOGIN ? 'login' : 'register', { server, remember });
    return { user: this.user, settings: this.userSettings };
  }

  /**
   * Lưu kết quả LoginPayload và chuyển sang trạng thái online.
   * @param {{user, session_token, expires_at, server_public_key, settings}} payload
   */
  _applyLoginPayload(payload, { remember, server }) {
    if (!payload || !payload.user || !payload.session_token) {
      throw new AppError(ERROR_CODE.INTERNAL, 'Server trả về dữ liệu đăng nhập không hợp lệ');
    }
    const { settings } = this.repos;
    const prevOwner = settings.get(SETTINGS_KEYS.DB_OWNER, null);
    if (prevOwner != null && Number(prevOwner) !== Number(payload.user.id) && this.onUserChanged) {
      this.onUserChanged(Number(prevOwner), Number(payload.user.id));
    }
    settings.set(SETTINGS_KEYS.DB_OWNER, payload.user.id);

    const wasLoggedIn = this.isLoggedIn();
    this.user = payload.user;
    this.token = payload.session_token;
    this.expiresAt = payload.expires_at || null;
    this.remember = !!remember;
    this.server = server;
    this.userSettings = payload.settings || {};
    this.authState = AUTH_STATE.LOGGED_IN;
    this.authenticated = true;

    this.repos.users.upsert({ ...payload.user, online: true });
    if (payload.server_public_key) settings.set(SETTINGS_KEYS.SERVER_PUBLIC_KEY, payload.server_public_key);
    settings.set(SETTINGS_KEYS.LAST_SERVER, server);
    settings.set(SETTINGS_KEYS.USER_SETTINGS, this.userSettings);
    if (this.userSettings.theme) settings.set(SETTINGS_KEYS.THEME, this.userSettings.theme);
    this._persistSession();

    this.connection.setAutoReconnect(true);
    this.emitEvt(IPC_EVENTS.AUTH, { state: AUTH_STATE.LOGGED_IN, user: this.user });
    this.emitConnection();
    if (!wasLoggedIn) this.emit('logged_in', this.user);
    this.emit('authenticated', payload);
  }

  /** Ghi/xóa token trong client.db theo lựa chọn "Ghi nhớ đăng nhập" */
  _persistSession() {
    if (this.remember && this.token) {
      this.repos.settings.set(SETTINGS_KEYS.SESSION, {
        token: this.token,
        expires_at: this.expiresAt,
        user: this.user,
        server: this.server,
        remember: true,
      });
    } else {
      this.repos.settings.delete(SETTINGS_KEYS.SESSION);
    }
  }

  /**
   * Khôi phục phiên đã ghi nhớ. Server offline nhưng token còn hạn → vào chế độ P2P.
   * @returns {Promise<{user, settings, server} | null>}
   */
  async restore() {
    if (this.isLoggedIn()) return { user: this.user, settings: this.userSettings, server: this.server };
    const saved = this.repos.settings.get(SETTINGS_KEYS.SESSION, null);
    if (!saved || !saved.token || !saved.user || !saved.server) return null;
    if (!isTokenUnexpired(saved.token)) {
      this.repos.settings.delete(SETTINGS_KEYS.SESSION);
      this.log.info(LOG_CATEGORY.AUTH, 'restore_expired');
      return null;
    }
    this.user = saved.user;
    this.token = saved.token;
    this.expiresAt = saved.expires_at || null;
    this.remember = true;
    this.server = saved.server;
    this.userSettings = this.repos.settings.get(SETTINGS_KEYS.USER_SETTINGS, {}) || {};
    this.authState = AUTH_STATE.LOGGED_IN;
    this.authenticated = false;
    this.connection.setAutoReconnect(true);
    this.emit('logged_in', this.user);

    try {
      await this.connection.connect(this.server);
      await this._reauthenticate();
    } catch (err) {
      if (err && (err.code === ERROR_CODE.SESSION_EXPIRED || err.code === ERROR_CODE.UNAUTHORIZED)) return null;
      // Server offline → chế độ P2P (connection tự reconnect nền)
      this.log.info(LOG_CATEGORY.CONNECTION, 'restore_offline', { server: this.server, code: err && err.code });
      this.emitEvt(IPC_EVENTS.AUTH, { state: AUTH_STATE.LOGGED_IN, user: this.user });
      this.emitConnection();
    }
    if (!this.isLoggedIn()) return null;
    return { user: this.user, settings: this.userSettings, server: this.server };
  }

  /** auth:reconnect bằng token cache (sau khi socket mở lại) */
  async _reauthenticate() {
    try {
      const payload = await this.connection.request(AUTH.RECONNECT, { session_token: this.token });
      this._applyLoginPayload(payload, { remember: this.remember, server: this.server });
      this.log.info(LOG_CATEGORY.AUTH, 'reconnected', { server: this.server });
    } catch (err) {
      if (err.code === ERROR_CODE.SESSION_EXPIRED || err.code === ERROR_CODE.UNAUTHORIZED) {
        this.log.warn(LOG_CATEGORY.AUTH, 'session_rejected', { code: err.code });
        this._endSession(AUTH_STATE.SESSION_EXPIRED, MESSAGES_VI.SESSION_EXPIRED);
      } else {
        this.log.warn(LOG_CATEGORY.AUTH, 'reconnect_failed', { code: err.code, message: err.message });
      }
      throw err;
    }
  }

  _onOpen(info) {
    if (!info.isReconnect || !this.isLoggedIn() || !this.token) return;
    this._reauthenticate().catch(() => {
      /* đã log + xử lý trong _reauthenticate */
    });
  }

  _onClose(info) {
    const wasAuthenticated = this.authenticated;
    this.authenticated = false;
    if (wasAuthenticated) {
      this.log.warn(LOG_CATEGORY.CONNECTION, 'server_lost', { code: info && info.code });
      this.emit('server-lost');
    }
    this.emitConnection();
  }

  _onPushFrame(frame) {
    if (frame.type === AUTH.KICKED) {
      const reason = (frame.data && frame.data.reason) || MESSAGES_VI.BLOCKED;
      this.log.audit(LOG_CATEGORY.AUTH, 'kicked', { reason });
      this._endSession(AUTH_STATE.KICKED, reason);
      return;
    }
    if (frame.type === USER.UPDATED && frame.data && frame.data.user && this.user && frame.data.user.id === this.user.id) {
      this.updateUser(frame.data.user);
    }
  }

  /** Kết thúc phiên (kicked / hết hạn): xóa token, đóng socket, báo renderer */
  _endSession(state, reason) {
    this.repos.settings.delete(SETTINGS_KEYS.SESSION);
    this.connection.close();
    this._reset();
    this.emitEvt(IPC_EVENTS.AUTH, { state, reason });
    this.emitConnection();
    this.emit('logged_out');
  }

  /** Cập nhật user hiện tại (đổi tên/avatar) */
  updateUser(user) {
    if (!this.user || !user || user.id !== this.user.id) return;
    this.user = { ...this.user, ...user };
    this._persistSession();
  }

  /** Lưu theme vào settings local (+ cập nhật userSettings) */
  setUserSetting(key, value) {
    this.userSettings = { ...this.userSettings, [key]: value };
    this.repos.settings.set(SETTINGS_KEYS.USER_SETTINGS, this.userSettings);
  }

  /**
   * Đăng xuất: thu hồi token trên server (nếu online), xóa token local, đóng socket.
   * @param {{ silent?: boolean }} [opts]
   */
  async logout(opts) {
    if (!this.isLoggedIn()) return;
    if (this.isOnline()) {
      try {
        await this.connection.request(AUTH.LOGOUT, {});
      } catch (err) {
        this.log.warn(LOG_CATEGORY.AUTH, 'logout_request_failed', { code: err.code });
      }
    }
    this.log.audit(LOG_CATEGORY.AUTH, 'logout', {});
    this.repos.settings.delete(SETTINGS_KEYS.SESSION);
    this.connection.close();
    this._reset();
    if (!(opts && opts.silent)) this.emitEvt(IPC_EVENTS.AUTH, { state: AUTH_STATE.LOGGED_OUT });
    this.emitConnection();
    this.emit('logged_out');
  }

  /**
   * Đổi mật khẩu (chỉ online). Server thu hồi các session khác và trả token mới.
   * @param {{old_password, new_password}} input
   */
  async changePassword(input) {
    const oldPw = String((input && input.old_password) || '');
    if (!oldPw) throw validationError('Vui lòng nhập mật khẩu hiện tại');
    const next = validators.validatePassword(input && input.new_password);
    if (!next.ok) throw validationError(next.error);
    if (!this.isOnline()) throw offlineError('Chỉ đổi được mật khẩu khi server online.');
    const res = await this.request(USER.CHANGE_PASSWORD, { old_password: oldPw, new_password: next.value });
    if (res && res.session_token) {
      this.token = res.session_token;
      this.expiresAt = res.expires_at || this.expiresAt;
      this._persistSession();
    }
    this.log.audit(LOG_CATEGORY.AUTH, 'change_password', {});
    return { ok: true };
  }
}

module.exports = { SessionService, SETTINGS_KEYS, RESERVED_SETTING_PREFIXES, AUTH_STATE, CONNECTION_STATE, normalizeServer };
