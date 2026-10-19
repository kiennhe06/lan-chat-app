/**
 * Dữ liệu cho tab "Thành viên" của trang quản trị trên máy chủ (/admin).
 * Gộp: thông tin tài khoản + trạng thái online + lần đăng nhập cuối + thống kê tin/file/nhóm.
 * Chỉ đọc — không có thao tác sửa tài khoản.
 */
'use strict';

/**
 * @param {{ repos: object, hub: { onlineUserIds: () => number[] } }} deps
 */
function createMemberDirectory(deps) {
  const { repos, hub } = deps;

  /** Gom mảng thống kê [{user_id|sender_id, ...}] thành Map theo user id. */
  const indexBy = (rows, key) => new Map(rows.map((row) => [row[key], row]));

  /**
   * Danh sách mọi thành viên, online trước rồi theo tên.
   * @returns {object[]}
   */
  function listMembers() {
    const online = new Set(hub.onlineUserIds());
    const messageStats = indexBy(repos.messages.statsBySender(), 'sender_id');
    const groupStats = indexBy(repos.conversations.countGroupsByUser(), 'user_id');
    return repos.users
      .listAll()
      .map((u) => {
        const msg = messageStats.get(u.id) || {};
        return {
          id: u.id,
          username: u.username,
          employee_id: u.employee_id,
          display_name: u.display_name,
          role: u.role,
          online: online.has(u.id),
          created_at: u.created_at,
          last_login_at: u.last_login_at || null,
          last_login_ip: u.last_login_ip || null,
          messages_sent: msg.messages_sent || 0,
          files_sent: msg.files_sent || 0,
          last_message_at: msg.last_message_at || null,
          groups_count: (groupStats.get(u.id) || {}).groups_count || 0,
        };
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || a.display_name.localeCompare(b.display_name, 'vi'));
  }

  return { listMembers };
}

module.exports = { createMemberDirectory };
