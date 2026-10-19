/**
 * Hàm chuẩn hóa + kiểm tra input dùng chung 3 nơi: Client UX → Server validate → Login.
 * Pure function — không I/O, không phụ thuộc Node/Electron/React.
 *
 * Mọi hàm normalize trả về: { ok: true, value } | { ok: false, error: string }
 *
 * ⚠️ DUPLICATE ở be/src/shared và fe/shared — sửa xong chạy `npm run sync:shared`.
 */
'use strict';

const C = require('./constants');

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

const toStr = (raw) => (typeof raw === 'string' ? raw : raw == null ? '' : String(raw));
const hasInnerWhitespace = (s) => /\s/.test(s);

/**
 * Chuẩn hóa username: trim, không khoảng trắng giữa, ASCII [a-zA-Z0-9_.-]{3,30}.
 * Giữ nguyên case gốc (so sánh case-insensitive ở tầng DB).
 * @param {unknown} raw
 */
function normalizeUsername(raw) {
  const value = toStr(raw).trim();
  if (!value) return fail('Vui lòng nhập tên đăng nhập');
  if (hasInnerWhitespace(value)) return fail('Tên đăng nhập không được chứa khoảng trắng');
  if (value.length < C.USERNAME_MIN || value.length > C.USERNAME_MAX) {
    return fail(`Tên đăng nhập dài ${C.USERNAME_MIN}–${C.USERNAME_MAX} ký tự`);
  }
  if (!C.USERNAME_REGEX.test(value)) {
    return fail('Tên đăng nhập chỉ gồm chữ không dấu, số và các ký tự _ . -');
  }
  return ok(value);
}

/**
 * Chuẩn hóa mã nhân viên: trim, không khoảng trắng giữa, ASCII [a-zA-Z0-9_.-], tối đa 30.
 * @param {unknown} raw
 */
function normalizeEmployeeId(raw) {
  const value = toStr(raw).trim();
  if (!value) return fail('Vui lòng nhập mã nhân viên');
  if (hasInnerWhitespace(value)) return fail('Mã nhân viên không được chứa khoảng trắng');
  if (value.length > C.EMPLOYEE_ID_MAX) return fail(`Mã nhân viên tối đa ${C.EMPLOYEE_ID_MAX} ký tự`);
  if (!C.EMPLOYEE_ID_REGEX.test(value)) {
    return fail('Mã nhân viên chỉ gồm chữ không dấu, số và các ký tự _ . -');
  }
  return ok(value);
}

/**
 * Chuẩn hóa tên hiển thị: NFC, trim, gộp nhiều khoảng trắng thành 1, dài 1–50 (Unicode).
 * @param {unknown} raw
 */
function normalizeDisplayName(raw) {
  const value = toStr(raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!value) return fail('Vui lòng nhập tên hiển thị');
  // Đếm theo code point để emoji/tiếng Việt không bị tính sai
  const length = Array.from(value).length;
  if (length < C.DISPLAY_NAME_MIN || length > C.DISPLAY_NAME_MAX) {
    return fail(`Tên hiển thị dài ${C.DISPLAY_NAME_MIN}–${C.DISPLAY_NAME_MAX} ký tự`);
  }
  return ok(value);
}

/**
 * Kiểm tra mật khẩu: ASCII printable, dài 6–64. KHÔNG trim (khoảng trắng là ký tự hợp lệ).
 * @param {unknown} raw
 */
function validatePassword(raw) {
  const value = toStr(raw);
  if (!value) return fail('Vui lòng nhập mật khẩu');
  if (!C.PASSWORD_ASCII_REGEX.test(value)) return fail(C.MESSAGES_VI.PASSWORD_HINT);
  if (value.length < C.PASSWORD_MIN || value.length > C.PASSWORD_MAX) {
    return fail(`Mật khẩu dài ${C.PASSWORD_MIN}–${C.PASSWORD_MAX} ký tự`);
  }
  return ok(value);
}

/**
 * Đánh giá độ mạnh mật khẩu cho strength meter.
 * @param {string} password
 * @returns {{ score: 0|1|2|3|4, label: string }}
 */
