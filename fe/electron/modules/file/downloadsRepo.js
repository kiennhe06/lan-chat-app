/**
 * Repository bảng `downloads` — file đã tải về (client_message_id → local_path).
 */
'use strict';

const { nowIso } = require('../../core/utils/time');

/**
 * @param {import('better-sqlite3').Database} db
 */
function createDownloadsRepo(db) {
  const stmt = {
    set: db.prepare(`INSERT INTO downloads (client_message_id, local_path, file_sha256, downloaded_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(client_message_id) DO UPDATE SET local_path = excluded.local_path, file_sha256 = excluded.file_sha256,
        downloaded_at = excluded.downloaded_at`),
    get: db.prepare('SELECT * FROM downloads WHERE client_message_id = ?'),
    bySha: db.prepare('SELECT local_path FROM downloads WHERE file_sha256 = ? ORDER BY downloaded_at DESC'),
  };
  return {
    set: (cmid, localPath, sha) => stmt.set.run(cmid, localPath, sha || null, nowIso()).changes,
    get: (cmid) => stmt.get.get(cmid) || null,
    pathsBySha: (sha) => stmt.bySha.all(sha).map((r) => r.local_path),
  };
}

module.exports = { createDownloadsRepo };
