/**
 * Repository bảng `p2p_files` — file nhận qua P2P (data/downloads-p2p/<sha256>/).
 */
'use strict';

const { nowIso } = require('../../core/utils/time');

/**
 * @param {import('better-sqlite3').Database} db
 */
function createP2pFilesRepo(db) {
  const stmt = {
    upsert: db.prepare(`INSERT INTO p2p_files (file_hash, local_path, file_size, mime_type, received_from_user_id, received_at, uploaded_to_server)
      VALUES (@file_hash, @local_path, @file_size, @mime_type, @received_from_user_id, @received_at, @uploaded_to_server)
      ON CONFLICT(file_hash) DO UPDATE SET local_path = excluded.local_path, file_size = excluded.file_size,
        mime_type = excluded.mime_type`),
    get: db.prepare('SELECT * FROM p2p_files WHERE file_hash = ?'),
    notUploaded: db.prepare('SELECT * FROM p2p_files WHERE uploaded_to_server = 0'),
    markUploaded: db.prepare('UPDATE p2p_files SET uploaded_to_server = 1 WHERE file_hash = ?'),
  };
  return {
    upsert(file) {
      stmt.upsert.run({
        file_hash: file.file_hash,
        local_path: file.local_path,
        file_size: file.file_size ?? null,
        mime_type: file.mime_type || null,
        received_from_user_id: file.received_from_user_id ?? null,
        received_at: file.received_at || nowIso(),
        uploaded_to_server: file.uploaded_to_server ? 1 : 0,
      });
    },
    get: (hash) => stmt.get.get(hash) || null,
    listNotUploaded: () => stmt.notUploaded.all(),
    markUploaded: (hash) => stmt.markUploaded.run(hash).changes,
  };
}

module.exports = { createP2pFilesRepo };
