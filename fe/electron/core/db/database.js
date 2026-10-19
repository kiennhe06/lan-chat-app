/**
 * Mở client.db (CHỈ client.db — không bao giờ đụng server.db), bật WAL, chạy migration theo schema_version.
 * Không chứa business logic.
 */
'use strict';

const Database = require('better-sqlite3');

/**
 * Danh sách migration theo thứ tự. KHÔNG sửa migration đã phát hành — chỉ thêm mới.
 * v1: schema cơ bản (bản trước Mức 3).
 * v2: bổ sung Mức 3 offline-first (vector clock, P2P, action queue...) — đúng spec §7.2.
 * v3: bảng downloads + chỉ mục phụ trợ.
 */
const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS users_cache (
        id INTEGER PRIMARY KEY,
        username TEXT,
        employee_id TEXT,
        display_name TEXT,
        avatar TEXT,
        role TEXT,
        online INTEGER DEFAULT 0,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS conversations_cache (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT,
        owner_id INTEGER,
        members TEXT NOT NULL DEFAULT '[]',
        pinned TEXT NOT NULL DEFAULT '[]',
        pending_count INTEGER NOT NULL DEFAULT 0,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        local_id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER UNIQUE,
        client_message_id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        sender_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        reply_to TEXT,
        file TEXT,
        file_sha256 TEXT,
        mentions TEXT NOT NULL DEFAULT '[]',
        edited INTEGER NOT NULL DEFAULT 0,
        recalled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        sync_state TEXT NOT NULL DEFAULT 'synced',
        created_at TEXT,
        updated_at TEXT,
        local_path TEXT,
        sort_key TEXT NOT NULL,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv_sort ON messages(conversation_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_messages_file_sha ON messages(file_sha256);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE messages ADD COLUMN vector_clock TEXT;
      ALTER TABLE messages ADD COLUMN p2p_receipts TEXT;
      ALTER TABLE messages ADD COLUMN created_at_local TEXT;

      ALTER TABLE conversations_cache ADD COLUMN version INTEGER DEFAULT 1;
      ALTER TABLE conversations_cache ADD COLUMN sync_state TEXT DEFAULT 'synced';
      ALTER TABLE conversations_cache ADD COLUMN client_temp_id TEXT;
      ALTER TABLE conversations_cache ADD COLUMN updated_by INTEGER;

      CREATE INDEX IF NOT EXISTS idx_messages_sync_state ON messages(sync_state);

      CREATE TABLE IF NOT EXISTS peers_cache (
        user_id INTEGER PRIMARY KEY, display_name TEXT, last_ip TEXT, last_port INTEGER,
        last_seen TEXT, server_online INTEGER DEFAULT 0, session_token TEXT
      );
      CREATE TABLE IF NOT EXISTS vector_clock (user_id INTEGER PRIMARY KEY, counter INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS action_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action_type TEXT NOT NULL, payload TEXT NOT NULL,
        vector_clock TEXT, created_at TEXT NOT NULL, retry_count INTEGER DEFAULT 0, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS p2p_files (
        file_hash TEXT PRIMARY KEY, local_path TEXT NOT NULL, file_size INTEGER, mime_type TEXT,
        received_from_user_id INTEGER, received_at TEXT, uploaded_to_server INTEGER DEFAULT 0
      );
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS downloads (
        client_message_id TEXT PRIMARY KEY,
        local_path TEXT NOT NULL,
        file_sha256 TEXT,
        downloaded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_downloads_sha ON downloads(file_sha256);
      ALTER TABLE action_queue ADD COLUMN client_action_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_action_queue_client_id ON action_queue(client_action_id);
    `,
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Đọc version hiện tại (0 nếu DB mới) */
function getSchemaVersion(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  return (row && row.v) || 0;
}

/**
 * Chạy các migration còn thiếu, mỗi migration trong 1 transaction (lỗi → rollback, throw).
 * @param {import('better-sqlite3').Database} db
 * @returns {number[]} các version vừa áp dụng
 */
function migrate(db) {
  const current = getSchemaVersion(db);
  const applied = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    })();
    applied.push(m.version);
  }
  return applied;
}

/**
 * Mở (tạo nếu chưa có) client.db.
 * @param {string} filePath đường dẫn file DB (':memory:' cho test)
 * @returns {{ db: import('better-sqlite3').Database, applied: number[] }}
 */
function openDatabase(filePath) {
  const db = new Database(filePath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const applied = migrate(db);
    return { db, applied };
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Đóng DB an toàn (checkpoint WAL trước) */
function closeDatabase(db) {
  if (!db || !db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

module.exports = { openDatabase, closeDatabase, migrate, getSchemaVersion, MIGRATIONS, LATEST_VERSION };

/**
 * Xóa dữ liệu gắn với 1 tài khoản (khi người khác đăng nhập trên cùng máy) — tránh lộ tin của người trước.
 * Giữ settings chung, users_cache, peers_cache, p2p_files.
 * @param {import('better-sqlite3').Database} db
 */
function clearUserScopedData(db) {
  db.transaction(() => {
    db.exec('DELETE FROM messages; DELETE FROM conversations_cache; DELETE FROM action_queue; DELETE FROM vector_clock; DELETE FROM downloads;');
  })();
}

module.exports.clearUserScopedData = clearUserScopedData;