function passwordStrength(password) {
  const pw = toStr(password);
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= C.PASSWORD_MIN) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score += 1;
  const labels = ['Rất yếu', 'Yếu', 'Trung bình', 'Mạnh', 'Rất mạnh'];
  const clamped = Math.min(score, 4);
  return { score: clamped, label: labels[clamped] };
}

/**
 * Chuẩn hóa input đăng nhập: identifier = username HOẶC employee_id.
 * @param {{ identifier: unknown, password: unknown }} input
 * @returns {{ ok: true, value: { identifier: string, password: string } } | { ok: false, error: string }}
 */
function normalizeLoginInput(input) {
  const identifier = toStr(input && input.identifier).trim();
  const password = toStr(input && input.password);
  if (!identifier) return fail('Vui lòng nhập tên đăng nhập hoặc mã nhân viên');
  if (hasInnerWhitespace(identifier)) return fail(C.MESSAGES_VI.INVALID_CREDENTIALS);
  if (!password) return fail('Vui lòng nhập mật khẩu');
  return ok({ identifier, password });
}

/**
 * Chuẩn hóa toàn bộ form đăng ký.
 * @param {{ username, employee_id, display_name, password }} input
 */
function normalizeRegisterInput(input) {
  const src = input || {};
  const username = normalizeUsername(src.username);
  if (!username.ok) return username;
  const employeeId = normalizeEmployeeId(src.employee_id);
  if (!employeeId.ok) return employeeId;
  const displayName = normalizeDisplayName(src.display_name);
  if (!displayName.ok) return displayName;
  const password = validatePassword(src.password);
  if (!password.ok) return password;
  return ok({
    username: username.value,
    employee_id: employeeId.value,
    display_name: displayName.value,
    password: password.value,
  });
}

/** Tên nhóm: NFC, gộp khoảng trắng, 1–100 ký tự. */
function normalizeGroupName(raw) {
  const value = toStr(raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!value) return fail('Vui lòng nhập tên nhóm');
  if (Array.from(value).length > C.GROUP_NAME_MAX) return fail(`Tên nhóm tối đa ${C.GROUP_NAME_MAX} ký tự`);
  return ok(value);
}

/**
 * Nội dung tin nhắn: NFC, giữ xuống dòng, chỉ trim 2 đầu.
 * @param {unknown} raw
 * @param {{ allowEmpty?: boolean }} [opts] allowEmpty=true cho tin ảnh/file không kèm text
 */
function normalizeMessageContent(raw, opts) {
  const value = toStr(raw).normalize('NFC').replace(/\r\n/g, '\n').trim();
  if (!value && !(opts && opts.allowEmpty)) return fail('Tin nhắn trống');
  if (value.length > C.MESSAGE_MAX_LENGTH) return fail(`Tin nhắn tối đa ${C.MESSAGE_MAX_LENGTH} ký tự`);
  return ok(value);
}

/** IPv4 dạng a.b.c.d */
function validateIpv4(raw) {
  const value = toStr(raw).trim();
  if (!C.IPV4_REGEX.test(value)) return fail('Địa chỉ IP không hợp lệ (ví dụ: 192.168.1.10)');
  return ok(value);
}

/**
 * Làm sạch tên file: bỏ path (chống traversal), ký tự cấm Windows, ký tự điều khiển, tên dành riêng.
 * @param {unknown} raw
 * @returns {string} luôn trả về tên hợp lệ (fallback "file")
 */
function sanitizeFileName(raw) {
  let name = toStr(raw).normalize('NFC');
  name = name.split(/[\\/]/).pop() || ''; // chỉ giữ phần tên cuối
  name = name.replace(/[<>:"|?*\u0000-\u001F]/g, '_');
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) name = `_${name}`;
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name || 'file';
}

/** Trích các link http(s) trong text (cho tab Link trong panel nhóm). */
function extractLinks(text) {
  const matches = toStr(text).match(C.URL_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
}

module.exports = {
  normalizeUsername,
  normalizeEmployeeId,
  normalizeDisplayName,
  validatePassword,
  passwordStrength,
  normalizeLoginInput,
  normalizeRegisterInput,
  normalizeGroupName,
  normalizeMessageContent,
  validateIpv4,
  sanitizeFileName,
  extractLinks,
};
