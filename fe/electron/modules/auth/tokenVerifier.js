/**
 * Xác minh session token (JWT-like, ký Ed25519) HOÀN TOÀN LOCAL bằng server_public_key đã cache —
 * dùng cho handshake P2P khi server offline (PROTOCOL §1.1).
 *
 * Token = base64url(JSON payload) + "." + base64url(signature)
 * Payload: { uid, un, dn, iat, exp, jti }  (iat/exp tính bằng ms)
 *
 * Chữ ký được kiểm tra trên chuỗi base64url của payload (quy ước JWT). Để tương thích nếu server
 * ký trên bytes JSON gốc, verify thử thêm phương án đó.
 */
'use strict';

const crypto = require('crypto');
const { ERROR_CODE } = require('../../../shared/constants');

const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Giải mã payload KHÔNG verify (chỉ để đọc exp/uid hiển thị).
 * @param {string} token
 * @returns {object|null}
 */
function decodeTokenPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = JSON.parse(fromB64url(parts[0]).toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Verify chữ ký + hạn dùng.
 * @param {string} token
 * @param {string} publicKeyPem PEM SPKI Ed25519
 * @param {number} [nowMs]
 * @returns {{ ok: true, claims: object } | { ok: false, code: string, reason: string }}
 */
function verifySessionToken(token, publicKeyPem, nowMs) {
  if (!publicKeyPem) return { ok: false, code: ERROR_CODE.UNAUTHORIZED, reason: 'missing_public_key' };
  if (typeof token !== 'string' || token.length > 4096) return { ok: false, code: ERROR_CODE.UNAUTHORIZED, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, code: ERROR_CODE.UNAUTHORIZED, reason: 'malformed' };

  let key;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch (_err) {
    return { ok: false, code: ERROR_CODE.UNAUTHORIZED, reason: 'bad_public_key' };
  }
  const signature = fromB64url(parts[1]);
  const payloadBytes = fromB64url(parts[0]);
  let valid = false;
  try {
    valid =
      crypto.verify(null, Buffer.from(parts[0], 'utf8'), key, signature) || crypto.verify(null, payloadBytes, key, signature);
  } catch (_err) {
    valid = false;
  }
  if (!valid) return { ok: false, code: ERROR_CODE.UNAUTHORIZED, reason: 'bad_signature' };

  const claims = decodeTokenPayload(token);
  if (!claims || !Number.isInteger(Number(claims.uid))) return { ok: false, code: ERROR_CODE.UNAUTHORIZED, reason: 'bad_payload' };
  const now = nowMs ?? Date.now();
  if (!claims.exp || Number(claims.exp) <= now) return { ok: false, code: ERROR_CODE.SESSION_EXPIRED, reason: 'expired' };
  return { ok: true, claims: { ...claims, uid: Number(claims.uid) } };
}

/** Token còn hạn không (không verify chữ ký — dùng cho quyết định UI) */
function isTokenUnexpired(token, nowMs) {
  const p = decodeTokenPayload(token);
  return !!(p && p.exp && Number(p.exp) > (nowMs ?? Date.now()));
}

module.exports = { verifySessionToken, decodeTokenPayload, isTokenUnexpired };
