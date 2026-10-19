/**
 * Mở server.db (CHỈ server.db — không bao giờ đụng client.db) + chạy migration.
 *
 * - WAL mode, foreign_keys ON, busy_timeout.
 * - Migration đánh số tăng dần, lưu trong bảng schema_version, idempotent (chạy lại an toàn).
 * - Migration 2 = các ALTER của Mức 3 (spec 7.1): messages.vector_clock, conversations.version,
 *   conversations.client_temp_id (+ cột LWW đổi tên nhóm).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const BUSY_TIMEOUT_MS = 5000;

/** Schema gốc (bản trước Mức 3). */
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  employee_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  theme TEXT NOT NULL DEFAULT 'light',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  direct_key TEXT UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  last_delivered_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS pending_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  has_thumb INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_message_id TEXT NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  reply_to TEXT,
  file_id INTEGER REFERENCES files(id),
  mentions TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  recalled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_at_local TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS pinned_messages (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  pinned_by INTEGER NOT NULL,
  pinned_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS blocked_ips (
  ip TEXT PRIMARY KEY,
  reason TEXT,
  blocked_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id INTEGER,
  client_id TEXT,
  ip TEXT,
  meta TEXT,
  source TEXT NOT NULL DEFAULT 'server'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`;

/** Bảng phục vụ Mức 3 (offline-first) + các bảng phụ trợ. */
const SCHEMA_V2_TABLES = `
CREATE TABLE IF NOT EXISTS vector_clocks (
  user_id INTEGER PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS action_queue (
  client_action_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  ok INTEGER NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, client_action_id)
);

CREATE TABLE IF NOT EXISTS client_log_ids (
  log_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_log_received ON client_log_ids(received_at);
`;

/** Thêm cột nếu chưa có (ALTER TABLE ADD COLUMN không có IF NOT EXISTS trong SQLite). */
function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const MIGRATIONS = [
  { version: 1, up: (db) => db.exec(SCHEMA_V1) },
  {
    version: 2,
    up: (db) => {
      // Spec 7.1 — Mức 3
      addColumnIfMissing(db, 'messages', 'vector_clock', 'TEXT');
      addColumnIfMissing(db, 'conversations', 'version', 'INTEGER DEFAULT 1');
      addColumnIfMissing(db, 'conversations', 'client_temp_id', 'TEXT');
      // LWW đổi tên nhóm theo (updated_at, user_id)
      addColumnIfMissing(db, 'conversations', 'name_updated_at', 'TEXT');
      addColumnIfMissing(db, 'conversations', 'name_updated_by', 'INTEGER');
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_client_temp ON conversations(client_temp_id) WHERE client_temp_id IS NOT NULL'
      );
      db.exec(SCHEMA_V2_TABLES);
    },
  },
  {
    version: 3,
    up: (db) => {
      // Trang Quản lý thành viên: lần đăng nhập gần nhất + IP
      addColumnIfMissing(db, 'users', 'last_login_at', 'TEXT');
      addColumnIfMissing(db, 'users', 'last_login_ip', 'TEXT');
    },
  },
];

/**
 * Chạy các migration chưa áp dụng, mỗi migration trong 1 transaction.
 * @param {import('better-sqlite3').Database} db
 */
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const current = (row && row.v) || 0;
  const insertVersion = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      migration.up(db);
      insertVersion.run(migration.version, new Date().toISOString());
    })();
  }
  return MIGRATIONS[MIGRATIONS.length - 1].version;
}

/**
 * Mở database server.
 * @param {string} dbFile đường dẫn server.db (từ paths.DB_SERVER)
 * @returns {import('better-sqlite3').Database}
 */
function openDatabase(dbFile) {
  if (path.basename(dbFile) !== 'server.db') {
    throw new Error(`database.js chỉ được mở server.db, nhận: ${dbFile}`);
  }
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.pragma('synchronous = NORMAL');
    migrate(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * Đóng DB an toàn (checkpoint WAL trước).
 * @param {import('better-sqlite3').Database} db
 */
function closeDatabase(db) {
  if (!db || !db.open) return;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

module.exports = { openDatabase, closeDatabase, migrate };
