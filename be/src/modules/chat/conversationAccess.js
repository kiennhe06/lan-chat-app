/**
 * Truy cập + kiểm tra quyền thành viên conversation — dùng chung cho conversationService,
 * messageService, syncService (tránh phụ thuộc vòng giữa các service).
 *
 * conversation_id trên dây là string: "12" (id server) hoặc "temp-<uuid>" (nhóm tạo offline,
 * map qua conversations.client_temp_id).
 */
'use strict';

const C = require('../../shared/constants');
const { errors } = require('../../core/errors');

const NUMERIC_ID_RE = /^[1-9]\d{0,15}$/;

/**
 * @param {{ conversations: object }} repos
 */
function createConversationAccess(repos) {
  /**
   * Tìm conversation từ id trên dây.
   * @param {string|number} rawId
   * @returns {object} conversation row
   * @throws CONV_NOT_SYNCED (temp chưa map) | NOT_FOUND | VALIDATION
   */
  function resolve(rawId) {
    const id = rawId == null ? '' : String(rawId).trim();
    if (id.startsWith(C.TEMP_CONVERSATION_PREFIX)) {
      const conv = repos.conversations.findByClientTempId(id);
      if (!conv) throw errors.convNotSynced();
      return conv;
    }
    if (!NUMERIC_ID_RE.test(id)) throw errors.validation('Mã cuộc trò chuyện không hợp lệ');
    const conv = repos.conversations.findById(Number(id));
    if (!conv) throw errors.notFound('Cuộc trò chuyện không tồn tại');
    return conv;
  }

  /**
   * Yêu cầu user là thành viên.
   * @returns {{ conv: object, member: object }}
   */
  function requireMember(rawId, userId) {
    const conv = resolve(rawId);
    const member = repos.conversations.getMember(conv.id, userId);
    if (!member) throw errors.forbidden('Bạn không phải thành viên của cuộc trò chuyện này');
    return { conv, member };
  }

  /** Yêu cầu owner/admin (chỉ nhóm). */
  function requireGroupManager(rawId, userId) {
    const ctx = requireGroup(rawId, userId);
    if (!isManagerRole(ctx.member.role)) throw errors.forbidden('Chỉ trưởng nhóm hoặc phó nhóm được thực hiện');
    return ctx;
  }

  /** Yêu cầu là thành viên của một NHÓM. */
  function requireGroup(rawId, userId) {
    const ctx = requireMember(rawId, userId);
    if (ctx.conv.type !== C.CONVERSATION_TYPE.GROUP) throw errors.validation('Thao tác chỉ áp dụng cho nhóm');
    return ctx;
  }

  /** Danh sách user_id thành viên. */
  const memberIds = (convId) => repos.conversations.listMembers(convId).map((m) => m.user_id);

  /** user_id của owner/admin (nhận thông báo pending). */
  const managerIds = (convId) =>
    repos.conversations
      .listMembers(convId)
      .filter((m) => isManagerRole(m.role))
      .map((m) => m.user_id);

  return { resolve, requireMember, requireGroup, requireGroupManager, memberIds, managerIds };
}

const isManagerRole = (role) => role === C.GROUP_ROLE.OWNER || role === C.GROUP_ROLE.ADMIN;

module.exports = { createConversationAccess, isManagerRole, NUMERIC_ID_RE };
