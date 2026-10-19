/**
 * Repository bảng files (metadata). Nội dung file nằm trên đĩa data/attachments/<sha256>, không lưu blob.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createFileRepo(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO files (sha256, original_name, size, mime_type, has_thumb, width, height, uploaded_by, created_at)
      VALUES (@sha256, @original_name, @size, @mime_type, @has_thumb, @width, @height, @uploaded_by, @created_at)`),
    findById: db.prepare('SELECT * FROM files WHERE id = ?'),
    findBySha: db.prepare('SELECT * FROM files WHERE sha256 = ? ORDER BY id LIMIT 1'),
    findByShaAndName: db.prepare('SELECT * FROM files WHERE sha256 = ? AND original_name = ? ORDER BY id LIMIT 1'),
  };
  return {
    insert: (f) => Number(stmts.insert.run(f).lastInsertRowid),
    findById: (id) => stmts.findById.get(id),
    findBySha: (sha) => stmts.findBySha.get(sha),
    findByShaAndName: (sha, name) => stmts.findByShaAndName.get(sha, name),
  };
}

module.exports = { createFileRepo };
