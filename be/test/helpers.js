/**
 * Tiện ích test: khởi động server in-process (cổng ngẫu nhiên, thư mục dữ liệu tạm) + WS client gọn.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { startServer } = require('../src/core/server');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Khởi động server test.
 * @param {object} [overrides] cấu hình override thêm
 */
async function bootServer(overrides) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanchat-test-'));
  const instance = await startServer({
    baseDir,
    port: 0,
    discovery: false,
    peerBroadcast: false,
    overrides: { logging: { consoleLevel: 'none', level: C.LOG_LEVEL.DEBUG }, ...(overrides || {}) },
  });
  return {
    instance,
    port: instance.port,
    baseDir,
    httpUrl: (p, host) => `http://${host || '127.0.0.1'}:${instance.port}${p}`,
    async close() {
      await instance.stop();
      fs.rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

class TestClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.pushes = [];
    this.waiters = [];
    this.closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.on('message', (raw) => this.onFrame(JSON.parse(raw.toString('utf8'))));
  }

  /** Kết nối tới server. */
  static connect(port, host) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${host || '127.0.0.1'}:${port}${C.NETWORK.WS_PATH}`);
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  onFrame(frame) {
    if (frame.reqId && this.pending.has(frame.reqId)) {
      const { resolve, timer } = this.pending.get(frame.reqId);
      clearTimeout(timer);
      this.pending.delete(frame.reqId);
      resolve(frame);
      return;
    }
    // Push được 1 waiter nhận thì không giữ lại trong buffer (tránh đếm trùng)
    const waiter = this.waiters.find((w) => w.type === frame.type && w.pred(frame.data || {}));
    if (!waiter) {
      this.pushes.push(frame);
      return;
    }
    clearTimeout(waiter.timer);
    this.waiters = this.waiters.filter((w) => w !== waiter);
    waiter.resolve(frame);
  }

  /** Gửi request có reqId và chờ frame trả lời. */
  request(type, data) {
    const reqId = `r-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Timeout chờ trả lời ${type}`));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, timer });
      this.ws.send(JSON.stringify({ type, data, reqId }));
    });
  }

  /** Gửi event một chiều (không reqId). */
  emit(type, data) {
    this.ws.send(JSON.stringify({ type, data }));
  }

  /** Chờ push event thỏa điều kiện (kiểm tra cả các push đã nhận trước đó). */
  waitFor(type, pred, timeoutMs) {
    const match = pred || (() => true);
    const index = this.pushes.findIndex((f) => f.type === type && match(f.data || {}));
    if (index >= 0) return Promise.resolve(this.pushes.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, pred: match, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Timeout chờ push ${type}`));
      }, timeoutMs || DEFAULT_TIMEOUT_MS);
      this.waiters.push(waiter);
    });
  }

  /** Đếm push đã nhận theo type + điều kiện. */
  count(type, pred) {
    const match = pred || (() => true);
    return this.pushes.filter((f) => f.type === type && match(f.data || {})).length;
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

let userSeq = 0;
/** Sinh input đăng ký duy nhất. */
function userInput(prefix) {
  userSeq += 1;
  const tag = `${prefix || 'user'}${userSeq}${crypto.randomBytes(2).toString('hex')}`;
  return { username: tag, employee_id: `NV-${tag}`, display_name: `Người ${tag}`, password: 'secret123' };
}

/**
 * Đăng ký user mới qua WS và trả về client đã auth.
 * @returns {Promise<{ client: TestClient, user: object, token: string, payload: object, input: object }>}
 */
async function registerUser(port, prefix, host) {
  const input = userInput(prefix);
  const client = await TestClient.connect(port, host);
  const reply = await client.request(W.AUTH.REGISTER, input);
  if (reply.error) throw new Error(`Đăng ký thất bại: ${reply.error.message}`);
  return { client, user: reply.data.user, token: reply.data.session_token, payload: reply.data, input };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { bootServer, TestClient, registerUser, userInput, delay };
