/**
 * Session token ký Ed25519 (PROTOCOL §1.1).
 *
 * Token = base64url(JSON payload) + "." + base64url(signature)
 *   - signature = Ed25519 ký trên chuỗi ASCII của phần đầu (base64url payload) — giống "signing input" của JWS.
 *   - payload = { uid, un, dn, iat, exp, jti } (iat/exp tính bằng ms epoch).
 * Cặp khóa sinh tự động lần chạy đầu trong data/keys/ (private key chmod 600 nếu hệ điều hành hỗ trợ).
 * Client/peer verify bằng server_public_key (PEM SPKI) mà không cần server.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { errors } = require('../../core/errors');

const PRIVATE_KEY_MODE = 0o600;

/**
 * Đọc hoặc sinh cặp khóa Ed25519.
 * @param {{ privateKeyFile: string, publicKeyFile: string }} files
 * @returns {{ privateKey: crypto.KeyObject, publicKey: crypto.KeyObject, publicKeyPem: string, created: boolean }}
 */
function loadOrCreateKeys(files) {
  if (fs.existsSync(files.privateKeyFile)) {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(files.privateKeyFile, 'utf8'));
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error(`Khóa ${files.privateKeyFile} không phải Ed25519`);
    }
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    // File public có thể bị xóa nhầm → sinh lại từ private key
    if (!fs.existsSync(files.publicKeyFile)) fs.writeFileSync(files.publicKeyFile, publicKeyPem, 'utf8');
    return { privateKey, publicKey, publicKeyPem, created: false };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(files.privateKeyFile, privatePem, { encoding: 'utf8', mode: PRIVATE_KEY_MODE });
  try {
    fs.chmodSync(files.privateKeyFile, PRIVATE_KEY_MODE); // Windows bỏ qua phần lớn bit quyền — chấp nhận
  } catch (_err) {
    // Không chmod được (FS không hỗ trợ) không phải lỗi nghiêm trọng; file vẫn nằm trong data/ riêng của server
  }
  fs.writeFileSync(files.publicKeyFile, publicKeyPem, 'utf8');
  return { privateKey, publicKey, publicKeyPem, created: true };
}

const b64urlJson = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

/**
 * Tách + kiểm tra chữ ký token bằng public key. Pure (không đụng DB) → dùng được cho test / peer.
 * @param {string} token
 * @param {crypto.KeyObject|string} publicKey KeyObject hoặc PEM
 * @returns {object|null} payload nếu chữ ký hợp lệ, null nếu sai định dạng/chữ ký
 */
function verifySignature(token, publicKey) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
    const okSig = crypto.verify(null, Buffer.from(parts[0], 'ascii'), key, Buffer.from(parts[1], 'base64url'));
    if (!okSig) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || typeof payload.uid !== 'number' || typeof payload.exp !== 'number' || !payload.jti) return null;
    return payload;
  } catch (_err) {
    return null; // token rác → coi như không hợp lệ (caller trả UNAUTHORIZED)
  }
}

/**
 * @param {{ keyFiles: { privateKeyFile: string, publicKeyFile: string }, ttlMs: number }} options
 */
function createTokenService(options) {
  const keys = loadOrCreateKeys(options.keyFiles);

  /**
   * Cấp token mới cho user.
   * @param {{ id: number, username: string, display_name: string }} user
   * @returns {{ token: string, payload: object, expiresAt: string }}
   */
  function issue(user) {
    const iat = Date.now();
    const payload = {
      uid: user.id,
      un: user.username,
      dn: user.display_name,
      iat,
      exp: iat + options.ttlMs,
      jti: crypto.randomBytes(16).toString('hex'),
    };
    const head = b64urlJson(payload);
    const signature = crypto.sign(null, Buffer.from(head, 'ascii'), keys.privateKey).toString('base64url');
    return { token: `${head}.${signature}`, payload, expiresAt: new Date(payload.exp).toISOString() };
  }

  /**
   * Verify chữ ký + hạn. Không kiểm tra thu hồi (việc của authService qua sessions).
   * @param {string} token
   * @returns {object} payload
   * @throws AppError UNAUTHORIZED | SESSION_EXPIRED
   */
  function verify(token) {
    const payload = verifySignature(token, keys.publicKey);
    if (!payload) throw errors.unauthorized('Phiên đăng nhập không hợp lệ');
    if (payload.exp <= Date.now()) throw errors.sessionExpired();
    return payload;
  }

  return { issue, verify, publicKeyPem: keys.publicKeyPem, keysCreated: keys.created };
}

module.exports = { createTokenService, verifySignature, loadOrCreateKeys };
