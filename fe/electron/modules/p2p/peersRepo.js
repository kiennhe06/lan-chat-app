/**
 * Repository bảng `peers_cache` — peer đã thấy gần đây (phục vụ hiển thị/khôi phục, không dùng để auth).
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createPeersRepo(db) {
  const stmt = {
    upsert: db.prepare(`INSERT INTO peers_cache (user_id, display_name, last_ip, last_port, last_seen, server_online)
      VALUES (@user_id, @display_name, @last_ip, @last_port, @last_seen, @server_online)
      ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, last_ip = excluded.last_ip,
        last_port = excluded.last_port, last_seen = excluded.last_seen, server_online = excluded.server_online`),
    list: db.prepare('SELECT * FROM peers_cache ORDER BY last_seen DESC'),
    get: db.prepare('SELECT * FROM peers_cache WHERE user_id = ?'),
  };
  return {
    upsert(peer) {
      stmt.upsert.run({
        user_id: peer.user_id,
        display_name: peer.display_name || null,
        last_ip: peer.ip || null,
        last_port: peer.port || null,
        last_seen: peer.last_seen || new Date().toISOString(),
        server_online: peer.server_online ? 1 : 0,
      });
    },
    list: () => stmt.list.all(),
    get: (userId) => stmt.get.get(userId) || null,
  };
}

module.exports = { createPeersRepo };
